"""Shared backend singletons, constructed lazily.

Importing this module must stay cheap: the embedding model, vector store and
watcher start on first use so that lightweight probes (e.g. /api/status before
warmup, CLI --help) never pay model-load cost. Every getter is thread-safe.
"""
import threading
from typing import Any, Dict

import embedder
import logging_config
import qa_engine
import scanner
import sources
import storage
import watcher

logger = logging_config.get_logger("app_state")

_emb = None
_emb_lock = threading.Lock()
_store = None
_store_lock = threading.Lock()
_sc = None
_sc_lock = threading.Lock()
_engine = None
_engine_lock = threading.Lock()
_live_watcher = None
_watcher_lock = threading.Lock()
_jobs = None
_jobs_lock = threading.Lock()


def get_embedder() -> embedder.Embedder:
    global _emb
    if _emb is None:
        with _emb_lock:
            if _emb is None:
                logger.info("Loading embedding model on demand...")
                _emb = embedder.Embedder()
    return _emb


def get_storage() -> storage.Storage:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = storage.Storage()
    return _store


def get_scanner() -> scanner.Scanner:
    global _sc
    if _sc is None:
        with _sc_lock:
            if _sc is None:
                _sc = scanner.Scanner(get_embedder(), get_storage())
    return _sc


def get_engine() -> qa_engine.QAEngine:
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                _engine = qa_engine.QAEngine()
    return _engine


def get_watcher() -> watcher.LiveWatcher:
    global _live_watcher
    if _live_watcher is None:
        with _watcher_lock:
            if _live_watcher is None:
                _live_watcher = watcher.LiveWatcher(get_embedder(), get_storage(), get_scanner(), sources.watched_paths)
                _live_watcher.start()
    return _live_watcher


def peek_watcher() -> Any:
    return _live_watcher


def get_jobs():
    """Index job manager (lives in jobs.py to keep this module import-light)."""
    global _jobs
    if _jobs is None:
        with _jobs_lock:
            if _jobs is None:
                from jobs import IndexJobManager
                _jobs = IndexJobManager()
    return _jobs


def warmup() -> Dict[str, Any]:
    """Load the heavy models now; called by POST /api/warmup."""
    emb = get_embedder()
    emb.embed_query("warmup")
    get_storage()
    return {"ready": True}
