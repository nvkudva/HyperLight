import os
from pathlib import Path
import threading
import time
from typing import Any, Callable, Dict, Iterable, Optional, Set
import watchdog.events
import watchdog.observers
import app_config
import embedder
import logging_config
import parsers
import scanner
import storage

logger = logging_config.get_logger("watcher")


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
        if p.name.startswith("."):
            return False
        parts = self._parts_below_watched_root(p)
        if any(scanner.is_ignored_dir(parent, name) for parent, name in zip(("",) + parts[:-2], parts[:-1])):
            return False
        return parsers.is_indexable(p.name)

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
            self._notify(path, "deleted")

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
                    self._notify(path, "modified")

    def _notify(self, path: str, event_type: str) -> None:
        """An exception here would end watchdog's observer thread and stop all live scanning."""
        try:
            self.callback(path, event_type)
        except Exception:
            logger.exception("Handling %s of %s failed", event_type, path)

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
        self.source_types: Dict[str, str] = {}
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
        for src_path, source_type in self.source_types.items():
            if file_path == src_path or file_path.startswith(src_path.rstrip("/") + "/"):
                source = source_type
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

            self.source_types = {
                s["path"]: s.get("source_type", "local") for s in app_config.get_configured_sources() if s.get("path")
            }

    def start(self) -> None:
        self.sync_sources()
        self.observer.start()

    def stop(self) -> None:
        self.handler.stop()
        self.observer.stop()
        self.observer.join()
