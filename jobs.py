"""Background indexing job queue (one active scan, rest wait in line)."""
import threading
from pathlib import Path
from typing import Any, Callable, Dict, List, NamedTuple, Optional

import app_state
import connectors
import google_auth
import logging_config
import sources

logger = logging_config.get_logger("jobs")


class Job(NamedTuple):
    path: Path
    source: str
    name: str
    options: Dict[str, Any]


class CloudSource(NamedTuple):
    name: str
    path: str
    kind: str
    run: Callable[..., Any]


def _sync_drive(progress, cancel, opts: Dict[str, Any]) -> None:
    google_auth.sync_google_drive(app_state.get_embedder(), app_state.get_storage(), on_progress=progress, cancel_check=cancel)


def _sync_photos(progress, cancel, opts: Dict[str, Any]) -> None:
    google_auth.sync_google_photos(app_state.get_embedder(), app_state.get_storage(), opts["session_id"], on_progress=progress, cancel_check=cancel)


def _sync_gmail(progress, cancel, opts: Dict[str, Any]) -> None:
    google_auth.sync_gmail(app_state.get_embedder(), app_state.get_storage(), on_progress=progress, cancel_check=cancel)


def _index_apps(progress, cancel, opts: Dict[str, Any]) -> None:
    connectors.index_applications(app_state.get_embedder(), app_state.get_storage())


def _index_settings(progress, cancel, opts: Dict[str, Any]) -> None:
    connectors.index_system_settings(app_state.get_embedder(), app_state.get_storage())


CLOUD_SOURCES: Dict[str, CloudSource] = {
    "google_drive_cloud": CloudSource("Google Drive", "https://drive.google.com", "google_drive", _sync_drive),
    "google_photos_cloud": CloudSource("Google Photos", str(google_auth.PHOTOS_CACHE_DIR), "google_photos", _sync_photos),
    "gmail_cloud": CloudSource("Gmail", "https://mail.google.com", "gmail", _sync_gmail),
}

# Indexed by a custom runner like the cloud sources, but local (not shown as a cloud job).
SYSTEM_SOURCES: Dict[str, CloudSource] = {
    "macos_apps": CloudSource("macOS Applications", "/Applications", sources.SYSTEM_SOURCE_TYPE, _index_apps),
    "macos_settings": CloudSource("macOS Settings", "x-apple.systempreferences:", sources.SYSTEM_SOURCE_TYPE, _index_settings),
}


class IndexJobManager:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.is_running = False
        self.cancel_requested = False
        self.current_folder = ""
        self.current_path = ""
        self.current_source = ""
        self.current_file = ""
        self.current_index = 0
        self.total_files = 0
        self.percent = 0.0
        self.indexed_items = 0
        self.status = "Idle"
        self.state = "idle"
        self.error_code = ""
        self.thread: Optional[threading.Thread] = None
        self.pending: List[Job] = []

    def get_status(self) -> Dict[str, Any]:
        with self.lock:
            jobs: List[Dict[str, Any]] = []
            if self.is_running and self.current_path:
                jobs.append({
                    "name": self.current_folder,
                    "path": self.current_path,
                    "state": "running",
                    "percent": round(self.percent, 1),
                    "current_index": self.current_index,
                    "total_files": self.total_files,
                })
            for job in self.pending:
                jobs.append({
                    "name": job.name,
                    "path": str(job.path),
                    "state": "queued",
                    "percent": 0.0,
                    "current_index": 0,
                    "total_files": 0,
                })
            return {
                "is_running": self.is_running,
                "cancel_requested": self.cancel_requested,
                "current_folder": self.current_folder,
                "current_path": self.current_path,
                "current_source": self.current_source,
                "current_file": self.current_file,
                "current_index": self.current_index,
                "total_files": self.total_files,
                "percent": round(self.percent, 1),
                "indexed_items": self.indexed_items,
                "status": self.status,
                "state": self.state,
                "error_code": self.error_code,
                "is_cloud": self.current_source in CLOUD_SOURCES,
                "queued": [job.name for job in self.pending],
                "jobs": jobs,
            }

    def start_indexing(self, path: Path, source: str, name: str, options: Optional[Dict[str, Any]] = None, rescan: bool = False) -> str:
        job = Job(path, source, name, {**(options or {}), "rescan": rescan})
        with self.lock:
            if self.is_running:
                if not any(j.path == path and j.source == source and bool(j.options.get("rescan")) == rescan for j in self.pending):
                    self.pending.append(job)
                return "queued"
            self.is_running = True
        self._launch(job)
        return "started"

    def _launch(self, job: Job) -> None:
        path, source, name = job.path, job.source, job.name
        with self.lock:
            self.state = "running"
            self.error_code = ""
            self.cancel_requested = False
            self.current_folder = name
            self.current_path = str(path)
            self.current_source = source
            self.current_file = ""
            self.current_index = 0
            self.total_files = 0
            self.percent = 0.0
            self.indexed_items = 0
            self.status = f"Preparing to scan '{name}'..."

        self.thread = threading.Thread(
            target=self._worker,
            args=(job,),
            daemon=True,
        )
        self.thread.start()

    def stop_indexing(self) -> None:
        with self.lock:
            self.pending.clear()
            if self.is_running:
                self.cancel_requested = True
                self.status = "Stopping scan..."

    def wait_until_idle(self, timeout: float = 30.0) -> None:
        thread = self.thread
        if thread is not None:
            thread.join(timeout)

    def _worker(self, job: Job) -> None:
        store = app_state.get_storage()
        sc = app_state.get_scanner()

        def on_progress(filename: str, current: int, total: int) -> None:
            with self.lock:
                self.current_file = filename
                self.current_index = current
                self.total_files = total
                self.percent = (current / total * 100.0) if total > 0 else 0.0
                self.status = f"Scanning file {current} of {total}..."

        def cancel_check() -> bool:
            with self.lock:
                return self.cancel_requested

        runner = CLOUD_SOURCES.get(job.source) or SYSTEM_SOURCES.get(job.source)
        if runner:
            name, track_path, kind = runner.name, runner.path, runner.kind
        else:
            name, track_path, kind = job.name, str(job.path), job.source
        try:
            if job.options.get("rescan"):
                pre_count = store.count_items_by_path(track_path)
                store.remove_items_by_path(track_path)
                sources.record_scan(name, track_path, kind, pre_count)
            else:
                sources.record_scan(name, track_path, kind, store.count_items_by_path(track_path))
            if runner:
                runner.run(on_progress, cancel_check, job.options)
            else:
                sc.scan_path(job.path, source=job.source, on_progress=on_progress, cancel_check=cancel_check)
            total_items = store.count_items_by_path(track_path)
            sources.record_scan(name, track_path, kind, total_items)
            with self.lock:
                if self.cancel_requested:
                    self.state = "cancelled"
                    self.status = f"Scan stopped. Indexed {total_items} items so far."
                else:
                    self.state = "finished"
                    self.percent = 100.0
                    self.status = f"Finished! Indexed {total_items} items from '{name}'."
                self.indexed_items = total_items
        except Exception as e:
            with self.lock:
                self.state = "error"
                self.error_code = "reauth_required" if isinstance(e, google_auth.GoogleScopeError) else ""
                self.status = f"Error during indexing: {e}"
        finally:
            with self.lock:
                self.cancel_requested = False
                next_job = self.pending.pop(0) if self.pending else None
                self.is_running = next_job is not None
            if next_job:
                self._launch(next_job)
