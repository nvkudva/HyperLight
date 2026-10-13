"""Source registry: configured sources, kept in step with the index and the live watcher.

Every change to a Source goes through here, so callers never have to remember
to resync the watcher, and "can this Source be live-scanned?" has one answer.
"""
import os
from typing import Any, Dict, List, Set

import app_config
import app_state
import google_auth

SYSTEM_SOURCE_TYPE = "macos_system"


def is_watchable(source: Dict[str, Any]) -> bool:
    path = source.get("path", "")
    return (
        source.get("source_type") != SYSTEM_SOURCE_TYPE
        and not path.startswith("http")
        and path != str(google_auth.PHOTOS_CACHE_DIR.resolve())
    )


def list_all() -> List[Dict[str, Any]]:
    return [{**s, "watchable": is_watchable(s)} for s in app_config.get_configured_sources()]


def watched_paths() -> Set[str]:
    """Paths the live watcher should cover right now."""
    if not app_config.get_app_settings().get("always_on_scanning", True):
        return set()
    return {
        s["path"]
        for s in app_config.get_configured_sources()
        if is_watchable(s) and s.get("watch_enabled", True) and os.path.exists(s["path"])
    }


def record_scan(name: str, path: str, source_type: str, items_count: int) -> None:
    app_config.save_configured_source(name, path, source_type, items_count)
    refresh()


def set_watch(path: str, enabled: bool) -> None:
    app_config.set_source_watch(path, enabled)
    refresh()


def remove(path: str) -> None:
    app_state.get_storage().remove_items_by_path(path)
    app_config.remove_configured_source(path)
    refresh()


def refresh() -> None:
    """Re-apply watched_paths() to the live watcher, e.g. after a settings change."""
    app_state.get_watcher().sync_sources()
