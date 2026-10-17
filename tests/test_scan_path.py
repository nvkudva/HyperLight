"""scan_path must parse and store files from a folder (pool result streaming).
Run: .venv/bin/python -m unittest tests.test_scan_path -v
"""
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, ".")

import scanner  # noqa: E402


class FakeEmbedder:
    def embed_texts(self, texts, titles=None, batch_size=8):
        return [[0.1] * 768 for _ in texts]


class SlowEmbedder(FakeEmbedder):
    def embed_texts(self, texts, titles=None, batch_size=8):
        time.sleep(0.5)
        return super().embed_texts(texts, titles=titles, batch_size=batch_size)


class FakeStorage:
    def __init__(self):
        self.items = []
        self.writes = []

    def get_indexed_file_mtimes(self, under=None):
        return {}

    def add_items(self, items, replace_paths=()):
        self.writes.append((list(replace_paths), [item["path"] for item in items]))
        self.items.extend(items)
        return len(items)


class EditedFileStorage(FakeStorage):
    """Reports one already-indexed file with an older mtime than on disk."""

    def __init__(self, indexed_path):
        super().__init__()
        self.indexed_path = indexed_path

    def get_indexed_file_mtimes(self, under=None):
        return {self.indexed_path: 1.0}


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

    def test_edited_file_replaces_its_old_chunks_in_the_same_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            note = Path(tmp) / "notes.txt"
            note.write_text("new text after the edit", encoding="utf-8")
            resolved = str(note.resolve())
            store = EditedFileStorage(resolved)
            scanner.Scanner(FakeEmbedder(), store).scan_path(Path(tmp))
            self.assertEqual(store.writes, [([resolved], [resolved])])

    def test_emptied_file_still_drops_its_old_chunks(self):
        with tempfile.TemporaryDirectory() as tmp:
            note = Path(tmp) / "notes.txt"
            note.write_text("", encoding="utf-8")
            resolved = str(note.resolve())
            store = EditedFileStorage(resolved)
            scanner.Scanner(FakeEmbedder(), store).scan_path(Path(tmp))
            self.assertEqual(store.writes, [([resolved], [])])

    def test_cancel_drops_queued_embedding_batches(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            for n in range(130):
                (folder / f"note{n:03}.txt").write_text(f"note number {n}", encoding="utf-8")
            store = FakeStorage()
            calls = {"count": 0}

            def cancel_after_parsing() -> bool:
                calls["count"] += 1
                return calls["count"] > 3  # 3 chunk checks while parsing, then the embedding wait

            scanner.Scanner(SlowEmbedder(), store).scan_path(folder, cancel_check=cancel_after_parsing)
            self.assertLess(len(store.items), 130)

    def test_progress_reaches_total_only_when_embedding_nearly_done(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            file_count = 600
            for n in range(file_count):
                (folder / f"note{n:03}.txt").write_text(f"note number {n}", encoding="utf-8")
            store = FakeStorage()
            stored_when_parsing_done = []

            def on_progress(filename, current, total):
                if current >= total and not stored_when_parsing_done:
                    stored_when_parsing_done.append(len(store.items))

            scanner.Scanner(SlowEmbedder(), store).scan_path(folder, on_progress=on_progress)
            self.assertGreater(stored_when_parsing_done[0], file_count * 0.4)

    def test_parsed_count_reaches_file_total(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            for n in range(200):
                (folder / f"note{n:03}.txt").write_text(f"note number {n}", encoding="utf-8")
            parsed_counts = []

            scanner.Scanner(FakeEmbedder(), FakeStorage()).scan_path(folder, on_parsed=parsed_counts.append)
            self.assertEqual(len(parsed_counts), 200)
            self.assertEqual(max(parsed_counts), 200)


if __name__ == "__main__":
    unittest.main()
