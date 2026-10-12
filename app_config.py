"""Local JSON config: indexed sources and app settings (~/.hyperlight/config.json)."""
import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

CONFIG_PATH = Path.home() / ".hyperlight" / "config.json"

DEFAULT_SETTINGS: Dict[str, Any] = {"always_on_scanning": True, "custom_instructions": ""}


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
    except Exception:
        return {"sources": [], "settings": dict(DEFAULT_SETTINGS)}


def _write_config(data: Dict[str, Any]) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _resolve(path: str) -> str:
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
    data = _read_config()
    current = data.get("settings", {})
    current.update(updates)
    data["settings"] = current
    _write_config(data)
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
    data = _read_config()
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
    _write_config(data)


def set_source_watch(path: str, enabled: bool) -> None:
    resolved_path = _resolve(path)
    data = _read_config()
    sources = data.get("sources", [])
    for s in sources:
        if _matches(s.get("path", ""), path, resolved_path):
            s["watch_enabled"] = enabled
            break
    data["sources"] = sources
    _write_config(data)


def remove_configured_source(path: str) -> None:
    resolved_path = _resolve(path)
    data = _read_config()
    sources = [
        s for s in data.get("sources", [])
        if not _matches(s.get("path", ""), path, resolved_path)
    ]
    data["sources"] = sources
    _write_config(data)
