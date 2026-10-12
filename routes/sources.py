"""Index sources, scan jobs, and local-target routes."""
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional

import fastapi

import app_state
import connectors
import logging_config
import storage
from routes.schemas import BrowseFolderRequest, IndexRequest, LaunchRequest, RemoveSourceRequest, SourceWatchRequest

logger = logging_config.get_logger("routes.sources")

router = fastapi.APIRouter()

SETTINGS_PANES = {
    "full-disk-access": "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
    "internet-accounts": "x-apple.systempreferences:com.apple.Internet-Accounts-Settings.extension",
}


@router.post("/api/launch")
def api_launch(req: LaunchRequest) -> Dict[str, Any]:
    success = connectors.launch_target(req.path)
    logger.info(f"Launch target: '{req.path}' -> success={success}")
    return {"success": success, "path": req.path}


@router.post("/api/reveal")
def api_reveal(req: LaunchRequest) -> Dict[str, Any]:
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


@router.post("/api/index-apps")
def api_index_apps() -> Dict[str, Any]:
    count = connectors.index_applications(app_state.get_embedder(), app_state.get_storage())
    return {"status": "success", "indexed_apps": count}


@router.post("/api/sources/apple-mail")
def api_index_apple_mail() -> Any:
    mail_dir = Path.home() / "Library" / "Mail"
    try:
        next(mail_dir.iterdir(), None)
    except PermissionError:
        return fastapi.responses.JSONResponse(status_code=403, content={
            "error": "full_disk_access",
            "message": "Grant Full Disk Access to Hyperlight in System Settings > Privacy & Security, then retry.",
        })
    return {"status": app_state.get_jobs().start_indexing(mail_dir, "apple_mail", "Apple Mail"), "name": "Apple Mail"}


@router.post("/api/open-settings/{pane}")
def api_open_settings(pane: str) -> Any:
    if pane not in SETTINGS_PANES:
        return fastapi.responses.JSONResponse(status_code=404, content={"error": f"Unknown settings pane '{pane}'"})
    return {"success": connectors.launch_target(SETTINGS_PANES[pane])}


@router.get("/api/sources")
def api_get_sources() -> Dict[str, Any]:
    sources = storage.get_configured_sources()
    return {"sources": sources}


@router.post("/api/remove-source")
def api_remove_source(req: RemoveSourceRequest) -> Dict[str, str]:
    app_state.get_storage().remove_items_by_path(req.path)
    storage.remove_configured_source(req.path)
    app_state.get_watcher().sync_sources()
    return {"status": "removed"}


@router.post("/api/clear")
def api_clear() -> Dict[str, str]:
    app_state.get_storage().clear()
    return {"status": "cleared"}


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
    prompt_str = (req.prompt if req and req.prompt else "Select a folder to index in Hyperlight").replace('"', '\\"')
    try:
        script = f'tell application "Finder"\nactivate\nset sel to (choose folder with prompt "{prompt_str}")\nPOSIX path of sel\nend tell'
        res = subprocess.run(
            ["osascript", "-e", script],
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


@router.get("/api/discovered-locations")
def api_discovered_locations() -> Dict[str, Any]:
    existing_sources = {s.get("path") for s in storage.get_configured_sources()}
    locations = []

    cloud_storage = Path.home() / "Library" / "CloudStorage"
    gdrive_found = False
    if cloud_storage.exists():
        for p in cloud_storage.glob("GoogleDrive*"):
            my_drive = p / "My Drive"
            target = my_drive if my_drive.exists() else p
            locations.append({
                "id": "gdrive",
                "name": "Google Drive",
                "type": "google_drive",
                "path": str(target),
                "icon": "☁️",
                "exists": True,
                "is_added": str(target) in existing_sources,
            })
            gdrive_found = True

    if not gdrive_found:
        legacy_drive = Path.home() / "Google Drive"
        locations.append({
            "id": "gdrive",
            "name": "Google Drive",
            "type": "google_drive",
            "path": str(legacy_drive),
            "icon": "☁️",
            "exists": legacy_drive.exists(),
            "is_added": str(legacy_drive) in existing_sources,
        })

    takeout_candidates = list((Path.home() / "Downloads").glob("*Takeout*"))
    photos_takeout = takeout_candidates[0] if takeout_candidates else (Path.home() / "Downloads" / "Takeout" / "Google Photos")
    locations.append({
        "id": "gphotos",
        "name": "Google Photos",
        "type": "google_photos",
        "path": str(photos_takeout),
        "icon": "☀️",
        "exists": photos_takeout.exists(),
        "is_added": str(photos_takeout) in existing_sources,
    })

    common_mac_folders = [
        ("Pictures", Path.home() / "Pictures", "🖼️"),
        ("Documents", Path.home() / "Documents", "📄"),
        ("Downloads", Path.home() / "Downloads", "📥"),
        ("Desktop", Path.home() / "Desktop", "💻"),
    ]

    for name, p, icon in common_mac_folders:
        locations.append({
            "id": name.lower(),
            "name": f"Mac {name}",
            "type": "local",
            "path": str(p),
            "icon": icon,
            "exists": p.exists(),
            "is_added": str(p) in existing_sources,
        })

    return {"locations": locations}
