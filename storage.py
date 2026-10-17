import json
import threading
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set
import lancedb
import pyarrow as pa

import logging_config
import ranking

logger = logging_config.get_logger("storage")

# Vectors from a different model or size are not comparable; bumping this rebuilds the index.
INDEX_VERSION = "google/embeddinggemma-2:768"
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

def _quote(value: str) -> str:
    """Escape a value for a single-quoted SQL string literal."""
    return value.replace("'", "''")


class Storage:
    def __init__(self, db_path: Optional[Path] = None):
        if db_path is None:
            db_path = Path.home() / ".hyperlight" / "lancedb"
        db_path.mkdir(parents=True, exist_ok=True)
        self.db = lancedb.connect(str(db_path))
        self.table_name = "items"
        version_path = db_path / "index_version"
        if self.table_name not in self.db.table_names():
            self.table = self.db.create_table(self.table_name, schema=SCHEMA)
        else:
            self.table = self.db.open_table(self.table_name)
            if self._is_stale(version_path):
                logger.warning(f"Index was built for a different embedding model; dropping {len(self.table)} items to rebuild.")
                self.db.drop_table(self.table_name)
                self.table = self.db.create_table(self.table_name, schema=SCHEMA)
        version_path.write_text(INDEX_VERSION)
        self._known_ids: Optional[Set[str]] = None
        # Watcher, index jobs and request handlers write concurrently.
        self._lock = threading.RLock()

    def _is_stale(self, version_path: Path) -> bool:
        if getattr(self.table.schema.field("vector").type, "list_size", None) != 768:
            return True
        # Indexes from before the marker existed are kept when their vector size matches.
        return version_path.exists() and version_path.read_text().strip() != INDEX_VERSION

    def _known_id_set(self) -> Set[str]:
        """IDs already stored, cached in memory so batch dedupe is O(batch)."""
        if self._known_ids is None:
            self._known_ids = set()
            if len(self.table) > 0:
                existing_df = self.table.search().select(["id"]).to_arrow()
                self._known_ids = set(existing_df["id"].to_pylist())
        return self._known_ids

    def add_items(self, items: List[Dict[str, Any]], replace_paths: Iterable[str] = ()) -> int:
        """Insert items, skipping ids already stored.

        Rows at `replace_paths` are deleted in the same locked step, so an edited
        file swaps its old chunks for new ones and is never missing from search.
        """
        replace_paths = list(replace_paths)
        if not items and not replace_paths:
            return 0
        with self._lock:
            if replace_paths:
                self._delete_where(" OR ".join(f"path = '{_quote(p)}'" for p in replace_paths))
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
        null_vectors: List[List[float]],
        query_text: Optional[str] = None,
        item_type: Optional[str] = None,
        exclude_type: Optional[str] = None,
        limit: int = 10,
        photo_limit: int = 0,
        boost_only: bool = False,
    ) -> List[Dict[str, Any]]:
        """Ranked records. With `photo_limit` and no type filter, photos get their own
        candidate pool and result budget so text hits cannot crowd them out."""
        split_photos = photo_limit > 0 and not (item_type and item_type != "all") and not exclude_type
        search_limit = max(limit * 5, 200)
        with self._lock:
            if len(self.table) == 0:
                return []

            def fetch(where: Optional[str]) -> List[Dict[str, Any]]:
                query = self.table.search(query_vector).metric("cosine").limit(search_limit)
                if where:
                    query = query.where(where)
                return query.to_arrow().to_pylist()

            if split_photos:
                results = fetch("type = 'photo'") + fetch("type != 'photo'")
            elif item_type and item_type != "all":
                results = fetch(f"type = '{_quote(item_type)}'")
            elif exclude_type:
                results = fetch(f"type != '{_quote(exclude_type)}'")
            else:
                results = fetch(None)
        return ranking.rank(results, query_vector, null_vectors, query_text, limit, photo_limit if split_photos else 0, boost_only)

    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
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
            q = _quote(p)
            prefix = q if q.endswith((":", "/")) else q.rstrip("/") + "/"
            clauses.append(f"path = '{q}' OR starts_with(path, '{prefix}')")
        return " OR ".join(f"({c})" for c in clauses)

    def count_items_by_path(self, target_path: str) -> int:
        if len(self.table) == 0:
            return 0
        return self.table.count_rows(self._path_filter(target_path))

    def remove_items_by_path(self, target_path: str) -> None:
        with self._lock:
            self._delete_where(self._path_filter(target_path))

    def _delete_where(self, where: str) -> None:
        if len(self.table) == 0:
            return
        if self._known_ids is not None:
            # Dropping just these ids keeps the cache valid; resetting it would
            # force the next write to re-read every id in the index.
            removed = self.table.search().select(["id"]).where(where).limit(None).to_arrow()
            self._known_ids.difference_update(removed["id"].to_pylist())
        self.table.delete(where)

    def clear(self) -> None:
        with self._lock:
            self.db.drop_table(self.table_name)
            self.table = self.db.create_table(self.table_name, schema=SCHEMA)
            self._known_ids = set()

