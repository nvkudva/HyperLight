"""Thumbnail, media streaming, and QuickLook preview routes."""
import hashlib
import mimetypes
import shutil
import subprocess
import tempfile
from pathlib import Path

import fastapi
from fastapi.responses import Response

import scanner

router = fastapi.APIRouter()


@router.get("/api/thumbnail")
def api_thumbnail(path: str) -> Response:
    file_path = Path(path).resolve()
    if not file_path.exists() or not file_path.is_file():
        return Response(status_code=404)
    mime, _ = mimetypes.guess_type(str(file_path))
    if not mime or not mime.startswith("image/"):
        mime = "application/octet-stream"
    return fastapi.responses.FileResponse(
        file_path, media_type=mime, headers={"Cache-Control": "private, max-age=3600"}
    )


PREVIEW_CACHE_DIR = Path.home() / ".hyperlight" / "previews"


@router.get("/api/media")
def api_media(path: str) -> Response:
    file_path = Path(path).resolve()
    if not file_path.is_file() or file_path.suffix.lower() not in scanner.VIDEO_EXTENSIONS | scanner.AUDIO_EXTENSIONS:
        return Response(status_code=404)
    return fastapi.responses.FileResponse(file_path)


@router.get("/api/preview")
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
    return fastapi.responses.FileResponse(
        cached, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"}
    )
