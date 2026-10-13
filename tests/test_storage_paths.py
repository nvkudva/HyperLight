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

    def test_mtimes_scoped_to_folder(self):
        self.assertEqual(sorted(self.store.get_indexed_file_mtimes(under="/x/Docs2")), ["/x/Docs2/b.txt"])


if __name__ == "__main__":
    unittest.main()
