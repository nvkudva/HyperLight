"""POST /api/clear must actually wipe the store (Settings Reset button).

Run: .venv/bin/python -m unittest tests.test_clear_route -v
"""
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import app_config
import app_state
import web_app


class _FakeStorage:
    def __init__(self):
        self.cleared = False

    def clear(self):
        self.cleared = True


class _FakeJobs:
    def stop_indexing(self):
        pass

    def wait_until_idle(self):
        pass


class ClearRouteTest(unittest.TestCase):
    def test_clear_route_clears_storage(self):
        fake = _FakeStorage()
        original_storage = app_state.get_storage
        original_jobs = app_state.get_jobs
        original_config = app_config.CONFIG_PATH
        app_state.get_storage = lambda: fake
        app_state.get_jobs = lambda: _FakeJobs()
        with tempfile.TemporaryDirectory() as tmp:
            app_config.CONFIG_PATH = Path(tmp) / "config.json"
            try:
                client = TestClient(web_app.app, base_url="http://127.0.0.1:8585")
                res = client.post("/api/clear", json={"force": True})
            finally:
                app_state.get_storage = original_storage
                app_state.get_jobs = original_jobs
                app_config.CONFIG_PATH = original_config
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"status": "cleared"})
        self.assertTrue(fake.cleared)


if __name__ == "__main__":
    unittest.main()
