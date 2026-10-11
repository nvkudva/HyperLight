import glob
import hashlib
import html
import json
import mimetypes
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
from typing import Any, Callable, Dict, List, NamedTuple, Optional
import fastapi
from fastapi.responses import HTMLResponse, Response
import fastapi.staticfiles
import pydantic
import uvicorn
import urllib.parse
import connectors
import embedder
import google_auth
import logging_config
import qa_engine
import scanner
import storage
import watcher

logging_config.setup_logging()
logger = logging_config.get_logger("web_app")

app = fastapi.FastAPI(title="Hyperlight")

emb = embedder.Embedder()
store = storage.Storage()
sc = scanner.Scanner(emb, store)
engine = qa_engine.QAEngine()
live_watcher = watcher.LiveWatcher(emb, store, sc)
live_watcher.start()

class Job(NamedTuple):
    path: Path
    source: str
    name: str
    options: Dict[str, Any]

class CloudSource(NamedTuple):
    name: str
    path: str
    kind: str
    run: Callable[..., Any]

CLOUD_SOURCES: Dict[str, CloudSource] = {
    "google_drive_cloud": CloudSource("Google Drive", "https://drive.google.com", "google_drive",
        lambda progress, cancel, opts: google_auth.sync_google_drive(emb, store, on_progress=progress, cancel_check=cancel)),
    "google_photos_cloud": CloudSource("Google Photos", str(google_auth.PHOTOS_CACHE_DIR), "google_photos",
        lambda progress, cancel, opts: google_auth.sync_google_photos(emb, store, opts["session_id"], on_progress=progress, cancel_check=cancel)),
    "gmail_cloud": CloudSource("Gmail", "https://mail.google.com", "gmail",
        lambda progress, cancel, opts: google_auth.sync_gmail(emb, store, on_progress=progress, cancel_check=cancel)),
}

class IndexJobManager:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.is_running = False
        self.cancel_requested = False
        self.current_folder = ""
        self.current_path = ""
        self.current_source = ""
        self.current_file = ""
        self.current_index = 0
        self.total_files = 0
        self.percent = 0.0
        self.indexed_items = 0
        self.status = "Idle"
        self.state = "idle"
        self.error_code = ""
        self.thread: Optional[threading.Thread] = None
        self.pending: List[Job] = []

    def get_status(self) -> Dict[str, Any]:
        with self.lock:
            return {
                "is_running": self.is_running,
                "cancel_requested": self.cancel_requested,
                "current_folder": self.current_folder,
                "current_path": self.current_path,
                "current_source": self.current_source,
                "current_file": self.current_file,
                "current_index": self.current_index,
                "total_files": self.total_files,
                "percent": round(self.percent, 1),
                "indexed_items": self.indexed_items,
                "status": self.status,
                "state": self.state,
                "error_code": self.error_code,
                "is_cloud": self.current_source in CLOUD_SOURCES,
                "queued": [job.name for job in self.pending],
            }

    def start_indexing(self, path: Path, source: str, name: str, options: Optional[Dict[str, Any]] = None) -> str:
        job = Job(path, source, name, options or {})
        with self.lock:
            if self.is_running:
                if not any(j.path == path and j.source == source for j in self.pending):
                    self.pending.append(job)
                return "queued"
            self.is_running = True
        self._launch(job)
        return "started"

    def _launch(self, job: Job) -> None:
        path, source, name = job.path, job.source, job.name
        with self.lock:
            self.state = "running"
            self.error_code = ""
            self.cancel_requested = False
            self.current_folder = name
            self.current_path = str(path)
            self.current_source = source
            self.current_file = ""
            self.current_index = 0
            self.total_files = 0
            self.percent = 0.0
            self.indexed_items = 0
            self.status = f"Preparing to scan '{name}'..."

        self.thread = threading.Thread(
            target=self._worker,
            args=(job,),
            daemon=True,
        )
        self.thread.start()

    def stop_indexing(self) -> None:
        with self.lock:
            self.pending.clear()
            if self.is_running:
                self.cancel_requested = True
                self.status = "Stopping scan..."

    def _worker(self, job: Job) -> None:
        def on_progress(filename: str, current: int, total: int) -> None:
            with self.lock:
                self.current_file = filename
                self.current_index = current
                self.total_files = total
                self.percent = (current / total * 100.0) if total > 0 else 0.0
                self.status = f"Scanning file {current} of {total}..."

        def cancel_check() -> bool:
            with self.lock:
                return self.cancel_requested

        cloud = CLOUD_SOURCES.get(job.source)
        if cloud:
            name, track_path, kind = cloud.name, cloud.path, cloud.kind
        else:
            name, track_path, kind = job.name, str(job.path), job.source
        try:
            storage.save_configured_source(name, track_path, kind, store.count_items_by_path(track_path))
            if cloud:
                cloud.run(on_progress, cancel_check, job.options)
            else:
                live_watcher.sync_sources()
                sc.scan_path(job.path, source=job.source, on_progress=on_progress, cancel_check=cancel_check)
            total_items = store.count_items_by_path(track_path)
            storage.save_configured_source(name, track_path, kind, total_items)
            if not cloud:
                live_watcher.sync_sources()
            with self.lock:
                if self.cancel_requested:
                    self.state = "cancelled"
                    self.status = f"Scan stopped. Indexed {total_items} items so far."
                else:
                    self.state = "finished"
                    self.percent = 100.0
                    self.status = f"Finished! Indexed {total_items} items from '{name}'."
                self.indexed_items = total_items
        except Exception as e:
            with self.lock:
                self.state = "error"
                self.error_code = "reauth_required" if isinstance(e, google_auth.GoogleScopeError) else ""
                self.status = f"Error during indexing: {e}"
        finally:
            with self.lock:
                self.cancel_requested = False
                next_job = self.pending.pop(0) if self.pending else None
                self.is_running = next_job is not None
            if next_job:
                self._launch(next_job)

