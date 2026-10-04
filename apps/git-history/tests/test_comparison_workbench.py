"""Comparison requests over real authenticated HTTP and immutable Git fixtures."""
import hashlib
import http.client
import json
import os
import sys
import threading
import time
import unittest
from unittest.mock import patch

from git_history.workbench import create_server
from .helpers import Repository


class ComparisonWorkbenchTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.left_path, self.right_path = 'src/old\tname.py', 'src/new name.py'
        self.left_source = 'def alpha():\n    return 1\n# literal <script>not code</script>\n'
        self.right_source = 'def beta():\n    return 2\n# literal <script>not code</script>\n'
        self.repo.write(self.left_path, self.left_source)
        self.repo.write('many.txt', ''.join(f'line {number}\n' for number in range(201)))
        self.left = self.repo.commit('Before selected rename')
        self.repo.git('mv', self.left_path, self.right_path)
        self.repo.write(self.right_path, self.right_source)
        self.repo.write('empty.txt', '')
        self.right = self.repo.commit('After selected rename')
        self.server = create_server(self.repo.path)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .01})
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.assertFalse(self.thread.is_alive())
        self.repo.close()

    def request(self, route, value, overrides=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        headers = {'Origin': self.server.origin, 'X-Git-History-Token': self.server.token,
                   'Content-Type': 'application/json; charset=utf-8'}
        headers.update(overrides or {})
        try:
            connection.request('POST', route, json.dumps(value).encode(), headers)
            response = connection.getresponse()
            return response.status, json.loads(response.read()), dict(response.getheaders())
        finally:
            connection.close()

    def args(self, left_selection=None, right_selection=None):
        return {'left': {'revision': self.left, 'path': self.left_path,
                         'selection': left_selection or {'kind': 'whole'}},
                'right': {'revision': self.right, 'path': self.right_path,
                          'selection': right_selection or {'kind': 'whole'}}}

    def submit(self, args):
        status, value, _ = self.request('/api/jobs', {'operation': 'comparison', 'args': args})
        self.assertEqual(status, 202, value)
        return value['id']

    def result(self, identifier):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            status, value, _ = self.request('/api/result', {'id': identifier})
            self.assertEqual(status, 200)
            if value['state'] != 'pending':
                return value
            time.sleep(.005)
        self.fail('Comparison did not reach a joined terminal state.')

    def test_real_comparison_has_exact_independent_pins_sources_hashes_and_portable_outputs(self):
        self.repo.write(self.right_path, 'def replacement():\n    return 999\n')
        self.repo.commit('Advance branch after both pins')
        self.repo.write(self.left_path, 'UNCOMMITTED AND WRONG')
        reply = self.result(self.submit(self.args()))
        self.assertEqual(reply['state'], 'complete', reply)
        self.assertEqual(set(reply['result']), {'html', 'json'})
        report = json.loads(reply['result']['json'])
        self.assertEqual((report['schema_version'], report['kind']), (1, 'source-comparison'))
        self.assertEqual((report['unchanged_lines'], report['removed_lines'], report['added_lines']), (1, 2, 2))
        for side, revision, path, source in [('left', self.left, self.left_path, self.left_source),
                                              ('right', self.right, self.right_path, self.right_source)]:
            value = report[side]
            self.assertEqual((value['revision'], value['requested_ref'], value['path']), (revision, revision, path))
            self.assertEqual(value['source'], source)
            self.assertEqual(value['source_sha256'], hashlib.sha256(source.encode()).hexdigest())
            self.assertEqual((value['start_line'], value['end_line']), (1, 3))
            self.assertIn(revision, reply['result']['html'])
        self.assertNotIn('<script>not code</script>', reply['result']['html'])
        self.assertIn('&lt;script&gt;', reply['result']['html'])
        self.assertNotIn(self.server.token, json.dumps(reply))
        self.assertNotIn(str(self.repo.path), json.dumps(reply))

    def test_function_and_manual_selections_are_independent_with_original_line_provenance(self):
        args = self.args({'kind': 'function', 'function': 'alpha'}, {'kind': 'lines', 'start': 2, 'end': 3})
        reply = self.result(self.submit(args))
        self.assertEqual(reply['state'], 'complete', reply)
        report = json.loads(reply['result']['json'])
        self.assertEqual(report['left']['selected_function'], 'alpha')
        self.assertEqual((report['left']['start_line'], report['left']['end_line']), (1, 2))
        self.assertEqual(report['left']['source'], 'def alpha():\n    return 1\n')
        self.assertEqual(report['right']['source'], '    return 2\n# literal <script>not code</script>\n')
        self.assertEqual((report['right']['start_line'], report['right']['end_line']), (2, 3))

    def test_explicit_missing_and_present_empty_remain_distinct(self):
        args = self.args({'kind': 'missing'})
        args['left']['path'] = args['right']['path'] = 'empty.txt'
        reply = self.result(self.submit(args))
        self.assertEqual(reply['state'], 'complete', reply)
        report = json.loads(reply['result']['json'])
        self.assertEqual(report['left']['status'], 'missing')
        self.assertIsNone(report['left']['source_sha256'])
        self.assertEqual(report['right']['status'], 'present')
        self.assertEqual(report['right']['source_sha256'], hashlib.sha256(b'').hexdigest())
        self.assertEqual(report['blocks'], [])
        for side in ('left', 'right'):
            self.assertEqual(report[side]['source'], '')
            self.assertIsNone(report[side]['start_line'])
            self.assertIsNone(report[side]['end_line'])
        args['right']['selection'] = {'kind': 'missing'}
        failure = self.result(self.submit(args))
        self.assertEqual(failure['state'], 'error')
        self.assertNotIn('result', failure)

    def test_exact_wire_admission_preserves_completed_result_on_bad_fields_types_and_limits(self):
        completed = self.submit(self.args())
        before = self.result(completed)
        self.assertEqual(before['state'], 'complete', before)
        bad = []
        for side in ('left', 'right'):
            for field, value in [('revision', 'HEAD'), ('revision', self.left[:12]),
                                 ('revision', 'A' * 40), ('revision', True), ('revision', '0' * 41),
                                 ('path', ''), ('path', False), ('path', '\0source.py'),
                                 ('path', 'x' * 4097), ('path', '\ud800')]:
                args = self.args()
                args[side][field] = value
                bad.append(args)
            for selection in [None, [], True, {}, {'start': 1, 'end': 2},
                              {'kind': 'whole', 'start': 1}, {'kind': 'missing', 'function': 'alpha'},
                              {'kind': 'lines', 'start': True, 'end': 2},
                              {'kind': 'lines', 'start': 1, 'end': 2.0},
                              {'kind': 'lines', 'start': 0, 'end': 2},
                              {'kind': 'lines', 'start': 2, 'end': 1},
                              {'kind': 'lines', 'start': 1, 'end': 201},
                              {'kind': 'lines', 'start': 1, 'end': 2, 'function': 'alpha'},
                              {'kind': 'function', 'function': ''},
                              {'kind': 'function', 'function': 'x' * 8193},
                              {'kind': 'function', 'function': False}, {'kind': 'unknown'},
                              {'kind': 'whole', 'context': 'untrusted'}]:
                args = self.args()
                args[side]['selection'] = selection
                bad.append(args)
            args = self.args()
            args[side]['repo'] = '/arbitrary/repository'
            bad.append(args)
        for args in [None, [], {'left': self.args()['left']},
                     {**self.args(), 'context': None}, {**self.args(), 'max_commits': 20}, *bad]:
            with self.subTest(args=args):
                status, value, headers = self.request('/api/jobs', {'operation': 'comparison', 'args': args})
                self.assertEqual(status, 400, value)
                self.assertIn('no-store', headers['Cache-Control'])
        self.assertEqual(self.result(completed), before)

    def test_comparison_retains_exact_origin_and_capability_authentication(self):
        request = {'operation': 'comparison', 'args': self.args()}
        for overrides in [{'Origin': 'http://example.invalid'}, {'X-Git-History-Token': '0' * 64},
                          {'Host': f'localhost:{self.server.server_port}'}, {'Sec-Fetch-Site': 'cross-site'}]:
            self.assertEqual(self.request('/api/jobs', request, overrides)[0], 403)
        self.assertIsNone(self.server.active_thread)

    def test_200_line_range_is_complete_but_whole_201_rejects_without_partial_result(self):
        args = self.args({'kind': 'lines', 'start': 1, 'end': 200}, {'kind': 'lines', 'start': 1, 'end': 200})
        args['left']['path'] = args['right']['path'] = 'many.txt'
        reply = self.result(self.submit(args))
        self.assertEqual(reply['state'], 'complete', reply)
        report = json.loads(reply['result']['json'])
        self.assertEqual((report['unchanged_lines'], report['removed_lines'], report['added_lines']), (200, 0, 0))
        self.assertEqual(report['left']['source'], ''.join(f'line {number}\n' for number in range(200)))
        args['left']['selection'] = {'kind': 'whole'}
        failure = self.result(self.submit(args))
        self.assertEqual(failure['state'], 'error')
        self.assertIn('200', failure['error'])
        self.assertNotIn('result', failure)

    def test_both_renderers_receive_the_same_single_immutable_report(self):
        from git_history.comparison import compare_repository
        from git_history.comparison_render import render_comparison_html, render_comparison_json
        captured = []

        def compare(*args, **kwargs):
            report = compare_repository(*args, **kwargs)
            captured.append(report)
            return report

        def render_html(report):
            self.assertIs(report, captured[0])
            return render_comparison_html(report)

        def render_json(report):
            self.assertIs(report, captured[0])
            return render_comparison_json(report)

        with patch('git_history.comparison.compare_repository', side_effect=compare), \
                patch('git_history.comparison_render.render_comparison_html', side_effect=render_html), \
                patch('git_history.comparison_render.render_comparison_json', side_effect=render_json):
            reply = self.result(self.submit(self.args()))
        self.assertEqual(reply['state'], 'complete', reply)
        self.assertEqual(len(captured), 1)
        self.assertEqual(reply['result']['html'], render_comparison_html(captured[0]))
        self.assertEqual(reply['result']['json'], render_comparison_json(captured[0]))

    def test_cancellation_joins_real_child_before_replacement_and_does_not_render(self):
        marker = self.repo.path / 'comparison-child.pid'
        from git_history.runner import _run_bounded

        def controlled_comparison(*_args):
            code = ('import os,time;from pathlib import Path;'
                    f'Path({str(marker)!r}).write_text(str(os.getpid()));time.sleep(30)')
            return _run_bounded([sys.executable, '-c', code], cwd=self.repo.path,
                                env=os.environ.copy(), timeout=10, max_bytes=1024)

        with patch('git_history.comparison.compare_repository', side_effect=controlled_comparison), \
                patch('git_history.comparison_render.render_comparison_html') as render:
            job = self.submit(self.args())
            deadline = time.monotonic() + 2
            while not marker.exists() and time.monotonic() < deadline:
                time.sleep(.005)
            self.assertTrue(marker.exists(), 'Actual child must start before cancellation.')
            pid = int(marker.read_text())
            status, _, _ = self.request('/api/jobs', {'operation': 'comparison', 'args': self.args()})
            self.assertEqual(status, 409)
            status, cancellation, _ = self.request('/api/cancel', {'id': job})
            self.assertEqual(status, 200)
            self.assertIn(cancellation['state'], ('cancelling', 'cancelled'))
            self.assertEqual(self.result(job)['state'], 'cancelled')
            render.assert_not_called()
        self.assertFalse(self.server.active_thread.is_alive())
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)
        self.assertEqual(self.result(self.submit(self.args()))['state'], 'complete')

    def test_aggregate_deadline_remains_fatal_and_reaps_comparison_child(self):
        self.server.job_timeout = .5
        marker = self.repo.path / 'comparison-deadline.pid'
        from git_history.runner import _run_bounded

        def controlled_comparison(*_args):
            code = ('import os,time;from pathlib import Path;'
                    f'Path({str(marker)!r}).write_text(str(os.getpid()));time.sleep(30)')
            return _run_bounded([sys.executable, '-c', code], cwd=self.repo.path,
                                env=os.environ.copy(), timeout=10, max_bytes=1024)

        with patch('git_history.comparison.compare_repository', side_effect=controlled_comparison):
            reply = self.result(self.submit(self.args()))
        self.assertEqual(reply['state'], 'error')
        self.assertIn('time budget', reply['error'])
        self.assertNotIn('result', reply)
        self.assertTrue(marker.exists())
        with self.assertRaises(ProcessLookupError):
            os.kill(int(marker.read_text()), 0)

    def test_combined_native_output_budget_is_shared_across_comparison_reads(self):
        from git_history.runner import _run_bounded

        def controlled_comparison(*_args):
            for _ in range(2):
                _run_bounded([sys.executable, '-c', 'import sys;sys.stdout.buffer.write(b"x"*(17*1024*1024))'],
                             cwd=self.repo.path, env=os.environ.copy(), timeout=10, max_bytes=20*1024*1024)
            self.fail('Two17MiB subprocesses must exceed the shared32MiB job budget.')

        with patch('git_history.comparison.compare_repository', side_effect=controlled_comparison):
            reply = self.result(self.submit(self.args()))
        self.assertEqual(reply['state'], 'error')
        self.assertIn('aggregate output limit', reply['error'])
        self.assertNotIn('result', reply)

    def test_reply_overflow_or_render_failure_never_publishes_partial_html(self):
        # A reduced service cap exercises the real encoder, without allocating32MiB.
        with patch('git_history.workbench.MAX_RESPONSE_BYTES', 1024):
            reply = self.result(self.submit(self.args()))
        self.assertEqual(reply['state'], 'error')
        self.assertIn('32 MiB', reply['error'])
        self.assertNotIn('result', reply)
        with patch('git_history.comparison_render.render_comparison_json',
                   side_effect=ValueError('Comparison output exceeds its8MiB limit.')):
            reply = self.result(self.submit(self.args()))
        self.assertEqual(reply['state'], 'error')
        self.assertIn('8MiB', reply['error'])
        self.assertNotIn('result', reply)

    def test_reader_guidance_is_preserved_but_raw_git_and_unknown_errors_are_generic(self):
        args = self.args()
        args['left']['path'] = 'not-there.py'
        failure = self.result(self.submit(args))
        self.assertEqual(failure['state'], 'error')
        self.assertRegex(failure['error'], 'Missing|missing|absent|exist')
        from git_history.runner import GitError
        for exception in [GitError('PRIVATE diagnostic and source'), RuntimeError('PRIVATE native message')]:
            with patch('git_history.comparison.compare_repository', side_effect=exception):
                reply = self.result(self.submit(self.args()))
            self.assertEqual(reply['state'], 'error')
            self.assertNotIn('PRIVATE', reply['error'])
            self.assertNotIn('result', reply)
