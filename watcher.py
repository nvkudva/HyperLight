import os
from pathlib import Path
import threading
import time
from typing import Any, Callable, Dict, Iterable, Optional, Set
import watchdog.events
import watchdog.observers
import embedder
import scanner
import storage

class DebouncedHandler(watchdog.events.FileSystemEventHandler):
    def __init__(self, callback: Callable[[str, str], None], watched_roots: Callable[[], Iterable[str]] = lambda: ()):
        super().__init__()
        self.callback = callback
        self.watched_roots = watched_roots
        self.pending_events: Dict[str, float] = {}
        self.lock = threading.Lock()
        self.running = True
        self.worker = threading.Thread(target=self._process_queue, daemon=True)
        self.worker.start()

    def _parts_below_watched_root(self, path: Path) -> tuple:
        """Path parts under the watched folder that contains it; the folders above it
        (e.g. ~/Library for Apple Mail) are the user's choice, not noise to skip."""
        containing_roots = [Path(root) for root in list(self.watched_roots()) if path.is_relative_to(root)]
        if not containing_roots:
            return path.parts
        return path.relative_to(max(containing_roots, key=lambda root: len(root.parts))).parts

    def _should_handle(self, path: str) -> bool:
        p = Path(path)
        if p.name.startswith(".") or any(part in scanner.IGNORED_DIRS for part in self._parts_below_watched_root(p)):
            return False
        return p.suffix.lower() in scanner.ALL_EXTENSIONS

    def on_created(self, event: watchdog.events.FileSystemEvent) -> None:
        if not event.is_directory and self._should_handle(event.src_path):
            with self.lock:
                self.pending_events[event.src_path] = time.time()

    def on_modified(self, event: watchdog.events.FileSystemEvent) -> None:
        if not event.is_directory and self._should_handle(event.src_path):
            with self.lock:
                self.pending_events[event.src_path] = time.time()

    def _deleted(self, path: str, is_directory: bool) -> None:
        if is_directory or self._should_handle(path):
            with self.lock:
                self.pending_events.pop(path, None)
            self.callback(path, "deleted")

    def on_deleted(self, event: watchdog.events.FileSystemEvent) -> None:
        self._deleted(event.src_path, event.is_directory)

    def on_moved(self, event: watchdog.events.FileSystemEvent) -> None:
        self._deleted(event.src_path, event.is_directory)
        if event.is_directory or self._should_handle(event.dest_path):
            with self.lock:
                self.pending_events[event.dest_path] = time.time()

    def _process_queue(self) -> None:
        while self.running:
            time.sleep(0.3)
            now = time.time()
            ready_paths = []
            with self.lock:
                for path, timestamp in list(self.pending_events.items()):
                    if now - timestamp >= 0.5:
                        ready_paths.append(path)
                        del self.pending_events[path]
            for path in ready_paths:
                if os.path.exists(path):
                    self.callback(path, "modified")

    def stop(self) -> None:
        self.running = False

class LiveWatcher:
    def __init__(
        self,
        emb: embedder.Embedder,
        store: storage.Storage,
        sc: scanner.Scanner,
        watched_paths: Callable[[], Set[str]],
        on_indexed: Optional[Callable[[str, str], None]] = None,
    ):
        self.watched_paths_fn = watched_paths
        self.embedder = emb
        self.storage = store
        self.scanner = sc
        self.on_indexed = on_indexed
        self.observer = watchdog.observers.Observer()
        self.watches: Dict[str, Any] = {}
        self.handler = DebouncedHandler(self._handle_file_event, lambda: self.watches.keys())
        self.watched_paths: Set[str] = set()
        self.lock = threading.Lock()

    def _handle_file_event(self, file_path: str, event_type: str) -> None:
        p = Path(file_path)
        if event_type == "deleted":
            self.storage.remove_items_by_path(file_path)
            if self.on_indexed:
                self.on_indexed(p.name, "deleted")
            return

        if not p.exists():
            return

        source = "local"
        for src in storage.get_configured_sources():
            src_path = src.get("path", "")
            if src_path and (file_path == src_path or file_path.startswith(src_path.rstrip("/") + "/")):
                source = src.get("source_type", "local")
                break

        count = self.scanner.scan_path(p, source=source)
        if self.on_indexed and count > 0:
            self.on_indexed(p.name, "indexed")

    def sync_sources(self) -> None:
        with self.lock:
            target_paths = self.watched_paths_fn()

            # Unschedule paths that should no longer be watched
            current_paths = set(self.watches.keys())
            for path in current_paths - target_paths:
                watch = self.watches.pop(path, None)
                if watch:
                    try:
                        self.observer.unschedule(watch)
                    except Exception:
                        pass

            # Schedule new paths
            for path in target_paths - current_paths:
                try:
                    w = self.observer.schedule(self.handler, path, recursive=True)
                    self.watches[path] = w
                except Exception:
                    pass

            self.watched_paths = set(self.watches.keys())

    def start(self) -> None:
        self.sync_sources()
        self.observer.start()

    def stop(self) -> None:
        self.handler.stop()
        self.observer.stop()
        self.observer.join()