job_manager = IndexJobManager()

class ChatRequest(pydantic.BaseModel):
    message: str

class IndexRequest(pydantic.BaseModel):
    path: str
    source: str = "local"
    name: Optional[str] = None

class RemoveSourceRequest(pydantic.BaseModel):
    path: str

class SpotlightRequest(pydantic.BaseModel):
    query: str
    limit: int = 20

class LaunchRequest(pydantic.BaseModel):
    path: str

class GoogleTokenRequest(pydantic.BaseModel):
    access_token: str
    refresh_token: Optional[str] = ""

class SettingsUpdateRequest(pydantic.BaseModel):
    always_on_scanning: Optional[bool] = None

class SourceWatchRequest(pydantic.BaseModel):
    path: str
    enabled: bool


FRONTEND_DIST = Path(__file__).parent / "frontend" / "dist"
TEMPLATE_PATH = Path(__file__).parent / "templates" / "index.html"

if (FRONTEND_DIST / "assets").exists():
    app.mount("/assets", fastapi.staticfiles.StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

@app.get("/", response_class=HTMLResponse)
def index_page() -> str:
    react_index = FRONTEND_DIST / "index.html"
    if react_index.exists():
        return react_index.read_text(encoding="utf-8")
    return TEMPLATE_PATH.read_text(encoding="utf-8")

@app.get("/vite.svg")
def vite_svg() -> Response:
    svg_path = FRONTEND_DIST / "vite.svg"
    if svg_path.exists():
        return Response(content=svg_path.read_bytes(), media_type="image/svg+xml")
    return Response(status_code=404)

@app.post("/api/spotlight")
def api_spotlight(req: SpotlightRequest) -> Dict[str, Any]:
    query_text = req.query.strip()
    if not query_text:
        return {"query": "", "categories": {}, "total_matches": 0}

    query_vector = emb.embed_query(query_text)
    results = store.search(query_vector, query_text=query_text, limit=max(req.limit, 60))

    categories: Dict[str, List[Dict[str, Any]]] = {}
    for r in results:
        t = r["type"]
        if t not in categories:
            categories[t] = []
        if len(categories[t]) < 5:
            categories[t].append(r)

    total_matches = sum(len(items) for items in categories.values())
    logger.info(f"Spotlight query: '{query_text}' -> {total_matches} matches across {len(categories)} categories")
    return {
        "query": query_text,
        "categories": categories,
        "total_matches": total_matches,
    }

@app.post("/api/launch")
def api_launch(req: LaunchRequest) -> Dict[str, Any]:
    success = connectors.launch_target(req.path)
    logger.info(f"Launch target: '{req.path}' -> success={success}")
    return {"success": success, "path": req.path}

@app.post("/api/reveal")
def api_reveal(req: LaunchRequest) -> Dict[str, Any]:
    success = connectors.reveal_in_finder(req.path)
    logger.info(f"Reveal in Finder: '{req.path}' -> success={success}")
    return {"success": success, "path": req.path}

@app.get("/api/network-volumes")
def api_network_volumes() -> Dict[str, Any]:
    volumes = connectors.get_mounted_network_volumes()
    return {"volumes": volumes}

@app.get("/api/drive-locations")
def api_drive_locations() -> Dict[str, Any]:
    locations = connectors.get_google_drive_locations()
    return {"locations": locations}

@app.get("/api/auth/google/status")
def api_google_status() -> Dict[str, Any]:
    return google_auth.get_status()

@app.get("/api/auth/google/login")
def api_google_login(request: fastapi.Request) -> Any:
    redirect_uri = str(request.url_for("api_google_callback"))
    try:
        url = google_auth.get_auth_url(redirect_uri)
        return fastapi.responses.RedirectResponse(url=url)
    except Exception as e:
        return fastapi.responses.RedirectResponse(url=f"/?google_error={urllib.parse.quote(str(e))}")

@app.get("/api/auth/google/auth-url")
def api_google_auth_url(request: fastapi.Request) -> Dict[str, Any]:
    redirect_uri = str(request.url_for("api_google_callback"))
    try:
        url = google_auth.get_auth_url(redirect_uri)
        return {"url": url}
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/auth/google/callback", response_class=HTMLResponse)
def api_google_callback(request: fastapi.Request, code: Optional[str] = None, error: Optional[str] = None) -> Any:
    if error:
        return HTMLResponse(content=f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Google Sign-In</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "SF Pro", sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
    .card {{ background: rgba(30, 41, 59, 0.9); border: 1px solid rgba(255,255,255,0.1); padding: 2.5rem; border-radius: 1.25rem; text-align: center; max-width: 420px; }}
    h1 {{ font-size: 1.25rem; margin: 0 0 0.5rem 0; color: #f87171; }}
    p {{ font-size: 0.875rem; color: #94a3b8; line-height: 1.5; }}
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">⚠️</div>
    <h1>Google Sign-In Cancelled</h1>
    <p>{html.escape(error)}</p>
    <p style="margin-top: 1.5rem; font-size: 0.75rem; color: #64748b;">You can close this tab and return to Hyperlight.</p>
  </div>
</body>
</html>""", status_code=400)

    if not code:
        return HTMLResponse(content="""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Error</title></head>
<body style="font-family: -apple-system, sans-serif; background: #0f172a; color: #f87171; text-align: center; padding-top: 4rem;">
  <h2>No authorization code provided</h2>
</body>
</html>""", status_code=400)

    try:
        redirect_uri = str(request.url_for("api_google_callback"))
        google_auth.exchange_code(code, redirect_uri)
        return HTMLResponse(content="""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Connected to Google</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro", "Segoe UI", sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background: rgba(30, 41, 59, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 2.5rem 3rem;
      border-radius: 1.25rem;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      max-width: 420px;
    }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem 0; color: #f8fafc; }
    p { font-size: 0.875rem; color: #94a3b8; margin: 0 0 1.5rem 0; line-height: 1.5; }
    .badge {
      display: inline-block;
      padding: 0.35rem 0.85rem;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✨</div>
    <h1>Connected to Google</h1>
    <p>Your Google account has been linked to Hyperlight. You can close this window now.</p>
    <div class="badge">● Connected &amp; Ready</div>
  </div>
  <script>
    if (window.opener) {
      try { window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS' }, '*'); } catch (e) {}
    }
    setTimeout(() => {
      try { window.close(); } catch (e) {}
    }, 2000);
  </script>
</body>
</html>""")
    except Exception as e:
        logger.error(f"Google OAuth exchange error: {e}")
        return HTMLResponse(content=f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Google Sign-In Error</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "SF Pro", sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
    .card {{ background: rgba(30, 41, 59, 0.9); border: 1px solid rgba(255,255,255,0.1); padding: 2.5rem; border-radius: 1.25rem; text-align: center; max-width: 440px; }}
    h1 {{ font-size: 1.25rem; margin: 0 0 0.5rem 0; color: #f87171; }}
    p {{ font-size: 0.875rem; color: #94a3b8; line-height: 1.5; }}
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">⚠️</div>
    <h1>Authentication Error</h1>
    <p>{html.escape(str(e))}</p>
    <p style="margin-top: 1.5rem; font-size: 0.75rem; color: #64748b;">Please close this window, check your credentials in Settings, and try again.</p>
  </div>
</body>
</html>""", status_code=500)

@app.post("/api/auth/google/token")
def api_google_token(req: GoogleTokenRequest) -> Dict[str, Any]:
    try:
        res = google_auth.save_direct_token(req.access_token, req.refresh_token or "")
        return {"status": "success", "user": res.get("user", {})}
    except Exception as e:
        return fastapi.responses.JSONResponse(status_code=400, content={"error": str(e)})

@app.post("/api/auth/google/disconnect")
def api_google_disconnect() -> Dict[str, str]:
    google_auth.disconnect()
    return {"status": "disconnected"}

@app.post("/api/auth/google/sync-drive")
def api_google_sync_drive() -> Dict[str, Any]:
    return {"status": job_manager.start_indexing(Path.home(), "google_drive_cloud", "Google Drive"), "name": "Google Drive"}

@app.post("/api/auth/google/sync-photos")
def api_google_sync_photos() -> Any:
    try:
        session = google_auth.create_photos_picker_session()
    except Exception as e:
        return fastapi.responses.JSONResponse(status_code=400, content={"error": str(e)})
    status = job_manager.start_indexing(Path.home(), "google_photos_cloud", "Google Photos", {"session_id": session["id"]})
    connectors.launch_target(session["picker_uri"])
    return {"status": status, "name": "Google Photos", "picker_uri": session["picker_uri"]}

@app.post("/api/auth/google/sync-gmail")
def api_google_sync_gmail() -> Dict[str, Any]:
    return {"status": job_manager.start_indexing(Path.home(), "gmail_cloud", "Gmail"), "name": "Gmail"}

@app.post("/api/sources/apple-mail")
def api_index_apple_mail() -> Any:
    mail_dir = Path.home() / "Library" / "Mail"
    try:
        next(mail_dir.iterdir(), None)
    except PermissionError:
        return fastapi.responses.JSONResponse(status_code=403, content={
            "error": "full_disk_access",
            "message": "Grant Full Disk Access to Hyperlight in System Settings > Privacy & Security, then retry.",
        })
    return {"status": job_manager.start_indexing(mail_dir, "apple_mail", "Apple Mail"), "name": "Apple Mail"}

SETTINGS_PANES = {
    "full-disk-access": "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
    "internet-accounts": "x-apple.systempreferences:com.apple.Internet-Accounts-Settings.extension",
}

@app.post("/api/open-settings/{pane}")
def api_open_settings(pane: str) -> Any:
    if pane not in SETTINGS_PANES:
        return fastapi.responses.JSONResponse(status_code=404, content={"error": f"Unknown settings pane '{pane}'"})
    return {"success": connectors.launch_target(SETTINGS_PANES[pane])}


@app.post("/api/index-apps")
def api_index_apps() -> Dict[str, Any]:
    count = connectors.index_applications(emb, store)
    return {"status": "success", "indexed_apps": count}

@app.post("/api/chat")
def api_chat(req: ChatRequest) -> Dict[str, Any]:
    query_text = req.message.strip()
    query_vector = emb.embed_query(query_text)
    lower_query = query_text.lower()

    photo_keywords = ["photo", "photos", "picture", "pictures", "image", "images", "pic", "pics", "snapshot", "selfie"]
    is_photo_query = any(w in lower_query for w in photo_keywords)

    meta_doc_keywords = [
        "size", "when", "added", "modified", "created", "date", "type", "extension", "format",
        "file", "files", "document", "documents", "tax", "pdf", "docx", "txt", "folder",
        "how much", "how many", "total", "what is", "where is", "list", "who", "phone", "email"
    ]
    is_meta_or_doc_query = any(w in lower_query for w in meta_doc_keywords)

    if is_photo_query and not is_meta_or_doc_query:
        photo_candidates = store.search(query_vector, query_text=query_text, item_type="photo", limit=6)
        matching_photos = [p for p in photo_candidates if p.get("score", 1.0) < 0.78]
        if matching_photos:
            return {
                "answer": f"I found {len(matching_photos)} photo(s) matching your request:",
                "photos": matching_photos,
                "sources": [],
            }
        else:
            return {
                "answer": f"No photos found matching '{query_text}'.",
                "photos": [],
                "sources": [],
            }

    doc_candidates = store.search(query_vector, query_text=query_text, exclude_type="photo", limit=6)

    if any(w in lower_query for w in ["photo", "image", "picture"]) and any(w in lower_query for w in ["size", "when", "added", "date", "modified"]):
        photo_candidates = store.search(query_vector, query_text=query_text, item_type="photo", limit=3)
        doc_candidates.extend(photo_candidates)

    qa_result = engine.generate_answer(query_text, doc_candidates)
    return {
        "answer": qa_result["answer"],
        "photos": [],
        "sources": qa_result["sources"],
    }


@app.get("/api/settings")
def api_get_settings() -> Dict[str, Any]:
    settings = storage.get_app_settings()
    return {
        "always_on_scanning": settings.get("always_on_scanning", True),
        "watched_paths_count": len(getattr(live_watcher, "watches", {})),
    }

@app.post("/api/settings")
def api_update_settings(req: SettingsUpdateRequest) -> Dict[str, Any]:
    updates = {}
    if req.always_on_scanning is not None:
        updates["always_on_scanning"] = req.always_on_scanning
    if updates:
        storage.update_app_settings(updates)
        live_watcher.sync_sources()
    return api_get_settings()

@app.post("/api/sources/watch")
def api_set_source_watch(req: SourceWatchRequest) -> Dict[str, Any]:
    storage.set_source_watch(req.path, req.enabled)
    live_watcher.sync_sources()
    return {
        "success": True,
        "sources": storage.get_configured_sources(),
    }

@app.get("/api/sources")
def api_get_sources() -> Dict[str, Any]:
    sources = storage.get_configured_sources()
    return {"sources": sources}

@app.post("/api/remove-source")
def api_remove_source(req: RemoveSourceRequest) -> Dict[str, str]:
    store.remove_items_by_path(req.path)
    storage.remove_configured_source(req.path)
    live_watcher.sync_sources()
    return {"status": "removed"}

class BrowseFolderRequest(pydantic.BaseModel):
    prompt: Optional[str] = "Select a folder to index in Hyperlight"

@app.post("/api/browse-folder")
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

@app.get("/api/discovered-locations")
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

@app.post("/api/index")
def api_index(req: IndexRequest) -> Dict[str, Any]:
    target = Path(req.path).expanduser().resolve()
    if not target.exists():
        return fastapi.responses.JSONResponse(
            status_code=400,
            content={"error": f"Path '{req.path}' does not exist on disk."},
        )
    folder_name = req.name or target.name or str(target)
    status = job_manager.start_indexing(target, req.source, folder_name)
    return {"status": status, "path": str(target), "source": req.source, "name": folder_name}

@app.get("/api/indexing-status")
def api_indexing_status() -> Dict[str, Any]:
    return job_manager.get_status()

@app.post("/api/stop-index")
def api_stop_index() -> Dict[str, str]:
    job_manager.stop_indexing()
    return {"status": "stopping"}

@app.get("/api/status")
def api_status() -> Dict[str, Any]:
    return store.get_stats()

@app.post("/api/clear")
def api_clear() -> Dict[str, str]:
    store.clear()
    return {"status": "cleared"}

@app.get("/api/thumbnail")
def api_thumbnail(path: str) -> Response:
    file_path = Path(path).resolve()
    if not file_path.exists() or not file_path.is_file():
        return Response(status_code=404)
    mime, _ = mimetypes.guess_type(str(file_path))
    if not mime or not mime.startswith("image/"):
        mime = "application/octet-stream"
    try:
        content = file_path.read_bytes()
        return Response(content=content, media_type=mime)
    except Exception:
        return Response(status_code=500)

PREVIEW_CACHE_DIR = Path.home() / ".smart_personal_search" / "previews"

@app.get("/api/media")
def api_media(path: str) -> Response:
    file_path = Path(path).resolve()
    if not file_path.is_file() or file_path.suffix.lower() not in scanner.VIDEO_EXTENSIONS | scanner.AUDIO_EXTENSIONS:
        return Response(status_code=404)
    return fastapi.responses.FileResponse(file_path)

@app.get("/api/preview")
def api_preview(path: str, size: int = 800) -> Response:
    file_path = Path(path).resolve()
    if not file_path.is_file():
        return Response(status_code=404)
    stat = file_path.stat()
    key = hashlib.sha1(f"{file_path}:{stat.st_mtime_ns}:{size}".encode()).hexdigest()
    cached = PREVIEW_CACHE_DIR / f"{key}.png"
    if not cached.exists():
        PREVIEW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory() as tmp:
            try:
                subprocess.run(
                    ["qlmanage", "-t", "-s", str(size), "-o", tmp, str(file_path)],
                    capture_output=True, timeout=10, check=False,
                )
            except subprocess.TimeoutExpired:
                return Response(status_code=404)
            produced = next(Path(tmp).glob("*.png"), None)
            if not produced:
                return Response(status_code=404)
            shutil.move(str(produced), cached)
    return Response(content=cached.read_bytes(), media_type="image/png", headers={"Cache-Control": "max-age=3600"})

def main() -> None:
    uvicorn.run(app, host="127.0.0.1", port=8585)

if __name__ == "__main__":
    main()
