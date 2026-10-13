"""Live text search and chat Q&A routes."""
from typing import Any, Dict, List

import fastapi

import app_state
import storage
from routes.schemas import ChatRequest, SpotlightRequest

router = fastapi.APIRouter()

PHOTO_KEYWORDS = ["photo", "photos", "picture", "pictures", "image", "images", "pic", "pics", "snapshot", "selfie"]

META_DOC_KEYWORDS = [
    "size", "when", "added", "modified", "created", "date", "type", "extension", "format",
    "file", "files", "document", "documents", "tax", "pdf", "docx", "txt", "folder",
    "how much", "how many", "total", "what is", "where is", "list", "who", "phone", "email"
]

CATEGORY_PRIORITY = ["app", "video", "photo", "document", "audio", "text"]

OFFICE_DOC_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx",
    ".key", ".pages", ".numbers", ".rtf", ".odt", ".odp",
}


def spotlight_bucket(r: Dict[str, Any]) -> str:
    t = r["type"]
    if t != "document":
        return t
    name = (r.get("filename") or r.get("path") or "").lower()
    dot = name.rfind(".")
    ext = name[dot:] if dot != -1 else ""
    return "document" if ext in OFFICE_DOC_EXTENSIONS else "text"


def group_spotlight(results: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Bucket results (5 per category, first hit per path) in priority order."""
    categories: Dict[str, List[Dict[str, Any]]] = {}
    seen_paths = set()
    for r in results:
        t = spotlight_bucket(r)
        if t not in categories:
            categories[t] = []
        if len(categories[t]) < 5 and r.get("path") not in seen_paths:
            seen_paths.add(r.get("path"))
            categories[t].append(r)
    ordered = {t: categories[t] for t in CATEGORY_PRIORITY if t in categories}
    for t, items in categories.items():
        if t not in ordered:
            ordered[t] = items
    return ordered


@router.post("/api/spotlight")
def api_spotlight(req: SpotlightRequest) -> Dict[str, Any]:
    query_text = req.query.strip()
    if not query_text:
        return {"query": "", "categories": {}, "total_matches": 0}

    query_vector = app_state.get_embedder().embed_query(query_text)
    results = app_state.get_storage().search(query_vector, query_text=query_text, limit=max(req.limit, 60))

    categories = group_spotlight(results)
    total_matches = sum(len(items) for items in categories.values())
    return {
        "query": query_text,
        "categories": categories,
        "total_matches": total_matches,
    }


@router.post("/api/chat")
def api_chat(req: ChatRequest) -> Dict[str, Any]:
    store = app_state.get_storage()
    query_text = req.message.strip()
    query_vector = app_state.get_embedder().embed_query(query_text)
    lower_query = query_text.lower()

    is_photo_query = any(w in lower_query for w in PHOTO_KEYWORDS)
    is_meta_or_doc_query = any(w in lower_query for w in META_DOC_KEYWORDS)

    if is_photo_query and not is_meta_or_doc_query:
        photo_candidates = store.search(query_vector, query_text=query_text, item_type="photo", limit=6)
        matching_photos = [p for p in photo_candidates if p.get("score", 1.0) < 0.78]
        if matching_photos:
            return {
                "answer": f"I found {len(matching_photos)} photo(s) matching your request:",
                "photos": matching_photos,
                "sources": [],
            }
        else:
            return {
                "answer": f"No photos found matching '{query_text}'.",
                "photos": [],
                "sources": [],
            }

    doc_candidates = store.search(query_vector, query_text=query_text, exclude_type="photo", limit=6)

    if any(w in lower_query for w in ["photo", "image", "picture"]) and any(w in lower_query for w in ["size", "when", "added", "date", "modified"]):
        photo_candidates = store.search(query_vector, query_text=query_text, item_type="photo", limit=3)
        doc_candidates.extend(photo_candidates)

    custom_instructions = storage.get_app_settings().get("custom_instructions", "")
    qa_result = app_state.get_engine().generate_answer(query_text, doc_candidates, system_prompt=custom_instructions)
    return {
        "answer": qa_result["answer"],
        "photos": [],
        "sources": qa_result["sources"],
    }
