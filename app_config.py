"""Local JSON config: indexed sources and app settings (~/.hyperlight/config.json)."""
import contextlib
import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

logger = logging.getLogger(__name__)

CONFIG_PATH = Path.home() / ".hyperlight" / "config.json"

# Jobs, the watcher and request handlers all read-modify-write this file.
_lock = threading.RLock()

DEFAULT_SETTINGS: Dict[str, Any] = {
    "always_on_scanning": True,
    "custom_instructions": "",
    "hotkey_enabled": True,
    "hotkey": "double_ctrl",
    "hotkey_voice": True,
}


def _read_config() -> Dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {"sources": [], "settings": dict(DEFAULT_SETTINGS)}
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"sources": [], "settings": dict(DEFAULT_SETTINGS)}
        if "settings" not in data or not isinstance(data["settings"], dict):
            data["settings"] = dict(DEFAULT_SETTINGS)
        if "sources" not in data or not isinstance(data["sources"], list):
            data["sources"] = []
        return data
    except (OSError, ValueError):
        # Keep the unreadable file so the next write cannot silently erase sources.
        backup = CONFIG_PATH.with_name(f"config.corrupt-{int(time.time())}.json")
        with contextlib.suppress(OSError):
            CONFIG_PATH.replace(backup)
        logger.error("Unreadable %s moved to %s", CONFIG_PATH, backup)
        return {"sources": [], "settings": dict(DEFAULT_SETTINGS)}


def _write_config(data: Dict[str, Any]) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = CONFIG_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(tmp, CONFIG_PATH)


@contextlib.contextmanager
def _editing() -> Iterator[Dict[str, Any]]:
    """Locked read-modify-write of the config; saves when the block exits cleanly."""
    with _lock:
        data = _read_config()
        yield data
        _write_config(data)


def _resolve(path: str) -> str:
    head, sep, _ = path.partition(":")
    if sep and "/" not in head and head[:1].isalpha():
        return path  # URL-like source (https:, x-apple.systempreferences:), not a file path
    return str(Path(path).expanduser().resolve())


def _matches(s_path: str, path: str, resolved_path: str) -> bool:
    return bool(s_path) and (s_path == path or _resolve(s_path) == resolved_path)


def get_app_settings() -> Dict[str, Any]:
    data = _read_config()
    settings = data.get("settings", {})
    for key, default in DEFAULT_SETTINGS.items():
        if key not in settings:
            settings[key] = default
    return settings


def update_app_settings(updates: Dict[str, Any]) -> Dict[str, Any]:
    with _editing() as data:
        current = data.get("settings", {})
        current.update(updates)
        data["settings"] = current
    return current


def get_configured_sources() -> List[Dict[str, Any]]:
    data = _read_config()
    sources = data.get("sources", [])
    for s in sources:
        if "watch_enabled" not in s:
            s["watch_enabled"] = True
    return sources


def save_configured_source(
    name: str, path: str, source_type: str, items_count: int, watch_enabled: Optional[bool] = None
) -> None:
    resolved_path = _resolve(path)
    with _editing() as data:
        sources = data.get("sources", [])
        found = False
        for s in sources:
            if _matches(s.get("path", ""), path, resolved_path):
                s["name"] = name
                s["path"] = resolved_path
                s["source_type"] = source_type
                s["items_count"] = items_count
                s["last_scanned"] = time.time()
                if watch_enabled is not None:
                    s["watch_enabled"] = watch_enabled
                elif "watch_enabled" not in s:
                    s["watch_enabled"] = True
                found = True
                break
        if not found:
            sources.append({
                "name": name,
                "path": resolved_path,
                "source_type": source_type,
                "items_count": items_count,
                "last_scanned": time.time(),
                "watch_enabled": True if watch_enabled is None else watch_enabled,
            })
        data["sources"] = sources


def reset_source_counts() -> None:
    with _editing() as data:
        for s in data["sources"]:
            s["items_count"] = 0
            s["last_scanned"] = 0


def set_source_watch(path: str, enabled: bool) -> None:
    resolved_path = _resolve(path)
    with _editing() as data:
        for s in data["sources"]:
            if _matches(s.get("path", ""), path, resolved_path):
                s["watch_enabled"] = enabled
                break


def remove_configured_source(path: str) -> None:
    resolved_path = _resolve(path)
    with _editing() as data:
        data["sources"] = [
            s for s in data["sources"]
            if not _matches(s.get("path", ""), path, resolved_path)
        ]
