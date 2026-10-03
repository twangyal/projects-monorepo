import json
import re
import unittest
from dataclasses import asdict
from html.parser import HTMLParser

from git_history.model import ChangeEvidence, LineEvidence, RenameEvidence, Report
from git_history.render import render_html, render_json


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
        changes=[ChangeEvidence(sha, "<Alice>", "2026-01-01", "Guard output\n\nBecause <script>evil</script>", "--- a/x\n+++ b/x\n-old\n+<img src=x onerror=alert(1)>\n")],
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
        self.assertEqual(json.loads(render_json(report)), asdict(report))

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
