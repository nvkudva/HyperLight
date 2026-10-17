"""Spotlight query: a text or voice query in, ordered result buckets out.

Owns bucket kinds, their labels and order, per-bucket caps and path dedupe,
so text search, voice search and the frontend all agree on one answer.
"""
import functools
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import numpy
import PIL.Image

import app_state
import parsers

CANDIDATE_LIMIT = 60
PHOTO_CANDIDATES = 40
PER_BUCKET = 5
PER_BUCKET_OVERRIDES = {"photo": 30}

EXCLUDED_IMAGE_PX = 32
SMALL_IMAGE_PX = 200
TINY_IMAGE_PX = 64
MAIL_PATH_MARKER = "/Library/Mail/"

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
BUCKET_ORDER = ["app", "setting", "video", "email", "photo", "document", "audio", "text"]

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
    if ext in parsers.IMAGE_EXTENSIONS:
        return "photo"  # a cloud-only image, indexed by name until downloaded
    return "document" if ext in OFFICE_DOC_EXTENSIONS else "text"


@functools.lru_cache(maxsize=4096)
def _image_size(path: str) -> Optional[Tuple[int, int]]:
    try:
        with PIL.Image.open(path) as image:
            return image.size
    except Exception:
        return None


def is_excluded_size(record: Dict[str, Any]) -> bool:
    if record["type"] != "photo":
        return False
    size = _image_size(record["path"])
    return size is not None and min(size) <= EXCLUDED_IMAGE_PX


def demotion(record: Dict[str, Any]) -> int:
    """0 = normal, 1 = thumbnail/icon-sized image, 2 = tiny image or small mail attachment."""
    if record["type"] != "photo":
        return 0
    size = _image_size(record["path"])
    if size is None or min(size) >= SMALL_IMAGE_PX:
        return 0
    is_mail_attachment = MAIL_PATH_MARKER in record["path"]
    return 2 if min(size) < TINY_IMAGE_PX or is_mail_attachment else 1


def _dedupe_key(record: Dict[str, Any]) -> Tuple[Any, ...]:
    """Same name and byte size counts as one file: a mail attachment saved per message, or a
    file chunked into several records."""
    size = (record.get("metadata") or {}).get("size_bytes")
    if size is None:
        return (record.get("path"),)
    return (record.get("filename"), size)


def group(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Ranked records -> buckets in BUCKET_ORDER, then first-seen order; first hit per file.

    Images at or under EXCLUDED_IMAGE_PX are dropped; other small images (icons, thumbnails,
    mail attachments) sink below normal ones.
    """
    items_by_kind: Dict[str, List[Dict[str, Any]]] = {}
    seen_files = set()
    for r in sorted(results, key=demotion):
        if is_excluded_size(r):
            continue
        kind = bucket_of(r)
        items = items_by_kind.setdefault(kind, [])
        key = _dedupe_key(r)
        if len(items) < PER_BUCKET_OVERRIDES.get(kind, PER_BUCKET) and key not in seen_files:
            seen_files.add(key)
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


MIN_SPEECH_RMS = 0.005
MAX_NO_SPEECH_PROB = 0.6


def _is_quiet(samples: Sequence[float]) -> bool:
    return float(numpy.sqrt(numpy.mean(numpy.square(samples)))) < MIN_SPEECH_RMS


def _transcript_if_speech(samples: Sequence[float], transcribe: Callable[[Any], Dict[str, Any]]) -> str:
    """The spoken words, or "" when the clip is quiet, Whisper hears no speech, or the text is only punctuation."""
    if _is_quiet(samples):
        return ""
    result = transcribe(samples)
    segments = result.get("segments") or []
    if segments and all(s.get("no_speech_prob", 0.0) > MAX_NO_SPEECH_PROB for s in segments):
        return ""
    text = (result.get("text") or "").strip()
    return text if any(c.isalnum() for c in text) else ""


def query_audio(samples: Sequence[float], rate: int, transcribe: Optional[Callable[[Any], Dict[str, Any]]]) -> Optional[Dict[str, Any]]:
    """Voice search: transcript + audio embedded jointly, transcript words only boost.
    Without `transcribe`, the raw audio alone is embedded and the response has no query text.
    Empty response for non-speech; None if embedding fails."""
    samples = numpy.asarray(samples, dtype=numpy.float32)
    if transcribe is None:
        if _is_quiet(samples):
            return respond("", [])
        vector = app_state.get_embedder().embed_audio(samples, rate)
        if vector is None:
            return None
        return respond("", _search(vector, None))
    transcript = _transcript_if_speech(samples, transcribe)
    if not transcript:
        return respond("", [])
    vector = app_state.get_embedder().embed_query_audio(transcript, samples, rate)
    if vector is None:
        return None
    return respond(transcript, _search(vector, transcript, boost_only=True))


def _search(vector: List[float], text: Optional[str], boost_only: bool = False) -> List[Dict[str, Any]]:
    return group(app_state.get_storage().search(vector, app_state.get_embedder().null_vectors(), query_text=text, limit=CANDIDATE_LIMIT, photo_limit=PHOTO_CANDIDATES, boost_only=boost_only))
