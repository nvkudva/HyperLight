import io
import json
import logging
import os
from pathlib import Path
import time
from typing import Any, Callable, Dict, List, Optional
import urllib.parse
import PIL.Image
import requests

logger = logging.getLogger(__name__)

CONFIG_DIR = Path.home() / ".smart_personal_search"
TOKENS_PATH = CONFIG_DIR / "google_tokens.json"
CLIENT_CONFIG_PATH = CONFIG_DIR / "google_client.json"
PHOTOS_CACHE_DIR = CONFIG_DIR / "google_photos_cache"

SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/photoslibrary.readonly",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/userinfo.email",
]

def get_client_config() -> Dict[str, str]:
    if CLIENT_CONFIG_PATH.exists():
        try:
            data = json.loads(CLIENT_CONFIG_PATH.read_text(encoding="utf-8"))
            if data.get("client_id") and data.get("client_secret"):
                return data
        except Exception:
            pass

    env_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
    env_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
    if env_id and env_secret:
        return {"client_id": env_id, "client_secret": env_secret}

    adc_path = Path.home() / ".config" / "gcloud" / "application_default_credentials.json"
    if adc_path.exists():
        try:
            data = json.loads(adc_path.read_text(encoding="utf-8"))
            cid = data.get("client_id", "").strip()
            sec = data.get("client_secret", "").strip()
            if cid and sec:
                return {"client_id": cid, "client_secret": sec}
        except Exception:
            pass

    return {"client_id": "", "client_secret": ""}

def save_client_config(client_id: str, client_secret: str) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CLIENT_CONFIG_PATH.write_text(
        json.dumps({"client_id": client_id.strip(), "client_secret": client_secret.strip()}, indent=2),
        encoding="utf-8",
    )

def get_auth_url(redirect_uri: str, state: str = "google_auth") -> str:
    cfg = get_client_config()
    client_id = cfg.get("client_id")
    if not client_id:
        raise ValueError("Google Client ID not configured. Please provide a Google Client ID in Settings.")

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"

def exchange_code(code: str, redirect_uri: str) -> Dict[str, Any]:
    cfg = get_client_config()
    client_id = cfg.get("client_id")
    client_secret = cfg.get("client_secret")
    if not client_id or not client_secret:
        raise ValueError("Google Client ID or Client Secret missing.")

    token_url = "https://oauth2.googleapis.com/token"
    data = {
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }
    resp = requests.post(token_url, data=data, timeout=15)
    if resp.status_code != 200:
        raise ValueError(f"Failed to exchange code: {resp.text}")

    token_data = resp.json()
    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in", 3600)

    userinfo = fetch_userinfo(access_token)

    saved_payload = {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": time.time() + expires_in,
        "user": userinfo,
    }
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    TOKENS_PATH.write_text(json.dumps(saved_payload, indent=2), encoding="utf-8")
    return saved_payload

def fetch_userinfo(access_token: str) -> Dict[str, Any]:
    userinfo_url = "https://www.googleapis.com/oauth2/v2/userinfo"
    resp = requests.get(userinfo_url, headers={"Authorization": f"Bearer {access_token}"}, timeout=10)
    if resp.status_code == 200:
        return resp.json()
    return {}

def get_valid_access_token() -> Optional[str]:
    if not TOKENS_PATH.exists():
        return None
    try:
        data = json.loads(TOKENS_PATH.read_text(encoding="utf-8"))
        access_token = data.get("access_token")
        refresh_token = data.get("refresh_token")
        expires_at = data.get("expires_at", 0)

        if access_token and time.time() < (expires_at - 60):
            return access_token

        if refresh_token:
            cfg = get_client_config()
            client_id = cfg.get("client_id")
            client_secret = cfg.get("client_secret")
            if client_id and client_secret:
                resp = requests.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "refresh_token": refresh_token,
                        "grant_type": "refresh_token",
                    },
                    timeout=15,
                )
                if resp.status_code == 200:
                    new_token_data = resp.json()
                    new_access = new_token_data.get("access_token")
                    expires_in = new_token_data.get("expires_in", 3600)
                    data["access_token"] = new_access
                    data["expires_at"] = time.time() + expires_in
                    TOKENS_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
                    return new_access
        return access_token
    except Exception as e:
        logger.error(f"Error checking access token: {e}")
        return None

