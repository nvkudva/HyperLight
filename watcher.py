import os
from pathlib import Path
import threading
import time
from typing import Callable, Dict, Optional, Set
import watchdog.events
import watchdog.observers
import embedder
import scanner
import storage

class DebouncedHandler(watchdog.events.FileSystemEventHandler):
    def __init__(self, callback: Callable[[str, str], None]):
        super().__init__()
        self.callback = callback
        self.pending_events: Dict[str, float] = {}
        self.lock = threading.Lock()
        self.running = True
        self.worker = threading.Thread(target=self._process_queue, daemon=True)
        self.worker.start()

    def _should_handle(self, path: str) -> bool:
        p = Path(path)
        if p.name.startswith(".") or any(part in scanner.IGNORED_DIRS for part in p.parts):
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

    def on_deleted(self, event: watchdog.events.FileSystemEvent) -> None:
        if not event.is_directory and self._should_handle(event.src_path):
            with self.lock:
                self.pending_events.pop(event.src_path, None)
            self.callback(event.src_path, "deleted")

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
        on_indexed: Optional[Callable[[str, str], None]] = None,
    ):
        self.embedder = emb
        self.storage = store
        self.scanner = sc
        self.on_indexed = on_indexed
        self.observer = watchdog.observers.Observer()
        self.handler = DebouncedHandler(self._handle_file_event)
        self.watched_paths: Set[str] = set()

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
            if file_path.startswith(src.get("path", "")):
                source = src.get("source_type", "local")
                break

        count = self.scanner.scan_path(p, source=source)
        if self.on_indexed and count > 0:
            self.on_indexed(p.name, "indexed")

    def sync_sources(self) -> None:
        sources = storage.get_configured_sources()
        target_paths = {s["path"] for s in sources if s.get("source_type") != "macos_system" and os.path.exists(s["path"])}

        # Add new sources
        for path in target_paths:
            if path not in self.watched_paths:
                try:
                    self.observer.schedule(self.handler, path, recursive=True)
                    self.watched_paths.add(path)
                except Exception:
                    pass

    def start(self) -> None:
        self.sync_sources()
        self.observer.start()

    def stop(self) -> None:
        self.handler.stop()
        self.observer.stop()
        self.observer.join()
