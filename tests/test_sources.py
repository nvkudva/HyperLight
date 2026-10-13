"""Source registry: watchable rule, watched paths, and watcher resync on change.
Run: .venv/bin/python -m unittest tests.test_sources -v
"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, ".")

import app_config  # noqa: E402
import app_state  # noqa: E402
import google_auth  # noqa: E402
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


class SourceRegistryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name) / "docs"
        self.folder.mkdir()
        self._config_path = app_config.CONFIG_PATH
        app_config.CONFIG_PATH = Path(self.tmp.name) / "config.json"
        self.watcher = _FakeWatcher()
        self.store = _FakeStorage()
        self._getters = (app_state.get_watcher, app_state.get_storage)
        app_state.get_watcher = lambda: self.watcher
        app_state.get_storage = lambda: self.store

    def tearDown(self):
        app_config.CONFIG_PATH = self._config_path
        app_state.get_watcher, app_state.get_storage = self._getters
        self.tmp.cleanup()

    def test_watchable_rule(self):
        self.assertTrue(sources.is_watchable({"path": str(self.folder), "source_type": "local"}))
        self.assertFalse(sources.is_watchable({"path": "/Applications", "source_type": "macos_system"}))
        self.assertFalse(sources.is_watchable({"path": "https://drive.google.com", "source_type": "google_drive"}))
        cache = str(google_auth.PHOTOS_CACHE_DIR.resolve())
        self.assertFalse(sources.is_watchable({"path": cache, "source_type": "google_photos"}))

    def test_record_scan_lists_watchable_and_resyncs(self):
        sources.record_scan("Docs", str(self.folder), "local", 3)
        sources.record_scan("Apps", "/Applications", "macos_system", 40)
        listed = {s["name"]: s["watchable"] for s in sources.list_all()}
        self.assertEqual(listed, {"Docs": True, "Apps": False})
        self.assertEqual(sources.watched_paths(), {str(self.folder.resolve())})
        self.assertEqual(self.watcher.syncs, 2)

    def test_set_watch_and_always_on_gate(self):
        sources.record_scan("Docs", str(self.folder), "local", 3)
        sources.set_watch(str(self.folder), False)
        self.assertEqual(sources.watched_paths(), set())
        sources.set_watch(str(self.folder), True)
        app_config.update_app_settings({"always_on_scanning": False})
        self.assertEqual(sources.watched_paths(), set())

    def test_remove_drops_index_config_and_resyncs(self):
        sources.record_scan("Docs", str(self.folder), "local", 3)
        sources.remove(str(self.folder))
        self.assertEqual(sources.list_all(), [])
        self.assertEqual(self.store.removed, [str(self.folder)])
        self.assertEqual(self.watcher.syncs, 2)


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
