"""Literal committed changes through CLI and authenticated single-pump HTTP."""
import hashlib
import http.client
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import patch

from git_history.workbench import create_server
from .helpers import Repository

APP = Path(__file__).resolve().parents[1]


def blob_id(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


class ChangedFilesIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.literal_path = 'src/literal\tline\nΩ[?].txt'
        self.old = b'original\n'
        self.new = b'replacement\n'
        self.repo.write(self.literal_path, self.old)
        self.repo.write('src/deleted.py', b'gone\n')
        self.repo.write('src-extra/kept.py', b'outside old\n')
        self.left = self.repo.commit('Original left tree')
        self.repo.write(self.literal_path, self.new)
        (self.repo.path / 'src/deleted.py').unlink()
        self.repo.write('src/empty.py', b'')
        self.repo.write('src-extra/kept.py', b'outside new\n')
        self.right = self.repo.commit('Original right tree')
        self.server = create_server(self.repo.path)
        self.thread = threading.Thread(target=self.server.serve_forever,
                                       kwargs={'poll_interval': .01})
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
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def args(self, **changes):
        return {'left_ref': self.left, 'right_ref': self.right, 'directory': 'src', **changes}

    def submit(self, args=None):
        status, reply = self.request('/api/jobs', {'operation': 'changed-files',
                                                   'args': self.args() if args is None else args})
        self.assertEqual(status, 202, reply)
        return reply['id']

    def result(self, identifier):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            status, value = self.request('/api/result', {'id': identifier})
            self.assertEqual(status, 200)
            if value['state'] != 'pending':
                return value
            time.sleep(.005)
        self.fail('Changed-file job did not reach a joined terminal state.')

    def cli(self, *options):
        return subprocess.run([sys.executable, '-m', 'git_history', 'changes', '--repo',
                               str(self.repo.path), '--left-ref', self.left, '--right-ref',
                               self.right, '--directory', 'src', *options], cwd=APP,
                              capture_output=True, text=True, timeout=10)

    def expected_entries(self):
        def endpoint(data):
            return {'kind': 'regular', 'mode': '100644', 'object_id': blob_id(data)}
        return [
            {'path': 'src/deleted.py', 'change': 'deleted', 'left': endpoint(b'gone\n'),
             'right': None, 'addressable': True},
            {'path': 'src/empty.py', 'change': 'added', 'left': None,
             'right': endpoint(b''), 'addressable': True},
            {'path': self.literal_path, 'change': 'modified', 'left': endpoint(self.old),
             'right': endpoint(self.new), 'addressable': True},
        ]

    def test_cli_json_and_real_http_match_literal_graph_and_preserve_dirty_repository(self):
        self.repo.write(self.literal_path, b'uncommitted replacement\n')
        before = self.repo.git('status', '--porcelain=v1', '-z')
        cli = self.cli('--format', 'json')
        self.assertEqual(cli.returncode, 0, cli.stderr)
        value = json.loads(cli.stdout)
        reply = self.result(self.submit())
        self.assertEqual(reply['state'], 'complete', reply)
        self.assertEqual(reply['result'], value)
        self.assertEqual(set(value), {'schema_version', 'kind', 'repo_name', 'left_requested_ref',
                                     'left_revision', 'right_requested_ref', 'right_revision',
                                     'directory', 'entries', 'omitted_non_utf8_paths'})
        self.assertEqual((value['schema_version'], value['kind'], value['directory']),
                         (1, 'changed-file-catalog', 'src'))
        self.assertEqual(value['entries'], self.expected_entries())
        self.assertEqual((value['left_revision'], value['right_revision']), (self.left, self.right))
        self.assertEqual(value['omitted_non_utf8_paths'], 0)
        self.assertEqual(cli.stdout, json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n')
        self.assertNotIn(self.server.token, cli.stdout)
        self.assertNotIn(str(self.repo.path), cli.stdout)
        self.assertEqual(self.repo.git('status', '--porcelain=v1', '-z'), before)
        self.assertEqual((self.repo.path / self.literal_path).read_bytes(), b'uncommitted replacement\n')

    def test_cli_text_quotes_control_paths_and_reports_both_complete_pins(self):
        cli = self.cli()
        self.assertEqual(cli.returncode, 0, cli.stderr)
        self.assertIn(self.left, cli.stdout)
        self.assertIn(self.right, cli.stdout)
        self.assertIn(json.dumps(self.literal_path), cli.stdout)
        self.assertNotIn(self.literal_path, cli.stdout)
        for kind in ('added', 'deleted', 'modified'):
            self.assertIn(kind, cli.stdout)
        self.assertIn('100644', cli.stdout)

    def test_cli_same_tree_is_successful_empty_catalog_and_rejects_output_flags(self):
        result = self.cli('--right-ref', self.left, '--format', 'json')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['entries'], [])
        target = self.repo.path / 'not-created.json'
        result = self.cli('--output', str(target))
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, '')
        self.assertFalse(target.exists())

    def test_exact_argument_admission_preserves_previous_result(self):
        job = self.submit()
        completed = self.result(job)
        self.assertEqual(completed['state'], 'complete', completed)
        bad = [None, [], {}, {'left_ref': self.left, 'right_ref': self.right},
               {**self.args(), 'repo': '/other'}, {**self.args(), 'output': '/other'},
               {**self.args(), 'flags': ['--ext-diff']}]
        for field, maximum in [('left_ref', 1024), ('right_ref', 1024), ('directory', 4096)]:
            for value in [False, 7, [], None, '\ud800', '\0', 'x' * (maximum + 1),
                          '🌓' * (maximum // 4 + 1)]:
                bad.append(self.args(**{field: value}))
        bad.extend([self.args(left_ref=''), self.args(right_ref='')])
        for args in bad:
            with self.subTest(argument_type=type(args).__name__):
                self.assertEqual(self.request('/api/jobs', {'operation': 'changed-files',
                                                            'args': args})[0], 400)
        self.assertEqual(self.result(job), completed)

    def test_exact_utf8_field_boundaries_are_not_clipped_before_kernel(self):
        from git_history.reader import ReaderError
        args = self.args(left_ref='🌓' * 256, right_ref='r' * 1024, directory='d' * 4096)
        with patch('git_history.changed_files.list_changed_files',
                   side_effect=ReaderError('Original boundary receipt.')) as kernel:
            reply = self.result(self.submit(args))
        self.assertEqual(reply['state'], 'error')
        self.assertEqual(reply['error'], 'Original boundary receipt.')
        kernel.assert_called_once_with(self.server.repo, args['left_ref'], args['right_ref'],
                                       directory=args['directory'])

    def test_static_module_uses_existing_exact_allowlist_and_safe_mime(self):
        for path, status in [('/changed-files.js', 200), ('/changed-files.js?x=1', 404),
                             ('/../changed-files.js', 404), ('/changed-files.py', 404)]:
            connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
            try:
                connection.request('GET', path)
                response = connection.getresponse()
                self.assertEqual(response.status, status)
                body = response.read()
                if status == 200:
                    self.assertEqual(response.getheader('Content-Type'), 'text/javascript; charset=utf-8')
                    self.assertEqual(body, (APP / 'git_history/web/changed-files.js').read_bytes())
                    self.assertIn("script-src 'self'", response.getheader('Content-Security-Policy'))
                    self.assertNotIn(self.server.token.encode(), body)
            finally:
                connection.close()

    def test_cli_bad_ref_never_publishes_partial_catalog(self):
        result = self.cli('--left-ref', 'missing-original-ref', '--format', 'json')
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, '')
        self.assertNotIn('Traceback', result.stderr)

    def test_authentication_precedes_changed_file_execution(self):
        value = {'operation': 'changed-files', 'args': self.args()}
        for headers in [{'Origin': 'https://foreign.invalid'}, {'X-Git-History-Token': '0' * 64},
                        {'Host': f'localhost:{self.server.server_port}'},
                        {'Sec-Fetch-Site': 'cross-site'}]:
            self.assertEqual(self.request('/api/jobs', value, headers)[0], 403)
        self.assertIsNone(self.server.active_thread)

    def test_selected_changes_handoff_uses_existing_independent_comparison(self):
        catalog = self.result(self.submit())
        self.assertEqual(catalog['state'], 'complete', catalog)
        value = {'operation': 'comparison', 'args': {
            'left': {'revision': catalog['result']['left_revision'], 'path': self.literal_path,
                     'selection': {'kind': 'whole'}},
            'right': {'revision': catalog['result']['right_revision'], 'path': self.literal_path,
                      'selection': {'kind': 'whole'}}}}
        status, job = self.request('/api/jobs', value)
        self.assertEqual(status, 202, job)
        result = self.result(job['id'])
        self.assertEqual(result['state'], 'complete', result)
        comparison = json.loads(result['result']['json'])
        self.assertEqual(comparison['left']['source'], self.old.decode())
        self.assertEqual(comparison['right']['source'], self.new.decode())
        self.assertEqual((comparison['removed_lines'], comparison['added_lines']), (1, 1))

    def test_one_catalog_is_rendered_once_and_unknown_errors_are_private(self):
        from git_history.changed_files import list_changed_files, render_changed_files_json
        captured = []

        def catalog(*args, **kwargs):
            value = list_changed_files(*args, **kwargs)
            captured.append(value)
            return value

        def render(value):
            self.assertIs(value, captured[0])
            return render_changed_files_json(value)

        with patch('git_history.changed_files.list_changed_files', side_effect=catalog), \
                patch('git_history.changed_files.render_changed_files_json', side_effect=render) as output:
            reply = self.result(self.submit())
        self.assertEqual(reply['state'], 'complete', reply)
        self.assertEqual(len(captured), 1)
        self.assertEqual(output.call_count, 1)
        with patch('git_history.changed_files.list_changed_files',
                   side_effect=RuntimeError('private diagnostic sentinel')):
            reply = self.result(self.submit())
        self.assertEqual(reply['state'], 'error')
        self.assertNotIn('private diagnostic sentinel', json.dumps(reply))
        self.assertNotIn('result', reply)

    def test_reader_failure_is_actionable_but_git_diagnostic_is_not(self):
        from git_history.reader import ReaderError
        from git_history.runner import GitError
        for error, visible in [(ReaderError('Narrow the changed-file directory.'), True),
                               (GitError('private raw Git sentinel'), False)]:
            with patch('git_history.changed_files.list_changed_files', side_effect=error):
                reply = self.result(self.submit())
            self.assertEqual(reply['state'], 'error')
            self.assertNotIn('result', reply)
            if visible:
                self.assertEqual(reply['error'], str(error))
            else:
                self.assertNotIn(str(error), json.dumps(reply))

    def test_cancel_join_keeps_single_job_and_never_serializes_old_catalog(self):
        from git_history.runner import _run_bounded
        marker = self.repo.path / 'owned-child.pid'

        def delayed(*_args, **_kwargs):
            code = ('import os,time;from pathlib import Path;'
                    f'Path({str(marker)!r}).write_text(str(os.getpid()));time.sleep(30)')
            return _run_bounded([sys.executable, '-c', code], cwd=self.repo.path,
                                env=os.environ.copy(), timeout=10, max_bytes=1024)

        with patch('git_history.changed_files.list_changed_files', side_effect=delayed), \
                patch('git_history.changed_files.render_changed_files_json') as render:
            job = self.submit()
            deadline = time.monotonic() + 2
            while not marker.exists() and time.monotonic() < deadline:
                time.sleep(.005)
            self.assertTrue(marker.exists())
            pid = int(marker.read_text())
            self.assertEqual(self.request('/api/jobs', {'operation': 'changed-files',
                                                       'args': self.args()})[0], 409)
            self.assertEqual(self.request('/api/cancel', {'id': job})[0], 200)
            self.assertEqual(self.result(job)['state'], 'cancelled')
            render.assert_not_called()
        self.assertFalse(self.server.active_thread.is_alive())
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)
        self.assertEqual(self.result(self.submit())['state'], 'complete')

    def test_aggregate_deadline_stops_child_and_does_not_publish(self):
        from git_history.runner import _run_bounded
        self.server.job_timeout = .15
        marker = self.repo.path / 'deadline-child.pid'

        def delayed(*_args, **_kwargs):
            code = ('import os,time;from pathlib import Path;'
                    f'Path({str(marker)!r}).write_text(str(os.getpid()));time.sleep(30)')
            return _run_bounded([sys.executable, '-c', code], cwd=self.repo.path,
                                env=os.environ.copy(), timeout=10, max_bytes=1024)

        with patch('git_history.changed_files.list_changed_files', side_effect=delayed):
            reply = self.result(self.submit())
        self.assertEqual(reply['state'], 'error')
        self.assertIn('time budget', reply['error'])
        self.assertNotIn('result', reply)
        self.assertTrue(marker.exists())
        with self.assertRaises(ProcessLookupError):
            os.kill(int(marker.read_text()), 0)
