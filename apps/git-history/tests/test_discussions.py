"""Opt-in GitHub pull-request discussion retrieval, end to end through the real CLI and Git."""
from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
import re
import unittest
from unittest.mock import patch

from git_history.cli import main
from git_history.discussions import DiscussionError, GitHubClient, github_repository
from tests.fake_github import FakeGitHub
from tests.helpers import Repository


class DiscussionRetrievalTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.addCleanup(self.repo.close)
        self.repo.write('src/app.py', 'def total(items):\n    return sum(items)\n')
        self.first = self.repo.commit('Add totals')
        self.repo.write('src/app.py', 'def total(items):\n    # Ignore missing prices.\n    return sum(item or 0 for item in items)\n')
        self.second = self.repo.commit('Skip missing prices in totals')
        self.repo.write('README.md', 'Docs\n')
        self.repo.commit('Unrelated docs')
        self.repo.git('remote', 'add', 'origin', 'https://github.com/acme/widgets.git')
        self.fake = FakeGitHub().__enter__()
        self.addCleanup(self.fake.__exit__)

    def run_cli(self, *args, env=None):
        out, err = io.StringIO(), io.StringIO()
        with patch.dict(os.environ, env or {}, clear=False), redirect_stdout(out), redirect_stderr(err):
            if env is None:
                os.environ.pop('GITHUB_TOKEN', None)
            code = main(['explain', '--repo', str(self.repo.path), '--file', 'src/app.py', '--lines', '1:3', *args])
        return code, out.getvalue(), err.getvalue()

    def fetch(self, *args, env=None):
        code, out, err = self.run_cli('--fetch-discussions', '--github-api', self.fake.url, '--format', 'json', *args, env=env)
        self.assertEqual(code, 0, err)
        return json.loads(out)

    def populate(self):
        fake = self.fake
        fake.pull(12, 'Treat missing prices as zero', 'Checkout crashed when a price was missing.\n\nFixes #7. Missing prices count as zero.')
        fake.commit_pulls[self.second] = [12]
        fake.comments[12] = [
            fake.review_comment(12, 501, 'src/app.py', 'Should None really count as zero rather than failing?'),
            fake.review_comment(12, 502, 'docs/other.py', 'Comment on a different file.'),
        ]
        fake.reviews[12] = [fake.review(12, 601, 'Zero matches how invoices already treat it.', 'APPROVED'),
                            fake.review(12, 602, '', 'APPROVED')]
        fake.conversation[12] = [fake.comment(12, 701, 'Merging for the release.')]
        fake.issue(7, 'Checkout crashes on missing price', 'TypeError: unsupported operand for None.')

    def test_without_the_flag_nothing_is_contacted_and_the_report_shape_is_unchanged(self):
        self.populate()
        code, out, _ = self.run_cli('--format', 'json')
        self.assertEqual(code, 0)
        report = json.loads(out)
        self.assertNotIn('retrieved_discussions', report)
        self.assertNotIn('discussions', report['synopsis'])
        self.assertIn('were not fetched', report['synopsis']['intent_note'])
        self.assertEqual(self.fake.requests, [])

    def test_pull_request_description_file_reviews_conversation_and_closed_issue_are_retrieved(self):
        self.populate()
        report = self.fetch()
        retrieved = report['retrieved_discussions']
        self.assertEqual((retrieved['provider'], retrieved['repository']), ('github', 'acme/widgets'))
        self.assertEqual(retrieved['commits_checked'], [self.second, self.first])
        self.assertEqual(retrieved['commits_without_pulls'], [self.first])
        [pull] = retrieved['pulls']
        self.assertEqual((pull['number'], pull['title'], pull['author'], pull['merged_at']),
                         (12, 'Treat missing prices as zero', 'octo', '2026-01-02T03:04:05Z'))
        self.assertEqual(pull['commits'], [self.second])
        self.assertIn('Fixes #7', pull['description'])
        # Review comments on other files and empty approvals are not quoted.
        self.assertEqual([(c['kind'], c['excerpt']) for c in pull['comments']], [
            ('file-review-comment', 'Should None really count as zero rather than failing?'),
            ('review', 'Zero matches how invoices already treat it.'),
            ('conversation', 'Merging for the release.')])
        self.assertEqual((pull['comments'][0]['path'], pull['comments'][0]['line']), ('src/app.py', 3))
        self.assertEqual([(i['number'], i['title']) for i in pull['linked_issues']], [(7, 'Checkout crashes on missing price')])
        summary = report['synopsis']['discussions'][0]
        self.assertEqual(summary['description_excerpt'], 'Checkout crashed when a price was missing.')
        self.assertEqual((summary['file_comment_count'], summary['evidence_anchor']), (1, 'pull-12'))
        self.assertIn('quoted participant statements', report['synopsis']['intent_note'])
        self.assertTrue(any('looked up for 2 report commits' in note for note in report['synopsis']['completeness_notes']))
        # Documented API headers; no credential unless one is supplied.
        headers = {key.lower(): value for key, value in self.fake.requests[0][1].items()}
        self.assertEqual((headers['accept'], headers['x-github-api-version']), ('application/vnd.github+json', '2022-11-28'))
        self.assertNotIn('authorization', headers)
        # The completeness notes no longer claim discussions were not fetched.
        self.assertFalse(any('not fetched' in note for note in report['synopsis']['completeness_notes']))
        self.assertTrue(any('retrieved from GitHub for report commits' in note for note in report['warnings']))

    def test_a_token_is_sent_but_never_written_and_html_links_the_evidence(self):
        self.populate()
        self.fake.pulls[12]['body'] += '\n<script>alert(1)</script>'
        code, html, err = self.run_cli('--fetch-discussions', '--github-api', self.fake.url, env={'GITHUB_TOKEN': 'ghp_secretvalue123'})
        self.assertEqual(code, 0, err)
        self.assertTrue(all({k.lower(): v for k, v in headers.items()}.get('authorization') == 'Bearer ghp_secretvalue123'
                            for _, headers in self.fake.requests))
        self.assertNotIn('ghp_secretvalue123', html)
        self.assertNotIn('<script>alert(1)', html)
        self.assertIn('&lt;script&gt;', html)
        self.assertIn('<section id="discussions">', html)
        self.assertIn('href="https://github.com/acme/widgets/pull/12"', html)
        self.assertIn('href="https://github.com/acme/widgets/pull/12#discussion_r501"', html)
        self.assertIn('<a href="#pull-12">Pull request #12</a>', html)
        self.assertIn(f'href="#commit-{self.second}"', html)
        self.assertIn('Closes issue #7: Checkout crashes on missing price', html)
        self.assertIn('GitHub was contacted only to retrieve', html)
        self.assertNotIn('have not been fetched', html)
        self.assertRegex(html, re.compile(r'<span>05</span><h2>Retrieved pull-request discussion</h2>'))
        self.assertRegex(html, re.compile(r'<span>06</span><h2>Evidence & limits</h2>'))
        self.assertNotIn('not fetched', html)

    def test_unexpected_links_and_records_are_dropped_and_counted(self):
        self.populate()
        foreign = self.fake.comment(12, 702, 'Planted link')
        foreign['html_url'] = 'https://evil.example/acme/widgets/pull/12#issuecomment-702'
        self.fake.conversation[12].append(foreign)
        self.fake.conversation[12].append({'body': 'missing fields'})
        self.fake.pulls[13] = {**self.fake.pulls[12], 'number': 13, 'html_url': 'https://github.com/other/repo/pull/13'}
        self.fake.commit_pulls[self.first] = [13]
        pull = self.fetch()['retrieved_discussions']
        self.assertEqual([p['number'] for p in pull['pulls']], [12])
        self.assertNotIn('Planted link', json.dumps(pull))
        self.assertIn('3 malformed or unexpected GitHub records were skipped.', pull['notes'])

    def test_rate_limits_and_refusals_keep_earlier_results_with_an_explanation(self):
        self.populate()
        self.fake.failures.append((f'/commits/{self.first}', 403, {'X-RateLimit-Remaining': '0'}))
        retrieved = self.fetch()['retrieved_discussions']
        self.assertEqual(retrieved['commits_checked'], [self.second])
        self.assertEqual([p['number'] for p in retrieved['pulls']], [12])
        self.assertTrue(any('rate limit' in note for note in retrieved['notes']))
        self.fake.failures.append(('/commits/', 401, {}))
        retrieved = self.fetch()['retrieved_discussions']
        self.assertEqual((retrieved['commits_checked'], retrieved['pulls']), ([], []))
        self.assertTrue(any('refused access (401)' in note and 'GITHUB_TOKEN' in note for note in retrieved['notes']))

    def test_long_text_and_many_comments_are_bounded(self):
        self.populate()
        self.fake.pulls[12]['body'] = 'x' * 5000
        self.fake.conversation[12] = [self.fake.comment(12, 800 + i, f'Comment {i}') for i in range(40)]
        pull = self.fetch()['retrieved_discussions']['pulls'][0]
        self.assertEqual((len(pull['description']), pull['description_truncated']), (4000, True))
        self.assertEqual(len(pull['comments']), 30)
        self.assertEqual(pull['omitted_comments'], 12)

    def test_only_github_origins_and_safe_api_addresses_are_accepted(self):
        self.repo.git('remote', 'set-url', 'origin', 'https://gitlab.com/acme/widgets.git')
        code, _, err = self.run_cli('--fetch-discussions', '--github-api', self.fake.url)
        self.assertEqual(code, 2)
        self.assertIn('needs a github.com origin', err)
        self.assertEqual(self.fake.requests, [])
        with self.assertRaises(DiscussionError):
            GitHubClient('acme', 'widgets', api_url='https://evil.example')
        with self.assertRaises(DiscussionError):
            GitHubClient('acme', 'widgets', api_url='http://localhost:9')
        self.assertEqual(github_repository('https://github.com/acme/widgets'), ('acme', 'widgets'))
        with self.assertRaises(DiscussionError):
            github_repository('https://github.com/acme/..')


class WorkbenchOptionTests(unittest.TestCase):
    def test_discussion_retrieval_is_an_optional_boolean_report_field(self):
        from git_history.workbench import _job_args
        base = {'revision': 'a' * 40, 'path': 'src/app.py', 'selection': {'start': 1, 'end': 2}, 'max_commits': 20, 'context': None}
        self.assertNotIn('discussions', _job_args({'operation': 'report', 'args': base})[1])
        self.assertIs(_job_args({'operation': 'report', 'args': {**base, 'discussions': True}})[1]['discussions'], True)
        for bad in ('yes', 1, None):
            with self.assertRaises(ValueError):
                _job_args({'operation': 'report', 'args': {**base, 'discussions': bad}})
        with self.assertRaises(ValueError):
            _job_args({'operation': 'source', 'args': {'revision': 'a' * 40, 'path': 'x', 'discussions': True}})


if __name__ == '__main__':
    unittest.main()
