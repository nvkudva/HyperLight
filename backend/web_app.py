"""Hyperlight backend entry point: FastAPI app + route assembly.

All request handling lives in routes/; shared heavy singletons (embedder,
vector store, scanner, watcher) live in app_state.py and load lazily on first
use. Importing this module must stay cheap and side-effect free.
"""
import urllib.parse

import fastapi
import fastapi.exceptions
import fastapi.responses
import fastapi.staticfiles
import uvicorn

import logging_config
from routes import audio, auth_google, media, pages, search, settings, sources

logging_config.setup_logging()
logger = logging_config.get_logger("web_app")

app = fastapi.FastAPI(title="Hyperlight")

LOCAL_HOSTS = {"127.0.0.1", "localhost"}
PORT = 8585


def _is_local(url: str) -> bool:
    """True for the app's own address; a different port is another local service, not us."""
    try:
        parts = urllib.parse.urlsplit(url)
        return parts.hostname in LOCAL_HOSTS and parts.port == PORT
    except ValueError:
        return False


@app.exception_handler(fastapi.exceptions.RequestValidationError)
async def reject_invalid_request(request: fastapi.Request, exc: fastapi.exceptions.RequestValidationError):
    """Reports which fields are wrong without echoing their values: they may be huge or unencodable."""
    problems = [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
    return fastapi.responses.JSONResponse({"detail": problems}, status_code=422)


@app.middleware("http")
async def reject_foreign_requests(request: fastapi.Request, call_next):
    """The API is unauthenticated, so only the app's own pages may call it.

    Blocks DNS rebinding (foreign Host), cross-site writes (foreign Origin) and
    cross-site subresource reads such as <img src=/api/thumbnail?path=...>.
    Top-level GET navigations stay allowed for the Google OAuth redirect.
    """
    host_ok = _is_local(str(request.url))
    origin = request.headers.get("origin")
    origin_ok = origin is None or _is_local(origin)
    site = request.headers.get("sec-fetch-site", "same-origin")
    navigation = request.method == "GET" and request.headers.get("sec-fetch-mode") == "navigate"
    if not host_ok or not origin_ok or (site == "cross-site" and not navigation):
        logger.warning("Rejected %s %s from origin=%s site=%s", request.method, request.url.path, origin, site)
        return fastapi.responses.JSONResponse({"error": "forbidden"}, status_code=403)
    return await call_next(request)


for router in (
    pages.router,
    search.router,
    media.router,
    audio.router,
    sources.router,
    auth_google.router,
    settings.router,
):
    app.include_router(router)

if pages.FRONTEND_DIST.exists():
    app.mount("/", fastapi.staticfiles.StaticFiles(directory=str(pages.FRONTEND_DIST), html=False), name="dist")


def main() -> None:
    media.prune_preview_cache()
    uvicorn.run(app, host="127.0.0.1", port=PORT)


if __name__ == "__main__":
    main()
