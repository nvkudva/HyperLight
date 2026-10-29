"""Static page routes (React shell + favicon)."""
import os
import sys
from pathlib import Path

import fastapi
from fastapi.responses import HTMLResponse

router = fastapi.APIRouter()


def resource_root() -> Path:
    """Where bundled resources (frontend/dist) live.

    Frozen PyInstaller sidecar: resources extract to ``sys._MEIPASS``.
    ``HYPERLIGHT_RESOURCE_DIR`` overrides for tests and custom layouts.
    Otherwise the repo root (three levels above this file).
    """
    frozen_root = getattr(sys, "_MEIPASS", None)
    if frozen_root:
        return Path(frozen_root)
    override = os.environ.get("HYPERLIGHT_RESOURCE_DIR")
    if override:
        return Path(override)
    return Path(__file__).parent.parent.parent


FRONTEND_DIST = resource_root() / "frontend" / "dist"


@router.get("/", response_class=HTMLResponse)
def index_page() -> str:
    return (FRONTEND_DIST / "index.html").read_text(encoding="utf-8")


@router.get("/api/health")
def health() -> dict:
    return {"ok": True}
