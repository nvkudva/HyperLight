"""Source registry: configured sources, kept in step with the index and the live watcher.

Every change to a Source goes through here, so callers never have to remember
to resync the watcher, and "can this Source be live-scanned?" has one answer.
"""
import os
from typing import Any, Dict, List, NamedTuple, Optional, Set, Tuple

import app_config
import app_state
import google_auth

SYSTEM_SOURCE_TYPE = "macos_system"


class Runner(NamedTuple):
    """A source indexed by its own code instead of a folder scan."""
    name: str
    path: str  # fixed path the source is recorded under
    kind: str  # source_type of the records it writes
    is_cloud: bool
    rescannable: bool  # can run again without user input (Photos needs a picker session)
    extra_paths: Tuple[str, ...] = ()  # other locations its rows live under, so removal and rescan reach them


RUNNERS: Dict[str, Runner] = {
    "google_drive_cloud": Runner("Google Drive", "https://drive.google.com", "google_drive", True, True, ("https://docs.google.com",)),
    "google_photos_cloud": Runner("Google Photos", str(google_auth.PHOTOS_CACHE_DIR.resolve()), "google_photos", True, False),
    "gmail_cloud": Runner("Gmail", "https://mail.google.com", "gmail", True, True),
    "macos_apps": Runner("Application", "/Applications", SYSTEM_SOURCE_TYPE, False, True, ("/System/Applications",)),
    "macos_settings": Runner("System Settings", "x-apple.systempreferences:", SYSTEM_SOURCE_TYPE, False, True),
}


def runner_of(source: Dict[str, Any]) -> Optional[str]:
    """Key of the runner that indexes `source`, or None for a plain folder."""
    for key, runner in RUNNERS.items():
        if source.get("path") == runner.path and source.get("source_type") == runner.kind:
            return key
    return None


def is_watchable(source: Dict[str, Any]) -> bool:
    return runner_of(source) is None and not source.get("path", "").startswith("http")


def list_all() -> List[Dict[str, Any]]:
    """Configured sources, with item counts read live from the index."""
    store = app_state.get_storage()
    listed = []
    for s in app_config.get_configured_sources():
        key = runner_of(s)
        name = RUNNERS[key].name if key else s.get("name")  # config may hold a name from an older release
        listed.append({**s, "name": name, "items_count": count_rows(s["path"]), "watchable": is_watchable(s), "runner": key})
    return listed


def row_paths(path: str) -> List[str]:
    """Every path whose rows belong to the source recorded under `path`."""
    runner = next((r for r in RUNNERS.values() if r.path == path), None)
    return [path, *runner.extra_paths] if runner else [path]


def count_rows(path: str) -> int:
    store = app_state.get_storage()
    return sum(store.count_items_by_path(p) for p in row_paths(path))


def remove_rows(path: str) -> None:
    store = app_state.get_storage()
    for p in row_paths(path):
        store.remove_items_by_path(p)


def watched_paths() -> Set[str]:
    """Paths the live watcher should cover right now."""
    if not app_config.get_app_settings().get("always_on_scanning", True):
        return set()
    return {
        s["path"]
        for s in app_config.get_configured_sources()
        if is_watchable(s) and s.get("watch_enabled", True) and os.path.exists(s["path"])
    }


def record_scan(name: str, path: str, source_type: str) -> None:
    app_config.save_configured_source(name, path, source_type)
    refresh()


def mark_unscanned() -> None:
    app_config.reset_scan_times()


def set_watch(path: str, enabled: bool) -> None:
    app_config.set_source_watch(path, enabled)
    refresh()


def remove(path: str) -> bool:
    """Forget a source; a scan of it is stopped first so it cannot write rows or re-register itself.

    False, with nothing removed, when the scan has not stopped yet: the caller should retry.
    """
    if not app_state.get_jobs().cancel_source(path):
        return False
    remove_rows(path)
    app_config.remove_configured_source(path)
    refresh()
    return True


def refresh() -> None:
    """Re-apply watched_paths() to the live watcher, e.g. after a settings change.

    A watcher that has not started yet syncs when it starts, so this never
    forces the embedding model to load.
    """
    live_watcher = app_state.peek_watcher()
    if live_watcher is not None:
        live_watcher.sync_sources()
