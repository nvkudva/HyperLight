"""App settings and model-warmup routes."""
from typing import Any, Dict

import fastapi

import app_state
import storage
from routes.schemas import SettingsUpdateRequest, SourceWatchRequest

router = fastapi.APIRouter()


@router.get("/api/settings")
def api_get_settings() -> Dict[str, Any]:
    settings = storage.get_app_settings()
    return {
        "always_on_scanning": settings.get("always_on_scanning", True),
        "custom_instructions": settings.get("custom_instructions", ""),
        "watched_paths_count": len(getattr(app_state.get_watcher(), "watches", {})),
    }


@router.post("/api/settings")
def api_update_settings(req: SettingsUpdateRequest) -> Dict[str, Any]:
    updates = {}
    if req.always_on_scanning is not None:
        updates["always_on_scanning"] = req.always_on_scanning
    if req.custom_instructions is not None:
        updates["custom_instructions"] = req.custom_instructions.strip()[:4000]
    if updates:
        storage.update_app_settings(updates)
        app_state.get_watcher().sync_sources()
    return api_get_settings()


@router.post("/api/sources/watch")
def api_set_source_watch(req: SourceWatchRequest) -> Dict[str, Any]:
    storage.set_source_watch(req.path, req.enabled)
    app_state.get_watcher().sync_sources()
    return {
        "success": True,
        "sources": storage.get_configured_sources(),
    }


@router.post("/api/warmup")
def api_warmup() -> Dict[str, Any]:
    """Load heavy models now instead of on first search/chat."""
    return app_state.warmup()
