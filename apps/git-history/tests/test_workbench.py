"""Real loopback jobs and bounded request/lifetime behavior."""
import http.client
import json
import os
from pathlib import Path
import select
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from git_history.workbench import create_server
from git_history.work_budget import check_work_budget
from .helpers import Repository


class WorkbenchTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.repo.write('source.py', '@decorator\ndef original():\n    return 1\n')
        self.revision = self.repo.commit()
        self.server = create_server(self.repo.path, request_timeout=.4)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.repo.close()

    def request(self, path, value, headers=None, method='POST'):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        body = json.dumps(value).encode()
        complete = {'Origin': self.server.origin, 'X-Git-History-Token': self.server.token,
                    'Content-Type': 'application/json; charset=utf-8'}
        complete.update(headers or {})
        connection.request(method, path, body if method == 'POST' else None, complete)
        response = connection.getresponse()
        raw = response.read()
        status = response.status
        reply_headers = dict(response.getheaders())
        connection.close()
        return status, json.loads(raw), reply_headers

    def wait_result(self, job):
        for _ in range(200):
            status, value, _ = self.request('/api/result', {'id': job})
            self.assertEqual(status, 200)
            if value['state'] != 'pending':
                return value
            time.sleep(.01)
        self.fail('Job did not finish.')

    def submit(self, operation, args):
        status, value, _ = self.request('/api/jobs', {'operation': operation, 'args': args})
        self.assertEqual(status, 202, value)
        return value['id']

    def test_session_auth_exact_origin_host_and_security_headers(self):
        status, value, headers = self.request('/api/session', {})
        self.assertEqual(status, 200)
        self.assertEqual(value, {'repo_name': self.repo.path.name})
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(headers['Referrer-Policy'], 'no-referrer')
        self.assertEqual(headers['Connection'], 'close')
        for overrides in [{'Origin': 'https://example.invalid'}, {'Host': f'localhost:{self.server.server_port}'},
                          {'X-Git-History-Token': 'wrong'}, {'Sec-Fetch-Site': 'cross-site'}]:
            self.assertEqual(self.request('/api/session', {}, overrides)[0], 403)

    def test_real_files_source_functions_report_and_expired_job(self):
        files = self.wait_result(self.submit('files', {'ref': 'HEAD', 'directory': '', 'language': 'all'}))
        self.assertEqual(files['state'], 'complete')
        self.assertEqual(files['result']['revision'], self.revision)
        source_id = self.submit('source', {'revision': self.revision, 'path': 'source.py'})
        self.assertEqual(self.request('/api/result', {'id': files['id']})[0], 404)
        source = self.wait_result(source_id)['result']
        self.assertEqual(source['line_count'], 3)
        self.assertTrue(source['source'].endswith('return 1\n'))
        functions = self.wait_result(self.submit('functions', {'revision': self.revision, 'path': 'source.py'}))
        self.assertEqual(functions['result']['functions'][0]['qualified_name'], 'original')
        report = self.wait_result(self.submit('report', {'revision': self.revision, 'path': 'source.py',
            'selection': {'function': 'original'}, 'max_commits': 20, 'context': None}))
        self.assertEqual(report['state'], 'complete', report)
        self.assertIn('original', report['result']['html'])
        self.assertEqual(json.loads(report['result']['json'])['revision'], self.revision)
        self.assertEqual(self.request('/api/cancel', {'id': report['id']})[1]['state'], 'complete')

    def test_exact_schema_and_revision_requirements_preserve_completed_result(self):
        completed = self.submit('files', {'ref': 'HEAD', 'directory': '', 'language': 'python'})
        self.wait_result(completed)
        bad = [
            {'operation': 'files', 'args': {'ref': 'HEAD', 'directory': '', 'language': 'all', 'repo': '/elsewhere'}},
            {'operation': 'source', 'args': {'revision': 'HEAD', 'path': 'source.py'}},
            {'operation': 'report', 'args': {'revision': self.revision, 'path': 'source.py',
              'selection': {'start': True, 'end': 2}, 'max_commits': 20, 'context': None}},
            {'operation': 'report', 'args': {'revision': self.revision, 'path': 'source.py',
              'selection': {'start': 1, 'end': 2}, 'max_commits': 20, 'context': '/tmp/context.json'}},
        ]
        for value in bad[:-1]:
            self.assertEqual(self.request('/api/jobs', value)[0], 400)
        self.assertEqual(self.request('/api/result', {'id': completed})[1]['state'], 'complete')
        invalid_context = self.wait_result(self.submit(**{'operation': bad[-1]['operation'], 'args': bad[-1]['args']}))
        self.assertEqual(invalid_context['state'], 'error')

    def test_one_active_job_cancel_slot_and_shutdown_join(self):
        started = threading.Event()

        def slow(_repo, _operation, _args):
            started.set()
            while True:
                check_work_budget()
                time.sleep(.01)

        with patch('git_history.workbench._execute_operation', side_effect=slow):
            job = self.submit('files', {'ref': 'HEAD', 'directory': '', 'language': 'all'})
            self.assertTrue(started.wait(1))
            self.assertEqual(self.request('/api/jobs', {'operation': 'files', 'args': {'ref': 'HEAD', 'directory': '', 'language': 'all'}})[0], 409)
            self.assertIn(self.request('/api/cancel', {'id': job})[1]['state'], ('cancelling', 'cancelled'))
            self.assertEqual(self.wait_result(job)['state'], 'cancelled')
            second = self.submit('files', {'ref': 'HEAD', 'directory': '', 'language': 'all'})
            self.server.shutdown()
            self.assertFalse(self.server.active_thread.is_alive())
            self.assertNotEqual(job, second)

    def test_absolute_deadline_stops_slow_header_drip(self):
        sock = socket.create_connection(('127.0.0.1', self.server.server_port), timeout=2)
        started = time.monotonic()
        sock.sendall(b'POST /api/session HTTP/1.1\r\n')
        for byte in b'Host: 127.0.0.1:':
            try:
                sock.sendall(bytes([byte]))
            except OSError:
                break
            time.sleep(.06)
        try:
            reply = sock.recv(4096)
        except OSError:
            reply = b''
        sock.close()
        self.assertLess(time.monotonic() - started, 1.3)
        self.assertIn(b'408', reply)

    def test_unknown_routes_and_non_post_api_are_rejected(self):
        self.assertEqual(self.request('/api/session', {}, method='GET')[0], 405)
        self.assertEqual(self.request('/arbitrary/path', {}, method='GET')[0], 404)
        self.assertEqual(self.request('/api/session?token=' + self.server.token, {})[0], 404)

    def test_non_ascii_capability_is_rejected_as_authentication_without_server_error(self):
        self.assertEqual(self.request('/api/session', {}, {'X-Git-History-Token': '\xff' * 64})[0], 403)

    def test_actionable_domain_errors_are_preserved_but_git_diagnostics_are_not(self):
        result = self.wait_result(self.submit('source', {'revision': self.revision, 'path': 'missing.py'}))
        self.assertEqual(result['state'], 'error')
        self.assertIn('does not exist', result['error'])
        invalid = json.dumps({'schema_version': 1, 'revision': '0' * 40, 'records': []})
        result = self.wait_result(self.submit('report', {'revision': self.revision, 'path': 'source.py',
            'selection': {'start': 1, 'end': 2}, 'max_commits': 20, 'context': invalid}))
        self.assertIn('Context revision', result['error'])
        from git_history.runner import GitError
        with patch('git_history.workbench._execute_operation', side_effect=GitError('private diagnostic secret')):
            result = self.wait_result(self.submit('files', {'ref': 'HEAD', 'directory': '', 'language': 'all'}))
        self.assertNotIn('private diagnostic', result['error'])

    def test_terminal_result_waits_for_thread_exit_before_releasing_busy_slot(self):
        published = threading.Event()
        finish = threading.Event()
        original = self.server._run_job

        def delayed_exit(*args):
            original(*args)
            published.set()
            finish.wait(2)

        with patch.object(self.server, '_run_job', side_effect=delayed_exit):
            job = self.submit('files', {'ref': 'HEAD', 'directory': '', 'language': 'all'})
            try:
                self.assertTrue(published.wait(1))
                self.assertEqual(self.request('/api/result', {'id': job})[1]['state'], 'pending')
                self.assertEqual(self.request('/api/cancel', {'id': job})[1]['state'], 'cancelling')
                self.assertEqual(self.request('/api/jobs', {'operation': 'files', 'args': {
                    'ref': 'HEAD', 'directory': '', 'language': 'all'}})[0], 409)
            finally:
                finish.set()
            self.assertEqual(self.wait_result(job)['state'], 'complete')
            replacement = self.submit('files', {'ref': 'HEAD', 'directory': '', 'language': 'all'})
            self.assertEqual(self.wait_result(replacement)['state'], 'complete')


