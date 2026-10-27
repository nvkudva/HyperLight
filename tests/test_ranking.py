"""Relevance gate: weak hits are dropped, word matches rescue them only for typed queries.
Run: .venv/bin/python -m unittest tests.test_ranking -v
"""
import json
import unittest

import ranking

QUERY = [1.0, 0.0, 0.0]
NULLS = [[0.0, 1.0, 0.0]]


def _row(item_id, filename, vector, kind="document"):
    return {
        "id": item_id, "type": kind, "path": f"/x/{filename}", "filename": filename,
        "content": "", "source": "local", "modified_at": 0.0, "metadata": json.dumps({}), "vector": vector,
    }


class RankTest(unittest.TestCase):
    def test_close_item_passes_and_unrelated_item_is_dropped(self):
        rows = [_row("near", "a.txt", [1.0, 0.0, 0.0]), _row("far", "b.txt", [0.0, 0.0, 1.0])]
        self.assertEqual([r["id"] for r in ranking.rank(rows, QUERY, NULLS, "zzz", 10)], ["near"])

    def test_filename_match_rescues_a_weak_hit_but_not_in_boost_only_mode(self):
        weak = _row("weak", "budget.txt", [0.03, 0.0, 1.0])
        self.assertEqual(len(ranking.rank([weak], QUERY, NULLS, "budget", 10)), 1)
        self.assertEqual(ranking.rank([weak], QUERY, NULLS, "budget", 10, boost_only=True), [])

    def test_photos_have_their_own_budget(self):
        rows = [_row(f"d{i}", f"d{i}.txt", [1.0, 0.0, 0.0]) for i in range(3)]
        rows.append(_row("p", "p.jpg", [1.0, 0.0, 0.0], kind="photo"))
        ranked = ranking.rank(rows, QUERY, NULLS, None, limit=1, photo_limit=1)
        self.assertEqual(sorted(r["type"] for r in ranked), ["document", "photo"])


if __name__ == "__main__":
    unittest.main()
