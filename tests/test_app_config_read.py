"""An unreadable config is skipped this time; only a corrupt one is moved aside.

Run: .venv/bin/python -m unittest tests.test_app_config_read -v
"""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import app_config


class ReadConfigTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._config_path = app_config.CONFIG_PATH
        app_config.CONFIG_PATH = Path(self.tmp.name) / "config.json"

    def tearDown(self):
        app_config.CONFIG_PATH = self._config_path
        self.tmp.cleanup()

    def test_read_error_keeps_the_good_config_in_place(self):
        app_config.save_configured_source("Docs", self.tmp.name, "local")
        with mock.patch.object(Path, "read_text", side_effect=PermissionError("busy")):
            self.assertEqual(app_config.get_configured_sources(), [])
        self.assertEqual(list(Path(self.tmp.name).glob("config.corrupt-*")), [])
        self.assertEqual(len(app_config.get_configured_sources()), 1)

    def test_corrupt_json_is_moved_aside(self):
        app_config.CONFIG_PATH.write_text("{not json")
        self.assertEqual(app_config.get_configured_sources(), [])
        self.assertEqual(len(list(Path(self.tmp.name).glob("config.corrupt-*"))), 1)


if __name__ == "__main__":
    unittest.main()
