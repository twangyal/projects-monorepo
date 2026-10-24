import unittest
from tests import test_discussions as fixtures


class IssueCommentTests(unittest.TestCase):
    setUp = fixtures.DiscussionRetrievalTests.setUp
    run_cli = fixtures.DiscussionRetrievalTests.run_cli
    fetch = fixtures.DiscussionRetrievalTests.fetch

    def direct(self):
        self.repo.write('src/app.py', 'def total(items):\n    # progress\n    return 2\n')
        self.repo.commit('Change totals (#7)')
        self.fake.issue(7, 'Progress <script>', 'Original task')

    def comment(self, number, identity, text):
        return dict(self.fake.comment(number, identity, text),
                    html_url=f'https://github.com/acme/widgets/issues/{number}#issuecomment-{identity}',
                    issue_url=f'https://api.github.com/repos/acme/widgets/issues/{number}')

    def test_recent_page_is_quoted_safely_in_json_and_html(self):
        self.direct()
        self.fake.issues[7]['comments'] = 14
        self.fake.conversation[7] = [self.comment(7, i, 'x' * 4100 if i == 14 else f'Progress {i} <b>literal</b>') for i in range(1, 15)]
        self.run_cli('--format', 'json')
        self.assertEqual(self.fake.requests, [])
        issue = self.fetch()['retrieved_discussions']['referenced_issues'][0]
        self.assertEqual([c['url'].split('-')[-1] for c in issue['comments']], ['11', '12', '13', '14'])
        self.assertEqual(issue['omitted_comments_estimate'], 10)
        self.assertEqual((len(issue['comments'][-1]['excerpt']), issue['comments'][-1]['truncated']), (4000, True))
        self.assertIn('page 2', issue['comment_note'])
        self.assertTrue(any(path.endswith('/issues/7/comments?per_page=10&page=2') for path, _ in self.fake.requests))
        code, html, err = self.run_cli('--fetch-discussions', '--github-api', self.fake.url)
        self.assertEqual(code, 0, err)
        self.assertIn('Progress 11 &lt;b&gt;literal&lt;/b&gt;', html)
        self.assertNotIn('Progress 11 <b>', html)
        self.assertIn('Recent quoted issue comments', html)
        self.assertIn('issuecomment-14', html)

    def test_foreign_mismatched_and_empty_records_do_not_become_evidence(self):
        self.direct()
        self.fake.issues[7]['comments'] = 5
        self.fake.conversation[7] = [self.comment(7, 1, 'Valid claim'), self.comment(8, 2, 'Foreign'),
            dict(self.comment(7, 3, 'Wrong ID'), id=99),
            dict(self.comment(7, 4, 'Wrong issue'), issue_url='https://api.github.com/repos/other/repo/issues/7'), self.comment(7, 5, '')]
        data = self.fetch()['retrieved_discussions']
        self.assertEqual([c['excerpt'] for c in data['referenced_issues'][0]['comments']], ['Valid claim'])
        self.assertEqual(data['referenced_issues'][0]['omitted_comments_estimate'], 4)
        self.assertTrue(any('malformed' in n for n in data['notes']))

    def test_zero_missing_or_invalid_count_skips_comment_network(self):
        self.direct()
        for count in [0, None, -1, True, '12']:
            with self.subTest(count=count):
                self.fake.requests.clear()
                self.fake.issues[7]['comments'] = count
                issue = self.fetch()['retrieved_discussions']['referenced_issues'][0]
                self.assertEqual(issue['excerpt'], 'Original task')
                self.assertEqual(issue['comments'], [])
                self.assertTrue(issue['comment_note'])
                self.assertFalse(any('/issues/7/comments' in path for path, _ in self.fake.requests))

    def test_comment_rate_limit_retains_issue_description(self):
        self.direct()
        self.fake.issues[7]['comments'] = 1
        self.fake.failures = [('/issues/7/comments', 429, {})]
        data = self.fetch()['retrieved_discussions']
        self.assertEqual(data['referenced_issues'][0]['excerpt'], 'Original task')
        self.assertEqual(data['referenced_issues'][0]['comments'], [])
        self.assertIn('did not complete', data['referenced_issues'][0]['comment_note'])
        self.assertTrue(any('rate limit' in n for n in data['notes']))

    def test_concurrent_additions_label_omission_as_estimate_not_exact_count(self):
        self.direct()
        self.fake.issues[7]['comments'] = 14
        self.fake.conversation[7] = [self.comment(7, i, f'Comment {i}') for i in range(1, 21)]
        issue = self.fetch()['retrieved_discussions']['referenced_issues'][0]
        self.assertNotIn('omitted_comments', issue)
        self.assertEqual(issue['comment_count_at_lookup'], 14)
        self.assertEqual(len(issue['comments']), 10)
        self.assertEqual(issue['omitted_comments_estimate'], 4)
        self.assertIn('estimate', issue['comment_note'])
