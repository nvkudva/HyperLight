import glob
import json
import mimetypes
import os
from pathlib import Path
import subprocess
import threading
import time
from typing import Any, Dict, List, Optional
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

app = fastapi.FastAPI(title="Smart Personal Search")

emb = embedder.Embedder()
store = storage.Storage()
sc = scanner.Scanner(emb, store)
engine = qa_engine.QAEngine()
live_watcher = watcher.LiveWatcher(emb, store, sc)
live_watcher.start()

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
        self.thread: Optional[threading.Thread] = None

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
            }

    def start_indexing(self, path: Path, source: str, name: str) -> bool:
        with self.lock:
            if self.is_running:
                return False
            self.is_running = True
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
            args=(path, source, name),
            daemon=True,
        )
        self.thread.start()
        return True

    def stop_indexing(self) -> None:
        with self.lock:
            if self.is_running:
                self.cancel_requested = True
                self.status = "Stopping scan..."

    def _worker(self, path: Path, source: str, name: str) -> None:
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

        try:
            if source == "google_drive_cloud":
                cloud_path = "https://drive.google.com"
                initial_count = store.count_items_by_path(cloud_path)
                storage.save_configured_source("Google Drive", cloud_path, "google_drive", initial_count)
                google_auth.sync_google_drive(emb, store, on_progress=on_progress, cancel_check=cancel_check)
                total_items = store.count_items_by_path(cloud_path)
                storage.save_configured_source("Google Drive", cloud_path, "google_drive", total_items)
            elif source == "google_photos_cloud":
                cache_dir_str = str(google_auth.PHOTOS_CACHE_DIR)
                initial_count = store.count_items_by_path(cache_dir_str)
                storage.save_configured_source("Google Photos", cache_dir_str, "google_photos", initial_count)
                google_auth.sync_google_photos(emb, store, on_progress=on_progress, cancel_check=cancel_check)
                total_items = store.count_items_by_path(cache_dir_str)
                storage.save_configured_source("Google Photos", cache_dir_str, "google_photos", total_items)
            else:
                initial_count = store.count_items_by_path(str(path))
                storage.save_configured_source(name, str(path), source, initial_count)
                live_watcher.sync_sources()
                sc.scan_path(path, source=source, on_progress=on_progress, cancel_check=cancel_check)
                total_items = store.count_items_by_path(str(path))
                storage.save_configured_source(name, str(path), source, total_items)
                live_watcher.sync_sources()
            with self.lock:
                if self.cancel_requested:
                    self.status = f"Scan stopped. Indexed {total_items} items so far."
                else:
                    self.percent = 100.0
                    self.status = f"Finished! Indexed {total_items} items from '{name}'."
                self.indexed_items = total_items
        except Exception as e:
            with self.lock:
                self.status = f"Error during indexing: {e}"
        finally:
            with self.lock:
                self.is_running = False
                self.cancel_requested = False

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

class GoogleConfigRequest(pydantic.BaseModel):
    client_id: str
    client_secret: str

class GoogleTokenRequest(pydantic.BaseModel):
    access_token: str
    refresh_token: Optional[str] = ""

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

    query_vector = emb.embed_text(query_text)
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

@app.post("/api/auth/google/config")
def api_google_config(req: GoogleConfigRequest) -> Dict[str, Any]:
    google_auth.save_client_config(req.client_id, req.client_secret)
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

@app.get("/api/auth/google/callback")
def api_google_callback(request: fastapi.Request, code: Optional[str] = None, error: Optional[str] = None) -> Any:
    if error:
        return fastapi.responses.RedirectResponse(url=f"/?google_error={urllib.parse.quote(error)}")
    if not code:
        return fastapi.responses.RedirectResponse(url="/?google_error=No+authorization+code+provided")
    try:
        redirect_uri = str(request.url_for("api_google_callback"))
        google_auth.exchange_code(code, redirect_uri)
        return fastapi.responses.RedirectResponse(url="/?google_connected=true")
    except Exception as e:
        return fastapi.responses.RedirectResponse(url=f"/?google_error={urllib.parse.quote(str(e))}")

@app.post("/api/auth/google/token")
def api_google_token(req: GoogleTokenRequest) -> Dict[str, Any]:
    try:
        res = google_auth.save_direct_token(req.access_token, req.refresh_token or "")
        return {"status": "success", "user": res.get("user", {})}
    except Exception as e:
        return fastapi.responses.JSONResponse(status_code=400, content={"error": str(e)})

@app.post("/api/auth/google/quick-connect")
def api_google_quick_connect() -> Dict[str, Any]:
    try:
        res = subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True, timeout=5)
        if res.returncode == 0 and res.stdout.strip():
            token = res.stdout.strip()
            data = google_auth.save_direct_token(token)
            return {"status": "success", "user": data.get("user", {})}
        return {"status": "error", "error": "No active gcloud token found"}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.post("/api/auth/google/disconnect")
def api_google_disconnect() -> Dict[str, str]:
    google_auth.disconnect()
    return {"status": "disconnected"}

@app.post("/api/auth/google/sync-drive")
def api_google_sync_drive() -> Dict[str, Any]:
    started = job_manager.start_indexing(Path.home(), "google_drive_cloud", "Google Drive")
    if not started:
        return {"status": "busy", "message": "An indexing job is already in progress."}
    return {"status": "started", "name": "Google Drive"}

@app.post("/api/auth/google/sync-photos")
def api_google_sync_photos() -> Dict[str, Any]:
    started = job_manager.start_indexing(Path.home(), "google_photos_cloud", "Google Photos")
    if not started:
        return {"status": "busy", "message": "An indexing job is already in progress."}
    return {"status": "started", "name": "Google Photos"}


@app.post("/api/index-apps")
def api_index_apps() -> Dict[str, Any]:
    count = connectors.index_applications(emb, store)
    return {"status": "success", "indexed_apps": count}

@app.post("/api/chat")
def api_chat(req: ChatRequest) -> Dict[str, Any]:
    query_text = req.message.strip()
    query_vector = emb.embed_text(query_text)
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
    prompt: Optional[str] = "Select a folder to index in Smart Personal Search"

@app.post("/api/browse-folder")
def api_browse_folder(req: Optional[BrowseFolderRequest] = None) -> Dict[str, Any]:
    prompt_str = (req.prompt if req and req.prompt else "Select a folder to index in Smart Personal Search").replace('"', '\\"')
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
    started = job_manager.start_indexing(target, req.source, folder_name)
    if not started:
        return {"status": "busy", "message": "An indexing job is already in progress."}
    return {"status": "started", "path": str(target), "source": req.source, "name": folder_name}

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

def main() -> None:
    uvicorn.run(app, host="127.0.0.1", port=8585)

if __name__ == "__main__":
    main()
