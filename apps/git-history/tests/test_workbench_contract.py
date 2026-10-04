"""Independent wire-level workbench acceptance against real HTTP and Git.

Controlled job fixtures are explicitly labeled; they launch real bounded children
through the production subprocess supervisor, not mocked cancellation results.
"""
from __future__ import annotations

import http.client
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from tests.helpers import Repository

APP = Path(__file__).resolve().parents[1]


class WorkbenchContractTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.addCleanup(self.repo.close)
        self.repo.write('app.py', 'def answer():\n    return 1\n')
        self.old_revision = self.repo.commit('Original answer')
        self.repo.write('app.py', 'def answer():\n    return 2\n')
        self.revision = self.repo.commit('Changed answer')
        self.server = None
        self.thread = None
        self.addCleanup(self.stop_server)

    def start_server(self, **limits):
        from git_history.workbench import create_server
        self.server = create_server(self.repo.path, **limits)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]
        self.host = f'127.0.0.1:{self.port}'
        return self.server

    def stop_server(self):
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()
            self.thread.join(5)
            self.assertFalse(self.thread.is_alive(), 'HTTP accept loop survived shutdown')
            self.server = None

    def request(self, path, value=None, *, method='POST', overrides=None):
        body = None if method == 'GET' else json.dumps({} if value is None else value).encode()
        headers = {'Host': self.host, 'Origin': f'http://{self.host}',
                   'X-Git-History-Token': self.server.token,
                   'Content-Type': 'application/json; charset=utf-8'}
        for key, value in (overrides or {}).items():
            if value is None:
                headers.pop(key, None)
            else:
                headers[key] = value
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def raw(self, headers, body=b'', target='/api/session', method='POST'):
        payload = (f'{method} {target} HTTP/1.1\r\n' + '\r\n'.join(headers)
                   + '\r\n\r\n').encode('ascii') + body
        with socket.create_connection(('127.0.0.1', self.port), timeout=5) as sock:
            sock.sendall(payload)
            response = http.client.HTTPResponse(sock)
            response.begin()
            return response.status, dict(response.getheaders()), response.read()

    def base_headers(self):
        return [f'Host: {self.host}', f'Origin: http://{self.host}',
                f'X-Git-History-Token: {self.server.token}',
                'Content-Type: application/json', 'Content-Length: 2']

    def submit(self, operation, args):
        status, _, raw = self.request('/api/jobs', {'operation': operation, 'args': args})
        self.assertEqual(status, 202, raw)
        return json.loads(raw)['id']

    def result(self, identifier, *, timeout=10):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            status, _, raw = self.request('/api/result', {'id': identifier})
            self.assertEqual(status, 200, raw)
            value = json.loads(raw)
            if value['state'] != 'pending':
                return value
            time.sleep(.02)
        self.fail('Job did not reach a terminal state within the test deadline')

    def files_args(self):
        return {'ref': 'HEAD', 'directory': '', 'language': 'all'}

    def assert_error(self, response, statuses=(400, 401, 403, 404, 405, 413, 415)):
        status, headers, raw = response
        low = {key.lower(): value for key, value in headers.items()}
        self.assertIn('no-store', low.get('cache-control', ''))
        self.assertEqual(low.get('x-content-type-options'), 'nosniff')
        self.assertEqual(low.get('referrer-policy'), 'no-referrer')
        self.assertIn('content-security-policy', low)
        self.assertIn(status, statuses, raw)
        value = json.loads(raw)
        self.assertEqual(set(value), {'error'})
        self.assertIsInstance(value['error'], str)
        self.assertNotIn(self.server.token.encode(), raw)
        self.assertNotIn(b'Traceback', raw)

    def test_session_and_static_routes_have_no_credential_or_cache_leaks(self):
        server = self.start_server()
        self.assertEqual(server.server_address[0], '127.0.0.1')
        self.assertRegex(server.token, r'\A[0-9a-f]{64}\Z')
        self.assertEqual(server.url, server.origin + '/#session=' + server.token)
        for target, method in [('/api/session', 'POST'), ('/', 'GET'),
                               ('/workbench.js', 'GET'), ('/workbench.css', 'GET')]:
            with self.subTest(target=target):
                status, headers, raw = self.request(target, method=method)
                self.assertEqual(status, 200, raw[:200])
                low = {key.lower(): value for key, value in headers.items()}
                self.assertIn('no-store', low.get('cache-control', ''))
                self.assertEqual(low.get('x-content-type-options'), 'nosniff')
                self.assertEqual(low.get('referrer-policy'), 'no-referrer')
                self.assertIn('content-security-policy', low)
                self.assertNotIn('set-cookie', low)
                self.assertNotIn('access-control-allow-origin', low)
                self.assertNotIn(server.token.encode(), raw)
        value = json.loads(self.request('/api/session')[2])
        self.assertEqual(value, {'repo_name': self.repo.path.name})

    def test_authentication_host_origin_and_fetch_metadata_fail_closed(self):
        self.start_server()
        cases = [{'Host': 'localhost:' + str(self.port)}, {'Host': 'attacker.invalid'},
                 {'Origin': None}, {'Origin': 'null'}, {'Origin': 'https://' + self.host},
                 {'Origin': 'http://attacker.invalid'}, {'X-Git-History-Token': None},
                 {'X-Git-History-Token': '0' * 64}, {'Sec-Fetch-Site': 'cross-site'}]
        for overrides in cases:
            with self.subTest(overrides=overrides):
                self.assert_error(self.request('/api/session', overrides=overrides))
        self.assert_error(self.request('/', method='GET', overrides={'Host': 'localhost:' + str(self.port)}))
        self.assert_error(self.request('/api/session', method='GET'))
        self.assert_error(self.request('/api/session?token=' + self.server.token))
        self.assert_error(self.request('/../../app.py', method='GET'))
        self.assert_error(self.request('/app.py', method='GET'))

    def test_duplicate_and_conflicting_headers_or_missing_framing_are_rejected(self):
        self.start_server()
        base = self.base_headers()
        variants = [base + ['Content-Length: 2'], base + ['Content-Length: 3'],
                    base + ['Transfer-Encoding: chunked'], base + [f'Host: {self.host}'],
                    base + [f'Origin: http://{self.host}'],
                    base + [f'X-Git-History-Token: {self.server.token}'],
                    base + ['Content-Type: application/json'], base[1:], base[:-1],
                    base[:-1] + ['Content-Length: -1'], base[:-1] + ['Content-Length: 2097153']]
        for headers in variants:
            with self.subTest(last=headers[-1]):
                self.assert_error(self.raw(headers, b'{}'))

    def test_json_and_operation_schema_reject_unsafe_scalar_shapes_without_starting_work(self):
        self.start_server()
        for body in [b'{"x":1,"x":2}', b'{"x":NaN}', b'[]', b'null', b'"text"', b'\xff']:
            headers = self.base_headers()[:-1] + [f'Content-Length: {len(body)}']
            self.assert_error(self.raw(headers, body))
        self.assert_error(self.request('/api/session', {'extra': True}))
        self.assert_error(self.request('/api/session', overrides={'Content-Type': 'text/plain'}))
        for payload in [
            {'operation': 'files', 'args': {**self.files_args(), 'repo': '/etc'}},
            {'operation': 'read_file', 'args': {'path': '/etc/passwd'}},
            {'operation': 'source', 'args': {'revision': 'HEAD', 'path': 'app.py'}},
            {'operation': 'source', 'args': {'revision': self.revision + '\n', 'path': 'app.py'}},
            {'operation': 'report', 'args': {'revision': self.revision, 'path': 'app.py',
                'selection': {'start': True, 'end': 2}, 'max_commits': 20, 'context': None}},
            {'operation': 'report', 'args': {'revision': self.revision, 'path': 'app.py',
                'selection': {'start': 1, 'end': 201}, 'max_commits': 20, 'context': None}},
            {'operation': 'report', 'args': {'revision': self.revision, 'path': 'app.py',
                'selection': {'start': 1, 'end': 2, 'function': 'answer'}, 'max_commits': 20, 'context': None}},
            {'operation': 'report', 'args': {'revision': self.revision, 'path': 'app.py',
                'selection': {'start': 1, 'end': 2}, 'max_commits': 20, 'context': 'x' * (256 * 1024 + 1)}},
        ]:
            self.assert_error(self.request('/api/jobs', payload))
        result = self.result(self.submit('files', self.files_args()))
        self.assertEqual(result['state'], 'complete', result)

    def test_full_revision_source_is_immutable_and_counts_only_physical_lf(self):
        self.repo.write('odd\tname.txt', b'\xef\xbb\xbfx\r\nsecond\xe2\x80\xa8same-line\n')
        revision = self.repo.commit('Physical source')
        self.start_server()
        catalog = self.result(self.submit('files', self.files_args()))['result']
        self.assertEqual(catalog['revision'], revision)
        self.repo.write('odd\tname.txt', 'Moved branch\n')
        self.repo.commit('Move branch after discovery')
        identifier = self.submit('source', {'revision': revision, 'path': 'odd\tname.txt'})
        result = self.result(identifier)
        self.assertEqual(result['state'], 'complete', result)
        self.assertEqual(result['result']['source'], '\ufeffx\r\nsecond\u2028same-line\n')
        self.assertEqual(result['result']['line_count'], 2)
        self.assertEqual(result['result']['revision'], revision)
        self.assertEqual(self.result(identifier), result, 'Reading must not consume completed evidence')
        self.assertEqual(json.loads(self.request('/api/cancel', {'id': identifier})[2])['state'], 'complete')
        newer = self.submit('functions', {'revision': revision, 'path': 'app.py'})
        self.assertEqual(self.result(newer)['state'], 'complete')
        self.assert_error(self.request('/api/result', {'id': identifier}), (404,))

    def test_fixed_repository_does_not_offer_arbitrary_files_or_symlink_targets(self):
        self.repo.write('secret.txt', 'PRIVATE_WORKTREE_SENTINEL')
        os.symlink('/etc/passwd', self.repo.path / 'link.py')
        revision = self.repo.commit('Committed symlink')
        self.repo.write('uncommitted.txt', 'PRIVATE_WORKTREE_SENTINEL')
        self.start_server()
        for path in ['../secret.txt', '/etc/passwd', 'link.py', 'uncommitted.txt', '.git/config']:
            response = self.request('/api/jobs', {'operation': 'source', 'args': {'revision': revision, 'path': path}})
            if response[0] == 202:
                result = self.result(json.loads(response[2])['id'])
                self.assertEqual(result['state'], 'error', result)
                self.assertNotIn('PRIVATE_WORKTREE_SENTINEL', json.dumps(result))
            else:
                self.assert_error(response)

    def test_real_http_report_matches_independently_invoked_cli_bytes_with_context(self):
        self.start_server()
        context = {'schema_version': 1, 'entries': [{'commit': self.revision,
            'source': 'Original supplied context', 'url': 'https://github.com/example/repo/pull/7',
            'author': '<literal author>', 'excerpt': 'Unverified <script>literal</script> explanation.'}]}
        args = {'revision': self.revision, 'path': 'app.py', 'selection': {'start': 1, 'end': 2},
                'max_commits': 20, 'context': json.dumps(context)}
        result = self.result(self.submit('report', args))
        self.assertEqual(result['state'], 'complete', result)
        with tempfile.TemporaryDirectory() as directory:
            context_file = Path(directory) / 'context.json'
            context_file.write_text(json.dumps(context))
            for format_name in ['html', 'json']:
                cli = subprocess.run([sys.executable, '-m', 'git_history', 'explain', '--repo', str(self.repo.path),
                    '--ref', self.revision, '--file', 'app.py', '--lines', '1:2', '--max-commits', '20',
                    '--context', str(context_file), '--format', format_name], cwd=APP, capture_output=True, timeout=15)
                self.assertEqual(cli.returncode, 0, cli.stderr)
                self.assertEqual(result['result'][format_name].encode('utf-8'), cli.stdout)
        self.assertNotIn('<script>literal</script>', result['result']['html'])

    def test_authentication_precedes_a_large_incomplete_body(self):
        self.start_server(request_timeout=1)
        headers = [f'Host: {self.host}', f'Origin: http://{self.host}',
                   'X-Git-History-Token: wrong', 'Content-Type: application/json',
                   'Content-Length: 2097152']
        started = time.monotonic()
        response = self.raw(headers)
        self.assert_error(response)
        self.assertLess(time.monotonic() - started, .7, 'Unauthenticated body was read before rejection')

    def test_absolute_header_and_body_deadlines_defeat_continuous_trickle(self):
        self.start_server(request_timeout=.6)
        for phase in ['headers', 'body']:
            with self.subTest(phase=phase), socket.create_connection(('127.0.0.1', self.port), timeout=2) as sock:
                sock.settimeout(.04)
                prefix = f'POST /api/session HTTP/1.1\r\nHost: {self.host}\r\n'
                if phase == 'headers':
                    prefix += 'X-Slow: '
                else:
                    prefix = 'POST /api/session HTTP/1.1\r\n' + '\r\n'.join(
                        self.base_headers()[:-1] + ['Content-Length: 1000']) + '\r\n\r\n{'
                started = time.monotonic()
                sock.sendall(prefix.encode())
                stopped = False
                while time.monotonic() - started < 1.5:
                    try:
                        sock.sendall(b' ')
                        data = sock.recv(1)
                        if data == b'' or data:
                            stopped = True
                            break
                    except socket.timeout:
                        continue
                    except (BrokenPipeError, ConnectionResetError):
                        stopped = True
                        break
                self.assertTrue(stopped, 'Continuous activity bypassed the absolute request deadline')
                self.assertLess(time.monotonic() - started, 1.2)
        self.assertEqual(self.request('/api/session')[0], 200)

    def test_eight_slow_handlers_do_not_create_an_unbounded_waiting_queue(self):
        self.start_server(request_timeout=2)
        sockets = []
        try:
            for expected_handlers in range(1, 9):
                sock = socket.create_connection(('127.0.0.1', self.port), timeout=1)
                sock.sendall(b'GET / HTTP/1.1\r\n')
                sockets.append(sock)
                # Synchronize setup with admission: eight simultaneous TCP
                # connects can overflow HTTPServer's listen backlog (five)
                # before its accept loop runs on a busy matrix-test machine.
                # This observes readiness only; the ninth real HTTP request
                # below still independently verifies refusal and its deadline.
                ready_by = time.monotonic() + 1
                admitted = 0
                while time.monotonic() < ready_by:
                    with self.server._lock:
                        admitted = len(self.server._handlers)
                    if admitted == expected_handlers:
                        break
                    time.sleep(.005)
                self.assertEqual(admitted, expected_handlers, 'Slow handler was not admitted during setup')
            started = time.monotonic()
            with socket.create_connection(('127.0.0.1', self.port), timeout=.5) as excess:
                excess.settimeout(.5)
                excess.sendall(f'GET / HTTP/1.1\r\nHost: {self.host}\r\n\r\n'.encode())
                try:
                    response = excess.recv(4096)
                except ConnectionResetError:
                    response = b''
                self.assertTrue(not response or b'503' in response or b'429' in response, response[:100])
            self.assertLess(time.monotonic() - started, .7)
        finally:
            for sock in sockets:
                sock.close()

    @unittest.skipUnless(sys.platform.startswith('linux'), 'Descendant liveness uses Linux proc state')
    def test_cancel_and_shutdown_reap_real_children_even_after_both_output_pipes_close(self):
        from git_history import workbench
        from git_history.runner import _run_bounded
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'children.txt'
            script = (
                'import os,subprocess,sys,time;from pathlib import Path;'
                'child=subprocess.Popen([sys.executable,"-c","import time;time.sleep(20)"],'
                'stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);'
                f'Path({str(marker)!r}).write_text(str(os.getpid())+" "+str(child.pid));'
                'os.close(1);os.close(2);time.sleep(20)'
            )
            def controlled_job(_repo, _operation, _args):
                _run_bounded([sys.executable, '-I', '-c', script], cwd=directory,
                             env=os.environ, timeout=20, max_bytes=1024)
                return {'unexpected': 'completed sleeping child'}

            with patch.object(workbench, '_execute_operation', side_effect=controlled_job):
                self.start_server()
                for action in ['cancel', 'shutdown']:
                    marker.unlink(missing_ok=True)
                    identifier = self.submit('files', self.files_args())
                    end = time.monotonic() + 3
                    pids = []
                    while time.monotonic() < end:
                        if marker.exists():
                            pids = [int(value) for value in marker.read_text().split()]
                            if len(pids) == 2:
                                break
                        time.sleep(.01)
                    self.assertEqual(len(pids), 2, 'Real child did not publish both process IDs')
                    self.assert_error(self.request('/api/jobs', {'operation': 'files', 'args': self.files_args()}), (409,))
                    started = time.monotonic()
                    if action == 'cancel':
                        self.assertEqual(self.request('/api/cancel', {'id': identifier})[0], 200)
                        result = self.result(identifier, timeout=3)
                        self.assertEqual(result['state'], 'cancelled', result)
                    else:
                        self.stop_server()
                    self.assertLess(time.monotonic() - started, 2)
                    for pid in pids:
                        end = time.monotonic() + 1
                        while time.monotonic() < end:
                            stat = Path(f'/proc/{pid}/stat')
                            if not stat.exists() or stat.read_text().split(') ', 1)[1][0] == 'Z':
                                break
                            time.sleep(.01)
                        else:
                            self.fail(f'Child {pid} remained active after {action}')

    def test_aggregate_output_budget_counts_multiple_individually_valid_subprocesses(self):
        from git_history import workbench
        from git_history.runner import _run_bounded
        completed_calls = []
        def controlled_job(_repo, _operation, _args):
            for index in range(2):
                _run_bounded([sys.executable, '-I', '-c', 'import sys;sys.stdout.buffer.write(b"x"*(17*1024*1024))'],
                             cwd=self.repo.path, env=os.environ, timeout=5, max_bytes=20 * 1024 * 1024)
                completed_calls.append(index)
            return {'unexpected': 'accepted34MiB'}
        with patch.object(workbench, '_execute_operation', side_effect=controlled_job):
            self.start_server()
            result = self.result(self.submit('files', self.files_args()))
            self.assertEqual(result['state'], 'error', result)
            self.assertEqual(completed_calls, [0], 'Aggregate budget must fail before returning the second output')
            self.assertNotIn('result', result)
        self.assertEqual(self.result(self.submit('files', self.files_args()))['state'], 'complete')

    def test_operation_deadline_does_not_publish_success_after_a_child_wait(self):
        from git_history import workbench
        from git_history.runner import _run_bounded
        def controlled_job(_repo, _operation, _args):
            _run_bounded([sys.executable, '-I', '-c', 'import os,time;os.close(1);os.close(2);time.sleep(10)'],
                         cwd=self.repo.path, env=os.environ, timeout=10, max_bytes=1024)
            return {'unexpected': 'completed after deadline'}
        with patch.object(workbench, '_execute_operation', side_effect=controlled_job):
            self.start_server(job_timeout=.25)
            started = time.monotonic()
            result = self.result(self.submit('files', self.files_args()), timeout=3)
            self.assertEqual(result['state'], 'error', result)
            self.assertNotIn('result', result)
            self.assertLess(time.monotonic() - started, 2)
        self.assertEqual(self.request('/api/session')[0], 200)

    def test_python_catalog_uses_a_real_isolated_child_without_executing_source(self):
        from git_history import function_parser
        with tempfile.TemporaryDirectory() as directory:
            sentinel = Path(directory) / 'must-not-execute'
            self.repo.write('safe.py', f'from pathlib import Path\nPath({str(sentinel)!r}).write_text("BAD")\ndef exact():\n    return 3\n')
            revision = self.repo.commit('Python is syntax only')
            self.start_server()
            launched = []
            original = subprocess.Popen
            def record_process(argv, **kwargs):
                process = original(argv, **kwargs)
                if str(argv[0]) == sys.executable:
                    launched.append((list(argv), process))
                return process
            # Parent parsing is forbidden in this assertion; the real isolated
            # interpreter has no monkeypatch and must perform the syntax parse.
            with patch.object(function_parser.ast, 'parse', side_effect=AssertionError('Parent AST parsing forbidden')):
                with patch.object(subprocess, 'Popen', side_effect=record_process):
                    result = self.result(self.submit('functions', {'revision': revision, 'path': 'safe.py'}))
            self.assertEqual(result['state'], 'complete', result)
            self.assertEqual(result['result']['functions'], [{'qualified_name': 'exact', 'start_line': 3, 'end_line': 4, 'kind': 'function'}])
            self.assertFalse(sentinel.exists())
            self.assertTrue(launched, 'Python parsing did not launch an isolated interpreter')
            for command, process in launched:
                self.assertIn('-I', command)
                self.assertIsNotNone(process.returncode, 'Parser child was not reaped')

    def test_python_resource_heavy_source_keeps_manual_source_and_session_available(self):
        self.repo.write('wide.py', 'x\n' * (512 * 1024 // 2))
        revision = self.repo.commit('Wide AST within committed source bound')
        self.start_server()
        result = self.result(self.submit('functions', {'revision': revision, 'path': 'wide.py'}), timeout=8)
        # Some supported Python allocators can parse this inside512MiB; others
        # legitimately hit the isolated limit. Either must leave the service alive.
        self.assertIn(result['state'], ['complete', 'error'], result)
        if result['state'] == 'complete':
            self.assertEqual(result['result']['functions'], [])
        else:
            self.assertNotIn('result', result)
            self.assertNotIn('Traceback', result['error'])
        source = self.result(self.submit('source', {'revision': revision, 'path': 'wide.py'}))
        self.assertEqual(source['state'], 'complete', source)
        self.assertEqual(source['result']['line_count'], 262144)
        self.assertEqual(self.request('/api/session')[0], 200)

    def test_response_budget_counts_json_escaping_and_does_not_publish_oversized_result(self):
        from git_history import workbench
        # A bounded6MiB result field becomes36MiB once JSON control escaping is
        # applied; checking only Python string length would incorrectly accept it.
        with patch.object(workbench, '_execute_operation', return_value={'html': '\x01' * (6 * 1024 * 1024), 'json': '{}'}):
            self.start_server()
            result = self.result(self.submit('report', {'revision': self.revision, 'path': 'app.py',
                'selection': {'start': 1, 'end': 2}, 'max_commits': 20, 'context': None}))
            self.assertEqual(result['state'], 'error', result.get('state'))
            self.assertNotIn('result', result)
            self.assertLess(len(json.dumps(result)), 4096)
        self.assertEqual(self.request('/api/session')[0], 200)

    def test_unexpected_worker_exception_does_not_expose_private_diagnostics(self):
        from git_history import workbench
        with patch.object(workbench, '_execute_operation', side_effect=RuntimeError('PRIVATE_SOURCE_SENTINEL')):
            self.start_server()
            result = self.result(self.submit('files', self.files_args()))
            self.assertEqual(result['state'], 'error', result)
            self.assertNotIn('PRIVATE_SOURCE_SENTINEL', json.dumps(result))
            self.assertNotIn(self.server.token, json.dumps(result))


    @unittest.skipIf(all(importlib.util.find_spec(name) for name in
                        ('tree_sitter', 'tree_sitter_javascript', 'tree_sitter_typescript')),
                     'Optional parser absence is exercised in the core-only environment')
    def test_missing_optional_parser_leaves_manual_source_and_report_working(self):
        self.repo.write('example.js', 'function exact() { return 1; }\n')
        revision = self.repo.commit('Optional language source')
        self.start_server()
        catalog = self.result(self.submit('functions', {'revision': revision, 'path': 'example.js'}))
        self.assertEqual(catalog['state'], 'error', catalog)
        self.assertIn('javascript', catalog['error'].lower())
        source = self.result(self.submit('source', {'revision': revision, 'path': 'example.js'}))
        self.assertEqual(source['state'], 'complete', source)
        report = self.result(self.submit('report', {'revision': revision, 'path': 'example.js',
            'selection': {'start': 1, 'end': 1}, 'max_commits': 20, 'context': None}))
        self.assertEqual(report['state'], 'complete', report)
