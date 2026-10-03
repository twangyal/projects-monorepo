"""Supplied context stays bounded, unverified and tied to displayed evidence."""

from contextlib import redirect_stderr, redirect_stdout
from copy import deepcopy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest

from git_history.cli import main
from git_history.context import load_context
from git_history.model import SuppliedContext
from git_history.render import render_html, render_json
from git_history.reader import inspect_repository
from tests.helpers import Repository
from tests.test_report import Links


class ContextTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.addCleanup(self.repo.close)
        self.repo.write("sample.py", "def answer():\n    return 41\n")
        self.old = self.repo.commit("Introduce helper")
        self.repo.write("sample.py", "def answer():\n    return 42\n")
        self.revision = self.repo.commit("Correct answer")
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.context = Path(self.temp.name) / "context.json"
        self.document = {
            "schema_version": 1, "revision": self.revision,
            "records": [{
                "commit": self.old, "url": "https://github.com/owner/repo/pull/12#issuecomment-42",
                "title": "Explain <helper>", "author": "<Alice>",
                "excerpt": "Keep <script>alert(1)</script> literal.\nThis is supplied context.",
            }],
        }

    def run_cli(self, document=None, *, format="json", options=()):
        if document is not None:
            self.context.write_text(json.dumps(document), encoding="utf-8")
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            try:
                status = main([
                    "explain", "--repo", str(self.repo.path), "--file", "sample.py",
                    "--function", "answer", "--format", format,
                    "--context", str(self.context), *options,
                ])
            except SystemExit as error:
                status = error.code
        return status, stdout.getvalue(), stderr.getvalue()

    def test_supplied_context_round_trips_without_changing_git_or_synopsis(self):
        before = self.repo.git("status", "--porcelain")
        status, text, error = self.run_cli(self.document)
        self.assertEqual(status, 0, error)
        report = json.loads(text)
        self.assertEqual(report["supplied_context"], self.document["records"])
        self.assertIn("not verified", report["supplied_context_note"])
        self.assertNotIn("Keep <script>", json.dumps(report["synopsis"]))
        self.assertEqual(self.repo.git("status", "--porcelain"), before)

    def test_html_quotes_supplied_text_and_links_to_existing_unique_evidence_anchors(self):
        status, html, error = self.run_cli(self.document, format="html")
        self.assertEqual(status, 0, error)
        self.assertIn("Supplied discussion context", html)
        self.assertIn("not verified", html)
        self.assertIn("&lt;Alice&gt;", html)
        self.assertIn("&lt;script&gt;", html)
        parsed = Links()
        parsed.feed(html)
        self.assertNotIn("script", parsed.tags)
        self.assertIn(self.document["records"][0]["url"], parsed.links)
        self.assertIn("#commit-" + self.old, parsed.links)
        self.assertEqual(len(parsed.ids), len(set(parsed.ids)))
        for link in parsed.links:
            if link.startswith("#"):
                self.assertIn(link[1:], parsed.ids)

    def test_context_requires_exact_snapshot_and_displayed_commit_evidence(self):
        cases = []
        stale = deepcopy(self.document)
        stale["revision"] = self.old
        cases.append(stale)
        unrelated = deepcopy(self.document)
        unrelated["records"][0]["commit"] = "a" * 40
        cases.append(unrelated)
        truncated = deepcopy(self.document)
        cases.append(truncated)
        for index, document in enumerate(cases):
            with self.subTest(index=index):
                options = ("--max-commits", "1", "--lines", "2:2") if index == 2 else ()
                # The existing line 1 still attributes the introduction. Make
                # an unrelated commit to test a real existing-but-undisplayed ID.
                if index == 2:
                    self.repo.write("other.py", "unrelated = True\n")
                    other = self.repo.commit("Unrelated file")
                    document["revision"] = other
                    document["records"][0]["commit"] = other
                    options = ("--max-commits", "1")
                status, text, error = self.run_cli(document, options=options)
                self.assertEqual(status, 2, error)
                self.assertIn("Git history: Context", error)
                self.assertEqual(text, "")
                self.assertNotIn("Traceback", error)

    def test_unsafe_or_non_discussion_urls_are_rejected_without_echoing_them(self):
        unsafe = [
            "javascript:alert(1)", "https://example.com/owner/repo/pull/1",
            "https://token@github.com/owner/repo/pull/1", "https://github.com:443/o/r/pull/1",
            "https://github.com/o/r/pull/1?token=secret", "https://github.com/o/r/commit/abc",
            "https://github.com/o/r/pull/1\n", "https://github.com/o/r/pull/1#<script>",
            "https://github.com/o/r/../pull/1", "https://github.com/o/r/pull/%31",
        ]
        for url in unsafe:
            with self.subTest(url=url):
                document = deepcopy(self.document)
                document["records"][0]["url"] = url
                status, text, error = self.run_cli(document)
                self.assertEqual(status, 2, error)
                self.assertEqual(text, "")
                self.assertNotIn(url, error)
                self.assertIn("discussion URL", error)

    def test_github_discussions_and_nested_gitlab_sources_are_supported(self):
        for url in [
            "https://github.com/o/r/issues/1#issuecomment-2",
            "https://github.com/o/r/discussions/1#discussioncomment-2",
            "https://github.com/o/r/pull/1#discussion_r2",
            "https://gitlab.com/group/nested/repo/-/merge_requests/1#note_2",
            "https://gitlab.com/group/repo/-/issues/1",
        ]:
            with self.subTest(url=url):
                document = deepcopy(self.document)
                document["records"][0]["url"] = url
                status, text, error = self.run_cli(document)
                self.assertEqual(status, 0, error)
                self.assertEqual(json.loads(text)["supplied_context"][0]["url"], url)

    def test_invalid_schema_limits_and_text_never_publish_output(self):
        cases = [None, [], {}, {**self.document, "schema_version": True},
                 {**self.document, "schema_version": 2},
                 {**self.document, "records": self.document["records"] * 51},
                 {**self.document, "unexpected": "ignored?"}]
        for key, value in [("commit", self.old[:10]), ("title", ""), ("author", "x" * 201),
                           ("excerpt", "x" * 4001), ("excerpt", "bad\x00text"),
                           ("excerpt", "\ud800"), ("title", 42)]:
            document = deepcopy(self.document)
            document["records"][0][key] = value
            cases.append(document)
        output = Path(self.temp.name) / "keep.html"
        output.write_text("Preserve previous report")
        for document in cases:
            with self.subTest(document_type=type(document).__name__):
                self.context.write_text(json.dumps(document), encoding="utf-8")
                status, text, error = self.run_cli(options=("--output", str(output), "--force"))
                self.assertEqual(status, 2, error)
                self.assertIn("Git history: Context", error)
                self.assertEqual(text, "")
                self.assertNotIn("Traceback", error)
                self.assertEqual(output.read_text(), "Preserve previous report")

    def test_malformed_duplicate_keys_and_oversized_input_are_bounded(self):
        for raw in [b"not JSON", b"\xff", b"[" * 2000,
                    b'{"schema_version":1,"schema_version":1}', b" " * (256 * 1024 + 1)]:
            with self.subTest(raw_length=len(raw)):
                self.context.write_bytes(raw)
                status, text, error = self.run_cli()
                self.assertEqual(status, 2, error)
                self.assertIn("Git history: Context", error)
                self.assertEqual(text, "")
                self.assertNotIn("Traceback", error)

    def test_empty_context_is_valid_and_absence_remains_explicit(self):
        document = {**self.document, "records": []}
        status, text, error = self.run_cli(document)
        self.assertEqual(status, 0, error)
        self.assertEqual(json.loads(text)["supplied_context"], [])
        status, html, error = self.run_cli(document, format="html")
        self.assertEqual(status, 0, error)
        self.assertIn("No discussion excerpts were supplied", html)

    def test_input_rejects_non_regular_files_without_waiting_for_pipe_writers(self):
        report = inspect_repository(self.repo.path, "sample.py", 1, 2)
        fifo = Path(self.temp.name) / "pipe"
        os.mkfifo(fifo)
        for path in [fifo, Path(self.temp.name)]:
            with self.subTest(path=path.name):
                with self.assertRaisesRegex(ValueError, "regular"):
                    load_context(path, report)

    def test_renderers_reject_unsafe_context_constructed_outside_the_cli(self):
        report = inspect_repository(self.repo.path, "sample.py", 1, 2)
        record = deepcopy(self.document["records"][0])
        record["url"] = "https://token@github.com/o/r/pull/1"
        report.supplied_context = [SuppliedContext(**record)]
        for renderer in [render_json, render_html]:
            with self.subTest(renderer=renderer.__name__):
                with self.assertRaisesRegex(ValueError, "discussion URL"):
                    renderer(report)

    def test_explicit_empty_context_path_is_an_error_instead_of_silently_omitted(self):
        status, text, error = self.run_cli(options=("--context", ""))
        self.assertEqual(status, 2, error)
        self.assertEqual(text, "")


if __name__ == "__main__":
    unittest.main()
