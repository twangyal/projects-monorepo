"""Exercise the runner against real Git and bounded child processes."""

from __future__ import annotations

import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from git_history.runner import GitError, GitOutputLimit, GitRunner, GitTimeout, _run_bounded


class GitRunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="git runner ")
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / "repository with spaces"
        self.repo.mkdir()
        self.git("init", "--quiet")
        self.git("config", "user.name", "Test Author")
        self.git("config", "user.email", "author@example.test")
        (self.repo / "source.txt").write_text("committed source\n", encoding="utf-8")
        self.git("add", "source.txt")
        self.git("commit", "--quiet", "-m", "Initial evidence")

    def git(self, *args: str) -> bytes:
        return subprocess.check_output(["git", "-C", str(self.repo), *args], stderr=subprocess.PIPE)

    def child(self, script: str, *, timeout: float = 2, max_bytes: int = 1024) -> bytes:
        return _run_bounded(
            [sys.executable, "-c", script],
            cwd=self.repo,
            env=dict(os.environ),
            timeout=timeout,
            max_bytes=max_bytes,
        )

    def test_reads_committed_object_from_repository_with_spaces(self) -> None:
        self.assertEqual(GitRunner(self.repo).run("show", "HEAD:source.txt"), b"committed source\n")

    def test_unicode_metadata_is_utf8_despite_repository_output_encoding(self) -> None:
        source = "café source\n".encode("utf-8")
        message = "café evidence"
        (self.repo / "source.txt").write_bytes(source)
        self.git("add", "source.txt")
        self.git("commit", "--quiet", "-m", message)
        self.git("config", "i18n.logOutputEncoding", "ISO-8859-1")
        configuration = (self.repo / ".git" / "config").read_bytes()
        self.assertEqual(self.git("log", "-1", "--format=%s"), message.encode("latin-1") + b"\n")

        runner = GitRunner(self.repo)
        self.assertEqual(runner.run("log", "-1", "--format=%s"), message.encode("utf-8") + b"\n")
        blame = runner.run("blame", "--line-porcelain", "HEAD", "--", "source.txt")
        self.assertIn(f"summary {message}\n", blame.decode("utf-8"))
        blob = runner.run("rev-parse", "HEAD:source.txt").decode().strip()
        self.assertEqual(runner.run("cat-file", "blob", blob), source)
        self.assertEqual((self.repo / ".git" / "config").read_bytes(), configuration)

    def test_arguments_are_never_interpreted_by_a_shell(self) -> None:
        marker = Path(self.temp.name) / "shell-was-run"
        value = f"$(touch '{marker}'); echo expanded"
        self.git("config", "test.literal", value)
        self.assertEqual(GitRunner(self.repo).run("config", "--get", "test.literal"),
                         value.encode() + b"\n")
        self.assertFalse(marker.exists())

    def test_failure_has_useful_stderr_without_dumping_arguments(self) -> None:
        private_arg = "private-argument-do-not-echo"
        with self.assertRaises(GitError) as caught:
            _run_bounded(
                [sys.executable, "-c",
                 "import sys; sys.stderr.write('specific failure'); sys.exit(7)", private_arg],
                cwd=self.repo, env=dict(os.environ), timeout=2, max_bytes=1024,
            )
        self.assertIn("specific failure", str(caught.exception))
        self.assertIn("7", str(caught.exception))
        self.assertNotIn(private_arg, str(caught.exception))

    def test_git_command_failure_is_actionable(self) -> None:
        with self.assertRaisesRegex(GitError, "not a valid object|invalid object"):
            GitRunner(self.repo).run("show", "missing-revision:source.txt")

    def test_failure_diagnostic_is_bounded(self) -> None:
        with self.assertRaises(GitError) as caught:
            self.child("import os,sys; os.write(2,b'e' * 5000); sys.exit(1)", max_bytes=6000)
        self.assertLess(len(str(caught.exception)), 4300)
        self.assertIn("truncated", str(caught.exception))

    def test_drains_large_stderr_while_reading_stdout(self) -> None:
        script = "import os; os.write(2, b'e' * 200000); os.write(1, b'result')"
        self.assertEqual(self.child(script, max_bytes=200006), b"result")

    def test_exact_combined_limit_is_allowed(self) -> None:
        self.assertEqual(self.child("import os; os.write(1,b'abc'); os.write(2,b'de')",
                                    max_bytes=5), b"abc")

    def test_combined_stdout_and_stderr_exceed_limit(self) -> None:
        with self.assertRaises(GitOutputLimit):
            self.child("import os; os.write(1,b'abc'); os.write(2,b'def')", max_bytes=5)

    def test_huge_stdout_is_stopped_and_child_reaped(self) -> None:
        self.assert_child_reaped(
            "import os;\nwhile True: os.write(1, b'x' * 65536)",
            GitOutputLimit,
            max_bytes=4096,
        )

    def test_huge_stderr_is_stopped_and_child_reaped(self) -> None:
        self.assert_child_reaped(
            "import os;\nwhile True: os.write(2, b'x' * 65536)",
            GitOutputLimit,
            max_bytes=4096,
        )

    def test_timeout_kills_and_reaps_child(self) -> None:
        started = time.monotonic()
        self.assert_child_reaped("import time; time.sleep(30)", GitTimeout, timeout=0.1)
        self.assertLess(time.monotonic() - started, 2)

    def test_timeout_still_applies_after_pipes_close(self) -> None:
        self.assert_child_reaped(
            "import os,time; os.close(1); os.close(2); time.sleep(30)",
            GitTimeout,
            timeout=0.1,
        )

    def assert_child_reaped(self, script: str, exception: type[GitError], **kwargs) -> None:
        children = []
        original_popen = subprocess.Popen

        def capture_child(*args, **popen_kwargs):
            child = original_popen(*args, **popen_kwargs)
            children.append(child)
            return child

        with patch("git_history.runner.subprocess.Popen", side_effect=capture_child):
            with self.assertRaises(exception):
                self.child(script, **kwargs)
        self.assertEqual(len(children), 1)
        self.assertIsNotNone(children[0].returncode)
        if os.name == "posix":
            with self.assertRaises(ChildProcessError):
                os.waitpid(children[0].pid, os.WNOHANG)

    def test_run_override_can_lower_output_limit(self) -> None:
        runner = GitRunner(self.repo, max_bytes=100)
        with self.assertRaises(GitOutputLimit):
            runner.run("show", "HEAD:source.txt", max_bytes=4)
        self.assertEqual(runner.run("show", "HEAD:source.txt"), b"committed source\n")

    def test_ignores_inherited_repository_and_object_overrides(self) -> None:
        wrong_repo = Path(self.temp.name) / "wrong"
        wrong_repo.mkdir()
        subprocess.run(["git", "init", "--quiet", str(wrong_repo)], check=True)
        poisoned = {
            "GIT_DIR": str(wrong_repo / ".git"),
            "GIT_WORK_TREE": str(wrong_repo),
            "GIT_OBJECT_DIRECTORY": str(wrong_repo / ".git" / "objects"),
            "GIT_INDEX_FILE": str(wrong_repo / "other-index"),
            "GIT_NAMESPACE": "unrelated",
        }
        with patch.dict(os.environ, poisoned):
            self.assertEqual(GitRunner(self.repo).run("show", "HEAD:source.txt"),
                             b"committed source\n")

    def test_reads_original_objects_even_when_git_replace_is_configured(self) -> None:
        original = self.git("rev-parse", "HEAD").decode().strip()
        (self.repo / "source.txt").write_text("replacement source\n", encoding="utf-8")
        self.git("add", "source.txt")
        self.git("commit", "--quiet", "-m", "Replacement evidence")
        replacement = self.git("rev-parse", "HEAD").decode().strip()
        self.git("replace", original, replacement)
        self.assertEqual(self.git("show", f"{original}:source.txt"), b"replacement source\n")

        with patch.dict(os.environ):
            os.environ.pop("GIT_NO_REPLACE_OBJECTS", None)
            runner = GitRunner(self.repo)
            self.assertEqual(runner.run("rev-parse", "--verify", f"{original}^{{commit}}"),
                             original.encode() + b"\n")
            self.assertEqual(runner.run("show", f"{original}:source.txt"), b"committed source\n")
            blob = runner.run("rev-parse", f"{original}:source.txt").decode().strip()
            self.assertEqual(runner.run("cat-file", "blob", blob), b"committed source\n")

    def test_disables_inherited_config_injection_and_fsmonitor(self) -> None:
        poisoned = {
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "core.fsmonitor",
            "GIT_CONFIG_VALUE_0": "injected-command",
        }
        with patch.dict(os.environ, poisoned):
            self.assertEqual(GitRunner(self.repo).run("config", "--get", "core.fsmonitor"),
                             b"false\n")

    def test_preserves_proxies_and_disables_lazy_fetch_and_tracing(self) -> None:
        environments = []
        original_popen = subprocess.Popen

        def capture_environment(*args, **kwargs):
            environments.append(kwargs["env"])
            return original_popen(*args, **kwargs)

        inherited = {
            "HTTPS_PROXY": "http://proxy.example.test:8080", "GIT_TRACE": "1",
            "GIT_NO_REPLACE_OBJECTS": "0",
        }
        with patch.dict(os.environ, inherited):
            with patch("git_history.runner.subprocess.Popen", side_effect=capture_environment):
                GitRunner(self.repo).run("rev-parse", "HEAD")
        self.assertEqual(environments[0]["HTTPS_PROXY"], inherited["HTTPS_PROXY"])
        self.assertEqual(environments[0]["GIT_NO_LAZY_FETCH"], "1")
        self.assertEqual(environments[0]["GIT_NO_REPLACE_OBJECTS"], "1")
        self.assertEqual(environments[0]["GIT_OPTIONAL_LOCKS"], "0")
        self.assertNotIn("GIT_TRACE", environments[0])

    def test_rejects_invalid_limits(self) -> None:
        for timeout in (0, -1, math.inf, math.nan, True, "10", 10**1000):
            with self.subTest(timeout=timeout), self.assertRaises(ValueError):
                GitRunner(self.repo, timeout=timeout)
        for max_bytes in (0, -1, 1.5, True, "1024"):
            with self.subTest(max_bytes=max_bytes), self.assertRaises(ValueError):
                GitRunner(self.repo, max_bytes=max_bytes)
        with self.assertRaises(ValueError):
            GitRunner(self.repo).run("status", max_bytes=0)

    def test_large_finite_timeout_does_not_overflow_selector(self) -> None:
        self.assertEqual(GitRunner(self.repo, timeout=1e100).run("show", "HEAD:source.txt"),
                         b"committed source\n")


if __name__ == "__main__":
    unittest.main()
