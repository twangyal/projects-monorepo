"""Supplied discussions remain bounded, unverified, and tied to existing evidence."""
import json
import os
from pathlib import Path
import tempfile
import unittest

from git_history.context import load_context
from git_history.model import ChangeEvidence, ContextEntry, LineEvidence, RenameEvidence, Report
from git_history.render import render_html, render_json
from tests.test_report import Links


def report():
    return Report('fixture', 'a' * 40, 'HEAD', 'sample.py', 1, 1, 'x\n',
                  blame=[LineEvidence(1, 1, 'b' * 40, 'sample.py', 'B', '0', 'Root', 'x')],
                  changes=[ChangeEvidence('c' * 40, 'C', 'date', 'Change', 'patch')],
                  renames=[RenameEvidence('d' * 40, 'old.py', 'sample.py', 100)])


def entry(commit='a' * 40, **changes):
    return {'commit': commit, 'source': 'Pull request #42',
            'url': 'https://github.com/owner/repository/pull/42#issuecomment-123',
            'author': 'Supplied author', 'excerpt': 'An explanation supplied by the user.', **changes}


class ContextTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'context.json'

    def load(self, entries, target=None, **root_fields):
        self.path.write_text(json.dumps({'schema_version': 1, 'entries': entries, **root_fields}), encoding='utf-8')
        return load_context(self.path, target or report())

    def test_all_existing_commit_evidence_sources_are_accepted_without_mutation(self):
        target = report()
        supplied = [entry(commit=letter * 40) for letter in 'abcd']
        result = self.load(supplied, target)
        self.assertEqual([item.commit for item in result], [letter * 40 for letter in 'abcd'])
        self.assertEqual(result[0].excerpt, supplied[0]['excerpt'])
        self.assertEqual(target, report())
        sha256 = report()
        sha256.revision = 'e' * 64
        self.assertEqual(self.load([entry(commit=sha256.revision)], sha256)[0].commit, sha256.revision)

    def test_unrelated_abbreviated_refs_and_wrong_case_ids_are_rejected_atomically(self):
        for commit in ['e' * 40, 'a' * 10, 'HEAD', 'A' * 40, 'a' * 41]:
            with self.subTest(commit=commit), self.assertRaisesRegex(ValueError, 'commit'):
                self.load([entry(), entry(commit=commit)])

    def test_strict_version_fields_types_and_limits(self):
        for changes in [{'schema_version': 2}, {'schema_version': True}, {'extra': 'unknown'}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.load([entry()], **changes)
        self.assertEqual(self.load([]), [])
        for supplied in [[entry()] * 51, 'not a list', [None], [entry(extra='unknown')]]:
            with self.subTest(kind=type(supplied)), self.assertRaises(ValueError):
                self.load(supplied)
        for field, value in [('author', ''), ('source', ' '), ('excerpt', 1),
                             ('author', 'x' * 201), ('source', 'x' * 201),
                             ('excerpt', 'x' * 4001), ('url', 'x' * 2049),
                             ('excerpt', 'private\x00value'), ('author', '\ud800')]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.load([entry(**{field: value})])
        self.assertEqual(len(self.load([entry(excerpt='x' * 4000, author='a' * 200, source='s' * 200)])), 1)

    def test_recognized_discussion_and_comment_urls(self):
        urls = [
            'https://github.com/owner/repo/pull/1',
            'https://github.com/owner/repo/pull/1#discussion_r456',
            'https://github.com/owner/repo/pull/1#pullrequestreview-456',
            'https://github.com/owner/repo/issues/2#issuecomment-789',
            'https://github.com/owner/repo/discussions/3#discussioncomment-123',
            'https://gitlab.com/group/project/-/merge_requests/4#note_123',
            'https://gitlab.com/group/subgroup/project/-/issues/5',
        ]
        for url in urls:
            with self.subTest(url=url):
                self.assertEqual(self.load([entry(url=url)])[0].url, url)

    def test_unsafe_or_nondiscussion_urls_are_rejected_without_echoing_secrets(self):
        urls = [
            'javascript:PRIVATE_SENTINEL', 'http://github.com/owner/repo/issues/1',
            'https://PRIVATE_SENTINEL@github.com/owner/repo/issues/1',
            'https://git:PRIVATE_SENTINEL@gitlab.com/group/repo/-/issues/1',
            'https://github.com:443/owner/repo/issues/1',
            'https://github.com/owner/repo/issues/1?token=PRIVATE_SENTINEL',
            'https://github.com/owner/repo/issues/1#PRIVATE_SENTINEL',
            'https://github.com.evil.invalid/owner/repo/issues/1',
            'https://github.com/owner/repo/commit/' + 'a' * 40,
            'https://gitlab.com/group/repo/-/raw/main/PRIVATE_SENTINEL',
            'https://github.com/owner/../issues/1',
            'https://github.com/owner/%72epo/issues/1',
            'https://github.com/owner/repo/issues/0',
            'https://github.com/owner/repo/issues/1\n',
            'https://github.com\\@evil.invalid/owner/repo/issues/1',
        ]
        for url in urls:
            with self.subTest(url=url), self.assertRaises(ValueError) as caught:
                self.load([entry(url=url)])
            self.assertNotIn('PRIVATE_SENTINEL', str(caught.exception))

    def test_malformed_oversized_and_nonregular_files_are_bounded(self):
        for content in [b'not json PRIVATE_SENTINEL', b'\xff',
                        b'{"schema_version":1,"schema_version":1,"entries":[]}',
                        b'{"schema_version":NaN,"entries":[]}',
                        b'[' * 2000 + b']' * 2000, b' ' * (256 * 1024 + 1)]:
            self.path.write_bytes(content)
            with self.subTest(size=len(content)), self.assertRaises(ValueError) as caught:
                load_context(self.path, report())
            self.assertNotIn('PRIVATE_SENTINEL', str(caught.exception))
        with self.assertRaises(ValueError):
            load_context(self.path.parent, report())
        self.path.unlink()
        with self.assertRaises(ValueError):
            load_context(self.path, report())
        if hasattr(os, 'mkfifo'):
            os.mkfifo(self.path)
            with self.assertRaisesRegex(ValueError, 'regular'):
                load_context(self.path, report())


class ContextRenderingTests(unittest.TestCase):
    def test_context_is_separate_unverified_and_does_not_change_git_evidence(self):
        target = report()
        entries = [ContextEntry(**entry(source='<Source>', author='<Alice>',
                                       excerpt='"Quoted" & <script>bad()</script>\nSecond line.'))]
        base = json.loads(render_json(target))
        rendered = json.loads(render_json(target, entries))
        context = rendered.pop('supplied_context')
        self.assertEqual(rendered, base)
        self.assertEqual(context['schema_version'], 1)
        self.assertIn('Unverified supplied context', context['provenance'])
        self.assertIn('have not been verified', context['provenance'])
        self.assertEqual(context['entries'][0]['excerpt'], entries[0].excerpt)
        self.assertEqual(context['entries'][0]['evidence_anchor'], 'commit-' + target.revision)
        html = render_html(target, entries)
        self.assertIn('Unverified supplied context', html)
        self.assertIn('&lt;Source&gt;', html)
        self.assertIn('&lt;Alice&gt;', html)
        self.assertIn('&lt;script&gt;bad()&lt;/script&gt;', html)
        self.assertNotIn('<script>', html)
        self.assertIn("default-src 'none'", html)
        self.assertIn('rel="noreferrer noopener"', html)

    def test_every_context_commit_links_to_one_existing_evidence_anchor(self):
        target = report()
        entries = [ContextEntry(**entry(commit=letter * 40)) for letter in 'abcda']
        parsed = Links()
        parsed.feed(render_html(target, entries))
        self.assertEqual(len(parsed.ids), len(set(parsed.ids)))
        for link in parsed.links:
            if link.startswith('#'):
                self.assertIn(link[1:], parsed.ids)
        for letter in 'abcd':
            self.assertEqual(parsed.ids.count('commit-' + letter * 40), 1)
        self.assertIn('supplied-context', parsed.ids)
        target.revision = 'b' * 40
        parsed = Links()
        parsed.feed(render_html(target, [ContextEntry(**entry(commit='b' * 40))]))
        self.assertEqual(parsed.ids.count('commit-' + 'b' * 40), 1)

    def test_omitted_context_keeps_old_report_shape_and_explicit_empty_is_clear(self):
        target = report()
        self.assertEqual(render_html(target), render_html(target, None))
        self.assertEqual(render_json(target), render_json(target, None))
        self.assertNotIn('supplied_context', json.loads(render_json(target)))
        self.assertNotIn('id="supplied-context"', render_html(target))
        self.assertEqual(json.loads(render_json(target, []))['supplied_context']['entries'], [])
        self.assertIn('No supplied excerpts', render_html(target, []))

    def test_direct_renderers_reject_unsafe_and_unrelated_entries(self):
        for changes in [{'url': 'https://SECRET_TOKEN@github.com/a/b/pull/1'},
                        {'commit': 'f' * 40}, {'excerpt': 'x' * 4001}]:
            supplied = [ContextEntry(**entry(**changes))]
            for render in [render_html, render_json]:
                with self.subTest(changes=list(changes), renderer=render.__name__), self.assertRaises(ValueError) as caught:
                    render(report(), supplied)
                self.assertNotIn('SECRET_TOKEN', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
