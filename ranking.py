"""Relevance ranking for vector-search candidates: scores similarity above each item's
baseline, boosts query-word matches, and gates out weak hits."""
import json
import re
from typing import Any, Dict, List, Optional, Sequence

import numpy

# Queries with no meaning. An item close to these is close to every query (a "hub"),
# so its similarity to them is subtracted from its similarity to the real query.
NULL_QUERIES = ["the", "a", "something", "file", "qwerty asdf", "lorem ipsum", "thing stuff", "hello"]

# Minimum similarity above baseline. Gibberish queries top out near 0.01 (photos) and
# 0.065 (text); real matches start around 0.06 and 0.08.
RELEVANCE_FLOOR = {"photo": 0.05, "text": 0.075}

STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "do", "for", "from", "how", "i", "in", "is",
    "it", "me", "my", "of", "on", "or", "the", "to", "was", "what", "when", "where", "which",
    "who", "with", "show", "find", "all", "any",
    # Say which kind of result is wanted, not what it contains.
    "photo", "photos", "picture", "pictures", "image", "images", "pic", "pics",
}


def _unit_rows(vectors: Sequence[Sequence[float]]) -> numpy.ndarray:
    matrix = numpy.asarray(vectors, dtype=numpy.float32)
    return matrix / numpy.maximum(numpy.linalg.norm(matrix, axis=-1, keepdims=True), 1e-9)


def query_terms(query_text: Optional[str]) -> List[str]:
    return [t for t in (query_text or "").lower().split() if len(t) > 1 and t not in STOPWORDS]


def rank(
    results: List[Dict[str, Any]],
    query_vector: Sequence[float],
    null_vectors: Sequence[Sequence[float]],
    query_text: Optional[str],
    limit: int,
    photo_limit: int = 0,
    boost_only: bool = False,
) -> List[Dict[str, Any]]:
    """Best-first records that clear the relevance gate. A nonzero `photo_limit` budgets
    photos separately from other results. `boost_only` lets word matches raise a score but
    never bypass the relevance floor (noisy voice transcripts)."""
    if not results:
        return []

    q_terms = query_terms(query_text)
    is_lookup = bool(q_terms and all(
        any(c.isdigit() for c in t) and (any(c.isalpha() for c in t) or len(t) >= 4)
        for t in q_terms
    ))

    item_vectors = _unit_rows([r["vector"] for r in results])
    sims = item_vectors @ _unit_rows([query_vector])[0]
    baselines = (item_vectors @ _unit_rows(null_vectors).T).mean(axis=1)
    relevances = (sims - baselines).tolist()

    cov_weight, fn_weight = (0.15, 1.5) if is_lookup else (0.08, 1.0)

    gated = []
    for row, relevance in zip(results, relevances):
        meta = {}
        if row.get("metadata"):
            try:
                meta = json.loads(row["metadata"])
            except Exception:
                meta = {}

        fn_lower = row["filename"].lower()
        content_lower = row["content"].lower()

        coverage = 0.0
        fn_bonus = 0.0
        matched = []
        if q_terms:
            matched = [t for t in q_terms if t in fn_lower or re.search(r"\b" + re.escape(t), content_lower)]
            coverage = len(matched) / len(q_terms)
            if any(t == fn_lower or fn_lower.startswith(t) for t in q_terms):
                fn_bonus = 0.15
            elif any(t in fn_lower for t in q_terms):
                fn_bonus = 0.08

        modality = "photo" if row.get("type") == "photo" else "text"
        has_word_match = coverage >= 0.5 or fn_bonus > 0.0
        passes_gate = relevance >= RELEVANCE_FLOOR[modality] or (has_word_match and relevance > 0.0 and not boost_only)
        if not passes_gate:
            continue

        gated.append({
            "id": row["id"],
            "type": row["type"],
            "path": row["path"],
            "filename": row["filename"],
            "content": row["content"],
            "source": row["source"],
            "modified_at": row["modified_at"],
            "metadata": meta,
            "score": relevance + cov_weight * (coverage ** 1.5) + fn_bonus * fn_weight,
            "raw_distance": float(row.get("_distance", 1.0)),
            "matched_terms": matched,
        })

    gated.sort(key=lambda x: x["score"], reverse=True)
    if not photo_limit:
        return gated[:limit]
    photos = [c for c in gated if c["type"] == "photo"][:photo_limit]
    others = [c for c in gated if c["type"] != "photo"][:limit]
    return sorted(photos + others, key=lambda x: x["score"], reverse=True)
