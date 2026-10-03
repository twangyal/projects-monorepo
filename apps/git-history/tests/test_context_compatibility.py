"""The two published context envelopes keep their contracts at shared boundaries."""

from dataclasses import asdict
import json
from pathlib import Path
import tempfile
import unittest

from git_history.context import ContextRecords, discussion_url, load_context
from git_history.model import SuppliedContext
from git_history.render import render_html, render_json
from tests.test_context import entry, report


class ContextCompatibilityTests(unittest.TestCase):
    def record(self, commit=None):
        return SuppliedContext(commit or 'b' * 40, entry()['url'], 'Review title', 'Author', 'Excerpt')

    def test_loaded_records_render_directly_even_when_empty_without_mutating_report(self):
        target = report()
        before = asdict(target)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'context.json'
            for records in ([], [asdict(self.record())]):
                with self.subTest(count=len(records)):
                    path.write_text(json.dumps({'schema_version': 1, 'revision': target.revision,
                                                'records': records}), encoding='utf-8')
                    loaded = load_context(path, target)
                    self.assertIsInstance(loaded, ContextRecords)
                    self.assertEqual(json.loads(render_json(target, loaded))['supplied_context'], records)
                    self.assertIn('Supplied discussion context', render_html(target, loaded))
                    self.assertEqual(asdict(target), before)

    def test_mixed_envelopes_and_render_arguments_are_rejected(self):
        target = report()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'mixed.json'
            path.write_text(json.dumps({'schema_version': 1, 'revision': target.revision,
                                        'records': [], 'entries': []}), encoding='utf-8')
            with self.assertRaises(ValueError):
                load_context(path, target)
        target.supplied_context = [self.record()]
        for renderer in (render_json, render_html):
            with self.subTest(renderer=renderer.__name__):
                with self.assertRaisesRegex(ValueError, 'cannot be combined'):
                    renderer(target, [])
                with self.assertRaisesRegex(ValueError, 'only one'):
                    renderer(target, ContextRecords())

    def test_records_direct_rendering_enforces_aggregate_utf8_byte_limit(self):
        target = report()
        record = self.record()
        record.excerpt = '\U0001f600' * 4000
        target.supplied_context = [record] * 50
        for renderer in (render_json, render_html):
            with self.subTest(renderer=renderer.__name__):
                with self.assertRaisesRegex(ValueError, '256 KiB'):
                    renderer(target)

    def test_records_reject_nonstandard_json_constants_before_validation(self):
        target = report()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'context.json'
            path.write_text('{"schema_version":1,"revision":NaN,"records":[]}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'standard values'):
                load_context(path, target)

    def test_shared_discussion_validation_keeps_route_specific_review_anchors(self):
        self.assertTrue(discussion_url('https://github.com/o/r/pull/1#pullrequestreview-2'))
        self.assertFalse(discussion_url('https://github.com/o/r/issues/1#discussion_r2'))
        self.assertFalse(discussion_url('https://github.com/o/r/discussions/1#issuecomment-2'))
