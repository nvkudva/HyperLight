"""CLI: runs under the repo virtualenv, and `index` registers the folder like the API does.

Run: .venv/bin/python -m unittest tests.test_cli -v
"""
import argparse
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import app_config
import cli


class UseRepoPythonTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.venv = Path(self.tmp.name) / ".venv"
        (self.venv / "bin").mkdir(parents=True)
        self.python = self.venv / "bin" / "python3"
        self.python.touch()

    def tearDown(self):
        self.tmp.cleanup()

    def _run(self, prefix, python):
        with mock.patch.object(cli, "REPO_PYTHON", python), mock.patch.object(cli.sys, "prefix", str(prefix)), \
                mock.patch.object(cli.os, "execv") as execv:
            cli.use_repo_python()
        return execv

    def test_reexecs_into_repo_python_from_another_interpreter(self):
        execv = self._run("/usr/local", self.python)
        execv.assert_called_once()
        self.assertEqual(execv.call_args.args[0], self.python)

    def test_stays_put_inside_the_repo_virtualenv(self):
        self._run(self.venv, self.python).assert_not_called()

    def test_stays_put_when_there_is_no_virtualenv(self):
        self._run("/usr/local", self.venv / "bin" / "missing").assert_not_called()


class IndexRegistersSourceTest(unittest.TestCase):
    def test_index_saves_the_folder_as_a_configured_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "docs"
            folder.mkdir()
            saved = app_config.CONFIG_PATH
            app_config.CONFIG_PATH = Path(tmp) / "config.json"
            try:
                with mock.patch.object(cli.embedder, "Embedder"), mock.patch.object(cli.storage, "Storage"), \
                        mock.patch.object(cli.scanner, "Scanner") as scanner_class:
                    scanner_class.return_value.scan_path.return_value = 3
                    cli.cmd_index(argparse.Namespace(path=str(folder), source="local"))
                configured = app_config.get_configured_sources()
            finally:
                app_config.CONFIG_PATH = saved
        self.assertEqual([(s["name"], s["path"], s["source_type"]) for s in configured], [("docs", str(folder.resolve()), "local")])


if __name__ == "__main__":
    unittest.main()
