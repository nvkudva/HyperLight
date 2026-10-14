"""Spotlight query: a text or voice query in, ordered result buckets out.

Owns bucket kinds, their labels and order, per-bucket caps and path dedupe,
so text search, voice search and the frontend all agree on one answer.
"""
from typing import Any, Dict, List, Optional, Sequence

import app_state

CANDIDATE_LIMIT = 60
PHOTO_CANDIDATES = 40
PER_BUCKET = 5
PER_BUCKET_OVERRIDES = {"photo": 30}

BUCKET_LABELS = {
    "app": "Applications",
    "setting": "Settings",
    "video": "Videos",
    "photo": "Photos",
    "document": "Documents",
    "audio": "Audio",
    "text": "Text files",
    "contact": "Contacts",
    "calendar": "Calendar events",
    "email": "Mail",
    "bookmark": "Bookmarks",
}
BUCKET_ORDER = ["app", "setting", "video", "photo", "document", "audio", "text"]

OFFICE_DOC_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx",
    ".key", ".pages", ".numbers", ".rtf", ".odt", ".odp",
}


def bucket_of(record: Dict[str, Any]) -> str:
    t = record["type"]
    if t != "document":
        return t
    name = (record.get("filename") or record.get("path") or "").lower()
    dot = name.rfind(".")
    ext = name[dot:] if dot != -1 else ""
    return "document" if ext in OFFICE_DOC_EXTENSIONS else "text"


def group(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Ranked records -> buckets in BUCKET_ORDER, then first-seen order; first hit per path."""
    items_by_kind: Dict[str, List[Dict[str, Any]]] = {}
    seen_paths = set()
    for r in results:
        kind = bucket_of(r)
        items = items_by_kind.setdefault(kind, [])
        if len(items) < PER_BUCKET_OVERRIDES.get(kind, PER_BUCKET) and r.get("path") not in seen_paths:
            seen_paths.add(r.get("path"))
            items.append(r)
    kinds = [k for k in BUCKET_ORDER if k in items_by_kind]
    kinds += [k for k in items_by_kind if k not in kinds]
    return [
        {"kind": k, "label": BUCKET_LABELS.get(k, k), "items": items_by_kind[k]}
        for k in kinds
        if items_by_kind[k]
    ]


def respond(query: str, buckets: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "query": query,
        "buckets": buckets,
        "total_matches": sum(len(b["items"]) for b in buckets),
    }


def query(text: str) -> Dict[str, Any]:
    text = text.strip()
    if not text:
        return respond("", [])
    vector = app_state.get_embedder().embed_query(text)
    return respond(text, _search(vector, text))


def query_audio(samples: Sequence[float], rate: int) -> Optional[Dict[str, Any]]:
    """Search by the audio embedding directly (no transcription). None if embedding fails."""
    vector = app_state.get_embedder().embed_audio(samples, rate)
    if vector is None:
        return None
    return respond("", _search(vector, None))


def _search(vector: List[float], text: Optional[str]) -> List[Dict[str, Any]]:
    return group(app_state.get_storage().search(vector, query_text=text, limit=CANDIDATE_LIMIT, photo_limit=PHOTO_CANDIDATES))