@unittest.skipUnless(os.name == 'posix', 'POSIX termination and process groups')
class WorkbenchCliTests(unittest.TestCase):
    def test_sigterm_cleans_up_actual_active_git_child(self):
        repo = Repository()
        self.addCleanup(repo.close)
        repo.write('source.py', 'def original():\n    return 1\n')
        repo.commit()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            marker = root / 'child.pid'
            fake = root / 'git'
            real = shutil.which('git')
            fake.write_text(f'#!{sys.executable}\nimport os,sys,time\nfrom pathlib import Path\n'
                            f'if "ls-tree" in sys.argv:\n Path({str(marker)!r}).write_text(str(os.getpid()))\n time.sleep(30)\n'
                            f'else:\n os.execv({real!r}, [{real!r}, *sys.argv[1:]])\n')
            fake.chmod(0o755)
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'])
            process = subprocess.Popen([sys.executable, '-m', 'git_history', 'serve', '--repo', str(repo.path)],
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
            try:
                self.assertTrue(select.select([process.stdout], [], [], 5)[0])
                url = process.stdout.readline().decode().strip()
                origin, token = url.split('/#session=')
                port = int(origin.rsplit(':', 1)[1])
                connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
                connection.request('POST', '/api/jobs', json.dumps({'operation': 'files',
                    'args': {'ref': 'HEAD', 'directory': '', 'language': 'all'}}),
                    {'Origin': origin, 'X-Git-History-Token': token, 'Content-Type': 'application/json'})
                response = connection.getresponse()
                self.assertEqual(response.status, 202)
                response.read()
                connection.close()
                end = time.monotonic() + 3
                while not marker.exists() and time.monotonic() < end:
                    time.sleep(.01)
                self.assertTrue(marker.exists())
                child_pid = int(marker.read_text())
                process.send_signal(signal.SIGTERM)
                process.wait(timeout=3)
                with self.assertRaises(ProcessLookupError):
                    os.kill(child_pid, 0)
                self.assertEqual(process.returncode, 0)
                self.assertEqual(process.stderr.read(), b'')
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                if marker.exists():
                    try:
                        os.kill(int(marker.read_text()), signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                process.stdout.close()
                process.stderr.close()


if __name__ == '__main__':
    unittest.main()
