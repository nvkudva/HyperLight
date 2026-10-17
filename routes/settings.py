"""App settings and model-warmup routes."""
from typing import Any, Dict

import fastapi

import app_config
import app_state
import sources
from routes.schemas import SettingsUpdateRequest, SourceWatchRequest

router = fastapi.APIRouter()


@router.get("/api/settings")
def api_get_settings() -> Dict[str, Any]:
    settings = app_config.get_app_settings()
    return {
        **{key: settings[key] for key in app_config.DEFAULT_SETTINGS},
        "watched_paths_count": len(getattr(app_state.peek_watcher(), "watches", {}) or {}),
    }


@router.post("/api/settings")
def api_update_settings(req: SettingsUpdateRequest) -> Dict[str, Any]:
    updates = req.model_dump(exclude_none=True)
    if "custom_instructions" in updates:
        updates["custom_instructions"] = updates["custom_instructions"].strip()[:4000]
    if updates:
        app_config.update_app_settings(updates)
    if "always_on_scanning" in updates:
        sources.refresh()
    return api_get_settings()


@router.post("/api/sources/watch")
def api_set_source_watch(req: SourceWatchRequest) -> Dict[str, Any]:
    sources.set_watch(req.path, req.enabled)
    return {
        "success": True,
        "sources": sources.list_all(),
    }


@router.post("/api/warmup")
def api_warmup() -> Dict[str, Any]:
    """Load heavy models now instead of on first search/chat."""
    return app_state.warmup()
