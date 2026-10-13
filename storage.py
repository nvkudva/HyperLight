import json
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
import lancedb
import pyarrow as pa

from app_config import (
    CONFIG_PATH,
    get_app_settings,
    get_configured_sources,
    remove_configured_source,
    save_configured_source,
    set_source_watch,
    update_app_settings,
)

__all__ = [
    "SCHEMA",
    "Storage",
    "CONFIG_PATH",
    "get_app_settings",
    "update_app_settings",
    "get_configured_sources",
    "save_configured_source",
    "set_source_watch",
    "remove_configured_source",
]

SCHEMA = pa.schema([
    pa.field("id", pa.string()),
    pa.field("vector", pa.list_(pa.float32(), 768)),
    pa.field("type", pa.string()),
    pa.field("path", pa.string()),
    pa.field("filename", pa.string()),
    pa.field("content", pa.string()),
    pa.field("source", pa.string()),
    pa.field("modified_at", pa.float64()),
    pa.field("metadata", pa.string()),
])

class Storage:
    def __init__(self, db_path: Optional[Path] = None):
        if db_path is None:
            db_path = Path.home() / ".hyperlight" / "lancedb"
        db_path.mkdir(parents=True, exist_ok=True)
        self.db = lancedb.connect(str(db_path))
        self.table_name = "items"
        if self.table_name not in self.db.table_names():
            self.table = self.db.create_table(self.table_name, schema=SCHEMA)
        else:
            self.table = self.db.open_table(self.table_name)
            vec_type = self.table.schema.field("vector").type
            if getattr(vec_type, "list_size", None) != 768:
                self.db.drop_table(self.table_name)
                self.table = self.db.create_table(self.table_name, schema=SCHEMA)
        self._known_ids: Optional[Set[str]] = None
        # Watcher, index jobs and request handlers write concurrently.
        self._lock = threading.RLock()

    def _known_id_set(self) -> Set[str]:
        """IDs already stored, cached in memory so batch dedupe is O(batch)."""
        if self._known_ids is None:
            self._known_ids = set()
            if len(self.table) > 0:
                existing_df = self.table.search().select(["id"]).to_arrow()
                self._known_ids = set(existing_df["id"].to_pylist())
        return self._known_ids

    def add_items(self, items: List[Dict[str, Any]]) -> int:
        if not items:
            return 0
        with self._lock:
            existing_ids = self._known_id_set()

            ids, vectors, types, paths, filenames, contents, sources, mtimes, metadatas = (
                [], [], [], [], [], [], [], [], []
            )
            for item in items:
                if item["id"] in existing_ids:
                    continue
                ids.append(str(item["id"]))
                vectors.append([float(v) for v in item["vector"]])
                types.append(str(item.get("type", "document")))
                paths.append(str(item.get("path", "")))
                filenames.append(str(item.get("filename", "")))
                contents.append(str(item.get("content", "")))
                sources.append(str(item.get("source", "local")))
                mtimes.append(float(item.get("modified_at", 0.0)))
                metadatas.append(json.dumps(item.get("metadata", {})))

            if ids:
                existing_ids.update(ids)
                batch = pa.RecordBatch.from_arrays([
                    pa.array(ids, type=pa.string()),
                    pa.array(vectors, type=pa.list_(pa.float32(), 768)),
                    pa.array(types, type=pa.string()),
                    pa.array(paths, type=pa.string()),
                    pa.array(filenames, type=pa.string()),
                    pa.array(contents, type=pa.string()),
                    pa.array(sources, type=pa.string()),
                    pa.array(mtimes, type=pa.float64()),
                    pa.array(metadatas, type=pa.string()),
                ], schema=SCHEMA)
                self.table.add(pa.Table.from_batches([batch]))
        return len(ids)

    def search(
        self,
        query_vector: List[float],
        query_text: Optional[str] = None,
        item_type: Optional[str] = None,
        exclude_type: Optional[str] = None,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        if len(self.table) == 0:
            return []

        search_limit = max(limit * 5, 200)
        query = self.table.search(query_vector).metric("cosine").limit(search_limit)
        if item_type and item_type != "all":
            query = query.where(f"type = '{item_type}'")
        elif exclude_type:
            query = query.where(f"type != '{exclude_type}'")

        results = query.to_arrow().to_pylist()
        if not results:
            return []

        q_terms = [t.lower() for t in (query_text or "").split() if len(t) > 1]
        is_lookup = bool(q_terms and all(
            any(c.isdigit() for c in t) and (any(c.isalpha() for c in t) or len(t) >= 4)
            for t in q_terms
        ))

        sims = [1.0 - float(r.get("_distance", 1.0)) for r in results]
        mods = ["photo" if r.get("type") == "photo" else "text" for r in results]
        global_mean = sum(sims) / len(sims)
        by_mod: Dict[str, List[float]] = {}
        for m, s in zip(mods, sims):
            by_mod.setdefault(m, []).append(s)
        modality_means = {
            m: sum(v) / len(v) if len(v) >= 5 else global_mean
            for m, v in by_mod.items()
        }

        centered_sims = [s - modality_means[m] for m, s in zip(mods, sims)]
        c_mean = sum(centered_sims) / len(centered_sims)
        variance = sum((c - c_mean) ** 2 for c in centered_sims) / len(centered_sims)
        deviation = max(variance ** 0.5, 0.02)
        z_scores = [(c - c_mean) / deviation for c in centered_sims]

        z_weight, cov_weight, fn_weight = (0.04, 0.40, 1.5) if is_lookup else (0.12, 0.20, 1.0)

        formatted = []
        gated = []
        for row, z in zip(results, z_scores):
            meta = {}
            if row.get("metadata"):
                try:
                    meta = json.loads(row["metadata"])
                except Exception:
                    meta = {}

            distance = float(row.get("_distance", 1.0))
            fn_lower = row["filename"].lower()
            content_lower = row["content"].lower()

            coverage = 0.0
            fn_bonus = 0.0
            matched = []
            if q_terms:
                matched = [t for t in q_terms if t in fn_lower or t in content_lower]
                coverage = len(matched) / len(q_terms)
                if any(t == fn_lower or fn_lower.startswith(t) for t in q_terms):
                    fn_bonus = 0.35
                elif any(t in fn_lower for t in q_terms):
                    fn_bonus = 0.20

            z_boost = max(0.0, z * z_weight)
            word_bonus = cov_weight * (coverage ** 1.5) + fn_bonus * fn_weight

            adjusted_score = max(0.0, distance - z_boost - word_bonus)
            passes_gate = (z >= 1.5) or (coverage >= 0.5) or (fn_bonus > 0.0)

            item = {
                "id": row["id"],
                "type": row["type"],
                "path": row["path"],
                "filename": row["filename"],
                "content": row["content"],
                "source": row["source"],
                "modified_at": row["modified_at"],
                "metadata": meta,
                "score": adjusted_score,
                "raw_distance": distance,
                "matched_terms": matched,
            }
            if passes_gate:
                gated.append(item)
            formatted.append(item)

        candidates = gated or formatted
        candidates.sort(key=lambda x: x["score"])
        return candidates[:limit]

    def get_stats(self) -> Dict[str, Any]:
        count = len(self.table)
        if count == 0:
            return {"total": 0, "photos": 0, "documents": 0, "sources": {}}

        arrow_data = self.table.search().select(["type", "source"]).to_arrow()
        types = arrow_data["type"].to_pylist()
        sources = arrow_data["source"].to_pylist()

        photos = sum(1 for t in types if t == "photo")
        documents = sum(1 for t in types if t == "document")
        source_counts: Dict[str, int] = {}
        for s in sources:
            source_counts[s] = source_counts.get(s, 0) + 1

        return {
            "total": count,
            "photos": photos,
            "documents": documents,
            "sources": source_counts,
        }

    def get_indexed_file_mtimes(self, under: Optional[str] = None) -> Dict[str, float]:
        """Path -> mtime of indexed items, optionally only those at or beneath `under`."""
        if len(self.table) == 0:
            return {}
        try:
            query = self.table.search().select(["path", "modified_at"])
            if under:
                query = query.where(self._path_filter(under))
            arrow_data = query.limit(None).to_arrow()
            paths = arrow_data["path"].to_pylist()
            mtimes = arrow_data["modified_at"].to_pylist()
            return dict(zip(paths, mtimes))
        except Exception:
            return {}

    @staticmethod
    def _path_filter(target_path: str) -> str:
        """SQL filter for the item at target_path and everything beneath it (raw and resolved)."""
        clauses = []
        for p in {target_path.rstrip("/") or "/", str(Path(target_path).expanduser().resolve())}:
            q = p.replace("'", "''")
            clauses.append(f"path = '{q}' OR starts_with(path, '{q.rstrip('/')}/')")
        return " OR ".join(f"({c})" for c in clauses)

    def count_items_by_path(self, target_path: str) -> int:
        if len(self.table) == 0:
            return 0
        return self.table.count_rows(self._path_filter(target_path))

    def remove_items_by_path(self, target_path: str) -> None:
        if len(self.table) == 0:
            return
        with self._lock:
            self.table.delete(self._path_filter(target_path))
            self._known_ids = None

    def clear(self) -> None:
        with self._lock:
            self.db.drop_table(self.table_name)
            self.table = self.db.create_table(self.table_name, schema=SCHEMA)
            self._known_ids = set()

