"""Live watcher event filter: ignored folders apply below a watched root, not above it.
Run: .venv/bin/python -m unittest tests.test_watcher_filter -v
"""
import sys
import tempfile
import threading
import time
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


class ProcessQueueTest(unittest.TestCase):
    def test_failing_callback_does_not_stop_later_events(self):
        processed = threading.Event()

        def callback(path, kind):
            if path.endswith("bad.txt"):
                raise RuntimeError("index failed")
            processed.set()

        with tempfile.TemporaryDirectory() as tmp:
            bad, good = f"{tmp}/bad.txt", f"{tmp}/good.txt"
            for path in (bad, good):
                open(path, "w").close()
            handler = watcher.DebouncedHandler(callback)
            try:
                with self.assertLogs("hyperlight.watcher", level="ERROR"):
                    handler.pending_events.update({bad: time.time() - 1, good: time.time() - 1})
                    self.assertTrue(processed.wait(5))
            finally:
                handler.stop()


class HiddenFolderTest(unittest.TestCase):
    def test_watcher_and_scan_agree_on_hidden_folders(self):
        import pathlib
        import scanner

        handler = watcher.DebouncedHandler(lambda path, kind: None, lambda: ["/proj"])
        try:
            self.assertFalse(handler._should_handle("/proj/.github/workflows/ci.yml"))
        finally:
            handler.stop()
        with tempfile.TemporaryDirectory() as tmp:
            hidden = pathlib.Path(tmp) / ".github"
            hidden.mkdir()
            (hidden / "ci.yml").write_text("x")
            self.assertEqual(scanner.collect_supported_files(pathlib.Path(tmp)), [])

    def test_failing_delete_does_not_escape_the_observer_thread(self):
        def boom(path, kind):
            raise RuntimeError("disk full")

        handler = watcher.DebouncedHandler(boom, lambda: ["/proj"])
        try:
            handler._deleted("/proj/a.txt", False)
        finally:
            handler.stop()


if __name__ == "__main__":
    unittest.main()
