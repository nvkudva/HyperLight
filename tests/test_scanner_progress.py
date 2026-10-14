"""Indexing progress must advance at every whole-percent step, not per chunk.

The reporter throttles callbacks to integer percent changes (plus the final
file), so the UI number ticks 1, 2, 3... without a callback per file.

Run: .venv/bin/python -m unittest tests.test_scanner_progress -v
"""
import unittest

import scanner


class ProgressReporterTest(unittest.TestCase):
    def test_reports_each_percent_step_and_final(self):
        calls = []
        reporter = scanner.ProgressReporter(lambda name, cur, tot: calls.append((cur, tot)), total=250)
        for i in range(1, 251):
            reporter.report(f"file{i}.txt", i)
        percents = [round(cur / tot * 100) for cur, tot in calls]
        self.assertEqual(percents, list(range(0, 101)))
        self.assertEqual(calls[-1], (250, 250))
        self.assertLess(len(calls), 110)

    def test_small_totals_still_report_every_file_percent(self):
        calls = []
        reporter = scanner.ProgressReporter(lambda name, cur, tot: calls.append(cur), total=3)
        for i in range(1, 4):
            reporter.report("a.txt", i)
        self.assertEqual(calls, [1, 2, 3])

    def test_no_callback_without_callback_or_total(self):
        reporter = scanner.ProgressReporter(None, total=10)
        reporter.report("a.txt", 5)  # must not raise
        empty = scanner.ProgressReporter(lambda *a: self.fail("called"), total=0)
        empty.report("a.txt", 0)


if __name__ == "__main__":
    unittest.main()
