"""Index sources, scan jobs, and local-target routes."""
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional

import fastapi

import app_config
import app_state
import connectors
import google_auth
import logging_config
import sources
from routes import media
from routes.schemas import BrowseFolderRequest, IndexRequest, LaunchRequest, RemoveSourceRequest, SourceWatchRequest

logger = logging_config.get_logger("routes.sources")

router = fastapi.APIRouter()

SETTINGS_PANES = {
    "full-disk-access": "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
    "internet-accounts": "x-apple.systempreferences:com.apple.Internet-Accounts-Settings.extension",
}


@router.post("/api/launch")
def api_launch(req: LaunchRequest) -> Any:
    if not media.is_openable(req.path):
        return media.not_indexed_response(success=False, path=req.path)
    success = connectors.launch_target(req.path)
    logger.info(f"Launch target: '{req.path}' -> success={success}")
    return {"success": success, "path": req.path}


@router.post("/api/reveal")
def api_reveal(req: LaunchRequest) -> Any:
    if not media.is_openable(req.path):
        return media.not_indexed_response(success=False, path=req.path)
    success = connectors.reveal_in_finder(req.path)
    logger.info(f"Reveal in Finder: '{req.path}' -> success={success}")
    return {"success": success, "path": req.path}


@router.get("/api/network-volumes")
def api_network_volumes() -> Dict[str, Any]:
    volumes = connectors.get_mounted_network_volumes()
    return {"volumes": volumes}


@router.get("/api/drive-locations")
def api_drive_locations() -> Dict[str, Any]:
    locations = connectors.get_google_drive_locations()
    return {"locations": locations}


@router.get("/api/icloud-locations")
def api_icloud_locations() -> Dict[str, Any]:
    return {"locations": connectors.get_icloud_drive_locations()}


@router.post("/api/index-apps")
def api_index_apps() -> Dict[str, Any]:
    return {"status": app_state.get_jobs().start_indexing(Path.home(), "macos_apps", "Application")}


@router.post("/api/index-settings")
def api_index_settings() -> Dict[str, Any]:
    return {"status": app_state.get_jobs().start_indexing(Path.home(), "macos_settings", "System Settings")}


def _full_disk_access_denied() -> Any:
    return fastapi.responses.JSONResponse(status_code=403, content={
        "error": "full_disk_access",
        "message": "Grant Full Disk Access to Hyperlight in System Settings > Privacy & Security, then retry.",
    })


@router.post("/api/sources/apple-mail")
def api_index_apple_mail() -> Any:
    mail_dir = Path.home() / "Library" / "Mail"
    try:
        next(mail_dir.iterdir(), None)
    except PermissionError:
        return _full_disk_access_denied()
    return {"status": app_state.get_jobs().start_indexing(mail_dir, "apple_mail", "Apple Mail"), "name": "Apple Mail"}


@router.post("/api/open-settings/{pane}")
def api_open_settings(pane: str) -> Any:
    if pane not in SETTINGS_PANES:
        return fastapi.responses.JSONResponse(status_code=404, content={"error": f"Unknown settings pane '{pane}'"})
    return {"success": connectors.launch_target(SETTINGS_PANES[pane])}


@router.get("/api/permissions")
def api_permissions() -> Dict[str, bool]:
    return {"full_disk_access": connectors.full_disk_access_granted()}


@router.get("/api/sources")
def api_get_sources() -> Dict[str, Any]:
    return {"sources": sources.list_all()}


@router.post("/api/remove-source")
def api_remove_source(req: RemoveSourceRequest) -> Dict[str, str]:
    sources.remove(req.path)
    return {"status": "removed"}


@router.post("/api/clear")
def api_clear() -> Dict[str, str]:
    jobs = app_state.get_jobs()
    jobs.stop_indexing()
    jobs.wait_until_idle()
    app_state.get_storage().clear()
    sources.mark_unscanned()
    return {"status": "cleared"}


