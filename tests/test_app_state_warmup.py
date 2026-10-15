"""warmup must start the live watcher, or live scanning stays off until a scan or settings change.
Run: .venv/bin/python -m unittest tests.test_app_state_warmup -v
"""
import sys
import unittest

sys.path.insert(0, ".")

import app_state  # noqa: E402


class _FakeEmbedder:
    def embed_query(self, text):
        return [0.0]


class WarmupTest(unittest.TestCase):
    def test_warmup_starts_live_watcher(self):
        started = []
        saved = (app_state.get_embedder, app_state.get_storage, app_state.get_watcher)
        app_state.get_embedder = lambda: _FakeEmbedder()
        app_state.get_storage = lambda: object()
        app_state.get_watcher = lambda: started.append(True)
        try:
            app_state.warmup()
        finally:
            app_state.get_embedder, app_state.get_storage, app_state.get_watcher = saved
        self.assertEqual(started, [True])


if __name__ == "__main__":
    unittest.main()
