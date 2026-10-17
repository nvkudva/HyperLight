"""Background indexing job queue (one active scan, rest wait in line)."""
import os
import dataclasses
import threading
from pathlib import Path
from typing import Any, Callable, Dict, List, NamedTuple, Optional

import app_state
import connectors
import google_sync
import logging_config
import sources

logger = logging_config.get_logger("jobs")


class Job(NamedTuple):
    path: Path
    source: str
    name: str
    options: Dict[str, Any]

    def tracked_path(self) -> str:
        """Path the source is recorded under; runners use their fixed one."""
        runner = sources.RUNNERS.get(self.source)
        return runner.path if runner else str(self.path)


def _sync_drive(progress, cancel, opts: Dict[str, Any]) -> None:
    google_sync.sync_google_drive(app_state.get_embedder(), app_state.get_storage(), on_progress=progress, cancel_check=cancel)


def _sync_photos(progress, cancel, opts: Dict[str, Any]) -> None:
    google_sync.sync_google_photos(app_state.get_embedder(), app_state.get_storage(), opts["session_id"], on_progress=progress, cancel_check=cancel)


def _sync_gmail(progress, cancel, opts: Dict[str, Any]) -> None:
    google_sync.sync_gmail(app_state.get_embedder(), app_state.get_storage(), on_progress=progress, cancel_check=cancel)


def _index_apps(progress, cancel, opts: Dict[str, Any]) -> None:
    connectors.index_applications(app_state.get_embedder(), app_state.get_storage())


def _index_settings(progress, cancel, opts: Dict[str, Any]) -> None:
    connectors.index_system_settings(app_state.get_embedder(), app_state.get_storage())


# How each sources.RUNNERS entry indexes; the registry holds what they are.
RUN_FUNCTIONS: Dict[str, Callable[..., Any]] = {
    "google_drive_cloud": _sync_drive,
    "google_photos_cloud": _sync_photos,
    "gmail_cloud": _sync_gmail,
    "macos_apps": _index_apps,
    "macos_settings": _index_settings,
}
assert RUN_FUNCTIONS.keys() == sources.RUNNERS.keys()


@dataclasses.dataclass
class JobProgress:
    """What the active (or last) job reports; a fresh one per job, so nothing leaks between runs."""
    current_folder: str = ""
    current_path: str = ""
    current_source: str = ""
    current_file: str = ""
    current_index: int = 0
    total_files: int = 0
    percent: float = 0.0
    indexed_items: int = 0
    parsed_files: int = 0
    status: str = "Idle"
    state: str = "idle"
    error_code: str = ""


class IndexJobManager:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.is_running = False
        self.cancel_requested = False
        self.progress = JobProgress()
        self.thread: Optional[threading.Thread] = None
        self.pending: List[Job] = []

    def get_status(self) -> Dict[str, Any]:
        with self.lock:
            progress = self.progress
            current_runner = sources.RUNNERS.get(progress.current_source)
            jobs: List[Dict[str, Any]] = []
            if self.is_running and progress.current_path:
                jobs.append({
                    "name": progress.current_folder,
                    "path": progress.current_path,
                    "state": "running",
                    "percent": round(progress.percent, 1),
                    "current_index": progress.current_index,
                    "parsed_files": progress.parsed_files,
                    "total_files": progress.total_files,
                })
            for job in self.pending:
                jobs.append({
                    "name": job.name,
                    "path": job.tracked_path(),
                    "state": "queued",
                    "percent": 0.0,
                    "current_index": 0,
                    "total_files": 0,
                })
            return {
                **dataclasses.asdict(progress),
                "percent": round(progress.percent, 1),
                "is_running": self.is_running,
                "cancel_requested": self.cancel_requested,
                "is_cloud": current_runner is not None and current_runner.is_cloud,
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
        with self.lock:
            self.cancel_requested = False
            self.progress = JobProgress(
                current_folder=job.name,
                current_path=job.tracked_path(),
                current_source=job.source,
                status=f"Preparing to scan '{job.name}'...",
                state="running",
            )

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
                self.progress.status = "Stopping scan..."

    def wait_until_idle(self, timeout: float = 30.0) -> None:
        thread = self.thread
        if thread is not None:
            thread.join(timeout)

    def _worker(self, job: Job) -> None:
        store = app_state.get_storage()
        sc = app_state.get_scanner()

        def on_progress(filename: str, current: int, total: int) -> None:
            with self.lock:
                progress = self.progress
                progress.current_file = filename
                progress.current_index = current
                progress.total_files = total
                progress.percent = (current / total * 100.0) if total > 0 else 0.0
                progress.status = f"Scanning file {current} of {total}..."

        def on_parsed(parsed_files: int) -> None:
            with self.lock:
                self.progress.parsed_files = parsed_files

        def cancel_check() -> bool:
            with self.lock:
                return self.cancel_requested

        runner = sources.RUNNERS.get(job.source)
        track_path = job.tracked_path()
        name, kind = (runner.name, runner.kind) if runner else (job.name, job.source)
        try:
            if job.options.get("rescan"):
                store.remove_items_by_path(track_path)
            sources.record_scan(name, track_path, kind)
            if runner:
                RUN_FUNCTIONS[job.source](on_progress, cancel_check, job.options)
            else:
                if job.path.is_dir():
                    os.listdir(job.path)  # PermissionError (no Full Disk Access) must not look like an empty folder
                sc.scan_path(job.path, source=job.source, on_progress=on_progress, cancel_check=cancel_check, on_parsed=on_parsed)
            sources.record_scan(name, track_path, kind)
            total_items = store.count_items_by_path(track_path)
            with self.lock:
                progress = self.progress
                if self.cancel_requested:
                    progress.state = "cancelled"
                    progress.status = f"Scan stopped. Indexed {total_items} items so far."
                else:
                    progress.state = "finished"
                    progress.percent = 100.0
                    progress.status = f"Finished! Indexed {total_items} items from '{name}'."
                progress.indexed_items = total_items
        except Exception as e:
            with self.lock:
                progress = self.progress
                progress.state = "error"
                if isinstance(e, PermissionError):
                    progress.error_code = "full_disk_access"
                    progress.status = f"Hyperlight can't read '{name}'. Allow it under Settings > Permissions, then rescan."
                else:
                    progress.error_code = "reauth_required" if isinstance(e, google_sync.GoogleScopeError) else ""
                    progress.status = f"Error during indexing: {e}"
        finally:
            with self.lock:
                self.cancel_requested = False
                next_job = self.pending.pop(0) if self.pending else None
                self.is_running = next_job is not None
            if next_job:
                self._launch(next_job)
