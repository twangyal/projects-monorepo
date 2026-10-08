import copy
import unittest

from git_history.model import ChangeEvidence, LineEvidence, RenameEvidence
from git_history.synopsis import build_synopsis
from tests.test_report import example_report


class SynopsisTests(unittest.TestCase):
    def test_selection_contains_resolved_snapshot_range_and_optional_function(self):
        report = example_report()
        self.assertEqual(build_synopsis(report)["selection"], {
            "path": report.path, "start_line": 3, "end_line": 4,
            "selected_function": None, "revision": report.revision, "requested_ref": "HEAD",
        })
        report.selected_function = "Handler.process"
        self.assertEqual(build_synopsis(report)["selection"]["selected_function"], "Handler.process")

    def test_attribution_counts_current_lines_by_commit_without_inventing_chronology(self):
        report = example_report()
        report.end_line = 5
        report.source += "x\n"
        report.blame.append(LineEvidence(5, 8, "a" * 40, "x.py", "<Alice>", "2026", "Fix <x>", "x"))
        synopsis = build_synopsis(report)
        self.assertEqual(synopsis["attribution"], [
            {"commit": "a" * 40, "line_count": 2, "author": "<Alice>", "summary": "Fix <x>", "evidence_anchor": "commit-" + "a" * 40},
            {"commit": "b" * 40, "line_count": 1, "author": "Bob", "summary": "Initial implementation", "evidence_anchor": "commit-" + "b" * 40},
        ])
        self.assertNotIn("introduced", synopsis["intent_note"].lower())
        self.assertIn("unknown", synopsis["intent_note"].lower())

    def test_recent_changes_use_at_most_three_records_in_existing_git_order(self):
        report = example_report()
        report.changes = [
            ChangeEvidence("c" * 40, "Newest", "2020", "newest\n\nDetails <script>", "patch"),
            ChangeEvidence("d" * 40, "Next", "2026", "é" * 241, "patch"),
            ChangeEvidence("e" * 40, "Third", "2018", "x" * 240, "patch"),
            ChangeEvidence("f" * 40, "Fourth", "2030", "fourth", "patch"),
        ]
        changes = build_synopsis(report)["recent_changes"]
        self.assertEqual([change["commit"] for change in changes], ["c" * 40, "d" * 40, "e" * 40])
        self.assertEqual(changes[0]["message_excerpt"], "newest\n\nDetails <script>")
        self.assertEqual(changes[1]["message_excerpt"], "é" * 240)
        self.assertTrue(changes[1]["message_truncated"])
        self.assertFalse(changes[2]["message_truncated"])
        self.assertTrue(all(len(change["message_excerpt"]) <= 240 for change in changes))
        self.assertEqual(changes[0]["author"], "Newest")
        self.assertEqual(changes[0]["date"], "2020")
        self.assertTrue(any("3 of 4" in note for note in build_synopsis(report)["completeness_notes"]))

    def test_empty_messages_are_preserved_without_fabricating_an_author_explanation(self):
        report = example_report()
        report.changes[0].message = ""
        change = build_synopsis(report)["recent_changes"][0]
        self.assertEqual(change["message_excerpt"], "")
        self.assertFalse(change["message_truncated"])

    def test_renames_preserve_whole_file_evidence_and_link_even_unattributed_commits(self):
        report = example_report()
        report.renames.append(RenameEvidence("c" * 40, "other.py", "current.py", 72))
        self.assertEqual(build_synopsis(report)["renames"], [
            {"commit": "b" * 40, "old_path": "old.py", "new_path": "src/<example>.py", "similarity": 100, "evidence_anchor": "commit-" + "b" * 40},
            {"commit": "c" * 40, "old_path": "other.py", "new_path": "current.py", "similarity": 72, "evidence_anchor": "commit-" + "c" * 40},
        ])

    def test_empty_and_partial_reports_explain_missing_evidence_and_unknown_intent(self):
        report = example_report()
        report.blame = []
        report.changes = []
        report.renames = []
        report.warnings = []
        synopsis = build_synopsis(report)
        self.assertEqual(synopsis["attribution"], [])
        self.assertEqual(synopsis["recent_changes"], [])
        self.assertEqual(synopsis["renames"], [])
        notes = " ".join(synopsis["completeness_notes"])
        self.assertIn("No current-line attribution", notes)
        self.assertIn("No range-change records", notes)
        self.assertIn("No whole-file rename", notes)
        self.assertIn("not proof", notes)
        self.assertIn("unknown", synopsis["intent_note"])
        report.warnings = ["Shallow boundary", "Optional history failed"]
        partial = build_synopsis(report)
        self.assertIn("Shallow boundary", partial["completeness_notes"])
        self.assertIn("Optional history failed", partial["completeness_notes"])

    def test_building_and_mutating_a_synopsis_cannot_change_the_report(self):
        report = example_report()
        before = copy.deepcopy(report)
        synopsis = build_synopsis(report)
        synopsis["selection"]["path"] = "changed.py"
        synopsis["attribution"][0]["line_count"] = 50
        synopsis["renames"][0]["new_path"] = "elsewhere.py"
        synopsis["completeness_notes"].append("extra")
        self.assertEqual(report, before)


if __name__ == "__main__":
    unittest.main()
