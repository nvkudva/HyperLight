"""Live watcher event filter: ignored folders apply below a watched root, not above it.
Run: .venv/bin/python -m unittest tests.test_watcher_filter -v
"""
import sys
import unittest

sys.path.insert(0, ".")

import watcher  # noqa: E402


class ShouldHandleTest(unittest.TestCase):
    def setUp(self):
        self.roots = ["/Users/me/Library/Mail", "/Users/me/Documents"]
        self.handler = watcher.DebouncedHandler(lambda path, kind: None, lambda: self.roots)

    def tearDown(self):
        self.handler.stop()

    def test_mail_under_library_is_handled_when_library_is_the_watched_path(self):
        self.assertTrue(self.handler._should_handle("/Users/me/Library/Mail/V10/a/Messages/1.emlx"))

    def test_ignored_folder_below_a_watched_root_is_still_skipped(self):
        self.assertFalse(self.handler._should_handle("/Users/me/Documents/app/node_modules/pkg/readme.md"))

    def test_library_below_an_unrelated_watched_root_is_skipped(self):
        self.assertFalse(self.handler._should_handle("/Users/me/Documents/Library/notes.txt"))

    def test_hidden_files_and_unsupported_extensions_are_skipped(self):
        self.assertFalse(self.handler._should_handle("/Users/me/Documents/.secret.txt"))
        self.assertFalse(self.handler._should_handle("/Users/me/Documents/app.bin"))

    def test_path_outside_every_root_falls_back_to_full_path_check(self):
        self.assertFalse(self.handler._should_handle("/Users/me/Library/other/a.txt"))


if __name__ == "__main__":
    unittest.main()