def save_direct_token(access_token: str, refresh_token: str = "") -> Dict[str, Any]:
    userinfo = fetch_userinfo(access_token)
    payload = {
        "access_token": access_token.strip(),
        "refresh_token": refresh_token.strip(),
        "expires_at": time.time() + 3600,
        "user": userinfo,
    }
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    TOKENS_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload

def disconnect() -> None:
    if TOKENS_PATH.exists():
        TOKENS_PATH.unlink(missing_ok=True)

def get_status() -> Dict[str, Any]:
    cfg = get_client_config()
    client_id = cfg.get("client_id", "")
    has_client_config = bool(client_id and cfg.get("client_secret"))

    if not TOKENS_PATH.exists():
        return {
            "connected": False,
            "has_client_config": has_client_config,
            "client_id": client_id[:12] + "..." if client_id else "",
            "user": {},
        }
    try:
        data = json.loads(TOKENS_PATH.read_text(encoding="utf-8"))
        user = data.get("user", {})
        return {
            "connected": bool(data.get("access_token")),
            "has_client_config": has_client_config,
            "client_id": client_id[:12] + "..." if client_id else "",
            "user": user,
        }
    except Exception:
        return {
            "connected": False,
            "has_client_config": has_client_config,
            "client_id": "",
            "user": {},
        }

def sync_google_drive(
    emb: Any,
    store: Any,
    on_progress: Optional[Callable[[str, int, int], None]] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
    max_files: int = 200,
) -> int:
    token = get_valid_access_token()
    if not token:
        raise ValueError("Google account is not connected.")

    headers = {"Authorization": f"Bearer {token}"}
    files_url = "https://www.googleapis.com/drive/v3/files"
    params = {
        "pageSize": min(max_files, 100),
        "fields": "nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,description)",
        "q": "trashed = false and mimeType != 'application/vnd.google-apps.folder'",
    }

    all_files: List[Dict[str, Any]] = []
    page_token = None

    while len(all_files) < max_files:
        if cancel_check and cancel_check():
            break
        if page_token:
            params["pageToken"] = page_token
        resp = requests.get(files_url, headers=headers, params=params, timeout=15)
        if resp.status_code != 200:
            err_data = resp.json() if "application/json" in resp.headers.get("Content-Type", "") else {}
            err_msg = err_data.get("error", {}).get("message", resp.text)
            logger.error(f"Google Drive API error ({resp.status_code}): {err_msg}")
            if not all_files:
                if resp.status_code == 403 and "insufficient" in err_msg.lower():
                    raise ValueError("Google Drive permission not granted. Please click 'Sign in with Google' to authorize Drive access.")
                raise ValueError(f"Google Drive API error ({resp.status_code}): {err_msg}")
            break
        data = resp.json()
        items = data.get("files", [])
        all_files.extend(items)
        page_token = data.get("nextPageToken")
        if not page_token:
            break

    if not all_files:
        return 0

    total = len(all_files)
    batch_items: List[Dict[str, Any]] = []

    for idx, f in enumerate(all_files):
        if cancel_check and cancel_check():
            break
        name = f.get("name", "Untitled")
        if on_progress:
            on_progress(name, idx + 1, total)

        fid = f.get("id")
        mime = f.get("mimeType", "")
        web_link = f.get("webViewLink") or f"https://drive.google.com/file/d/{fid}/view"
        desc = f.get("description", "")
        mod_time = f.get("modifiedTime", "")

        content_repr = f"Google Drive File: {name}\nType: {mime}\nModified: {mod_time}\nDescription: {desc}"

        vec = emb.embed_text(content_repr)
        batch_items.append({
            "id": f"gdrive_{fid}",
            "path": web_link,
            "filename": name,
            "file_type": "document",
            "source": "google_drive",
            "content": content_repr,
            "excerpt": f"Google Drive • {mime.split('.')[-1]} • {mod_time[:10]}",
            "vector": vec,
            "metadata": {
                "url": web_link,
                "mimeType": mime,
                "modifiedTime": mod_time,
                "googleId": fid,
            },
        })

    if batch_items:
        store.add_items(batch_items)
    return len(batch_items)

