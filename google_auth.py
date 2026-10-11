from concurrent.futures import ThreadPoolExecutor
import html
import json
import logging
import os
from pathlib import Path
import time
from typing import Any, Callable, Dict, List, Optional
import urllib.parse
import PIL.Image
import requests
import scanner

logger = logging.getLogger(__name__)

CONFIG_DIR = Path.home() / ".smart_personal_search"
TOKENS_PATH = CONFIG_DIR / "google_tokens.json"
CLIENT_CONFIG_PATH = CONFIG_DIR / "google_client.json"
PHOTOS_CACHE_DIR = CONFIG_DIR / "google_photos_cache"
BUNDLED_CLIENT_PATH = Path(__file__).resolve().parent / "google_client.json"

# Drive and Gmail scopes are restricted: they need Google verification plus a CASA assessment before public release.
FULL_ACCESS = os.environ.get("SPS_GOOGLE_FULL_ACCESS") == "1"

SCOPES = [
    "https://www.googleapis.com/auth/photospicker.mediaitems.readonly",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/userinfo.email",
] + ([
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/gmail.readonly",
] if FULL_ACCESS else [])

def get_client_config() -> Dict[str, str]:
    if CLIENT_CONFIG_PATH.exists():
        try:
            data = json.loads(CLIENT_CONFIG_PATH.read_text(encoding="utf-8"))
            if data.get("client_id") and data.get("client_secret"):
                return data
        except Exception:
            pass

    if BUNDLED_CLIENT_PATH.exists():
        try:
            return parse_client_json(BUNDLED_CLIENT_PATH.read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning("Ignoring invalid %s: %s", BUNDLED_CLIENT_PATH.name, e)

    env_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
    env_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
    if env_id and env_secret:
        return {"client_id": env_id, "client_secret": env_secret}

    return {"client_id": "", "client_secret": ""}

def parse_client_json(text: str) -> Dict[str, str]:
    data = json.loads(text)
    inner = data.get("installed") or data.get("web") or data
    cid = (inner.get("client_id") or "").strip()
    sec = (inner.get("client_secret") or "").strip()
    if not cid or not sec:
        raise ValueError("That file has no client_id/client_secret. Download the JSON of a 'Desktop app' OAuth client.")
    return {"client_id": cid, "client_secret": sec}

_last_redirect_uri: str = "http://localhost:8585/api/auth/google/callback"

def get_auth_url(redirect_uri: str, state: str = "google_auth") -> str:
    global _last_redirect_uri
    _last_redirect_uri = redirect_uri
    cfg = get_client_config()
    client_id = cfg.get("client_id")
    if not client_id:
        raise ValueError("Google sign-in is not configured in this build (google_client.json is missing).")

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

def exchange_code(code: str, redirect_uri: Optional[str] = None) -> Dict[str, Any]:
    global _last_redirect_uri
    cfg = get_client_config()
    client_id = cfg.get("client_id")
    client_secret = cfg.get("client_secret")
    if not client_id or not client_secret:
        raise ValueError("Google Client ID or Client Secret missing.")

    target_redirect_uri = redirect_uri or _last_redirect_uri
    token_url = "https://oauth2.googleapis.com/token"
    data = {
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": target_redirect_uri,
        "grant_type": "authorization_code",
    }
    resp = requests.post(token_url, data=data, timeout=15)
    if resp.status_code != 200 and "redirect_uri_mismatch" in resp.text:
        alt_uri = target_redirect_uri.replace("localhost", "127.0.0.1") if "localhost" in target_redirect_uri else target_redirect_uri.replace("127.0.0.1", "localhost")
        data["redirect_uri"] = alt_uri
        resp = requests.post(token_url, data=data, timeout=15)

    if resp.status_code != 200:
        raise ValueError(f"Failed to exchange code: {resp.text}")

    token_data = resp.json()
    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in", 3600)

    if not refresh_token and TOKENS_PATH.exists():
        try:
            prev_data = json.loads(TOKENS_PATH.read_text(encoding="utf-8"))
            refresh_token = prev_data.get("refresh_token")
        except Exception:
            pass

    userinfo = fetch_userinfo(access_token)

    saved_payload = {
        "access_token": access_token,
        "refresh_token": refresh_token or "",
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

def _read_tokens() -> Optional[Dict[str, Any]]:
    try:
        return json.loads(TOKENS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None

def get_valid_access_token(data: Optional[Dict[str, Any]] = None) -> Optional[str]:
    data = data or _read_tokens()
    if not data:
        return None
    try:
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
        if access_token and time.time() >= (expires_at - 60):
            return None
        return access_token
    except Exception as e:
        logger.error(f"Error checking access token: {e}")
        return None

def save_direct_token(access_token: str, refresh_token: str = "") -> Dict[str, Any]:
    userinfo = fetch_userinfo(access_token)
    final_refresh = refresh_token.strip()
    if not final_refresh and TOKENS_PATH.exists():
        try:
            prev = json.loads(TOKENS_PATH.read_text(encoding="utf-8"))
            final_refresh = prev.get("refresh_token", "").strip()
        except Exception:
            pass

    payload = {
        "access_token": access_token.strip(),
        "refresh_token": final_refresh,
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
    data = _read_tokens()
    try:
        valid_token = get_valid_access_token(data) if data else None
    except Exception:
        valid_token = None
    return {
        "connected": bool(valid_token),
        "has_client_config": bool(client_id and cfg.get("client_secret")),
        "full_access": FULL_ACCESS,
        "client_id": client_id[:12] + "..." if client_id else "",
        "user": data.get("user", {}) if valid_token else {},
    }

def sync_google_drive(
    emb: Any,
    store: Any,
    on_progress: Optional[Callable[[str, int, int], None]] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
    max_files: int = 200,
) -> int:
    headers = _require_token()
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
            err = _api_error(resp, "Google Drive")
            if not all_files:
                raise err
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

        vec = emb.embed_text(content_repr, title=name)
        batch_items.append({
            "id": f"gdrive_{fid}",
            "path": web_link,
            "filename": name,
            "type": "document",
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

PICKER_API = "https://photospicker.googleapis.com/v1"

class GoogleScopeError(ValueError):
    """The signed-in account did not grant the scope this sync needs."""

def _api_error(resp: requests.Response, service: str) -> ValueError:
    try:
        msg = resp.json().get("error", {}).get("message", resp.text)
    except Exception:
        msg = resp.text
    logger.error(f"{service} API error ({resp.status_code}): {msg}")
    if resp.status_code == 403 and ("insufficient" in msg.lower() or "scope" in msg.lower()):
        return GoogleScopeError(f"{service} permission not granted. Sign in with Google again to allow {service} access.")
    if resp.status_code == 403 and "has not been used" in msg.lower():
        return ValueError(f"Enable the {service} API in your Google Cloud project, then retry. ({msg})")
    return ValueError(f"{service} API error ({resp.status_code}): {msg}")

def _require_token() -> Dict[str, str]:
    token = get_valid_access_token()
    if not token:
        raise ValueError("Google account is not connected. Please sign in with Google.")
    return {"Authorization": f"Bearer {token}"}

def create_photos_picker_session() -> Dict[str, Any]:
    resp = requests.post(f"{PICKER_API}/sessions", headers=_require_token(), json={}, timeout=15)
    if resp.status_code != 200:
        raise _api_error(resp, "Google Photos Picker")
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
    headers = _require_token()
    deadline = time.time() + wait_seconds
    while True:
        if cancel_check and cancel_check():
            return 0
        resp = requests.get(f"{PICKER_API}/sessions/{session_id}", headers=headers, timeout=15)
        if resp.status_code != 200:
            raise _api_error(resp, "Google Photos Picker")
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
            raise _api_error(resp, "Google Photos Picker")
        data = resp.json()
        all_media.extend(data.get("mediaItems", []))
        if not data.get("nextPageToken"):
            break
        params["pageToken"] = data["nextPageToken"]
    requests.delete(f"{PICKER_API}/sessions/{session_id}", headers=headers, timeout=15)

    PHOTOS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
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
        cache_file = PHOTOS_CACHE_DIR / f"{item_id}.jpg"
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

    return store.add_items(batch_items)

GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"

def sync_gmail(
    emb: Any,
    store: Any,
    on_progress: Optional[Callable[[str, int, int], None]] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
    max_messages: int = 1000,
) -> int:
    headers = _require_token()
    ids: List[str] = []
    params: Dict[str, Any] = {"maxResults": 500, "q": "-in:spam -in:trash"}
    while len(ids) < max_messages:
        resp = requests.get(f"{GMAIL_API}/messages", headers=headers, params=params, timeout=15)
        if resp.status_code != 200:
            raise _api_error(resp, "Gmail")
        data = resp.json()
        ids.extend(m["id"] for m in data.get("messages", []))
        if not data.get("nextPageToken"):
            break
        params["pageToken"] = data["nextPageToken"]
    ids = ids[:max_messages]

    session = requests.Session()
    session.mount("https://", requests.adapters.HTTPAdapter(pool_maxsize=8))

    def fetch(mid: str) -> Optional[Dict[str, Any]]:
        resp = session.get(
            f"{GMAIL_API}/messages/{mid}",
            headers=headers,
            params={"format": "metadata", "metadataHeaders": ["Subject", "From", "To", "Date"]},
            timeout=15,
        )
        return resp.json() if resp.status_code == 200 else None

    total = len(ids)
    records: List[Dict[str, Any]] = []
    pool = ThreadPoolExecutor(max_workers=8)
    try:
        for idx, msg in enumerate(pool.map(fetch, ids)):
            if cancel_check and cancel_check():
                break
            if not msg:
                continue
            hdrs = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
            subject = hdrs.get("Subject", "(no subject)")
            if on_progress:
                on_progress(subject, idx + 1, total)
            records.append(scanner.email_record(
                record_id=f"gmail_{msg['id']}",
                source="gmail",
                path=f"https://mail.google.com/mail/u/0/#all/{msg['threadId']}",
                subject=subject,
                sender=hdrs.get("From", ""),
                to=hdrs.get("To", ""),
                date=hdrs.get("Date", ""),
                body=html.unescape(msg.get("snippet", "")),
                modified_at=int(msg.get("internalDate", "0")) / 1000.0,
            ))
    finally:
        pool.shutdown(wait=False, cancel_futures=True)

    return scanner.embed_and_store(emb, store, records, "gmail")
