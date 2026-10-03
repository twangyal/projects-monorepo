import json
from contextlib import redirect_stderr, redirect_stdout
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from git_history.cli import main
from git_history.model import FunctionCatalog, FunctionDefinition

APP = Path(__file__).resolve().parents[1]


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / "example repository"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "Fixture Author")
        self.git("config", "user.email", "fixture@example.invalid")
        (self.repo / "sample.py").write_text("def answer():\n    return 41\n", encoding="utf-8")
        self.git("add", "sample.py")
        self.git("commit", "-qm", "Introduce the answer helper")
        (self.repo / "sample.py").write_text("def answer():\n    return 42\n", encoding="utf-8")
        self.git("commit", "-qam", "Correct answer\n\nThe fixture expects forty-two.")

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.repo), *args], check=True, capture_output=True)

    def cli(self, *args):
        return self.command("explain", "--lines", "1:2", *args)

    def command(self, command, *args):
        return subprocess.run(
            [sys.executable, "-m", "git_history", command, "--repo", str(self.repo), "--file", "sample.py", *args],
            cwd=APP, capture_output=True, text=True, timeout=30,
        )

    def test_json_cli_is_structured_and_does_not_change_git_state(self):
        before = self.git("status", "--porcelain").stdout
        result = self.cli("--format", "json")
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["schema_version"], 1)
        self.assertIn("return 42", report["source"])
        self.assertEqual(len(report["blame"]), 2)
        self.assertTrue(report["changes"])
        self.assertEqual(self.git("status", "--porcelain").stdout, before)

    def test_html_output_is_created_once_and_only_force_replaces_it(self):
        output = Path(self.temp.name) / "report.html"
        result = self.cli("--output", str(output))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("<!doctype html>", output.read_text())
        output.write_text("Keep my work")
        result = self.cli("--output", str(output))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("already exists", result.stderr)
        self.assertEqual(output.read_text(), "Keep my work")
        result = self.cli("--output", str(output), "--force")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("<!doctype html>", output.read_text())

    def test_git_metadata_is_protected_even_with_force(self):
        config = self.repo / ".git" / "config"
        before = config.read_bytes()
        result = self.cli("--output", str(config), "--force")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Git metadata", result.stderr)
        self.assertEqual(config.read_bytes(), before)
        alias = Path(self.temp.name) / "alias"
        alias.symlink_to(self.repo / ".git", target_is_directory=True)
        result = self.cli("--output", str(alias / "config"), "--force")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(config.read_bytes(), before)

    def test_other_bare_and_separate_git_metadata_are_protected(self):
        bare = Path(self.temp.name) / 'bare-repository'
        subprocess.run(['git', 'init', '--bare', '-q', str(bare)], check=True)
        metadata = Path(self.temp.name) / 'separate-metadata'
        tree = Path(self.temp.name) / 'separate-worktree'
        subprocess.run(['git', 'init', '-q', '--separate-git-dir', str(metadata), str(tree)], check=True)
        for directory in [bare, metadata]:
            target = directory / 'config'
            original = target.read_bytes()
            result = self.cli('--output', str(target), '--force')
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Git metadata', result.stderr)
            self.assertEqual(target.read_bytes(), original)

    def test_functions_lists_committed_names_ranges_and_revision_as_text_or_json(self):
        (self.repo / "sample.py").write_text("def uncommitted():\n    return 99\n")
        result = self.command("functions")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("answer", result.stdout)
        self.assertIn("1:2", result.stdout)
        self.assertNotIn("uncommitted", result.stdout)
        result = self.command("functions", "--format", "json")
        self.assertEqual(result.returncode, 0, result.stderr)
        catalog = json.loads(result.stdout)
        self.assertEqual(catalog["revision"], self.git("rev-parse", "HEAD").stdout.decode().strip())
        self.assertEqual(catalog["functions"], [{
            "qualified_name": "answer", "start_line": 1, "end_line": 2, "kind": "function",
        }])
        self.assertEqual(catalog["path"], "sample.py")

    def test_function_explanation_matches_manual_committed_range(self):
        manual = json.loads(self.cli("--format", "json", "--ref", "HEAD~1").stdout)
        result = self.command("explain", "--function", "answer", "--format", "json", "--ref", "HEAD~1")
        self.assertEqual(result.returncode, 0, result.stderr)
        selected = json.loads(result.stdout)
        self.assertEqual(selected["selected_function"], "answer")
        for field in ("revision", "source", "start_line", "end_line", "blame", "changes", "renames", "warnings"):
            self.assertEqual(selected[field], manual[field], field)

    def test_oversized_catalog_output_is_rejected_before_writing_stdout(self):
        catalog = FunctionCatalog("fixture", "a" * 40, "HEAD", "sample.py", [
            FunctionDefinition("a" * 9000, 1, 2, "function")
        ] * 1000)
        for format in ("text", "json"):
            stdout, stderr = io.StringIO(), io.StringIO()
            with patch("git_history.cli.list_functions", return_value=catalog), redirect_stdout(stdout), redirect_stderr(stderr):
                status = main(["functions", "--file", "sample.py", "--format", format])
            self.assertEqual(status, 2)
            self.assertEqual(stdout.getvalue(), "")
            self.assertIn("8 MiB", stderr.getvalue())

    def test_selection_errors_never_write_output(self):
        output = Path(self.temp.name) / "should-not-exist.html"
        options = [(), ("--lines", "1:2", "--function", "answer"), ("--function", "missing")]
        for selection in options:
            result = self.command("explain", *selection, "--output", str(output))
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertNotIn("Traceback", result.stderr)
            self.assertEqual(result.stdout, "")
            self.assertFalse(output.exists())
        (self.repo / "sample.py").write_text("def answer():\n    return 1\ndef answer():\n    return 2\n")
        self.git("commit", "-qam", "Ambiguous definitions")
        result = self.command("explain", "--function", "answer", "--output", str(output))
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("--lines", result.stderr)
        self.assertFalse(output.exists())

    def test_empty_function_catalog_is_explicit_and_keeps_manual_range_available(self):
        (self.repo / "sample.py").write_text("answer = 42\n")
        self.git("commit", "-qam", "Use a constant")
        result = self.command("functions")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("No functions", result.stdout)
        self.assertIn("--lines", result.stdout)
        result = self.command("explain", "--lines", "1:1", "--format", "json")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["source"], "answer = 42\n")

    def test_function_report_output_is_offline_and_keeps_atomic_write_protection(self):
        output = Path(self.temp.name) / "function.html"
        result = self.command("explain", "--function", "answer", "--output", str(output))
        self.assertEqual(result.returncode, 0, result.stderr)
        html = output.read_text()
        self.assertIn("answer", html)
        self.assertIn("Evidence synopsis", html)
        self.assertIn("default-src 'none'", html)
        output.write_text("Existing report")
        result = self.command("explain", "--function", "answer", "--output", str(output))
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(output.read_text(), "Existing report")

    def test_bad_ref_range_and_missing_output_parent_are_actionable_without_traceback(self):
        for options in [("--ref", "missing-revision"), ("--lines", "0:2"), ("--lines", "2:1"), ("--lines", "1:999"), ("--output", str(Path(self.temp.name) / "missing" / "report.html"))]:
            result = self.cli(*options)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(result.stderr)
            self.assertNotIn("Traceback", result.stderr)
            self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
