"""iCloud Drive discovery: find CloudDocs under a home dir, else nothing.
Run: .venv/bin/python -m unittest tests.test_icloud_locations -v
"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, ".")

import connectors  # noqa: E402


class ICloudLocationsTest(unittest.TestCase):
    def test_found_when_clouddocs_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            cloud_docs = home / "Library" / "Mobile Documents" / "com~apple~CloudDocs"
            cloud_docs.mkdir(parents=True)
            locations = connectors.get_icloud_drive_locations(home)
            self.assertEqual(len(locations), 1)
            self.assertEqual(locations[0]["name"], "iCloud Drive")
            self.assertEqual(locations[0]["path"], str(cloud_docs.resolve()))

    def test_empty_when_clouddocs_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(connectors.get_icloud_drive_locations(Path(tmp)), [])


if __name__ == "__main__":
    unittest.main()
