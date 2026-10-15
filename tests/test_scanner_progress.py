"""Indexing progress is reported on a time interval, so the file count ticks
smoothly instead of jumping a whole percent at a time.

Run: .venv/bin/python -m unittest tests.test_scanner_progress -v
"""
import unittest

import scanner


class _FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


class ProgressReporterTest(unittest.TestCase):
    def test_throttles_by_time_and_always_reports_first_and_last(self):
        clock = _FakeClock()
        calls = []
        reporter = scanner.ProgressReporter(lambda name, cur, tot: calls.append(cur), total=1000, clock=clock)
        for processed in range(1, 1001):
            clock.now += 0.01  # 10ms per file: one report per 100ms
            reporter.report(f"file{processed}.txt", processed)
        self.assertEqual(calls[0], 1)
        self.assertEqual(calls[-1], 1000)
        self.assertEqual(calls, sorted(calls))
        self.assertLess(len(calls), 120)
        self.assertGreater(len(calls), 90)

    def test_no_callback_without_callback_or_total(self):
        reporter = scanner.ProgressReporter(None, total=10)
        reporter.report("a.txt", 5)  # must not raise
        empty = scanner.ProgressReporter(lambda *a: self.fail("called"), total=0)
        empty.report("a.txt", 0)


if __name__ == "__main__":
    unittest.main()
