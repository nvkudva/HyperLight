"""Thumbnail, media streaming, and QuickLook preview routes."""
import hashlib
import mimetypes
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import fastapi
from fastapi.responses import Response

import app_state
import google_auth
import parsers

router = fastapi.APIRouter()

HYPERLIGHT_DIR = Path.home() / ".hyperlight"
PREVIEW_CACHE_DIR = HYPERLIGHT_DIR / "previews"


def _is_within(path: Path, root: Path) -> bool:
    return path.is_relative_to(root.resolve())


def is_openable(target: str) -> bool:
    """Only items in the index and our own caches may be read, previewed, opened or revealed;
    everything else under ~/.hyperlight (config, tokens, the index itself) stays private."""
    if not target.startswith("/"):
        return app_state.get_storage().has_path(target)
    path = Path(target).resolve()
    if _is_within(path, HYPERLIGHT_DIR):
        return _is_within(path, PREVIEW_CACHE_DIR) or _is_within(path, google_auth.PHOTOS_CACHE_DIR)
    return app_state.get_storage().has_path(str(path))


def not_indexed_response(**fields: Any) -> Response:
    return fastapi.responses.JSONResponse(status_code=403, content={"error": "not_indexed", **fields})


@router.get("/api/thumbnail")
def api_thumbnail(path: str) -> Response:
    file_path = Path(path).resolve()
    if not is_openable(str(file_path)):
        return not_indexed_response()
    mime, _ = mimetypes.guess_type(str(file_path))
    if not file_path.is_file() or not mime or not mime.startswith("image/"):
        return Response(status_code=404)
    return fastapi.responses.FileResponse(
        file_path, media_type=mime, headers={"Cache-Control": "private, max-age=3600"}
    )


@router.get("/api/media")
def api_media(path: str) -> Response:
    file_path = Path(path).resolve()
    if not is_openable(str(file_path)):
        return not_indexed_response()
    if not file_path.is_file() or file_path.suffix.lower() not in parsers.VIDEO_EXTENSIONS | parsers.AUDIO_EXTENSIONS:
        return Response(status_code=404)
    return fastapi.responses.FileResponse(file_path)


TEXT_PREVIEW_BYTES = 64 * 1024
TEXT_PREVIEW_EXTENSIONS = parsers.TEXT_EXTENSIONS | parsers.CODE_EXTENSIONS | {".log", ".xml", ".toml", ".ini", ".rtf"}


@router.get("/api/text")
def api_text(path: str) -> Response:
    """First 64 KB of a text-like file, for the preview pane."""
    file_path = Path(path).resolve()
    if not is_openable(str(file_path)):
        return not_indexed_response()
    if not file_path.is_file() or file_path.suffix.lower() not in TEXT_PREVIEW_EXTENSIONS:
        return Response(status_code=404)
    with file_path.open("rb") as handle:
        raw = handle.read(TEXT_PREVIEW_BYTES)
    return Response(raw.decode("utf-8", errors="replace"), media_type="text/plain; charset=utf-8",
                    headers={"Cache-Control": "private, max-age=60"})


@router.get("/api/app-icon")
def api_app_icon(path: str, size: int = 128) -> Response:
    """Real .app bundle icon, read from its .icns (qlmanage hangs on bundles)."""
    file_path = Path(path).resolve()
    if not is_openable(str(file_path)):
        return not_indexed_response()
    if file_path.suffix.lower() != ".app" or not file_path.is_dir():
        return Response(status_code=404)
    icns = _find_app_icns(file_path)
    if icns is None:
        return Response(status_code=404)
    try:
        stat = icns.stat()
    except OSError:
        return Response(status_code=404)
    size = min(max(size, 16), 512)
    key = hashlib.sha1(f"appicon:{file_path}:{stat.st_mtime_ns}:{stat.st_size}:{size}".encode()).hexdigest()
    cached = PREVIEW_CACHE_DIR / f"appicon_{key}.png"
    if not cached.exists():
        PREVIEW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        try:
            subprocess.run(
                ["sips", "-s", "format", "png", "-Z", str(size), str(icns), "--out", str(cached)],
                capture_output=True, timeout=10, check=True,
            )
        except (subprocess.SubprocessError, OSError):
            return Response(status_code=404)
        if not cached.exists():
            return Response(status_code=404)
    return fastapi.responses.FileResponse(
        cached, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"}
    )


def _bundle_icon_name(plist_path: Path) -> str:
    if not plist_path.is_file():
        return ""
    try:
        import plistlib

        with open(plist_path, "rb") as handle:
            info = plistlib.load(handle)
    except (OSError, ValueError):
        return ""
    name = info.get("CFBundleIconFile", "")
    return name if isinstance(name, str) else ""


def _find_app_icns(app_path: Path) -> Path | None:
    resources = app_path / "Contents" / "Resources"
    plist_path = app_path / "Contents" / "Info.plist"
    icon_name = _bundle_icon_name(plist_path)
    if icon_name:
        candidate = resources / icon_name
        if candidate.is_file():
            return candidate
        suffixed = candidate.with_suffix(".icns") if candidate.suffix != ".icns" else candidate
        if suffixed.is_file():
            return suffixed
    if not resources.is_dir():
        return None
    try:
        candidates = [p for p in resources.glob("*.icns") if p.is_file()]
    except OSError:
        return None
    if not candidates:
        return None
    try:
        candidates.sort(key=lambda p: p.stat().st_size, reverse=True)
    except OSError:
        pass
    return candidates[0]


@router.get("/api/preview")
def api_preview(path: str, size: int = 800) -> Response:
    file_path = Path(path).resolve()
    if not is_openable(str(file_path)):
        return not_indexed_response()
    is_app_bundle = file_path.suffix.lower() == ".app" and file_path.is_dir()
    if not file_path.is_file() and not is_app_bundle:
        return Response(status_code=404)
    try:
        stat = file_path.stat()
    except OSError:
        return Response(status_code=404)
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
