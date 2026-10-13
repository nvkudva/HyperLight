"""Static page routes (React shell + favicon)."""
from pathlib import Path

import fastapi
from fastapi.responses import HTMLResponse, Response

router = fastapi.APIRouter()

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
TEMPLATE_PATH = Path(__file__).parent.parent / "templates" / "index.html"


@router.get("/", response_class=HTMLResponse)
def index_page() -> str:
    react_index = FRONTEND_DIST / "index.html"
    if react_index.exists():
        return react_index.read_text(encoding="utf-8")
    return TEMPLATE_PATH.read_text(encoding="utf-8")


@router.get("/api/health")
def health() -> dict:
    return {"ok": True}


@router.get("/vite.svg")
def vite_svg() -> Response:
    svg_path = FRONTEND_DIST / "vite.svg"
    if svg_path.exists():
        return Response(content=svg_path.read_bytes(), media_type="image/svg+xml")
    return Response(status_code=404)
