"""Only genuinely network filesystems count as network volumes (not Recovery, USB or the boot disk).

Run: .venv/bin/python -m unittest tests.test_network_volumes -v
"""
import unittest

import connectors

MOUNT_OUTPUT = """\
/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)
/dev/disk5s1 on /Volumes/Recovery (apfs, local, journaled)
/dev/disk6s1 on /Volumes/USB Stick (msdos, local, nodev, nosuid)
//me@nas.local/media on /Volumes/media (smbfs, nodev, nosuid, mounted by me)
nas.local:/export/backup on /Volumes/backup (nfs, nodev, nosuid, mounted by me)
//me@nas.local/home (2) on /Volumes/home (2) (smbfs, nodev, nosuid, mounted by me)
"""


class NetworkVolumesTest(unittest.TestCase):
    def test_keeps_only_network_filesystems(self):
        volumes = connectors._network_volumes_in(MOUNT_OUTPUT)
        self.assertEqual(
            [(v["name"], v["path"]) for v in volumes],
            [("media", "/Volumes/media"), ("backup", "/Volumes/backup"), ("home (2)", "/Volumes/home (2)")],
        )
        self.assertEqual({v["type"] for v in volumes}, {"network_volume"})


if __name__ == "__main__":
    unittest.main()
