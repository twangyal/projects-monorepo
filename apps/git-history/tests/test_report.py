import json
import re
import unittest
from dataclasses import asdict
from html.parser import HTMLParser

from git_history.model import ChangeEvidence, LineEvidence, RenameEvidence, Report
from git_history.render import render_html, render_json
from git_history.synopsis import build_synopsis


def example_report():
    sha = "a" * 40
    older = "b" * 40
    return Report(
        repo_name="sample <repository>", revision=sha, requested_ref="HEAD",
        path="src/<example>.py", start_line=3, end_line=4,
        source='print("<script>alert(1)</script>")\nreturn True\n',
        blame=[
            LineEvidence(3, 1, sha, "src/old.py", "<Alice>", "2026-01-01", "Fix <x>", 'print("<script>alert(1)</script>")'),
            LineEvidence(4, 2, older, "old.py", "Bob", "2025-12-01", "Initial implementation", "return True"),
        ],
        changes=[ChangeEvidence(sha, "<Alice>", "2026-01-01", "Guard output\n\nBecause <script>evil</script>", "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+<img src=x onerror=alert(1)>\n")],
        renames=[RenameEvidence(older, "old.py", "src/<example>.py", 100)],
        warnings=["Shallow history; earlier commits may be missing."],
        remote_url="https://github.com/owner/repo",
    )


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.links = []
        self.tags = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        self.tags.append(tag)
        if "id" in attributes:
            self.ids.append(attributes["id"])
        if "href" in attributes:
            self.links.append(attributes["href"])


class ReportTests(unittest.TestCase):
    def test_html_escapes_all_evidence_and_embeds_no_scripts_or_external_assets(self):
        html = render_html(example_report())
        self.assertIn("&lt;script&gt;", html)
        self.assertIn("&lt;Alice&gt;", html)
        self.assertNotIn("<script>", html)
        self.assertNotIn("<img ", html)
        self.assertIn("Content-Security-Policy", html)
        self.assertIn("default-src 'none'", html)
        parsed = Links()
        parsed.feed(html)
        self.assertNotIn("script", parsed.tags)
        self.assertNotIn("link", parsed.tags)

    def test_every_internal_evidence_link_resolves_to_one_unique_anchor(self):
        parsed = Links()
        parsed.feed(render_html(example_report()))
        self.assertEqual(len(parsed.ids), len(set(parsed.ids)))
        for link in parsed.links:
            if link.startswith("#"):
                self.assertIn(link[1:], parsed.ids)
        self.assertIn("source-L3", parsed.ids)
        self.assertIn("source-L4", parsed.ids)
        self.assertTrue(any("/commit/" in link for link in parsed.links))

    def test_reports_distinguish_messages_from_unknown_intent_and_show_limits(self):
        html = render_html(example_report())
        self.assertIn("Commit message", html)
        self.assertIn("Intent is not established", html)
        self.assertIn("Shallow history", html)
        self.assertIn("Working-tree edits", html)
        self.assertIn("PR discussions", html)
        self.assertIn("100%", html)
        self.assertIn("1 added", html)
        self.assertIn("1 removed", html)

    def test_patch_counts_include_header_like_source_only_inside_actual_hunks(self):
        report = example_report()
        report.changes[0].patch = (
            "+not a hunk\n-not a hunk\ndiff --git a/x b/x\n--- a/x\n+++ b/x\n"
            "@@ -1,2 +1,2 @@\n---counter\n-old\n+++counter\n+new\n"
            "diff --git a/y b/y\n--- a/y\n+++ b/y\n+outside a hunk\n"
        )
        self.assertIn("2 added · 2 removed lines", render_html(report))

    def test_empty_or_incomplete_evidence_is_explicit_not_fabricated(self):
        report = example_report()
        report.changes = []
        report.renames = []
        report.remote_url = None
        html = render_html(report)
        self.assertIn("No range-change patches available", html)
        self.assertNotRegex(html, re.compile(r'https://github\.com/'))
        self.assertIn("Initial implementation", html)

    def test_json_preserves_structured_evidence_and_unknowns(self):
        report = example_report()
        expected = asdict(report)
        expected.pop('supplied_context')
        expected["synopsis"] = build_synopsis(report)
        self.assertEqual(json.loads(render_json(report)), expected)

    def test_html_synopsis_shares_facts_and_links_all_commit_observations(self):
        report = example_report()
        report.selected_function = "Handler.<process>"
        report.end_line = 5
        report.source += "x\n"
        report.blame.append(LineEvidence(5, 9, "a" * 40, "x.py", "<Alice>", "2026", "Fix", "x"))
        report.changes += [
            ChangeEvidence("c" * 40, "Carol", "2026-02-01", "z" * 241, "patch"),
            ChangeEvidence("d" * 40, "Dan", "2025-01-01", "third message", "patch"),
            ChangeEvidence("e" * 40, "Eve", "2024-01-01", "fourth message", "patch"),
        ]
        html = render_html(report)
        synopsis_html = html.split('<section id="synopsis"', 1)[1].split('</section>', 1)[0]
        self.assertIn("Handler.&lt;process&gt;", synopsis_html)
        self.assertIn(report.revision, synopsis_html)
        self.assertIn("2 current lines", synopsis_html)
        self.assertIn("1 current line", synopsis_html)
        self.assertIn("Quoted commit message excerpt", synopsis_html)
        self.assertIn("[truncated]", synopsis_html)
        self.assertIn("z" * 240, synopsis_html)
        self.assertNotIn("z" * 241, synopsis_html)
        self.assertIn("third message", synopsis_html)
        self.assertNotIn("fourth message", synopsis_html)
        self.assertIn("&lt;script&gt;evil&lt;/script&gt;", synopsis_html)
        self.assertIn("3 of 4", synopsis_html)
        self.assertIn("unknown", synopsis_html)
        for commit in ["a" * 40, "b" * 40, "c" * 40, "d" * 40]:
            self.assertIn(f'href="#commit-{commit}"', synopsis_html)

    def test_rename_only_commits_have_one_anchor_even_when_multiple_paths_share_a_commit(self):
        report = example_report()
        commit = "c" * 40
        report.renames += [
            RenameEvidence(commit, "<previous>.py", "current.py", 87),
            RenameEvidence(commit, "more.py", "next.py", 91),
        ]
        html = render_html(report)
        parsed = Links()
        parsed.feed(html)
        self.assertEqual(len(parsed.ids), len(set(parsed.ids)))
        self.assertEqual(parsed.ids.count("commit-" + commit), 1)
        self.assertGreaterEqual(parsed.links.count("#commit-" + commit), 4)
        for link in parsed.links:
            if link.startswith("#"):
                self.assertIn(link[1:], parsed.ids)
        self.assertIn("&lt;previous&gt;.py", html)

    def test_report_size_limit_applies_after_adding_synopsis(self):
        report = example_report()
        report.source = "x" * (8 * 1024 * 1024)
        for renderer in [render_json, render_html]:
            with self.subTest(renderer=renderer.__name__):
                with self.assertRaisesRegex(ValueError, "8 MiB"):
                    renderer(report)

    def test_defense_in_depth_rejects_untrusted_remote_links(self):
        report = example_report()
        for remote in ["javascript:alert(1)", "https://token@github.com/owner/repo", "https://example.com/x", "https://github.com/owner/repo?token=secret"]:
            report.remote_url = remote
            html = render_html(report)
            self.assertNotIn("token@", html)
            self.assertNotIn("token=secret", html)
            self.assertNotIn("javascript:", html)
            self.assertNotIn("https://example.com", html)


if __name__ == "__main__":
    unittest.main()
