import unittest

from fastapi.testclient import TestClient

import web_app


class LocalOriginGuardTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(web_app.app, base_url="http://127.0.0.1:8585")

    def test_same_origin_request_allowed(self):
        self.assertEqual(self.client.get("/api/health").status_code, 200)

    def test_cross_site_post_rejected(self):
        res = self.client.post("/api/clear", headers={"Origin": "https://evil.example"})
        self.assertEqual(res.status_code, 403)

    def test_cross_site_subresource_read_rejected(self):
        res = self.client.get("/api/thumbnail?path=/etc/hosts", headers={"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors"})
        self.assertEqual(res.status_code, 403)

    def test_dns_rebinding_host_rejected(self):
        res = self.client.get("/api/health", headers={"Host": "attacker.example:8585"})
        self.assertEqual(res.status_code, 403)

    def test_other_local_port_host_rejected(self):
        for host in ("127.0.0.1:9999", "localhost", "localhost:5173"):
            self.assertEqual(self.client.get("/api/health", headers={"Host": host}).status_code, 403, host)

    def test_local_origin_on_other_port_rejected(self):
        res = self.client.post("/api/clear", headers={"Origin": "http://localhost:5173"})
        self.assertEqual(res.status_code, 403)

    def test_localhost_host_and_origin_on_app_port_allowed(self):
        res = self.client.get("/api/health", headers={"Host": "localhost:8585", "Origin": "http://localhost:8585"})
        self.assertEqual(res.status_code, 200)

    def test_validation_error_does_not_echo_input(self):
        body = '{"query": "' + "\\ud800" * 600 + '"}'
        res = self.client.post("/api/spotlight", content=body, headers={"Content-Type": "application/json"})
        self.assertEqual(res.status_code, 422)
        self.assertNotIn("input", res.json()["detail"][0])
        self.assertLess(len(res.text), 500)

    def test_cross_site_navigation_allowed_for_oauth_redirect(self):
        res = self.client.get("/api/health", headers={"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate"})
        self.assertEqual(res.status_code, 200)


if __name__ == "__main__":
    unittest.main()
