"""Google OAuth and cloud-sync routes."""
from pathlib import Path
from typing import Any, Dict, Optional

import fastapi
from fastapi.responses import HTMLResponse

import app_state
import connectors
import google_auth
import google_sync
import logging_config
from routes.auth_pages import auth_cancelled_page, auth_error_page, auth_missing_code_page, auth_success_page

logger = logging_config.get_logger("routes.auth_google")

router = fastapi.APIRouter()


@router.get("/api/auth/google/status")
def api_google_status() -> Dict[str, Any]:
    return google_auth.get_status()


@router.get("/api/auth/google/auth-url")
def api_google_auth_url(request: fastapi.Request) -> Dict[str, Any]:
    redirect_uri = str(request.url_for("api_google_callback"))
    try:
        url = google_auth.get_auth_url(redirect_uri)
        return {"url": url}
    except Exception as e:
        return {"error": str(e)}


@router.get("/api/auth/google/callback", response_class=HTMLResponse)
def api_google_callback(request: fastapi.Request, code: Optional[str] = None, error: Optional[str] = None) -> Any:
    if error:
        return HTMLResponse(content=auth_cancelled_page(error), status_code=400)

    if not code:
        return HTMLResponse(content=auth_missing_code_page(), status_code=400)

    try:
        redirect_uri = str(request.url_for("api_google_callback"))
        google_auth.exchange_code(code, redirect_uri)
        return HTMLResponse(content=auth_success_page())
    except Exception as e:
        logger.error(f"Google OAuth exchange error: {e}")
        return HTMLResponse(content=auth_error_page(e), status_code=500)


@router.post("/api/auth/google/disconnect")
def api_google_disconnect() -> Dict[str, str]:
    google_auth.disconnect()
    return {"status": "disconnected"}


@router.post("/api/auth/google/sync-drive")
def api_google_sync_drive() -> Dict[str, Any]:
    return {"status": app_state.get_jobs().start_indexing(Path.home(), "google_drive_cloud", "Google Drive"), "name": "Google Drive"}


@router.post("/api/auth/google/sync-photos")
def api_google_sync_photos() -> Any:
    try:
        session = google_sync.create_photos_picker_session()
    except Exception as e:
        return fastapi.responses.JSONResponse(status_code=400, content={"error": str(e)})
    status = app_state.get_jobs().start_indexing(Path.home(), "google_photos_cloud", "Google Photos", {"session_id": session["id"]})
    connectors.launch_target(session["picker_uri"])
    return {"status": status, "name": "Google Photos", "picker_uri": session["picker_uri"]}


@router.post("/api/auth/google/sync-gmail")
def api_google_sync_gmail() -> Dict[str, Any]:
    return {"status": app_state.get_jobs().start_indexing(Path.home(), "gmail_cloud", "Gmail"), "name": "Gmail"}
