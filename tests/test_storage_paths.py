import tempfile
import unittest
from pathlib import Path

import storage


def _item(item_id, path):
    return {"id": item_id, "vector": [0.0] * 768, "path": path, "filename": Path(path).name}


class PathPrefixTest(unittest.TestCase):
    def setUp(self):
        self.store = storage.Storage(Path(tempfile.mkdtemp()))
        self.store.add_items([
            _item("a", "/x/Docs/a.txt"),
            _item("b", "/x/Docs2/b.txt"),
            _item("c", "/x/D_cs/c.txt"),
            _item("d", "/x/Docs"),
        ])

    def test_count_matches_only_the_folder_and_its_children(self):
        self.assertEqual(self.store.count_items_by_path("/x/Docs"), 2)
        self.assertEqual(self.store.count_items_by_path("/x/Docs/"), 2)

    def test_remove_leaves_sibling_folders_with_shared_prefix(self):
        self.store.remove_items_by_path("/x/Docs")
        self.assertEqual(sorted(self.store.get_indexed_file_mtimes()), ["/x/D_cs/c.txt", "/x/Docs2/b.txt"])

    def test_remove_keeps_known_id_cache_so_readding_works(self):
        self.store.add_items([_item("e", "/x/Docs/e.txt")])
        cached_before = self.store._known_ids
        self.store.remove_items_by_path("/x/Docs/e.txt")
        self.assertIs(self.store._known_ids, cached_before)
        self.assertNotIn("e", self.store._known_ids)
        self.assertIn("b", self.store._known_ids)
        self.assertEqual(self.store.add_items([_item("e", "/x/Docs/e.txt")]), 1)

    def test_replace_paths_swaps_a_files_rows_and_keeps_its_folder_twin(self):
        self.store.add_items([_item("a2", "/x/Docs/a.txt")], replace_paths=["/x/Docs/a.txt", "/x/Docs"])
        self.assertEqual(self.store.count_items_by_path("/x/Docs/a.txt"), 1)
        self.assertEqual(self.store.count_items_by_path("/x/Docs2"), 1)
        self.assertNotIn("a", self.store._known_id_set())
        self.assertEqual(self.store.add_items([_item("a", "/x/Docs/a.txt")]), 1)

    def test_mtimes_scoped_to_folder(self):
        self.assertEqual(sorted(self.store.get_indexed_file_mtimes(under="/x/Docs2")), ["/x/Docs2/b.txt"])


class IndexVersionTest(unittest.TestCase):
    def test_index_from_another_model_is_rebuilt_and_matching_one_kept(self):
        db_path = Path(tempfile.mkdtemp())
        storage.Storage(db_path).add_items([_item("a", "/x/a.txt")])
        self.assertEqual(len(storage.Storage(db_path).table), 1)
        (db_path / "index_version").write_text("other-model:768")
        self.assertEqual(len(storage.Storage(db_path).table), 0)
        self.assertEqual((db_path / "index_version").read_text(), storage.INDEX_VERSION)


class MaintenanceTest(unittest.TestCase):
    def setUp(self):
        self.store = storage.Storage(Path(tempfile.mkdtemp()))
        self.store.add_items([_item("a", "/x/a.txt"), _item("b", "/x/b.txt"), _item("c", "/x/c.txt")])

    def test_remove_paths_deletes_only_the_listed_files(self):
        self.store.remove_paths(["/x/a.txt", "/x/b.txt"])
        self.assertEqual(sorted(self.store.get_indexed_file_mtimes()), ["/x/c.txt"])

    def test_compact_keeps_every_row(self):
        self.store.compact()
        self.assertEqual(self.store.count_items_by_path("/x"), 3)


if __name__ == "__main__":
    unittest.main()
