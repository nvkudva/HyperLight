"""Preview, text, launch and reveal only serve indexed items and Hyperlight's own caches.

Run: .venv/bin/python -m unittest tests.test_file_access -v
"""
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import app_state
import connectors
import google_auth
import routes.media as media
import storage
import web_app

SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.battery"


def _item(item_id, path):
    return {"id": item_id, "vector": [0.0] * 768, "path": path, "filename": Path(path).name}


class FileAccessTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name).resolve()
        self.indexed = root / "notes.txt"
        self.indexed.write_text("indexed text")
        self.unindexed = root / "secret.txt"
        self.unindexed.write_text("not in the index")
        self.app_dir = root / "hyperlight"
        self.photos_cache = self.app_dir / "google_photos_cache"
        self.photos_cache.mkdir(parents=True)
        self.cached = self.photos_cache / "cached.txt"
        self.cached.write_text("cached text")
        self.config = self.app_dir / "config.txt"
        self.config.write_text("private config")

        self.store = storage.Storage(root / "lancedb")
        self.store.add_items([_item("a", str(self.indexed)), _item("b", str(self.config)), _item("c", SETTINGS_URL)])

        self.saved = (app_state.get_storage, media.HYPERLIGHT_DIR, media.PREVIEW_CACHE_DIR, google_auth.PHOTOS_CACHE_DIR, connectors.launch_target, connectors.reveal_in_finder)
        app_state.get_storage = lambda: self.store
        media.HYPERLIGHT_DIR, media.PREVIEW_CACHE_DIR = self.app_dir, self.app_dir / "previews"
        google_auth.PHOTOS_CACHE_DIR = self.photos_cache
        self.opened = []
        connectors.launch_target = lambda target: self.opened.append(("launch", target)) or True
        connectors.reveal_in_finder = lambda target: self.opened.append(("reveal", target)) or True
        self.client = TestClient(web_app.app, base_url="http://127.0.0.1:8585")

    def tearDown(self):
        (app_state.get_storage, media.HYPERLIGHT_DIR, media.PREVIEW_CACHE_DIR, google_auth.PHOTOS_CACHE_DIR, connectors.launch_target, connectors.reveal_in_finder) = self.saved
        self.tmp.cleanup()

    def test_thumbnail_and_media_refuse_unindexed_files(self):
        picture = self.unindexed.with_suffix(".png")
        picture.write_bytes(b"png")
        recording = self.unindexed.with_suffix(".mp3")
        recording.write_bytes(b"mp3")
        self.assertEqual(self.client.get("/api/thumbnail", params={"path": str(picture)}).status_code, 403)
        self.assertEqual(self.client.get("/api/media", params={"path": str(recording)}).status_code, 403)

    def test_launch_allows_web_links_without_an_index_entry(self):
        res = self.client.post("/api/launch", json={"path": "https://example.com/docs"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.opened, [("launch", "https://example.com/docs")])

    def test_text_serves_indexed_file(self):
        res = self.client.get("/api/text", params={"path": str(self.indexed)})
        self.assertEqual((res.status_code, res.text), (200, "indexed text"))

    def test_text_refuses_unindexed_file(self):
        self.assertEqual(self.client.get("/api/text", params={"path": str(self.unindexed)}).status_code, 403)

    def test_text_serves_photos_cache_but_not_other_hyperlight_files(self):
        self.assertEqual(self.client.get("/api/text", params={"path": str(self.cached)}).status_code, 200)
        self.assertEqual(self.client.get("/api/text", params={"path": str(self.config)}).status_code, 403)

    def test_text_refuses_traversal_out_of_the_cache(self):
        sneaky = self.photos_cache / ".." / "config.txt"
        self.assertEqual(self.client.get("/api/text", params={"path": str(sneaky)}).status_code, 403)

    def test_preview_refuses_unindexed_file(self):
        self.assertEqual(self.client.get("/api/preview", params={"path": str(self.unindexed)}).status_code, 403)

    def test_launch_opens_indexed_file_and_indexed_setting(self):
        for target in (str(self.indexed), SETTINGS_URL):
            self.assertEqual(self.client.post("/api/launch", json={"path": target}).json()["success"], True)
        self.assertEqual(self.opened, [("launch", str(self.indexed)), ("launch", SETTINGS_URL)])

    def test_launch_and_reveal_refuse_unindexed_targets(self):
        for route in ("/api/launch", "/api/reveal"):
            res = self.client.post(route, json={"path": str(self.unindexed)})
            self.assertEqual((res.status_code, res.json()["success"]), (403, False))
        self.assertEqual(self.opened, [])

    def test_reveal_empty_path_fails(self):
        res = self.client.post("/api/reveal", json={"path": ""})
        self.assertEqual(res.json()["success"], False)
        self.assertEqual(self.opened, [])


if __name__ == "__main__":
    unittest.main()