def sync_google_photos(
    emb: Any,
    store: Any,
    on_progress: Optional[Callable[[str, int, int], None]] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
    max_photos: int = 100,
) -> int:
    token = get_valid_access_token()
    if not token:
        raise ValueError("Google account is not connected. Please sign in with Google.")

    headers = {"Authorization": f"Bearer {token}"}
    photos_url = "https://photoslibrary.googleapis.com/v1/mediaItems"
    params = {"pageSize": min(max_photos, 50)}

    all_media: List[Dict[str, Any]] = []
    page_token = None

    while len(all_media) < max_photos:
        if cancel_check and cancel_check():
            break
        if page_token:
            params["pageToken"] = page_token
        resp = requests.get(photos_url, headers=headers, params=params, timeout=15)
        if resp.status_code != 200:
            err_data = resp.json() if "application/json" in resp.headers.get("Content-Type", "") else {}
            err_msg = err_data.get("error", {}).get("message", resp.text)
            logger.error(f"Google Photos API error ({resp.status_code}): {err_msg}")
            if not all_media:
                if resp.status_code == 403 and "insufficient" in err_msg.lower():
                    raise ValueError("Google Photos permission not granted. Please click 'Sign in with Google' to authorize Photos access.")
                raise ValueError(f"Google Photos API error ({resp.status_code}): {err_msg}")
            break
        data = resp.json()
        items = data.get("mediaItems", [])
        all_media.extend(items)
        page_token = data.get("nextPageToken")
        if not page_token:
            break

    if not all_media:
        return 0

    PHOTOS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    total = len(all_media)
    batch_items: List[Dict[str, Any]] = []

    for idx, item in enumerate(all_media):
        if cancel_check and cancel_check():
            break
        filename = item.get("filename", f"photo_{idx}.jpg")
        if on_progress:
            on_progress(filename, idx + 1, total)

        base_url = item.get("baseUrl")
        if not base_url:
            continue

        item_id = item.get("id")
        cache_file = PHOTOS_CACHE_DIR / f"{item_id}.jpg"

        try:
            if not cache_file.exists():
                thumb_resp = requests.get(f"{base_url}=w600-h600", timeout=10)
                if thumb_resp.status_code == 200:
                    cache_file.write_bytes(thumb_resp.content)

            if cache_file.exists():
                img = PIL.Image.open(cache_file)
                vec = emb.embed_image(img)
                if vec:
                    meta = item.get("mediaMetadata", {})
                    creation_time = meta.get("creationTime", "")
                    batch_items.append({
                        "id": f"gphoto_{item_id}",
                        "path": str(cache_file),
                        "filename": filename,
                        "file_type": "photo",
                        "source": "google_photos",
                        "content": f"Google Photo: {filename} ({creation_time})",
                        "excerpt": f"Google Photos • {creation_time[:10] if creation_time else 'Cloud'}",
                        "vector": vec,
                        "metadata": {
                            "url": item.get("productUrl", ""),
                            "creationTime": creation_time,
                            "googleId": item_id,
                        },
                    })
        except Exception as e:
            logger.warning(f"Failed to process Google Photo {filename}: {e}")

    if batch_items:
        store.add_items(batch_items)
    return len(batch_items)
