"""System Settings indexing: catalog records and Spotlight bucket.
Run: .venv/bin/python -m unittest tests.test_settings_indexing -v
"""
import sys
import unittest

sys.path.insert(0, "backend")

import connectors  # noqa: E402
import spotlight  # noqa: E402


class SettingsCatalogTest(unittest.TestCase):
    def test_records_are_settings_with_openable_pane_urls(self):
        records = connectors.get_system_settings()
        self.assertGreaterEqual(len(records), 20)
        for record in records:
            self.assertEqual(record["type"], "setting")
            self.assertTrue(record["path"].startswith("x-apple.systempreferences:"))
            self.assertIn(record["filename"], record["content"])
        self.assertEqual(len({r["id"] for r in records}), len(records))

    def test_bluetooth_finds_by_keyword(self):
        bluetooth = next(r for r in connectors.get_system_settings() if r["filename"] == "Bluetooth")
        self.assertIn("pair", bluetooth["content"].lower())


class SettingsBucketTest(unittest.TestCase):
    def test_setting_bucket_label_and_order_after_apps(self):
        buckets = spotlight.group([
            {"type": "document", "path": "/d/a.pdf", "filename": "a.pdf"},
            {"type": "setting", "path": "x-apple.systempreferences:com.apple.preference.bluetooth", "filename": "Bluetooth"},
            {"type": "app", "path": "/Applications/Safari.app", "filename": "Safari.app"},
        ])
        self.assertEqual([b["kind"] for b in buckets], ["app", "setting", "document"])
        self.assertEqual(buckets[1]["label"], "Settings")


if __name__ == "__main__":
    unittest.main()
