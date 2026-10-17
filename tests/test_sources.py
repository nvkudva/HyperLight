"""Source registry: watchable rule, watched paths, and watcher resync on change.
Run: .venv/bin/python -m unittest tests.test_sources -v
"""
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, ".")

import app_config  # noqa: E402
import app_state  # noqa: E402
import google_auth  # noqa: E402
import jobs  # noqa: E402
import sources  # noqa: E402


class _FakeWatcher:
    def __init__(self):
        self.syncs = 0

    def sync_sources(self):
        self.syncs += 1


class _FakeStorage:
    def __init__(self):
        self.removed = []

    def remove_items_by_path(self, path):
        self.removed.append(path)

    def count_items_by_path(self, path):
        return 0


class SourceRegistryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name) / "docs"
        self.folder.mkdir()
        self._config_path = app_config.CONFIG_PATH
        app_config.CONFIG_PATH = Path(self.tmp.name) / "config.json"
        self.watcher = _FakeWatcher()
        self.store = _FakeStorage()
        self._getters = (app_state.peek_watcher, app_state.get_storage)
        app_state.peek_watcher = lambda: self.watcher
        app_state.get_storage = lambda: self.store

    def tearDown(self):
        app_config.CONFIG_PATH = self._config_path
        app_state.peek_watcher, app_state.get_storage = self._getters
        self.tmp.cleanup()

    def test_watchable_rule(self):
        self.assertTrue(sources.is_watchable({"path": str(self.folder), "source_type": "local"}))
        self.assertFalse(sources.is_watchable({"path": "/Applications", "source_type": "macos_system"}))
        self.assertFalse(sources.is_watchable({"path": "https://drive.google.com", "source_type": "google_drive"}))
        cache = str(google_auth.PHOTOS_CACHE_DIR.resolve())
        self.assertFalse(sources.is_watchable({"path": cache, "source_type": "google_photos"}))

    def test_record_scan_lists_watchable_and_resyncs(self):
        sources.record_scan("Docs", str(self.folder), "local")
        sources.record_scan("Application", "/Applications", "macos_system")
        listed = {s["name"]: (s["watchable"], s["runner"]) for s in sources.list_all()}
        self.assertEqual(listed, {"Docs": (True, None), "Application": (False, "macos_apps")})
        self.assertEqual(sources.watched_paths(), {str(self.folder.resolve())})
        self.assertEqual(self.watcher.syncs, 2)

    def test_refresh_before_watcher_starts_does_not_start_it(self):
        app_state.peek_watcher = lambda: None
        sources.record_scan("Docs", str(self.folder), "local")
        self.assertEqual(self.watcher.syncs, 0)

    def test_set_watch_and_always_on_gate(self):
        sources.record_scan("Docs", str(self.folder), "local")
        sources.set_watch(str(self.folder), False)
        self.assertEqual(sources.watched_paths(), set())
        sources.set_watch(str(self.folder), True)
        app_config.update_app_settings({"always_on_scanning": False})
        self.assertEqual(sources.watched_paths(), set())

    def test_remove_drops_index_config_and_resyncs(self):
        sources.record_scan("Docs", str(self.folder), "local")
        sources.remove(str(self.folder))
        self.assertEqual(sources.list_all(), [])
        self.assertEqual(self.store.removed, [str(self.folder)])
        self.assertEqual(self.watcher.syncs, 2)


class _BlockingScanner:
    """Scans until it is asked to stop (or gives up after a few seconds)."""

    def __init__(self):
        self.started = threading.Event()

    def scan_path(self, path, source="local", on_progress=None, cancel_check=None, on_parsed=None, force=False):
        self.started.set()
        for _ in range(100):
            if cancel_check():
                break
            threading.Event().wait(0.05)
        return 0


class RemoveWhileScanningTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name) / "docs"
        self.folder.mkdir()
        self._config_path = app_config.CONFIG_PATH
        app_config.CONFIG_PATH = Path(self.tmp.name) / "config.json"
        self.scanner = _BlockingScanner()
        self.manager = jobs.IndexJobManager()
        self._getters = (app_state.peek_watcher, app_state.get_storage, app_state.get_scanner, app_state.get_jobs)
        app_state.peek_watcher = lambda: _FakeWatcher()
        app_state.get_storage = lambda: _FakeStorage()
        app_state.get_scanner = lambda: self.scanner
        app_state.get_jobs = lambda: self.manager

    def tearDown(self):
        app_config.CONFIG_PATH = self._config_path
        app_state.peek_watcher, app_state.get_storage, app_state.get_scanner, app_state.get_jobs = self._getters
        self.tmp.cleanup()

    def test_removing_the_scanning_source_stops_the_scan_and_keeps_it_removed(self):
        self.manager.start_indexing(self.folder, "local", "Docs")
        self.assertTrue(self.scanner.started.wait(5))
        sources.remove(str(self.folder))
        self.assertFalse(self.manager.is_running)
        self.assertEqual(app_config.get_configured_sources(), [])

    def test_removing_a_source_drops_its_queued_job(self):
        other = Path(self.tmp.name) / "other"
        other.mkdir()
        self.manager.start_indexing(other, "local", "Other")
        self.assertTrue(self.scanner.started.wait(5))
        self.manager.start_indexing(self.folder, "local", "Docs")
        sources.remove(str(self.folder))
        self.assertEqual(self.manager.pending, [])
        self.manager.stop_indexing()
        self.manager.wait_until_idle()


class HotkeySchemaTest(unittest.TestCase):
    def test_accepts_named_and_combo(self):
        from routes.schemas import SettingsUpdateRequest

        self.assertEqual(SettingsUpdateRequest(hotkey="double_ctrl").hotkey, "double_ctrl")
        combo = SettingsUpdateRequest(hotkey={"key_code": 49, "modifiers": ["cmd", "shift"], "label": "⇧⌘Space"})
        self.assertEqual(combo.model_dump(exclude_none=True)["hotkey"]["key_code"], 49)

    def test_rejects_malformed(self):
        from routes.schemas import SettingsUpdateRequest

        for bad in ("triple_ctrl", {"key_code": 49, "modifiers": ["hyper"], "label": "x"}, {"label": "x"}):
            with self.assertRaises(Exception):
                SettingsUpdateRequest(hotkey=bad)


if __name__ == "__main__":
    unittest.main()
