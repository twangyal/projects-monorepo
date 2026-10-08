"""Direct, hand-authored comparison renderer expectations."""
from dataclasses import asdict, replace
from hashlib import sha256
from html.parser import HTMLParser
import json
import threading
import unittest
from unittest.mock import patch

from git_history.comparison import (
    CompareSelection, ComparisonBlock, ComparisonReport, ComparisonSide,
)
from git_history import comparison_render
from git_history.comparison_render import render_comparison_html, render_comparison_json
from git_history.work_budget import WorkCancelled, work_budget


def side(source='same\n', *, path='file.py', start=1, selection=None, missing=False):
    if missing:
        return ComparisonSide('HEAD', 'a' * 40, path, 'missing', CompareSelection('missing'),
                              None, None, None, '', None)
    count = source.count('\n') + int(bool(source) and not source.endswith('\n'))
    chosen = selection or CompareSelection('whole')
    return ComparisonSide('HEAD', 'a' * 40, path, 'present', chosen,
                          start if count else None, start + count - 1 if count else None,
                          chosen.function, source, sha256(source.encode()).hexdigest())


def report(left=None, right=None, blocks=None, counts=(1, 0, 0)):
    return ComparisonReport(1, 'source-comparison', 'fixture', left or side(), right or side(),
                            blocks if blocks is not None else (ComparisonBlock('equal', 0, 1, 0, 1),),
                            *counts)


