"""Rescan re-parses a folder in place and prunes vanished files; DB reset marks sources unscanned.

Run: .venv/bin/python -m unittest tests.test_rescan -v
"""
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import app_config
import app_state
import jobs
import sources
import web_app


class _FakeWatcher:
    def sync_sources(self):
        pass


class _FakeStore:
    def __init__(self, events):
        self.events = events
        self.count = 0
        self.indexed_paths = []

    def remove_items_by_path(self, path):
        self.events.append(f"remove:{path}")
        self.count = 0

    def remove_paths(self, paths):
        for path in paths:
            self.events.append(f"remove:{path}")

    def get_indexed_file_mtimes(self, under=None):
        return dict.fromkeys(self.indexed_paths, 0.0)

    def count_items_by_path(self, path):
        return self.count


class _FakeScanner:
    def __init__(self, events, store):
        self.events = events
        self.store = store

    def scan_path(self, path, source="local", on_progress=None, cancel_check=None, on_parsed=None, force=False):
        self.events.append(f"scan:{path}:force" if force else f"scan:{path}")
        self.store.count = 2
        return 2


class RescanWorkerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name) / "docs"
        self.folder.mkdir()
        self._config_path = app_config.CONFIG_PATH
        app_config.CONFIG_PATH = Path(self.tmp.name) / "config.json"
        self.events = []
        self.store = _FakeStore(self.events)
        self.scanner = _FakeScanner(self.events, self.store)
        self._getters = (app_state.get_storage, app_state.get_scanner, app_state.get_watcher)
        app_state.get_storage = lambda: self.store
        app_state.get_scanner = lambda: self.scanner
        app_state.get_watcher = lambda: _FakeWatcher()

    def tearDown(self):
        app_config.CONFIG_PATH = self._config_path
        app_state.get_storage, app_state.get_scanner, app_state.get_watcher = self._getters
        self.tmp.cleanup()

    def test_rescan_forces_reparse_and_never_empties_the_source_first(self):
        self.store.count = 5
        manager = jobs.IndexJobManager()
        manager._worker(jobs.Job(self.folder, "local", "Docs", {"rescan": True}))
        self.assertEqual(self.events, [f"scan:{self.folder}:force"])
        self.assertEqual(sources.list_all()[0]["items_count"], 2)

    def test_rescan_prunes_rows_of_files_that_no_longer_exist(self):
        kept = self.folder / "kept.txt"
        kept.write_text("x")
        gone = self.folder / "gone.txt"
        self.store.indexed_paths = [str(kept), str(gone)]
        jobs.IndexJobManager()._worker(jobs.Job(self.folder, "local", "Docs", {"rescan": True}))
        self.assertEqual(self.events, [f"scan:{self.folder}:force", f"remove:{gone}"])

    def test_cancelled_rescan_prunes_nothing(self):
        self.store.indexed_paths = [str(self.folder / "gone.txt")]
        manager = jobs.IndexJobManager()
        manager.cancel_requested = True
        manager._worker(jobs.Job(self.folder, "local", "Docs", {"rescan": True}))
        self.assertEqual(self.events, [f"scan:{self.folder}:force"])

    def test_rescan_of_runner_source_rebuilds_from_scratch(self):
        saved = jobs.RUN_FUNCTIONS["macos_apps"]
        jobs.RUN_FUNCTIONS["macos_apps"] = lambda progress, cancel, opts: self.events.append("run:apps")
        try:
            jobs.IndexJobManager()._worker(jobs.Job(Path.home(), "macos_apps", "Application", {"rescan": True}))
        finally:
            jobs.RUN_FUNCTIONS["macos_apps"] = saved
        self.assertEqual(self.events, ["remove:/Applications", "remove:/System/Applications", "run:apps"])

    def test_normal_index_does_not_remove(self):
        manager = jobs.IndexJobManager()
        manager._worker(jobs.Job(self.folder, "local", "Docs", {}))
        self.assertEqual(self.events, [f"scan:{self.folder}"])


class ResetCountsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name) / "docs"
        self.folder.mkdir()
        self._config_path = app_config.CONFIG_PATH
        app_config.CONFIG_PATH = Path(self.tmp.name) / "config.json"

    def tearDown(self):
        app_config.CONFIG_PATH = self._config_path
        self.tmp.cleanup()

    def test_mark_unscanned_zeroes_last_scanned(self):
        app_config.save_configured_source("Docs", str(self.folder), "local")
        sources.mark_unscanned()
        listed = app_config.get_configured_sources()
        self.assertEqual(listed[0]["last_scanned"], 0)
        self.assertEqual(listed[0]["path"], str(self.folder.resolve()))
        self.assertTrue(listed[0]["watch_enabled"])


class _FakeJobs:
    def __init__(self):
        self.calls = []
        self.stopped = False

    def start_indexing(self, path, source, name, options=None, rescan=False):
        self.calls.append((str(path), source, name, rescan))
        return "started"

    def stop_indexing(self):
        self.stopped = True

    def wait_until_idle(self):
        return True


class _FakeClearStore:
    def __init__(self):
        self.cleared = False

    def clear(self):
        self.cleared = True

    def count_items_by_path(self, path):
        return 0


class RescanAndClearRouteTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name) / "docs"
        self.folder.mkdir()
        (self.folder / "a.txt").write_text("hello")
        self._config_path = app_config.CONFIG_PATH
        app_config.CONFIG_PATH = Path(self.tmp.name) / "config.json"
        app_config.save_configured_source("Docs", str(self.folder), "local")
        self.fake_jobs = _FakeJobs()
        self.fake_store = _FakeClearStore()
        self._getters = (app_state.get_jobs, app_state.get_storage)
        app_state.get_jobs = lambda: self.fake_jobs
        app_state.get_storage = lambda: self.fake_store
        self.client = TestClient(web_app.app, base_url="http://127.0.0.1:8585")

    def tearDown(self):
        app_config.CONFIG_PATH = self._config_path
        app_state.get_jobs, app_state.get_storage = self._getters
        self.tmp.cleanup()

    def test_rescan_route_starts_rescan_job_for_configured_source(self):
        res = self.client.post("/api/sources/rescan", json={"path": str(self.folder.resolve())})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.fake_jobs.calls, [(str(self.folder.resolve()), "local", "Docs", True)])

    def test_rescan_route_unreadable_folder_reports_full_disk_access(self):
        self.folder.chmod(0)
        try:
            res = self.client.post("/api/sources/rescan", json={"path": str(self.folder.resolve())})
        finally:
            self.folder.chmod(0o755)
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()["error"], "full_disk_access")
        self.assertEqual(self.fake_jobs.calls, [])

    def test_rescan_route_unknown_source_404(self):
        res = self.client.post("/api/sources/rescan", json={"path": "/no/such/source"})
        self.assertEqual(res.status_code, 404)
        self.assertEqual(self.fake_jobs.calls, [])

    def test_clear_route_marks_sources_unscanned(self):
        res = self.client.post("/api/clear", json={"force": True})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(self.fake_store.cleared)
        self.assertTrue(self.fake_jobs.stopped)
        self.assertEqual(app_config.get_configured_sources()[0]["last_scanned"], 0)

    def test_reset_all_wipes_config_tokens_and_caches(self):
        import google_auth
        import routes.media

        class _FakeWatcher:
            def sync_sources(self):
                pass

        tokens = Path(self.tmp.name) / "google_tokens.json"
        tokens.write_text("{}")
        previews = Path(self.tmp.name) / "previews"
        previews.mkdir()
        photos = Path(self.tmp.name) / "photos"
        photos.mkdir()
        saved = (google_auth.TOKENS_PATH, google_auth.PHOTOS_CACHE_DIR, routes.media.PREVIEW_CACHE_DIR, app_state.get_watcher)
        google_auth.TOKENS_PATH, google_auth.PHOTOS_CACHE_DIR, routes.media.PREVIEW_CACHE_DIR = tokens, photos, previews
        app_state.get_watcher = lambda: _FakeWatcher()
        try:
            res = self.client.post("/api/reset-all")
        finally:
            google_auth.TOKENS_PATH, google_auth.PHOTOS_CACHE_DIR, routes.media.PREVIEW_CACHE_DIR, app_state.get_watcher = saved
        self.assertEqual(res.status_code, 200)
        self.assertTrue(self.fake_store.cleared)
        self.assertEqual(app_config.get_configured_sources(), [])
        self.assertFalse(tokens.exists())
        self.assertFalse(previews.exists())
        self.assertFalse(photos.exists())


if __name__ == "__main__":
    unittest.main()
