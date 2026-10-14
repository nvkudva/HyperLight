"""Index sources, scan jobs, and local-target routes."""
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional

import fastapi

import app_state
import connectors
import logging_config
import sources
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


@router.get("/api/icloud-locations")
def api_icloud_locations() -> Dict[str, Any]:
    return {"locations": connectors.get_icloud_drive_locations()}


@router.post("/api/index-apps")
def api_index_apps() -> Dict[str, Any]:
    return {"status": app_state.get_jobs().start_indexing(Path("/Applications"), "macos_apps", "macOS Applications")}


@router.post("/api/index-settings")
def api_index_settings() -> Dict[str, Any]:
    return {"status": app_state.get_jobs().start_indexing(Path.home(), "macos_settings", "macOS Settings")}


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
    sources.reset_counts()
    return {"status": "cleared"}


CLOUD_RESCAN_SOURCES = {
    "google_drive": "google_drive_cloud",
    "gmail": "gmail_cloud",
}


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
    if source_type == sources.SYSTEM_SOURCE_TYPE:
        if path.startswith("x-apple.systempreferences:"):
            status = app_state.get_jobs().start_indexing(Path.home(), "macos_settings", name, rescan=True)
        else:
            status = app_state.get_jobs().start_indexing(Path("/Applications"), "macos_apps", name, rescan=True)
    elif path.startswith("http"):
        cloud_source = CLOUD_RESCAN_SOURCES.get(source_type)
        if cloud_source is None:
            return fastapi.responses.JSONResponse(status_code=400, content={"error": "rescan_unsupported", "message": f"Rescan is not available for '{name}'. Reconnect it to index it again."})
        status = app_state.get_jobs().start_indexing(Path.home(), cloud_source, name, rescan=True)
    else:
        target = Path(path).expanduser().resolve()
        if not target.exists():
            return fastapi.responses.JSONResponse(status_code=400, content={"error": f"Path '{path}' does not exist on disk."})
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
