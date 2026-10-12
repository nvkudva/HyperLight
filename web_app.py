"""Hyperlight backend entry point: FastAPI app + route assembly.

All request handling lives in routes/; shared heavy singletons (embedder,
vector store, scanner, watcher) live in app_state.py and load lazily on first
use. Importing this module must stay cheap and side-effect free.
"""
import fastapi
import fastapi.staticfiles
import uvicorn

import logging_config
from routes import audio, auth_google, media, pages, search, settings, sources

logging_config.setup_logging()
logger = logging_config.get_logger("web_app")

app = fastapi.FastAPI(title="Hyperlight")

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
    uvicorn.run(app, host="127.0.0.1", port=8585)


if __name__ == "__main__":
    main()
