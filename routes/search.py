"""Live text search and chat Q&A routes."""
from typing import Any, Dict

import fastapi

import app_state
import spotlight
import storage
from routes.schemas import ChatRequest, SpotlightRequest

router = fastapi.APIRouter()

PHOTO_KEYWORDS = ["photo", "photos", "picture", "pictures", "image", "images", "pic", "pics", "snapshot", "selfie"]

META_DOC_KEYWORDS = [
    "size", "when", "added", "modified", "created", "date", "type", "extension", "format",
    "file", "files", "document", "documents", "tax", "pdf", "docx", "txt", "folder",
    "how much", "how many", "total", "what is", "where is", "list", "who", "phone", "email"
]


@router.post("/api/spotlight")
def api_spotlight(req: SpotlightRequest) -> Dict[str, Any]:
    return spotlight.query(req.query)


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
