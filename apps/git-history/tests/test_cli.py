import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

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
        return subprocess.run(
            [sys.executable, "-m", "git_history", "explain", "--repo", str(self.repo), "--file", "sample.py", "--lines", "1:2", *args],
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
    def test_bad_ref_range_and_missing_output_parent_are_actionable_without_traceback(self):
        for options in [("--ref", "missing-revision"), ("--lines", "0:2"), ("--lines", "2:1"), ("--lines", "1:999"), ("--output", str(Path(self.temp.name) / "missing" / "report.html"))]:
            result = self.cli(*options)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(result.stderr)
            self.assertNotIn("Traceback", result.stderr)
            self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
