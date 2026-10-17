import json
import logging
import os
from pathlib import Path
import secrets
import time
from typing import Any, Dict, List, Optional
import urllib.parse
import requests

logger = logging.getLogger(__name__)

CONFIG_DIR = Path.home() / ".hyperlight"
TOKENS_PATH = CONFIG_DIR / "google_tokens.json"
CLIENT_CONFIG_PATH = CONFIG_DIR / "google_client.json"
PHOTOS_CACHE_DIR = CONFIG_DIR / "google_photos_cache"
BUNDLED_CLIENT_PATH = Path(__file__).resolve().parent / "google_client.json"

# Drive and Gmail scopes are restricted: they need Google verification plus a CASA assessment before public release.
FULL_ACCESS = os.environ.get("HYPERLIGHT_GOOGLE_FULL_ACCESS") == "1"

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

MAX_PENDING_STATES = 5
_pending_states: List[str] = []


def consume_state(state: Optional[str]) -> bool:
    """True once for each state handed out by get_auth_url; guards the callback against forged sign-ins."""
    if state not in _pending_states:
        return False
    _pending_states.remove(state)
    return True


def get_auth_url(redirect_uri: str) -> str:
    global _last_redirect_uri
    _last_redirect_uri = redirect_uri
    cfg = get_client_config()
    client_id = cfg.get("client_id")
    if not client_id:
        raise ValueError("Google sign-in is not configured in this build (google_client.json is missing).")

    state = secrets.token_urlsafe(24)
    _pending_states[:] = _pending_states[-(MAX_PENDING_STATES - 1):] + [state]
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
    _write_tokens(saved_payload)
    return saved_payload

def fetch_userinfo(access_token: str) -> Dict[str, Any]:
    userinfo_url = "https://www.googleapis.com/oauth2/v2/userinfo"
    resp = requests.get(userinfo_url, headers={"Authorization": f"Bearer {access_token}"}, timeout=10)
    if resp.status_code == 200:
        return resp.json()
    return {}

def _write_tokens(payload: Dict[str, Any]) -> None:
    """Tokens are credentials: owner-only file, replaced atomically."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = TOKENS_PATH.with_suffix(".json.tmp")
    descriptor = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    os.replace(tmp_path, TOKENS_PATH)

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
                    _write_tokens(data)
                    return new_access
        if access_token and time.time() >= (expires_at - 60):
            return None
        return access_token
    except Exception as e:
        logger.error(f"Error checking access token: {e}")
        return None

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


__all__ = [
    "PHOTOS_CACHE_DIR",
    "consume_state",
    "disconnect",
    "exchange_code",
    "fetch_userinfo",
    "get_auth_url",
    "get_client_config",
    "get_status",
    "get_valid_access_token",
    "parse_client_json",
]
