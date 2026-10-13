"""Spotlight bucketing: order, labels, per-bucket cap and path dedupe.
Run: .venv/bin/python -m unittest tests.test_spotlight -v
"""
import sys
import unittest

sys.path.insert(0, ".")

import spotlight  # noqa: E402


def rec(type_, path, filename=None):
    return {"type": type_, "path": path, "filename": filename or path.rsplit("/", 1)[-1]}


class GroupTest(unittest.TestCase):
    def test_apps_first_then_priority_then_first_seen(self):
        buckets = spotlight.group([
            rec("contact", "/c/a.vcf"),
            rec("document", "/d/notes.md"),
            rec("photo", "/p/1.jpg"),
            rec("app", "/Applications/Safari.app"),
            rec("document", "/d/tax.pdf"),
        ])
        self.assertEqual([b["kind"] for b in buckets], ["app", "photo", "document", "text", "contact"])

    def test_labels_cover_scanner_types(self):
        buckets = spotlight.group([rec("bookmark", "/b/x.webloc"), rec("email", "/m/1.emlx")])
        self.assertEqual({b["kind"]: b["label"] for b in buckets}, {"bookmark": "Bookmarks", "email": "Mail"})

    def test_unknown_kind_keeps_kind_as_label(self):
        self.assertEqual(spotlight.group([rec("network_volume", "/Volumes/x")])[0]["label"], "network_volume")

    def test_first_hit_per_path_wins_across_buckets(self):
        buckets = spotlight.group([rec("photo", "/p/1.pdf"), rec("document", "/p/1.pdf")])
        self.assertEqual([b["kind"] for b in buckets], ["photo"])

    def test_caps_each_bucket(self):
        buckets = spotlight.group([rec("photo", f"/p/{i}.jpg") for i in range(9)])
        self.assertEqual(len(buckets[0]["items"]), spotlight.PER_BUCKET)

    def test_respond_counts_matches(self):
        res = spotlight.respond("q", spotlight.group([rec("photo", "/p/1.jpg"), rec("app", "/A.app")]))
        self.assertEqual(res["total_matches"], 2)


if __name__ == "__main__":
    unittest.main()
