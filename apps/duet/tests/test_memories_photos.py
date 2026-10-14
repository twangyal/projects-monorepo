"""Song and moment memories with photos: signature checks, ownership, serving and cleanup."""

import base64
import http.client
import json
import os
from pathlib import Path
import stat
import struct
import tempfile
import threading
import unittest
from unittest.mock import patch
import zlib

from duet.photos import PhotoError, inspect_photo
from duet.server import create_server
from duet.spotify import SpotifyClient
from tests.fake_spotify import FakeSpotify, track


def png(width=4, height=3):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    rows = b''.join(b'\x00' + b'\x80\x40\x20' * width for _ in range(height))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


# Complete, synthetic solid-color raster fixtures generated locally with Pillow; no test-time Pillow dependency.
JPEG = base64.b64decode('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAHgAoADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDjqKKK8c98KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/2Q==')
GIF = base64.b64decode('R0lGODdhAgACAIEAAIBAIAAAAAAAAAAAACwAAAAAAgACAAAIBgABCAQQEAA7')
WEBP = base64.b64decode('UklGRlQAAABXRUJQVlA4IEgAAABwBACdASpkADIAPm02mUmkIyKhISgAgA2JaQB2AAAWmdWrVq1atWrVq1aroAD+8FMf/+LWtwtLD//cGZ9XYSgwMPcUAAAAAAA=')

def jpeg():
    return JPEG

ANIMATED_GIF = base64.b64decode('R0lGODlhAgACAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAgACAAAIBgABCAQQEAAh+QQBCgABACwAAAAAAgACAIEAAP8AAAAAAAAAAAAIBgABCAQQEAA7')
BROKEN_LATER_GIF = base64.b64decode('R0lGODlhAgACAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAgACAAAIBgABCAQQEAAh+QQBCgABACwAAAAAAgACAIEAADs=')


class PhotoInspectionTests(unittest.TestCase):
    def test_accepts_passive_raster_formats_with_dimensions(self):
        self.assertEqual(inspect_photo(png()), ('image/png', 4, 3))
        self.assertEqual(inspect_photo(jpeg()), ('image/jpeg', 640, 480))
        self.assertEqual(inspect_photo(GIF), ('image/gif', 2, 2))
        self.assertEqual(inspect_photo(WEBP), ('image/webp', 100, 50))

    def test_refuses_header_only_and_truncated_images(self):
        headers = (b'\x89PNG\r\n\x1a\n' + struct.pack('>I', 13) + b'IHDR' + struct.pack('>II', 4, 3),
                   b'GIF89a' + struct.pack('<HH', 2, 2), b'\xff\xd8\xff\xc0'+struct.pack('>HBHHB',11,8,480,640,1)+b'\x01\x11\x00\xff\xd9',
                   b'GIF89a'+struct.pack('<HH',2,2)+b'\x00\x00\x00;',
                   b'RIFF'+struct.pack('<I',22)+b'WEBPVP8X'+struct.pack('<I',10)+b'\x00'*4+(99).to_bytes(3,'little')+(49).to_bytes(3,'little'))
        for data in headers:
            with self.subTest(header=data[:12]), self.assertRaises(PhotoError):
                inspect_photo(data)
        with self.assertRaises(PhotoError):
            inspect_photo(png()[:-12])

    def test_complete_animation_and_corrupt_later_frame(self):
        self.assertEqual(inspect_photo(ANIMATED_GIF), ('image/gif', 2, 2))
        with self.assertRaises(PhotoError):
            inspect_photo(BROKEN_LATER_GIF)
        with self.assertRaises(PhotoError):
            inspect_photo(GIF[:42] + b';')
        with patch('duet.photos._run', return_value=(12, b'')):
            with self.assertRaises(PhotoError):
                inspect_photo(ANIMATED_GIF)

    def test_animated_png_is_refused_before_first_frame_only_decoder(self):
        payload = struct.pack('>II', 2, 0)
        chunk = struct.pack('>I', len(payload)) + b'acTL' + payload + struct.pack('>I', zlib.crc32(b'acTL' + payload))
        animated = png()[:33] + chunk + png()[33:]
        with patch('duet.photos._run') as runner:
            with self.assertRaisesRegex(PhotoError, 'Animated PNG'):
                inspect_photo(animated)
            runner.assert_not_called()

    def test_pixel_and_worker_limits_refuse_without_public_internal_details(self):
        def header_chunk(kind, payload):
            return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))
        oversized = (b'\x89PNG\r\n\x1a\n' + header_chunk(b'IHDR', struct.pack('>IIBBBBB', 5000, 5000, 8, 2, 0, 0, 0))
                     + header_chunk(b'IEND', b''))
        with patch('duet.photos._run') as runner:
            with self.assertRaises(PhotoError):
                inspect_photo(oversized)
            runner.assert_not_called()
        with patch('duet.photos._run', side_effect=RuntimeError('private-file-path')):
            with self.assertRaises(PhotoError) as error:
                inspect_photo(png())
            self.assertNotIn('private-file-path', str(error.exception))

    def test_exact_pixel_limit_decodes_and_animation_budget_refuses_before_worker(self):
        try:
            result = inspect_photo(png(4000, 4000))
        except PhotoError as error:
            # Trusted synthetic fixture only: expose bounded worker diagnostics
            # in CI without changing generic production errors.
            cause = error.__context__
            self.fail(f'Exact-limit fixture refused: {type(cause).__name__}: '
                      f'{getattr(cause, "stderr", str(cause))!r}')
        self.assertEqual(result, ('image/png', 4000, 4000))
        # Complete original LZW frame blocks on a larger valid canvas, exceeding
        # the aggregate limit only on the third frame.
        over_budget = GIF[:6] + struct.pack('<HH', 4000, 4000) + GIF[10:25] + GIF[25:-1] * 3 + b';'
        with patch('duet.photos._run') as runner:
            with self.assertRaisesRegex(PhotoError, '32 million'):
                inspect_photo(over_budget)
            runner.assert_not_called()

    def test_refuses_active_content_damage_and_extremes(self):
        for data in (b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
                     b'<!doctype html><script>alert(1)</script>', b'\xff\xd8\xff\xe0', b'',
                     b'\x89PNG\r\n\x1a\n', png(0, 3), png(12001, 1), b'x' * (5 * 1024 * 1024 + 1)):
            with self.assertRaises(PhotoError):
                inspect_photo(data)


class MemoryHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        (root / 'dist').mkdir()
        (root / 'dist' / 'index.html').write_text('<h1>Duet</h1>')
        self.data = root / 'data'
        self.fake = FakeSpotify().__enter__()
        self.addCleanup(self.fake.__exit__)
        self.server = create_server(self.data, port=0, dist_dir=root / 'dist', normalize=lambda *a: 1.0,
                                    spotify=SpotifyClient('testclient1', accounts_url=self.fake.base, api_url=self.fake.base + '/v1'),
                                    sync_seconds=3600)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()

        def stop():
            self.server.shutdown()
            self.server.server_close()
            thread.join(3)
        self.addCleanup(stop)
        created = self.request('POST', '/api/rooms', {'title': 'Us', 'name': 'Ada'})[1]
        self.room, self.host = created['roomId'], created['token']
        self.guest = self.request('POST', f'/api/rooms/{self.room}/join', {'inviteToken': created['inviteToken'], 'name': 'Ben'})[1]['token']
        self.base = f'/api/rooms/{self.room}/listening'
        # A song on the timeline: the host's imported listening.
        self.fake.add_user('ada', 'Ada')
        self.fake.users['ada']['plays'].append((1_760_000_000_000, track('Song1', 'Harbour Lights', 'The Tides')))
        tokens = self.fake._issue('ada', refresh=True)
        self.server.listening.connect(self.room, 'host', {'accessToken': tokens['access_token'], 'expiresIn': 3600,
                                                          'refreshToken': tokens['refresh_token']}, {'id': 'ada', 'name': 'Ada'})
        self.server.listening.sync(self.server.spotify, self.room, 'host', force=True)

    def request(self, method, path, body=None, token=None, headers=None, binary=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        values = {'Host': f'127.0.0.1:{self.server.server_port}', **(headers or {})}
        if token:
            values['Authorization'] = f'Bearer {token}'
        data = binary
        if binary is None and (body is not None or method in ('POST', 'PUT', 'DELETE')):
            data = json.dumps(body if body is not None else {}).encode()
            values.setdefault('Content-Type', 'application/json')
        values['Content-Length'] = str(len(data or b''))
        connection.request(method, path, data, values)
        response = connection.getresponse()
        payload = response.read()
        connection.close()
        kind = response.getheader('Content-Type', '')
        return response.status, json.loads(payload) if kind.startswith('application/json') and payload else payload, response

    def add(self, token, target='track-Song1', text='Windows down, singing'):
        status, value, _ = self.request('POST', f'{self.base}/memories', {'target': target, 'date': '2025-07-04', 'text': text}, token)
        self.assertEqual(status, 201, value)
        return value['memoryId'], value['listening']

    def test_memories_appear_on_every_entry_for_their_song(self):
        memory_id, state = self.add(self.guest)
        entry = next(item for item in state['entries'] if item['key'] == 'new-host-Song1') if any(
            item['key'] == 'new-host-Song1' for item in state['entries']) else None
        listed = state['memories'][0]
        self.assertEqual((listed['id'], listed['label'], listed['role'], listed['photo']), (memory_id, 'Harbour Lights — The Tides', 'guest', False))
        for item in state['entries']:
            if item.get('track', {}).get('id') == 'Song1':
                self.assertEqual([memory['id'] for memory in item['memories']], [memory_id])
        self.assertIsNone(entry)  # Imported baseline listening has no "new" entry, but the memory is still listed.
        status, value, _ = self.request('POST', f'{self.base}/memories', {'target': 'track-Unknown1', 'date': '2025-07-04', 'text': 'x'}, self.host)
        self.assertEqual(status, 404)

    def test_photos_are_validated_owned_served_to_participants_and_removed(self):
        memory_id, _ = self.add(self.guest)
        photo = f'{self.base}/memories/{memory_id}/photo'
        status, value, _ = self.request('PUT', photo, token=self.host, headers={'Content-Type': 'image/png'}, binary=png())
        self.assertEqual(status, 403, 'only the author adds a photo')
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'
        self.assertEqual(self.request('PUT', photo, token=self.guest, headers={'Content-Type': 'image/png'}, binary=svg)[0], 400)
        self.assertEqual(self.request('PUT', photo, token=self.guest, headers={'Content-Type': 'image/gif'}, binary=png())[0], 400,
                         'a declared type that disagrees with the bytes is refused')
        status, state, _ = self.request('PUT', photo, token=self.guest, headers={'Content-Type': 'image/png'}, binary=png())
        self.assertEqual(status, 200, state)
        self.assertTrue(state['memories'][0]['photo'])
        stored = self.data / 'photos' / self.room / f'{memory_id}.png'
        self.assertEqual(stat.S_IMODE(os.stat(stored).st_mode), 0o600)

        status, body, response = self.request('GET', photo, token=self.host)
        self.assertEqual((status, body, response.getheader('Content-Type'), response.getheader('X-Content-Type-Options')),
                         (200, png(), 'image/png', 'nosniff'))
        cookie = self.request('POST', f'/api/rooms/{self.room}/access', {}, self.host)[2].getheader('Set-Cookie').split(';', 1)[0]
        self.assertEqual(self.request('GET', photo, headers={'Cookie': cookie})[0], 200, 'images load with the room cookie')
        self.assertEqual(self.request('GET', photo)[0], 401)

        status, state, _ = self.request('PUT', photo, token=self.guest, headers={'Content-Type': 'image/jpeg'}, binary=jpeg())
        self.assertEqual(status, 200)
        self.assertFalse(stored.exists(), 'a replaced photo of another type is removed')
        self.assertEqual(self.request('DELETE', f'{self.base}/memories/{memory_id}', {}, self.host)[0], 403)
        self.assertEqual(self.request('DELETE', f'{self.base}/memories/{memory_id}', {}, self.guest)[0], 200)
        self.assertEqual(list((self.data / 'photos' / self.room).iterdir()), [])
        self.assertEqual(self.request('GET', photo, token=self.host)[0], 404)

    def test_editing_disconnecting_and_room_deletion(self):
        memory_id, _ = self.add(self.host, text='First')
        self.assertEqual(self.request('PUT', f'{self.base}/memories/{memory_id}', {'date': '2025-07-05', 'text': 'Edited'}, self.guest)[0], 403)
        status, state, _ = self.request('PUT', f'{self.base}/memories/{memory_id}', {'date': '2025-07-05', 'text': 'Edited'}, self.host)
        self.assertEqual((status, state['memories'][0]['text'], state['memories'][0]['date']), (200, 'Edited', '2025-07-05'))
        self.request('PUT', f'{self.base}/memories/{memory_id}/photo', token=self.host, headers={'Content-Type': 'image/gif'}, binary=GIF)
        status, state, _ = self.request('DELETE', f'{self.base}/connection', {}, self.host)
        self.assertEqual(len(state['memories']), 1, 'memories outlive the imported listening they were attached to')
        self.assertEqual(self.request('DELETE', f'/api/rooms/{self.room}', {}, self.host)[0], 200)
        self.assertFalse((self.data / 'photos' / self.room).exists())
        self.assertEqual(self.server.listening.state(self.room, configured=True)['memories'], [])

    def test_oversized_uploads_are_refused_before_reading(self):
        memory_id, _ = self.add(self.guest)
        # Only headers are sent: the service must refuse from Content-Length without reading a body.
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        connection.putrequest('PUT', f'{self.base}/memories/{memory_id}/photo', skip_host=True)
        for key, value in {'Host': f'127.0.0.1:{self.server.server_port}', 'Authorization': f'Bearer {self.guest}',
                           'Content-Type': 'image/png', 'Content-Length': str(5 * 1024 * 1024 + 1)}.items():
            connection.putheader(key, value)
        connection.endheaders()
        response = connection.getresponse()
        self.assertEqual(response.status, 413)
        connection.close()


if __name__ == '__main__':
    unittest.main()
