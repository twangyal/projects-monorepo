"""Real ephemeral TLS and room data; no persistent services or trust overrides."""

import http.client
import json
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from challenges.server import create_server
from challenges.transport import prepare_transport
from challenges import transport as limits


class HttpsServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.cert, cls.key = (Path(cls.temp.name) / name for name in ('cert.pem', 'key.pem'))
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-keyout', str(cls.key), '-out', str(cls.cert), '-days', '1',
                        '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.key.chmod(0o600)

    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        self.root = Path(self.tempdir.name)
        self.setup = self.root / 'setup'
        self.setup.write_bytes(b'a' * 64)
        self.setup.chmod(0o600)
        self.dist = self.root / 'dist'
        self.dist.mkdir()
        (self.dist / 'index.html').write_text('Original HTTPS fixture')
        self.client_context = ssl.create_default_context(cafile=str(self.cert))

    @staticmethod
    def terms():
        return dict(title='Original challenge', description='Literal description',
                    successCriteria='Proposer finishes first', evidenceRule='Record elapsed time',
                    stake='bragging-rights', deadline=1900000060000)

    def config(self, port):
        return prepare_transport(bind='127.0.0.1', port=port, origin=f'https://localhost:{port}',
                                 tls_cert=self.cert, tls_key=self.key, setup_token_file=self.setup)

    def start(self):
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        config = self.config(port)
        server = create_server(self.root / 'data', port, dist_dir=self.dist,
                               transport=config, now=lambda: 1900000000.0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def cleanup():
            server.shutdown()
            server.server_close()
            thread.join(3)
        self.addCleanup(cleanup)
        return server, config

    def request(self, server, config, method='GET', path='/api/status', body=None, headers=None):
        connection = http.client.HTTPSConnection('localhost', server.server_port,
                                                context=self.client_context, timeout=3)
        values = {'Host': config.authority, **(headers or {})}
        if body is not None:
            body = json.dumps(body).encode()
            values.setdefault('Content-Type', 'application/json')
        try:
            connection.request(method, path, body=body, headers=values)
            response = connection.getresponse()
            data, received = response.read(), dict(response.getheaders())
            return response.status, received, json.loads(data) if data else None
        finally:
            connection.close()

    def test_tls_status_origin_creation_key_and_no_cookie_authority(self):
        server, config = self.start()
        status, _, result = self.request(server, config)
        self.assertEqual(status, 200)
        self.assertEqual(result['transport'], dict(mode='https-lan', origin=config.origin, setupRequired=True))
        body = dict(name='Proposer', terms=self.terms())
        self.assertEqual(self.request(server, config, 'POST', '/api/challenges', body)[0], 403)
        allowed = {'Origin': config.origin, 'X-Friendly-Setup-Key': 'a' * 64}
        self.assertEqual(self.request(server, config, 'POST', '/api/challenges', body,
                                      {'Origin': config.origin})[0], 403)
        status, headers, room = self.request(server, config, 'POST', '/api/challenges', body, allowed)
        self.assertEqual(status, 201)
        self.assertNotIn('Set-Cookie', headers)
        self.assertNotIn('a' * 64, json.dumps(room))
        self.assertEqual(self.request(server, config, headers={'Host': f'127.0.0.1:{server.server_port}'})[0], 403)
        self.assertEqual(self.request(server, config, headers={'Forwarded': 'host=localhost'})[0], 403)

    def test_bind_failure_precedes_library_creation_and_pause(self):
        with socket.socket() as occupied:
            occupied.bind(('127.0.0.1', 0))
            occupied.listen()
            port = occupied.getsockname()[1]
            data = self.root / 'must-not-exist'
            with self.assertRaises(OSError):
                create_server(data, port, transport=self.config(port))
            self.assertFalse(data.exists())

    def test_successful_tls_response_can_restart_same_listener_port_immediately(self):
        server, config = self.start()
        self.assertEqual(self.request(server, config)[0], 200)
        server.shutdown()
        server.server_close()
        replacement = create_server(self.root / 'data', config.port, dist_dir=self.dist,
                                    transport=config, now=lambda: 1900000000.0)
        replacement.server_close()

    def test_stalled_raw_handshake_does_not_block_other_requests_or_shutdown(self):
        server, config = self.start()
        stalled = socket.create_connection(('127.0.0.1', server.server_port))
        self.addCleanup(stalled.close)
        self.assertEqual(self.request(server, config)[0], 200)
        started = time.monotonic()
        server.shutdown()
        server.server_close()
        self.assertLess(time.monotonic() - started, 3)
        self.assertEqual(stalled.recv(1), b'')
        replacement = create_server(self.root / 'data', 0, now=lambda: 1900000000.0)
        replacement.server_close()

    def test_raw_duplicate_framing_and_header_syntax_are_rejected(self):
        server, config = self.start()
        for extra, status in [(b'Content-Length: 1\r\n', 400),
                              (b'Transfer-Encoding: chunked\r\n', 400),
                              (b'Sec-Fetch-Site: same-origin\r\nSec-Fetch-Site: same-origin\r\n', 403),
                              (b'Bad Name: value\r\n', 400),
                              (b' folded: value\r\n', 400)]:
            with self.subTest(extra=extra):
                with socket.create_connection(('127.0.0.1', server.server_port)) as raw:
                    with self.client_context.wrap_socket(raw, server_hostname='localhost') as client:
                        client.settimeout(3)
                        client.sendall(b'GET /api/status HTTP/1.1\r\nHost: ' + config.authority.encode() + b'\r\n' + extra + b'\r\n')
                        received = client.recv(4096)
                        self.assertIn(f' {status} '.encode(), received.split(b'\r\n')[0])

    def test_saturation_closes_seventeenth_socket_and_releases_slots(self):
        server, config = self.start()
        sockets = []
        try:
            for _ in range(16):
                sockets.append(socket.create_connection(('127.0.0.1', server.server_port)))
            deadline = time.monotonic() + 2
            while len(server.https_runtime.connections) < 16 and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertEqual(len(server.https_runtime.connections), 16)
            with socket.create_connection(('127.0.0.1', server.server_port)) as last:
                last.settimeout(2)
                self.assertEqual(last.recv(1), b'')
        finally:
            for connection in sockets:
                connection.close()
        deadline = time.monotonic() + 2
        while server.https_runtime.connections and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertEqual(self.request(server, config)[0], 200)

    def test_held_request_refuses_teardown_before_waiting_on_shared_job_lock(self):
        server, config = self.start()
        created = self.request(server, config, 'POST', '/api/challenges', dict(name='Proposer', terms=self.terms()),
                               {'Origin': config.origin, 'X-Friendly-Setup-Key': 'a' * 64})[2]
        entered, release = threading.Event(), threading.Event()
        original = server.store.get
        def held(*args):
            entered.set()
            release.wait(2)
            return original(*args)
        server.store.get = held
        with socket.create_connection(('127.0.0.1', server.server_port)) as raw:
            with self.client_context.wrap_socket(raw, server_hostname='localhost') as client:
                client.sendall((f'GET /api/challenges/{created["challengeId"]} HTTP/1.1\r\n'
                                f'Host: {config.authority}\r\nAuthorization: Bearer {created["token"]}\r\n\r\n').encode())
                self.assertTrue(entered.wait(1))
                try:
                    with patch.object(limits, 'REQUEST_JOIN_SECONDS', .15):
                        start = time.monotonic()
                        with self.assertRaises(RuntimeError):
                            server.server_close()
                        self.assertLess(time.monotonic() - start, .7)
                    self.assertIsNotNone(server._data_lock)
                    self.assertIsNotNone(server.store)
                finally:
                    release.set()
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    unittest.main()
