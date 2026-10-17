"""Frozen (PyInstaller) builds must serve the UI from bundled resources.

In a frozen sidecar, ``routes/pages.py`` sits inside the PyInstaller bundle,
so ``frontend/dist`` resolves under ``sys._MEIPASS`` (or the
``HYPERLIGHT_RESOURCE_DIR`` override), not beside the repo checkout.

Run: .venv/bin/python -m unittest tests.test_pages_paths -v
"""
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

import routes.pages as pages


class ResourceRootTest(unittest.TestCase):
    def test_defaults_to_repo_root(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with mock.patch.object(sys, "_MEIPASS", None, create=True):
                self.assertEqual(pages.resource_root(), Path(__file__).parent.parent)

    def test_uses_meipass_when_frozen(self):
        with mock.patch.object(sys, "_MEIPASS", "/bundle/root", create=True):
            self.assertEqual(pages.resource_root(), Path("/bundle/root"))

    def test_env_override(self):
        with mock.patch.dict(os.environ, {"HYPERLIGHT_RESOURCE_DIR": "/custom/root"}):
            with mock.patch.object(sys, "_MEIPASS", None, create=True):
                self.assertEqual(pages.resource_root(), Path("/custom/root"))


if __name__ == "__main__":
    unittest.main()
