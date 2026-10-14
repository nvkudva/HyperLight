"""scan_path must parse and store files from a folder (pool result streaming).
Run: .venv/bin/python -m unittest tests.test_scan_path -v
"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, ".")

import scanner  # noqa: E402


class FakeEmbedder:
    def embed_texts(self, texts, titles=None, batch_size=8):
        return [[0.1] * 768 for _ in texts]


class FakeStorage:
    def __init__(self):
        self.items = []

    def get_indexed_file_mtimes(self, under=None):
        return {}

    def add_items(self, items):
        self.items.extend(items)
        return len(items)


class ScanPathTest(unittest.TestCase):
    def test_scan_folder_stores_text_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "notes.txt").write_text("quarterly budget planning notes", encoding="utf-8")
            store = FakeStorage()
            count = scanner.Scanner(FakeEmbedder(), store).scan_path(folder, source="icloud_drive")
            self.assertEqual(count, 1)
            self.assertEqual(store.items[0]["filename"], "notes.txt")
            self.assertEqual(store.items[0]["source"], "icloud_drive")


if __name__ == "__main__":
    unittest.main()
