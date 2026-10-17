from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
import os
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Set, Tuple
import embedder
import parsers
import storage

IGNORED_DIRS = {
    ".git", ".venv", "venv", "node_modules", "__pycache__", ".cache",
    "build", "dist", ".Trash", ".idea", ".vscode", "Library", ".npm",
}


def is_ignored_dir(parent: str, name: str) -> bool:
    # A Photos library keeps resized derivatives and caches beside each original; index originals only.
    if parent.endswith(".photoslibrary") and name != "originals":
        return True
    return name.endswith(".app") or name in IGNORED_DIRS

def collect_supported_files(target_path: Path) -> List[Tuple[Path, float, int]]:
    if target_path.is_file():
        st = target_path.stat()
        return [(target_path, st.st_mtime, st.st_size)]
    files: List[Tuple[Path, float, int]] = []
    stack = [str(target_path)]
    while stack:
        curr = stack.pop()
        try:
            with os.scandir(curr) as it:
                for entry in it:
                    name = entry.name
                    if name.startswith("."):
                        continue
                    if entry.is_dir(follow_symlinks=False):
                        if is_ignored_dir(curr, name):
                            continue
                        stack.append(entry.path)
                    elif entry.is_file(follow_symlinks=False):
                        if parsers.is_indexable(name):
                            try:
                                st = entry.stat(follow_symlinks=False)
                                files.append((Path(entry.path), st.st_mtime, st.st_size))
                            except Exception:
                                pass
        except (PermissionError, FileNotFoundError):
            continue
    return files

def embed_and_store(
    emb: Any,
    store: Any,
    doc_records: List[Dict[str, Any]],
    source: str,
    batch_size: int = 32,
    replace_paths: Sequence[str] = (),
) -> int:
    if not doc_records and not replace_paths:
        return 0
    unembedded = [r for r in doc_records if "vector" not in r]
    if unembedded:
        texts = [r["content"] for r in unembedded]
        titles = [r.get("repo_path") or r.get("filename", "") for r in unembedded]
        vectors = emb.embed_texts(texts, titles=titles, batch_size=batch_size)
        for r, vec in zip(unembedded, vectors):
            r["vector"] = vec
    for r in doc_records:
        r["source"] = source
    return store.add_items(doc_records, replace_paths=replace_paths)