@router.post("/api/reset-all")
def api_reset_all() -> Dict[str, str]:
    """Back to a fresh install: index, sources, settings, Google sign-in and caches."""
    jobs = app_state.get_jobs()
    jobs.stop_indexing()
    jobs.wait_until_idle()
    app_state.get_storage().clear()
    app_config.reset_all()
    sources.refresh()
    google_auth.disconnect()
    shutil.rmtree(media.PREVIEW_CACHE_DIR, ignore_errors=True)
    shutil.rmtree(google_auth.PHOTOS_CACHE_DIR, ignore_errors=True)
    return {"status": "reset"}


@router.post("/api/sources/rescan")
def api_rescan_source(req: RemoveSourceRequest) -> Any:
    source = next((s for s in sources.list_all() if s.get("path") == req.path), None)
    if source is None:
        try:
            resolved = str(Path(req.path).expanduser().resolve())
        except Exception:
            resolved = req.path
        source = next((s for s in sources.list_all() if s.get("path") == resolved), None)
    if source is None:
        return fastapi.responses.JSONResponse(status_code=404, content={"error": "source_not_found", "message": "Source is not configured."})
    name = source.get("name") or req.path
    path = source.get("path", req.path)
    source_type = source.get("source_type", "local")
    runner = source.get("runner")
    if runner and sources.RUNNERS[runner].rescannable:
        status = app_state.get_jobs().start_indexing(Path.home(), runner, name, rescan=True)
    elif path.startswith("http"):
        return fastapi.responses.JSONResponse(status_code=400, content={"error": "rescan_unsupported", "message": f"Rescan is not available for '{name}'. Reconnect it to index it again."})
    else:
        target = Path(path).expanduser().resolve()
        if not target.exists():
            return fastapi.responses.JSONResponse(status_code=400, content={"error": f"Path '{path}' does not exist on disk."})
        try:
            next(target.iterdir(), None)
        except PermissionError:
            return _full_disk_access_denied()
        except NotADirectoryError:
            pass
        status = app_state.get_jobs().start_indexing(target, source_type, name, rescan=True)
    return {"status": status, "path": path, "name": name}


@router.get("/api/status")
def api_status() -> Dict[str, Any]:
    return app_state.get_storage().get_stats()


@router.post("/api/index")
def api_index(req: IndexRequest) -> Dict[str, Any]:
    target = Path(req.path).expanduser().resolve()
    if not target.exists():
        return fastapi.responses.JSONResponse(
            status_code=400,
            content={"error": f"Path '{req.path}' does not exist on disk."},
        )
    folder_name = req.name or target.name or str(target)
    for s in sources.list_all():
        try:
            existing = Path(s.get("path", "")).expanduser().resolve()
        except Exception:
            continue
        if existing == target or target in existing.parents or existing in target.parents:
            return fastapi.responses.JSONResponse(
                status_code=409,
                content={"error": "duplicate_source", "message": f"'{folder_name}' overlaps an already-added source ('{s.get('name') or existing}')."},
            )
    status = app_state.get_jobs().start_indexing(target, req.source, folder_name)
    return {"status": status, "path": str(target), "source": req.source, "name": folder_name}


@router.get("/api/indexing-status")
def api_indexing_status() -> Dict[str, Any]:
    return app_state.get_jobs().get_status()


@router.post("/api/stop-index")
def api_stop_index() -> Dict[str, str]:
    app_state.get_jobs().stop_indexing()
    return {"status": "stopping"}


@router.post("/api/browse-folder")
def api_browse_folder(req: Optional[BrowseFolderRequest] = None) -> Dict[str, Any]:
    prompt_str = req.prompt if req and req.prompt else "Select a folder to index in Hyperlight"
    # The prompt goes in as argv, never spliced into the script, so it cannot inject AppleScript.
    script = (
        "on run argv\n"
        'tell application "Finder"\nactivate\n'
        "set sel to (choose folder with prompt (item 1 of argv))\n"
        "POSIX path of sel\nend tell\nend run"
    )
    try:
        res = subprocess.run(
            ["osascript", "-e", script, prompt_str],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if res.returncode == 0:
            selected_path = res.stdout.strip().rstrip("/")
            folder_name = Path(selected_path).name or selected_path
            return {"path": selected_path, "name": folder_name, "canceled": False}
        return {"path": "", "name": "", "canceled": True}
    except Exception as e:
        return {"error": str(e), "canceled": True}