class Document(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.ids = []
        self.links = []
        self.tags = []
        self.sources = []
        self.code = None
        self.text = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tags.append(tag)
        if 'id' in attrs:
            self.ids.append(attrs['id'])
        if tag == 'a':
            self.links.append(attrs.get('href', ''))
        if tag == 'code':
            self.code = []

    def handle_endtag(self, tag):
        if tag == 'code' and self.code is not None:
            self.sources.append(''.join(self.code))
            self.code = None

    def handle_data(self, data):
        self.text.append(data)
        if self.code is not None:
            self.code.append(data)


class ComparisonRenderTests(unittest.TestCase):
    def test_json_exact_fields_sources_and_offsets(self):
        item = report(side('old\r\n'), side('new'),
                      (ComparisonBlock('change', 0, 1, 0, 1),), (0, 1, 1))
        encoded = render_comparison_json(item)
        self.assertTrue(encoded.endswith('\n'))
        self.assertEqual(json.loads(encoded), json.loads(json.dumps(asdict(item))))
        self.assertEqual(json.loads(encoded)['left']['source'], 'old\r\n')
        self.assertEqual(json.loads(encoded)['right']['source'], 'new')
        self.assertEqual(set(json.loads(encoded)['blocks'][0]),
                         {'kind', 'left_start', 'left_end', 'right_start', 'right_end'})

    def test_html_literal_source_provenance_and_internal_anchors(self):
        source = '<script>alert("owned")</script> & \ufeff\u2028\u2029\n'
        selection = CompareSelection('function', function='owner.<function>')
        lhs = replace(side(source, path='<img src=x onerror=bad>.py', start=12,
                           selection=selection), requested_ref='<branch>', revision='b' * 64)
        item = report(lhs, side('other\n'), (ComparisonBlock('change', 0, 1, 0, 1),), (0, 1, 1))
        text = render_comparison_html(item)
        doc = Document(text)
        self.assertIn(source[:-1], doc.sources)
        self.assertNotIn('script', doc.tags)
        self.assertNotIn('img', doc.tags)
        self.assertNotIn('link', doc.tags)
        self.assertIn('style', doc.tags)
        visible = ''.join(doc.text)
        for literal in (lhs.path, lhs.requested_ref, lhs.revision, lhs.selected_function):
            self.assertIn(literal, visible)
        self.assertIn('left-L12', doc.ids)
        self.assertIn('right-L1', doc.ids)
        self.assertEqual(len(doc.ids), len(set(doc.ids)))
        self.assertTrue(doc.links)
        self.assertTrue(all(link.startswith('#') and link[1:] in doc.ids for link in doc.links))
        self.assertIn('positional', visible.lower())
        self.assertIn('semantic', visible.lower())
        self.assertIn('authenticity', visible.lower())

    def test_eol_labels_and_physical_unicode_separator(self):
        item = report(side('a\r\nb\u2028c\nlast'), side('z\n'),
                      (ComparisonBlock('change', 0, 3, 0, 1),), (0, 3, 1))
        doc = Document(render_comparison_html(item))
        self.assertEqual(doc.sources, ['a', 'z', 'b\u2028c', 'last'])
        self.assertIn('CRLF', ''.join(doc.text))
        self.assertIn('LF', ''.join(doc.text))
        self.assertIn('No final LF', ''.join(doc.text))
        self.assertIn('left-L3', doc.ids)
        self.assertNotIn('left-L4', doc.ids)

    def test_present_empty_and_verified_missing_remain_distinct(self):
        item = report(side(''), side(missing=True), (), (0, 0, 0))
        doc = Document(render_comparison_html(item))
        visible = ''.join(doc.text).lower()
        self.assertIn('present empty', visible)
        self.assertIn('verified absent', visible)
        self.assertEqual(json.loads(render_comparison_json(item))['left']['source_sha256'],
                         sha256(b'').hexdigest())
        self.assertIsNone(json.loads(render_comparison_json(item))['right']['source_sha256'])

    def test_positional_pairing_keeps_surplus_rows_numbered(self):
        item = report(side('one\ntwo\nthree\n'), side('new\n'),
                      (ComparisonBlock('change', 0, 3, 0, 1),), (0, 3, 1))
        doc = Document(render_comparison_html(item))
        self.assertEqual(doc.sources, ['one', 'new', 'two', 'three'])
        self.assertEqual([x for x in doc.ids if x.startswith('left-L')],
                         ['left-L1', 'left-L2', 'left-L3'])
        self.assertEqual([x for x in doc.ids if x.startswith('right-L')], ['right-L1'])

    def test_direct_forged_alignment_hash_and_mutable_fields_reject(self):
        valid = report()
        malformed = [
            replace(valid, schema_version=True),
            replace(valid, left=replace(valid.left, source_sha256='0' * 64)),
            replace(valid, blocks=[ComparisonBlock('equal', 0, 1, 0, 1)]),
            replace(valid, blocks=(ComparisonBlock('change', 0, 1, 0, 1),),
                    unchanged_lines=0, removed_lines=1, added_lines=1),
            replace(valid, added_lines=True),
            replace(valid, right=replace(valid.right, source='different\n')),
        ]
        for bad in malformed:
            for renderer in (render_comparison_json, render_comparison_html):
                with self.subTest(bad=bad, renderer=renderer.__name__), self.assertRaises(ValueError):
                    renderer(bad)

    def test_both_renderers_invoke_public_validator(self):
        for renderer in (render_comparison_json, render_comparison_html):
            with patch('git_history.comparison_render.validate_comparison',
                       side_effect=ValueError('canonical admission')) as validator:
                with self.assertRaisesRegex(ValueError, 'canonical admission'):
                    renderer(report())
                validator.assert_called_once()

    def test_utf8_output_limit_inclusive_and_atomic(self):
        item = report(side('é\n'), side('é\n'))
        for renderer in (render_comparison_json, render_comparison_html):
            text = renderer(item)
            byte_count = len(text.encode('utf-8'))
            with patch('git_history.comparison_render.MAX_REPORT_BYTES', byte_count):
                self.assertEqual(renderer(item), text)
            with patch('git_history.comparison_render.MAX_REPORT_BYTES', byte_count - 1):
                with self.assertRaisesRegex(ValueError, 'report|Report|MiB'):
                    renderer(item)

    def test_cancellation_during_last_html_row_prevents_return(self):
        cancel = threading.Event()
        original = comparison_render._cell
        calls = 0

        def cancelling_cell(*args):
            nonlocal calls
            result = original(*args)
            calls += 1
            if calls == 2:
                cancel.set()
            return result

        with work_budget(cancel=cancel), patch('git_history.comparison_render._cell',
                                               side_effect=cancelling_cell):
            with self.assertRaises(WorkCancelled):
                render_comparison_html(report())
        self.assertEqual(calls, 2)

    def test_two_hundred_lines_and_one_sided_numbered_alignment(self):
        source = ''.join(f'line {number}\n' for number in range(200))
        item = report(side(source), side(missing=True),
                      (ComparisonBlock('change', 0, 200, 0, 0),), (0, 200, 0))
        doc = Document(render_comparison_html(item))
        self.assertEqual(len(doc.sources), 200)
        self.assertIn('left-L200', doc.ids)
        self.assertFalse(any(name.startswith('right-L') for name in doc.ids))
        self.assertEqual(json.loads(render_comparison_json(item))['removed_lines'], 200)

    def test_cancelled_budget_propagates_without_partial_result(self):
        cancel = threading.Event()
        cancel.set()
        with work_budget(cancel=cancel):
            for renderer in (render_comparison_json, render_comparison_html):
                with self.assertRaises(WorkCancelled):
                    renderer(report())


if __name__ == '__main__':
    unittest.main()
