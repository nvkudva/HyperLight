"""Shared helpers for Google cloud syncs (Drive, Photos, Gmail)."""
import logging
from typing import Dict

import requests

import google_auth

logger = logging.getLogger(__name__)


class GoogleScopeError(ValueError):
    """The signed-in account did not grant the scope this sync needs."""


def api_error(resp: requests.Response, service: str) -> ValueError:
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


def require_token() -> Dict[str, str]:
    token = google_auth.get_valid_access_token()
    if not token:
        raise ValueError("Google account is not connected. Please sign in with Google.")
    return {"Authorization": f"Bearer {token}"}
