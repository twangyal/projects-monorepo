"""Image evidence crosses the actual bounded HTTP transport and SQLite store."""
from io import BytesIO
import base64
import http.client
import json
import socket
import struct
import time
import unittest
from unittest.mock import patch

from PIL import Image
import test_server as support


def fixture():
    target = BytesIO()
    Image.new('RGB', (24, 16), (25, 90, 170)).save(target, 'JPEG')
    return target.getvalue()


def frame(metadata, jpeg=None):
    data = fixture() if jpeg is None else jpeg
    raw = json.dumps(metadata).encode() if type(metadata) is dict else metadata
    return b'FCEVID01' + struct.pack('<II', len(raw), len(data)) + raw + data


class ImageHTTPTests(unittest.TestCase):
    setUp = support.ServerTests.setUp
    start_server = support.ServerTests.start_server
    request = support.ServerTests.request
    raw = support.ServerTests.raw
    snapshot = support.ServerTests.snapshot
    command = support.ServerTests.command
    accept = support.ServerTests.accept

    def post_image(self, payload=None, data=None, token=None, headers=None):
        if payload is None:
            payload = {'revision': self.snapshot()['revision'], 'text': '<photo & claim>', 'url': None}
        return self.request('POST', self.endpoint + '/evidence/image',
                            frame(payload, data), token or self.host,
                            {'Content-Type': 'application/octet-stream', **(headers or {})})

    def test_real_pair_append_exact_authenticated_bytes_and_complete_script_free_export(self):
        self.accept()
        data = fixture()
        status, _, result = self.post_image(data=data)
        self.assertEqual(status, 200, result)
        item = result['evidence'][-1]
        route = self.endpoint + '/evidence/' + item['id'] + '/image'
        for token in (self.host, self.guest):
            status, headers, returned = self.request('GET', route, token=token)
            self.assertEqual((status, returned), (200, data))
            self.assertEqual(headers['Content-Type'], 'image/jpeg')
            self.assertEqual(headers['Cache-Control'], 'no-store')
            self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        for token in (None, '0' * 64, self.created['inviteToken']):
            self.assertEqual(self.request('GET', route, token=token)[0], 401)
        self.assertEqual(self.request('GET', route + '?token=' + self.host)[0], 400)
        status, _, record = self.request('GET', self.endpoint + '/export', token=self.guest)
        self.assertEqual(status, 200)
        self.assertEqual(record['schemaVersion'], 2)
        self.assertEqual(record['challenge']['evidence'][-1]['image'], item['image'])
        status, headers, html = self.request('GET', self.endpoint + '/export/images', token=self.guest)
        self.assertEqual(status, 200)
        self.assertIn(base64.b64encode(data), html)
        self.assertNotIn(b'<script', html.lower())
        self.assertIn(b'&lt;photo &amp; claim&gt;', html)
        self.assertIn('attachment;', headers['Content-Disposition'])
        for token in (self.host, self.guest, self.created['inviteToken']):
            self.assertNotIn(token.encode(), html)
        self.assertEqual(self.request('GET', self.endpoint + '/export/images')[0], 401)

    def test_bad_framing_json_and_jpeg_do_not_change_revision_or_evidence(self):
        self.accept()
        before = self.snapshot()
        valid = frame({'revision': before['revision'], 'text': 'x', 'url': None})
        bad = [b'', valid[:-1], valid + b'x', b'BADMAGIC' + valid[8:],
               frame(b'{"revision":3,"revision":3,"text":"x","url":null}'),
               frame(b'{"revision":NaN}'), frame(b'\xff'),
               frame({'revision': before['revision'], 'text': 'x', 'url': None, 'image': {}}),
               frame({'revision': before['revision'], 'text': 'x', 'url': None}, b'not-jpeg')]
        for body in bad:
            status, _, _ = self.request('POST', self.endpoint + '/evidence/image', body,
                                        self.host, {'Content-Type': 'application/octet-stream'})
            self.assertEqual(status, 400)
        self.assertEqual(self.snapshot(), before)

    def test_larger_route_keeps_auth_host_origin_type_and_declared_length_boundaries(self):
        self.accept()
        body = frame({'revision': self.snapshot()['revision'], 'text': 'x', 'url': None})
        self.assertEqual(self.request('POST', self.endpoint + '/evidence/image', body,
                         headers={'Content-Type': 'application/octet-stream'})[0], 401)
        self.assertEqual(self.post_image(headers={'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.post_image(headers={'Content-Type': 'application/json'})[0], 400)
        host = f'127.0.0.1:{self.server.server_port}'
        for size in (540689, 9999999999):
            status, _ = self.raw(f'POST {self.endpoint}/evidence/image HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {self.host}\r\nContent-Type: application/octet-stream\r\nContent-Length: {size}\r\n\r\n')
            self.assertEqual(status, 413)
        oversize = b'FCEVID01' + struct.pack('<II', 16385, 1) + b' ' * 16385 + b'x'
        self.assertEqual(self.request('POST', self.endpoint + '/evidence/image', oversize,
                         self.host, {'Content-Type': 'application/octet-stream'})[0], 413)
        self.assertEqual(self.request('POST', self.endpoint + '/evidence', b'x' * 16385,
                         self.host, {'Content-Type': 'application/json'})[0], 413)

    def test_image_body_retains_independent_total_deadline_under_continuous_bytes(self):
        self.accept()
        connection = socket.create_connection(('127.0.0.1', self.server.server_port), timeout=2)
        self.addCleanup(connection.close)
        headers = (f'POST {self.endpoint}/evidence/image HTTP/1.1\r\n'
                   f'Host: 127.0.0.1:{self.server.server_port}\r\nAuthorization: Bearer {self.host}\r\n'
                   'Content-Type: application/octet-stream\r\nContent-Length: 10000\r\n\r\n')
        with patch('challenges.server.BODY_TIMEOUT', .15), patch('challenges.server.SOCKET_TIMEOUT', .1):
            connection.sendall(headers.encode())
            for _ in range(8):
                try:
                    connection.sendall(b'x')
                except OSError:
                    break
                time.sleep(.03)
            response = http.client.HTTPResponse(connection)
            response.begin()
            self.assertEqual(response.status, 408)
            self.assertNotIn(self.host.encode(), response.read())
        self.assertEqual(self.snapshot()['evidence'], [])
