"""Google Photos Picker sync (user-picked photos only)."""
import time
from typing import Any, Callable, Dict, List, Optional

import PIL.Image
import requests

import google_auth
from google_sync.common import api_error, logger, require_token

PICKER_API = "https://photospicker.googleapis.com/v1"


def create_photos_picker_session() -> Dict[str, Any]:
    resp = requests.post(f"{PICKER_API}/sessions", headers=require_token(), json={}, timeout=15)
    if resp.status_code != 200:
        raise api_error(resp, "Google Photos Picker")
    data = resp.json()
    return {"id": data["id"], "picker_uri": data["pickerUri"]}


def sync_google_photos(
    emb: Any,
    store: Any,
    session_id: str,
    on_progress: Optional[Callable[[str, int, int], None]] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
    wait_seconds: int = 900,
) -> int:
    headers = require_token()
    deadline = time.time() + wait_seconds
    while True:
        if cancel_check and cancel_check():
            return 0
        resp = requests.get(f"{PICKER_API}/sessions/{session_id}", headers=headers, timeout=15)
        if resp.status_code != 200:
            raise api_error(resp, "Google Photos Picker")
        if resp.json().get("mediaItemsSet"):
            break
        if time.time() > deadline:
            raise ValueError("Timed out waiting for photos to be picked in Google Photos.")
        if on_progress:
            on_progress("Waiting for you to pick photos in Google Photos...", 0, 0)
        time.sleep(3)

    all_media: List[Dict[str, Any]] = []
    params: Dict[str, Any] = {"sessionId": session_id, "pageSize": 100}
    while True:
        resp = requests.get(f"{PICKER_API}/mediaItems", headers=headers, params=params, timeout=15)
        if resp.status_code != 200:
            raise api_error(resp, "Google Photos Picker")
        data = resp.json()
        all_media.extend(data.get("mediaItems", []))
        if not data.get("nextPageToken"):
            break
        params["pageToken"] = data["nextPageToken"]
    requests.delete(f"{PICKER_API}/sessions/{session_id}", headers=headers, timeout=15)

    cache_dir = google_auth.PHOTOS_CACHE_DIR
    cache_dir.mkdir(parents=True, exist_ok=True)
    total = len(all_media)
    batch_items: List[Dict[str, Any]] = []
    for idx, item in enumerate(all_media):
        if cancel_check and cancel_check():
            break
        media = item.get("mediaFile", {})
        filename = media.get("filename", f"photo_{idx}.jpg")
        if on_progress:
            on_progress(filename, idx + 1, total)
        if item.get("type") != "PHOTO" or not media.get("baseUrl"):
            continue
        item_id = item["id"]
        cache_file = cache_dir / f"{item_id}.jpg"
        try:
            if not cache_file.exists():
                img_resp = requests.get(f"{media['baseUrl']}=w800-h800", headers=headers, timeout=20)
                if img_resp.status_code != 200:
                    continue
                cache_file.write_bytes(img_resp.content)
            vec = emb.embed_image(PIL.Image.open(cache_file))
            if not vec:
                continue
            created = item.get("createTime", "")
            batch_items.append({
                "id": f"gphoto_{item_id}",
                "type": "photo",
                "path": str(cache_file),
                "filename": filename,
                "source": "google_photos",
                "content": f"Google Photo: {filename} ({created})",
                "vector": vec,
                "metadata": {"creationTime": created, "googleId": item_id, "mimeType": media.get("mimeType", "")},
            })
        except Exception as e:
            logger.warning(f"Failed to process Google Photo {filename}: {e}")

    if cancel_check and cancel_check():
        return 0
    return store.add_items(batch_items)
