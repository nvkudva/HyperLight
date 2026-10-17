"""The Google callback only accepts a state Hyperlight issued, once.

Run: .venv/bin/python -m unittest tests.test_google_oauth_state -v
"""
import unittest
import urllib.parse
from unittest import mock

from fastapi.testclient import TestClient

import google_auth
import web_app

REDIRECT = "http://127.0.0.1:8585/api/auth/google/callback"


class OAuthStateTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(web_app.app, base_url="http://127.0.0.1:8585")
        google_auth._pending_states.clear()
        patcher = mock.patch.object(google_auth, "get_client_config", return_value={"client_id": "id", "client_secret": "secret"})
        patcher.start()
        self.addCleanup(patcher.stop)

    def _issued_state(self) -> str:
        query = urllib.parse.urlsplit(google_auth.get_auth_url(REDIRECT)).query
        return urllib.parse.parse_qs(query)["state"][0]

    def test_each_auth_url_carries_a_fresh_random_state(self):
        self.assertNotEqual(self._issued_state(), self._issued_state())

    def test_callback_rejects_missing_or_forged_state_without_exchanging_the_code(self):
        with mock.patch.object(google_auth, "exchange_code") as exchange:
            for query in ("code=abc", "code=abc&state=google_auth", "code=abc&state=forged"):
                res = self.client.get(f"/api/auth/google/callback?{query}")
                self.assertEqual(res.status_code, 400, query)
        exchange.assert_not_called()

    def test_callback_accepts_an_issued_state_once(self):
        state = self._issued_state()
        with mock.patch.object(google_auth, "exchange_code") as exchange:
            first = self.client.get(f"/api/auth/google/callback?code=abc&state={state}")
            replay = self.client.get(f"/api/auth/google/callback?code=abc&state={state}")
        self.assertEqual((first.status_code, replay.status_code), (200, 400))
        exchange.assert_called_once()

    def test_only_the_most_recent_states_stay_valid(self):
        states = [self._issued_state() for _ in range(google_auth.MAX_PENDING_STATES + 1)]
        self.assertFalse(google_auth.consume_state(states[0]))
        self.assertTrue(google_auth.consume_state(states[-1]))


if __name__ == "__main__":
    unittest.main()