class ProgressReporter:
    """Throttles progress callbacks to one per MIN_INTERVAL_SECONDS, plus the last file.

    The UI polls every 100ms, so reporting faster only burns the job
    manager's lock; reporting slower makes the file count jump in chunks.
    """

    MIN_INTERVAL_SECONDS = 0.1

    def __init__(
        self,
        callback: Optional[Callable[[str, int, int], None]],
        total: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.callback = callback
        self.total = total
        self.clock = clock
        self.last_reported_at: Optional[float] = None

    def report(self, filename: str, processed: int) -> None:
        if self.callback is None or self.total <= 0:
            return
        now = self.clock()
        is_last = processed >= self.total
        is_due = self.last_reported_at is None or now - self.last_reported_at >= self.MIN_INTERVAL_SECONDS
        if is_last or is_due:
            self.last_reported_at = now
            self.callback(filename, processed, self.total)


class Scanner:
    def __init__(self, emb: embedder.Embedder, store: storage.Storage):
        self.embedder = emb
        self.storage = store

    def scan_path(
        self,
        target_path: Path,
        source: str = "local",
        on_progress: Optional[Callable[[str, int, int], None]] = None,
        cancel_check: Optional[Callable[[], bool]] = None,
        on_parsed: Optional[Callable[[int], None]] = None,
    ) -> int:
        if not target_path.exists():
            return 0

        files_to_process = collect_supported_files(target_path)
        total_files = len(files_to_process)
        if total_files == 0:
            return 0

        indexed_mtimes = self.storage.get_indexed_file_mtimes(under=str(target_path))
        indexed_items = 0

        doc_buffer: List[Dict[str, Any]] = []
        image_buffer: List[Path] = []
        # Edited files whose old rows the next flush of their buffer replaces.
        doc_replace: List[str] = []
        image_replace: List[str] = []
        stale_paths: Set[str] = set()
        BATCH_SIZE = 64
        IMG_BATCH_SIZE = 16
        MAX_QUEUED_BATCHES = 4

        embed_pool = ThreadPoolExecutor(max_workers=1)
        pending: List[Future] = []

        def submit_embedding(fn, *args):
            # Parsing outruns embedding by a wide margin; without a bound the
            # progress bar hits 100% and every parsed batch piles up in memory.
            while True:
                unfinished = [f for f in pending if not f.done()]
                if len(unfinished) < MAX_QUEUED_BATCHES:
                    break
                wait(unfinished, return_when=FIRST_COMPLETED)
            pending.append(embed_pool.submit(fn, *args))

        def flush_docs():
            nonlocal doc_buffer, doc_replace
            if not doc_buffer and not doc_replace:
                return
            batch, doc_buffer = doc_buffer, []
            replace, doc_replace = doc_replace, []
            submit_embedding(embed_and_store, self.embedder, self.storage, batch, source, BATCH_SIZE, replace)

        def flush_images():
            nonlocal image_buffer, image_replace
            if not image_buffer and not image_replace:
                return
            batch, image_buffer = image_buffer, []
            replace, image_replace = image_replace, []
            submit_embedding(self._embed_image_batch, batch, source, IMG_BATCH_SIZE, replace)

        # on_progress only advances as embedding drains the queue; this counter
        # runs ahead of it so the UI can show parsing speed separately.
        parsed_files = 0
        parsed_lock = threading.Lock()

        def count_parsed(newly_parsed: int) -> None:
            nonlocal parsed_files
            with parsed_lock:
                parsed_files += newly_parsed
                total_parsed = parsed_files
            if on_parsed:
                on_parsed(total_parsed)

        def parse_and_count(file_path: Path) -> Tuple[str, Path, List[Dict[str, Any]]]:
            parsed = parsers.parse(file_path, self.embedder)
            count_parsed(1)
            return parsed

        workers = min(8, os.cpu_count() or 4)
        CHUNK_SIZE = 64
        reporter = ProgressReporter(on_progress, total_files)
        processed_files = 0

        # One pool per scan, not per chunk: creating and tearing down a pool
        # for every 64 files churns threads for no reason.
        pool = ThreadPoolExecutor(max_workers=workers)
        cancelled = False
        try:
            try:
                for chunk_start in range(0, total_files, CHUNK_SIZE):
                    if cancel_check and cancel_check():
                        cancelled = True
                        break

                    chunk_files = files_to_process[chunk_start : chunk_start + CHUNK_SIZE]
                    files_to_parse = []
                    for file_path, st_mtime, st_size in chunk_files:
                        resolved_str = str(file_path.resolve())
                        if resolved_str in indexed_mtimes:
                            if abs(indexed_mtimes[resolved_str] - st_mtime) < 0.01:
                                continue
                            # Chunk ids derive from path + index and add_items skips known ids,
                            # so an edited file must replace its old rows, not add to them.
                            stale_paths.add(resolved_str)
                        files_to_parse.append(file_path)

                    # Already-indexed files count as processed without parsing.
                    skipped_files = len(chunk_files) - len(files_to_parse)
                    processed_files += skipped_files
                    if skipped_files:
                        count_parsed(skipped_files)
                    if not files_to_parse:
                        reporter.report(chunk_files[-1][0].name, processed_files)
                        continue

                    # map streams results in order so progress and embedding
                    # advance file-by-file instead of waiting for the whole chunk.
                    for kind, fp, chunks in pool.map(parse_and_count, files_to_parse):
                        resolved_fp = str(fp.resolve())
                        if resolved_fp in stale_paths:
                            (image_replace if kind == "image" else doc_replace).append(resolved_fp)
                        if kind == "image":
                            image_buffer.append(fp)
                            if len(image_buffer) >= IMG_BATCH_SIZE:
                                flush_images()
                        elif kind == "doc" and chunks:
                            doc_buffer.extend(chunks)
                            if len(doc_buffer) >= BATCH_SIZE:
                                flush_docs()
                        processed_files += 1
                        reporter.report(fp.name, processed_files)
            finally:
                pool.shutdown(wait=True)

            if not cancelled:
                flush_docs()
                flush_images()
            total_batches = len(pending)
            for i, future in enumerate(pending):
                if not cancelled and cancel_check and cancel_check():
                    cancelled = True
                if cancelled:
                    # Queued batches must not write once the scan is stopped
                    # (a Reset would otherwise be repopulated behind its back).
                    embed_pool.shutdown(wait=True, cancel_futures=True)
                if future.cancelled():
                    continue
                if total_batches > 1:
                    reporter.report(f"Embedding batch {i + 1}/{total_batches}...", processed_files)
                indexed_items += future.result()
        finally:
            embed_pool.shutdown(wait=True, cancel_futures=True)

        return indexed_items

    def _embed_image_batch(self, image_buffer: List[Path], source: str, batch_size: int, replace_paths: Sequence[str] = ()) -> int:
        vectors = self.embedder.embed_images(image_buffer, batch_size=batch_size) if image_buffer else []
        records = []
        for img_path, vec in zip(image_buffer, vectors):
            if vec is None:
                continue
            records.append({**parsers.build_photo_record(img_path, vec), "source": source})
        return self.storage.add_items(records, replace_paths=replace_paths)
