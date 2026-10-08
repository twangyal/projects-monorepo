"""Real loopback HTTP and SQLite; media worker injection is test-only."""

import http.client
import io
import json
import math
from pathlib import Path
import socket
import subprocess
import struct
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
import wave
from unittest.mock import patch
from urllib.parse import quote

from duet.server import create_server


def fake_normalize(source, output, cancel, stage):
    stage('Converting test media')
    output.write_bytes(b'OggS' + b'test-media' * 512)
    return 2.0


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.dist = self.root / 'dist'
        self.dist.mkdir()
        (self.dist / 'index.html').write_text('<h1>Duet test</h1>')
        self.server = self.start_server()
        status, headers, created = self.request('POST', '/api/rooms', {'title': 'Our music', 'name': 'Host'})
        self.assertEqual(status, 201, created)
        self.room = created['roomId']
        self.host = created['token']
        self.invite = created['inviteToken']
        self.host_cookie = headers['Set-Cookie'].split(';', 1)[0]
        self.endpoint = f'/api/rooms/{self.room}'

    def start_server(self, data=None, **kwargs):
        server = create_server(data or self.root / 'data', port=0, dist_dir=self.dist,
                               normalize=kwargs.get('normalize', fake_normalize))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def stop():
            server.shutdown()
            server.server_close()
            thread.join(3)

        self.addCleanup(stop)
        return server

    def request(self, method, path, body=None, token=None, cookie=None, headers=None, server=None):
        target = server or self.server
        connection = http.client.HTTPConnection('127.0.0.1', target.server_port, timeout=3)
        values = dict(headers or {})
        if token:
            values.setdefault('Authorization', f'Bearer {token}')
        if cookie:
            values['Cookie'] = cookie
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            values.setdefault('Content-Type', 'application/json')
        try:
            connection.request(method, path, body=body, headers=values)
            response = connection.getresponse()
            result = response.read()
            response_headers = dict(response.getheaders())
            if response_headers.get('Content-Type', '').startswith('application/json'):
                result = json.loads(result)
            return response.status, response_headers, result
        finally:
            connection.close()

    def join(self):
        status, headers, joined = self.request('POST', self.endpoint + '/join',
                                              {'inviteToken': self.invite, 'name': 'Guest'})
        self.assertEqual(status, 200, joined)
        self.guest = joined['token']
        self.guest_cookie = headers['Set-Cookie'].split(';', 1)[0]
        return joined

    def test_http_rejects_stale_transport_after_advance_stop_and_restart_pause(self):
        self.join()
        clock = [1_700_000_000.0]
        self.server.store.now = lambda: clock[0]
        first, second = 'a' * 32, 'b' * 32
        for track in (first, second):
            self.server.store.add_track(self.room, self.host, track, 'Song', '', 10)
        self.server.store.set_playlist(self.room, self.host, [first, second], 0)
        endpoint = self.endpoint + '/playback'
        stale = {'trackId': first, 'playing': True, 'position': 0, 'revision': 1}
        self.assertEqual(self.request('PUT', endpoint, {**stale, 'revision': 0}, token=self.host)[0], 200)
        clock[0] += 12
        self.assertEqual(self.request('PUT', endpoint, stale, token=self.guest)[0], 409)
        current = self.snapshot()['playback']
        self.assertEqual(current, {'trackId': second, 'playing': True, 'position': 2, 'revision': 2})
        self.assertEqual(self.request('PUT', endpoint, current, token=self.guest)[0], 200)
        clock[0] += 8
        self.assertEqual(self.request('PUT', endpoint, {**current, 'revision': 3}, token=self.host)[0], 409)
        self.assertEqual(self.snapshot()['playback']['revision'], 4)
        self.assertFalse(self.snapshot()['playback']['playing'])
        restarted = {**stale, 'revision': 4}
        self.assertEqual(self.request('PUT', endpoint, restarted, token=self.host)[0], 200)
        self.server.store.pause_all()
        self.assertEqual(self.request('PUT', endpoint, {**restarted, 'revision': 5}, token=self.guest)[0], 409)
        self.assertEqual(self.snapshot()['playback']['revision'], 6)
        self.assertFalse(self.snapshot()['playback']['playing'])

    def snapshot(self, token=None):
        status, _, room = self.request('GET', self.endpoint, token=token or self.host)
        self.assertEqual(status, 200, room)
        return room

    def upload(self, token=None, title='Shared song'):
        status, _, response = self.request('POST', self.endpoint + '/tracks', b'test-input',
                                           token=token or self.host,
                                           headers={'X-Track-Title': quote(title), 'X-Track-Artist': 'Test%20Artist'})
        self.assertEqual(status, 202, response)
        return self.wait_job(response['job']['id'], token)

    def wait_job(self, job_id, token=None):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            status, _, response = self.request('GET', self.endpoint + f'/jobs/{job_id}', token=token or self.host)
            self.assertEqual(status, 200, response)
            if response['job']['status'] != 'running':
                return response['job']
            time.sleep(.01)
        self.fail('Media job did not finish')

    def test_private_room_cookie_and_public_status_contract(self):
        self.assertEqual(self.request('GET', self.endpoint)[0], 401)
        self.assertEqual(self.request('GET', self.endpoint, cookie=self.host_cookie)[0], 401)
        self.assertEqual(self.request('GET', self.endpoint, token='a' * 64)[0], 401)
        room = self.snapshot()
        self.assertEqual(room['myRole'], 'host')
        self.assertIsNone(room['activeJob'])
        serialized = json.dumps(room)
        self.assertNotIn(self.host, serialized)
        self.assertNotIn(self.invite, serialized)
        status, headers, result = self.request('POST', self.endpoint + '/access', {}, token=self.host)
        self.assertEqual(status, 200)
        self.assertIn('HttpOnly', headers['Set-Cookie'])
        self.assertIn('SameSite=Strict', headers['Set-Cookie'])
        self.assertIn(f'Path={self.endpoint}', headers['Set-Cookie'])
        self.assertEqual(result['myRole'], 'host')
        public = self.request('GET', '/api/status')[2]
        self.assertNotIn(self.room, json.dumps(public))
        self.assertEqual(self.request('GET', '/api/rooms')[0], 404)

    def test_host_origin_query_and_path_validation(self):
        self.assertEqual(self.request('GET', '/api/status', headers={'Host': 'evil.test'})[0], 403)
        self.assertEqual(self.request('GET', '/api/status', headers={'Origin': 'http://evil.test'})[0], 403)
        self.assertEqual(self.request('POST', '/api/rooms', {'title': 'Bad', 'name': 'Bad'},
                                      headers={'Sec-Fetch-Site': 'cross-site'})[0], 403)
        for path in ('/../../etc/passwd', '/assets/%2e%2e/rooms.sqlite3', '/api/rooms/not-an-id'):
            self.assertEqual(self.request('GET', path)[0], 404)
        self.assertEqual(self.request('GET', self.endpoint + f'?token={self.host}', token=self.host)[0], 400)
        status, headers, body = self.request('GET', '/')
        self.assertEqual(status, 200)
        self.assertEqual(body, b'<h1>Duet test</h1>')
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        self.assertNotIn('Access-Control-Allow-Origin', headers)

    def test_join_consumes_invite_and_independent_preferences_build_explainable_mix(self):
        self.join()
        self.assertEqual(self.request('POST', self.endpoint + '/join',
                                      {'inviteToken': self.invite, 'name': 'Third'})[0], 409)
        track_id = self.upload()['trackId']
        rating_url = self.endpoint + f'/ratings/{track_id}'
        self.assertEqual(self.request('PUT', rating_url, {'rating': 1}, token=self.host)[0], 200)
        status, _, room = self.request('PUT', rating_url, {'rating': 1}, token=self.guest)
        self.assertEqual(status, 200)
        self.assertEqual(room['ratings'][track_id], {'host': 1, 'guest': 1})
        status, _, built = self.request('POST', self.endpoint + '/blend', {'revision': 0}, token=self.host)
        self.assertEqual(status, 200)
        self.assertEqual(built['playlist'], [track_id])
        self.assertEqual(built['blend'][0]['category'], 'mutual')
        self.assertEqual(self.request('PUT', self.endpoint + '/playlist',
                                      {'trackIds': [], 'revision': 0}, token=self.guest)[0], 409)
        status, _, playing = self.request('PUT', self.endpoint + '/playback',
                                         {'trackId': track_id, 'playing': True, 'position': 0, 'revision': 0}, token=self.host)
        self.assertEqual(status, 200)
        self.assertEqual(playing['playback']['revision'], 1)
        self.assertEqual(self.request('PUT', self.endpoint + '/playback',
                                      {'trackId': track_id, 'playing': False, 'position': 0, 'revision': 0}, token=self.guest)[0], 409)

    def test_normalized_audio_uses_scoped_cookie_or_bearer_and_validated_ranges(self):
        job = self.upload()
        self.assertEqual(job['status'], 'complete', job)
        url = self.endpoint + f'/tracks/{job["trackId"]}/audio'
        self.assertEqual(self.request('GET', url)[0], 401)
        full = self.request('GET', url, cookie=self.host_cookie)
        self.assertEqual(full[0], 200)
        self.assertEqual(full[1]['Content-Type'], 'audio/ogg')
        self.assertEqual(full[1]['Accept-Ranges'], 'bytes')
        self.assertTrue(full[2].startswith(b'OggS'))
        size = len(full[2])
        for value, start, end in [('bytes=0-3', 0, 3), ('bytes=4-', 4, size - 1), ('bytes=-7', size - 7, size - 1)]:
            status, headers, body = self.request('GET', url, token=self.host, headers={'Range': value})
            self.assertEqual(status, 206)
            self.assertEqual(headers['Content-Range'], f'bytes {start}-{end}/{size}')
            self.assertEqual(body, full[2][start:end + 1])
        status, headers, body = self.request('HEAD', url, cookie=self.host_cookie, headers={'Range': 'bytes=0-3'})
        self.assertEqual(status, 206)
        self.assertEqual(headers['Content-Length'], '4')
        self.assertEqual(body, b'')
        for value in (f'bytes={size}-', 'bytes=3-1', 'bytes=-0', 'bytes=0-1,3-4', 'bytes=' + '9' * 2000 + '-'):
            status, headers, body = self.request('GET', url, cookie=self.host_cookie, headers={'Range': value})
            self.assertEqual(status, 416)
            self.assertEqual(headers['Content-Range'], f'bytes */{size}')
            self.assertEqual(body, b'')
        wrong_cookie = 'duet_' + 'a' * 32 + '=' + self.host
        self.assertEqual(self.request('GET', url, cookie=wrong_cookie)[0], 401)
        self.assertEqual(self.request('GET', url, cookie=self.host_cookie,
                                      headers={'Authorization': 'Bearer ' + 'b' * 64})[0], 401)

    def test_metadata_export_and_memory_survive_audio_deletion_without_credentials(self):
        self.join()
        track_id = self.upload()['trackId']
        status, _, remembered = self.request('POST', self.endpoint + '/memories',
                                              {'trackId': track_id, 'date': '2026-10-03', 'text': '<script>literal memory</script>'}, token=self.guest)
        self.assertEqual(status, 200)
        memory = remembered['memories'][0]
        self.assertEqual(self.request('DELETE', self.endpoint + f'/memories/{memory["id"]}', {}, token=self.host)[0], 403)
        self.assertEqual(self.request('DELETE', self.endpoint + f'/tracks/{track_id}', {}, cookie=self.host_cookie)[0], 401)
        self.assertEqual(self.request('DELETE', self.endpoint + f'/tracks/{track_id}', {}, token=self.guest)[0], 403)
        status, _, deleted = self.request('DELETE', self.endpoint + f'/tracks/{track_id}', {}, token=self.host)
        self.assertEqual(status, 200)
        self.assertEqual(deleted['tracks'], [])
        self.assertEqual(deleted['memories'][0]['trackTitle'], 'Shared song')
        self.assertEqual(self.request('GET', self.endpoint + f'/tracks/{track_id}/audio', cookie=self.host_cookie)[0], 404)
        status, headers, exported = self.request('GET', self.endpoint + '/export', token=self.host)
        self.assertEqual(status, 200)
        self.assertIn('attachment', headers['Content-Disposition'])
        self.assertEqual(exported['schemaVersion'], 2)
        self.assertEqual(exported['savedMixes'], [])
        self.assertEqual(exported['savedMixesRevision'], 0)
        serialized = json.dumps(exported)
        for secret in (self.host, self.guest, self.invite):
            self.assertNotIn(secret, serialized)
        self.assertNotIn('myRole', exported)
        self.assertNotIn('serverTime', exported)

    def test_limits_and_malformed_json_do_not_create_jobs_or_change_room(self):
        for body in (b'{', b'null', b'\xff', b'{"revision":NaN}', b'{"revision":0,"revision":1}'):
            self.assertEqual(self.request('PUT', self.endpoint + '/playlist', body, token=self.host,
                                          headers={'Content-Type': 'application/json'})[0], 400)
        self.assertEqual(self.request('PUT', self.endpoint + '/playlist', b'', token=self.host,
                                      headers={'Content-Length': '65537'})[0], 413)
        self.assertEqual(self.request('POST', self.endpoint + '/tracks', b'', token=self.host,
                                      headers={'Content-Length': str(25 * 1024 * 1024 + 1), 'X-Track-Title': 'Song'})[0], 413)
        self.assertEqual(self.request('POST', self.endpoint + '/tracks', b'audio', token=self.host,
                                      headers={'Transfer-Encoding': 'chunked', 'X-Track-Title': 'Song'})[0], 400)
        self.assertIsNone(self.snapshot()['activeJob'])
        self.assertEqual(self.snapshot()['tracks'], [])

    def test_reserved_upload_can_be_cancelled_before_body_completes(self):
        self.join()
        connection = socket.create_connection(('127.0.0.1', self.server.server_port), timeout=2)
        self.addCleanup(connection.close)
        raw = (f'POST {self.endpoint}/tracks HTTP/1.1\r\nHost: 127.0.0.1:{self.server.server_port}\r\n'
               f'Authorization: Bearer {self.host}\r\nX-Track-Title: Receiving\r\nContent-Length: 100\r\n\r\na')
        connection.sendall(raw.encode())
        job = None
        deadline = time.monotonic() + 1
        while not job and time.monotonic() < deadline:
            job = self.snapshot()['activeJob']
            time.sleep(.01)
        self.assertIsNotNone(job)
        self.assertEqual(self.request('POST', self.endpoint + '/tracks', b'audio', token=self.host,
                                      headers={'X-Track-Title': 'Blocked'})[0], 409)
        self.assertEqual(self.request('DELETE', self.endpoint, {}, token=self.host)[0], 409)
        url = self.endpoint + f'/jobs/{job["id"]}/cancel'
        self.assertEqual(self.request('POST', url, {}, token=self.guest)[0], 403)
        self.assertEqual(self.request('POST', url, {}, token=self.host)[0], 200)
        self.assertEqual(self.wait_job(job['id'])['status'], 'cancelled')
        self.assertEqual(self.snapshot()['tracks'], [])

    def test_conversion_cancellation_cleanup_and_next_upload(self):
        started = threading.Event()

        def slow(source, output, cancel, stage):
            started.set()
            cancel.wait(3)
            output.write_bytes(b'cancelled output')
            return 2

        self.server.normalize = slow
        status, _, response = self.request('POST', self.endpoint + '/tracks', b'audio', token=self.host,
                                           headers={'X-Track-Title': 'Slow'})
        self.assertEqual(status, 202)
        self.assertTrue(started.wait(1))
        job_id = response['job']['id']
        self.request('POST', self.endpoint + f'/jobs/{job_id}/cancel', {}, token=self.host)
        self.assertEqual(self.wait_job(job_id)['status'], 'cancelled')
        self.assertEqual(self.snapshot()['tracks'], [])
        self.server.normalize = fake_normalize
        self.assertEqual(self.upload()['status'], 'complete')

    def test_failed_publication_removes_only_new_media_and_preserves_completed_track(self):
        first = self.upload()['trackId']
        with patch.object(self.server.store, 'add_track', side_effect=RuntimeError('test metadata failure')):
            job = self.upload()
            self.assertEqual(job['status'], 'failed')
        self.assertEqual([track['id'] for track in self.snapshot()['tracks']], [first])
        room_media = self.server.media_dir / self.room
        self.assertEqual([path.name for path in room_media.iterdir()], [first + '.ogg'])

    def test_jobs_and_credentials_are_scoped_to_their_room(self):
        job = self.upload()
        created = self.request('POST', '/api/rooms', {'title': 'Other', 'name': 'Other Host'})[2]
        other = f'/api/rooms/{created["roomId"]}'
        self.assertEqual(self.request('GET', other, token=self.host)[0], 401)
        self.assertEqual(self.request('GET', other + f'/jobs/{job["id"]}', token=created['token'])[0], 404)
        self.assertIsNone(self.request('GET', other, token=created['token'])[2]['activeJob'])

    def test_track_and_room_quotas_recover_only_after_explicit_deletion(self):
        tracks = [self.upload()['trackId'] for _ in range(12)]
        self.assertEqual(self.request('POST', self.endpoint + '/tracks', b'audio', token=self.host,
                                      headers={'X-Track-Title': 'Thirteenth'})[0], 409)
        self.request('DELETE', self.endpoint + f'/tracks/{tracks[0]}', {}, token=self.host)
        self.assertEqual(self.upload()['status'], 'complete')
        others = [self.request('POST', '/api/rooms', {'title': f'Room {index}', 'name': 'Host'})[2] for index in range(4)]
        self.assertEqual(self.request('POST', '/api/rooms', {'title': 'Sixth', 'name': 'Host'})[0], 409)
        self.assertEqual(self.request('DELETE', self.endpoint, {}, token=self.host)[2], {'deleted': True})
        self.assertEqual(self.request('POST', '/api/rooms', {'title': 'Replacement', 'name': 'Host'})[0], 201)
        for room in others:
            self.assertEqual(self.request('GET', f'/api/rooms/{room["roomId"]}', token=room['token'])[0], 200)

    def test_lifetime_data_lock_precedes_cleanup_and_restart_pauses_playback(self):
        track_id = self.upload()['trackId']
        self.request('PUT', self.endpoint + '/playback',
                     {'trackId': track_id, 'playing': True, 'position': 0, 'revision': 0}, token=self.host)
        live = self.server.work_dir / ('a' * 32)
        live.mkdir()
        (live / 'input.audio').write_bytes(b'live upload')
        for port in (0, self.server.server_port):
            with self.assertRaisesRegex(RuntimeError, 'already in use'):
                create_server(self.server.data_dir, port=port, dist_dir=self.dist, normalize=fake_normalize)
            self.assertEqual((live / 'input.audio').read_bytes(), b'live upload')
        other_data = self.root / 'other-data'
        with self.assertRaises(OSError):
            create_server(other_data, port=self.server.server_port, dist_dir=self.dist, normalize=fake_normalize)
        independent = create_server(other_data, port=0, dist_dir=self.dist, normalize=fake_normalize)
        independent.server_close()
        self.server.shutdown()
        self.server.server_close()
        restarted = self.start_server()
        room = self.request('GET', self.endpoint, token=self.host, server=restarted)[2]
        self.assertFalse(room['playback']['playing'])
        self.assertEqual(room['tracks'][0]['id'], track_id)
        self.assertFalse(live.exists())

    def test_shutdown_interrupts_receiving_upload_and_releases_data_lock(self):
        connection = socket.create_connection(('127.0.0.1', self.server.server_port), timeout=2)
        self.addCleanup(connection.close)
        connection.sendall((f'POST {self.endpoint}/tracks HTTP/1.1\r\nHost: 127.0.0.1:{self.server.server_port}\r\n'
                            f'Authorization: Bearer {self.host}\r\nX-Track-Title: Pending\r\n'
                            'Content-Length: 100\r\n\r\na').encode())
        deadline = time.monotonic() + 1
        while self.snapshot()['activeJob'] is None and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertIsNotNone(self.snapshot()['activeJob'])
        started = time.monotonic()
        self.server.shutdown()
        self.server.server_close()
        self.assertLess(time.monotonic() - started, 2)
        restarted = self.start_server()
        self.assertEqual(self.request('GET', self.endpoint, token=self.host, server=restarted)[2]['tracks'], [])
        self.assertEqual(list(restarted.work_dir.iterdir()), [])

    def test_invalid_normalizer_output_and_rename_failure_publish_nothing(self):
        def invalid(source, output, cancel, stage):
            output.write_bytes(b'')
            return 2
        self.server.normalize = invalid
        self.assertEqual(self.upload()['status'], 'failed')
        self.assertEqual(self.snapshot()['tracks'], [])
        self.server.normalize = fake_normalize
        with patch('duet.server.os.replace', side_effect=OSError('test rename failure')):
            self.assertEqual(self.upload()['status'], 'failed')
        self.assertEqual(self.snapshot()['tracks'], [])
        self.assertEqual(list(self.server.work_dir.iterdir()), [])
        self.assertEqual(self.upload()['status'], 'complete')

    def test_deleted_track_cleanup_failure_never_grants_access_or_changes_other_track(self):
        first, second = self.upload()['trackId'], self.upload()['trackId']
        first_path = self.server.media_dir / self.room / (first + '.ogg')
        with patch('duet.server.os.unlink', side_effect=OSError('test cleanup failure')):
            status, _, room = self.request('DELETE', self.endpoint + f'/tracks/{first}', {}, token=self.host)
        self.assertEqual(status, 200)
        self.assertEqual([item['id'] for item in room['tracks']], [second])
        self.assertTrue(first_path.exists())
        self.assertEqual(self.request('GET', self.endpoint + f'/tracks/{first}/audio', token=self.host)[0], 404)
        self.assertEqual(self.request('GET', self.endpoint + f'/tracks/{second}/audio', token=self.host)[0], 200)

    def test_media_parent_symlink_is_not_served(self):
        track_id = self.upload()['trackId']
        media_dir = self.server.media_dir / self.room
        moved = self.root / 'outside-media'
        media_dir.rename(moved)
        media_dir.symlink_to(moved, target_is_directory=True)
        self.assertEqual(self.request('GET', self.endpoint + f'/tracks/{track_id}/audio', token=self.host)[0], 404)

    def test_cli_sigterm_releases_lock_without_deleting_completed_rooms(self):
        data_dir = self.root / 'cli-data'
        process = subprocess.Popen([sys.executable, '-m', 'duet', '--data-dir', str(data_dir), '--port', '0'],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(lambda: process.poll() is None and process.kill())
        line = process.stdout.readline()
        self.assertTrue(line.startswith('Duet: http://127.0.0.1:'), line)
        process.terminate()
        _, stderr = process.communicate(timeout=3)
        self.assertEqual(process.returncode, 0, stderr)
        reopened = create_server(data_dir, 0, dist_dir=self.dist, normalize=fake_normalize)
        reopened.server_close()

    def test_production_default_processes_actual_wav_over_http(self):
        real = self.start_server(data=self.root / 'real-data', normalize=None)
        self.assertEqual(real.normalize.__name__, 'normalize_audio')
        status, headers, created = self.request('POST', '/api/rooms', {'title': 'Real audio', 'name': 'Host'}, server=real)
        self.assertEqual(status, 201)
        endpoint = f'/api/rooms/{created["roomId"]}'
        audio = io.BytesIO()
        with wave.open(audio, 'wb') as output:
            output.setparams((2, 2, 48000, 0, 'NONE', 'not compressed'))
            output.writeframes(b'\x00\x00' * (48000 * 2 * 2))
        status, _, response = self.request('POST', endpoint + '/tracks', audio.getvalue(), token=created['token'],
                                           headers={'X-Track-Title': 'Actual%20WAV'}, server=real)
        self.assertEqual(status, 202)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            job = self.request('GET', endpoint + f'/jobs/{response["job"]["id"]}', token=created['token'], server=real)[2]['job']
            if job['status'] != 'running':
                break
            time.sleep(.02)
        self.assertEqual(job['status'], 'complete', job)
        room = self.request('GET', endpoint, token=created['token'], server=real)[2]
        self.assertAlmostEqual(room['tracks'][0]['duration'], 2, places=3)
        native = self.request('GET', endpoint + f'/tracks/{job["trackId"]}/audio',
                              cookie=headers['Set-Cookie'].split(';', 1)[0], server=real)
        self.assertEqual(native[0], 200)
        self.assertTrue(native[2].startswith(b'OggS'))
        self.assertNotEqual(native[2], audio.getvalue())
        self.assertEqual(list(real.work_dir.iterdir()), [])

    def test_retained_job_records_are_bounded_without_secret_error_messages(self):
        def invalid(source, output, cancel, stage):
            raise RuntimeError('Failed with private ' + self.host)
        self.server.normalize = invalid
        jobs = [self.upload() for _ in range(51)]
        self.assertEqual(len(self.server.jobs.records), 50)
        self.assertEqual(self.request('GET', self.endpoint + f'/jobs/{jobs[0]["id"]}', token=self.host)[0], 404)
        status, _, response = self.request('GET', self.endpoint + f'/jobs/{jobs[-1]["id"]}', token=self.host)
        self.assertEqual(status, 200)
        self.assertEqual(response['job']['status'], 'failed')
        self.assertNotIn(self.host, json.dumps(response))

    def test_replaced_media_parent_cannot_redirect_room_cleanup(self):
        self.upload()
        outside = self.root / 'outside'
        selected = outside / self.room
        selected.mkdir(parents=True)
        sentinel = selected / 'unrelated-sentinel.txt'
        sentinel.write_text('Preserve outside data')
        self.server.media_dir.rename(self.root / 'original-media')
        self.server.media_dir.symlink_to(outside, target_is_directory=True)
        self.assertEqual(self.request('DELETE', self.endpoint, {}, token=self.host)[0], 200)
        self.assertEqual(sentinel.read_text(), 'Preserve outside data')

    def test_replaced_media_parent_cannot_redirect_publication(self):
        outside = self.root / 'outside'
        outside.mkdir()
        self.server.media_dir.rename(self.root / 'original-media')
        self.server.media_dir.symlink_to(outside, target_is_directory=True)
        job = self.upload()
        self.assertEqual(job['status'], 'failed')
        self.assertEqual(self.snapshot()['tracks'], [])
        self.assertEqual(list(outside.iterdir()), [])

    def test_replaced_job_parent_cannot_redirect_cleanup_or_normalizer_output(self):
        started, release = threading.Event(), threading.Event()
        def slow(source, output, cancel, stage):
            started.set()
            release.wait(2)
            output.write_bytes(b'OggS' + b'actual job output')
            return 2
        self.server.normalize = slow
        status, _, response = self.request('POST', self.endpoint + '/tracks', b'audio', token=self.host,
                                           headers={'X-Track-Title': 'Pending'})
        self.assertEqual(status, 202)
        self.assertTrue(started.wait(1))
        job_id = response['job']['id']
        outside = self.root / 'outside-jobs'
        selected = outside / job_id
        selected.mkdir(parents=True)
        sentinel = selected / 'unrelated-sentinel.txt'
        sentinel.write_text('Preserve outside data')
        self.server.work_dir.rename(self.root / 'original-jobs')
        self.server.work_dir.symlink_to(outside, target_is_directory=True)
        release.set()
        self.wait_job(job_id)
        self.assertEqual(sentinel.read_text(), 'Preserve outside data')
        self.assertEqual([path.name for path in selected.iterdir()], ['unrelated-sentinel.txt'])

    def test_replaced_job_parent_rejects_new_upload_without_creating_outside_files(self):
        outside = self.root / 'outside-jobs'
        outside.mkdir()
        self.server.work_dir.rename(self.root / 'original-jobs')
        self.server.work_dir.symlink_to(outside, target_is_directory=True)
        status, _, _ = self.request('POST', self.endpoint + '/tracks', b'audio', token=self.host,
                                    headers={'X-Track-Title': 'Rejected'})
        self.assertEqual(status, 500)
        self.assertEqual(list(outside.iterdir()), [])
        self.assertIsNone(self.snapshot()['activeJob'])

    def test_static_room_links_load_without_allowing_capability_queries(self):
        status, _, body = self.request('GET', '/?room=' + self.room)
        self.assertEqual(status, 200)
        self.assertEqual(body, b'<h1>Duet test</h1>')
        status, headers, body = self.request('HEAD', '/?room=' + self.room)
        self.assertEqual(status, 200)
        self.assertEqual(body, b'')
        self.assertEqual(headers['Content-Length'], str(len(b'<h1>Duet test</h1>')))
        for path in ('/?room=invalid', '/?token=' + self.host,
                     '/?room=' + self.room + '&token=' + self.host,
                     '/?room=' + self.room + '&room=' + self.room,
                     '/api/status?room=' + self.room):
            self.assertEqual(self.request('GET', path)[0], 400)

    def test_real_process_restart_preserves_both_participants_music_and_memories(self):
        data_dir = self.root / 'process-data'
        def launch():
            process = subprocess.Popen([sys.executable, '-m', 'duet', '--data-dir', str(data_dir), '--port', '0'],
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            def cleanup():
                if process.poll() is None:
                    process.kill()
                process.communicate(timeout=5)
            self.addCleanup(cleanup)
            line = process.stdout.readline()
            self.assertTrue(line.startswith('Duet: http://127.0.0.1:'), line)
            return process, SimpleNamespace(server_port=int(line.strip().rsplit(':', 1)[1]))
        first, original = launch()
        status, _, created = self.request('POST', '/api/rooms', {'title': 'Durable room', 'name': 'First'}, server=original)
        self.assertEqual(status, 201)
        endpoint, host = '/api/rooms/' + created['roomId'], created['token']
        status, _, joined = self.request('POST', endpoint + '/join',
                                         {'inviteToken': created['inviteToken'], 'name': 'Second'}, server=original)
        self.assertEqual(status, 200)
        guest = joined['token']
        audio = io.BytesIO()
        with wave.open(audio, 'wb') as stream:
            stream.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            stream.writeframes(b''.join(struct.pack('<h', round(5000 * math.sin(2 * math.pi * 220 * n / 16000)))
                                       for n in range(16000 * 3)))
        status, _, accepted = self.request('POST', endpoint + '/tracks', audio.getvalue(), token=host,
                                           headers={'X-Track-Title': 'Real%20shared%20song'}, server=original)
        self.assertEqual(status, 202)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            job = self.request('GET', endpoint + '/jobs/' + accepted['job']['id'], token=host, server=original)[2]['job']
            if job['status'] != 'running':
                break
            time.sleep(.02)
        self.assertEqual(job['status'], 'complete', job)
        track_id = job['trackId']
        for token in (host, guest):
            self.assertEqual(self.request('PUT', endpoint + '/ratings/' + track_id, {'rating': 1},
                                          token=token, server=original)[0], 200)
        status, _, built = self.request('POST', endpoint + '/blend', {'revision': 0}, token=guest, server=original)
        self.assertEqual(status, 200)
        self.assertEqual(built['playlist'], [track_id])
        status, _, remembered = self.request('POST', endpoint + '/memories',
                                              {'trackId': track_id, 'date': '2026-10-03', 'text': 'Our first real song'},
                                              token=guest, server=original)
        self.assertEqual(status, 200)
        memory = remembered['memories'][0]
        command_start = time.monotonic()
        self.assertEqual(self.request('PUT', endpoint + '/playback',
                                      {'trackId': track_id, 'playing': True, 'position': .25, 'revision': 0},
                                      token=host, server=original)[0], 200)
        first.terminate()
        _, stderr = first.communicate(timeout=5)
        self.assertEqual(first.returncode, 0, stderr)
        second, restarted = launch()
        for token, role in ((host, 'host'), (guest, 'guest')):
            status, headers, room = self.request('POST', endpoint + '/access', {}, token=token, server=restarted)
            self.assertEqual(status, 200)
            self.assertEqual(room['myRole'], role)
            self.assertEqual(room['profiles'], {'host': {'name': 'First'}, 'guest': {'name': 'Second'}})
            self.assertEqual(room['ratings'][track_id], {'host': 1, 'guest': 1})
            self.assertEqual(room['playlist'], [track_id])
            self.assertEqual(room['memories'], [memory])
            self.assertFalse(room['playback']['playing'])
            self.assertEqual(room['playback']['trackId'], track_id)
            self.assertEqual(room['playback']['revision'], 2)
            self.assertGreaterEqual(room['playback']['position'], .25)
            self.assertLessEqual(room['playback']['position'], min(3, .25 + time.monotonic() - command_start + .1))
            native = endpoint + '/tracks/' + track_id + '/audio'
            cookie = headers['Set-Cookie'].split(';', 1)[0]
            full = self.request('GET', native, cookie=cookie, server=restarted)
            self.assertEqual(full[0], 200)
            self.assertEqual(full[1]['Content-Type'], 'audio/ogg')
            self.assertTrue(full[2].startswith(b'OggS'))
            partial = self.request('GET', native, cookie=cookie, headers={'Range': 'bytes=0-63'}, server=restarted)
            self.assertEqual(partial[0], 206)
            self.assertEqual(partial[2], full[2][:64])
        persisted = data_dir / 'media' / created['roomId'] / (track_id + '.ogg')
        decoded = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(persisted), '-f', 's16le', '-ar', '48000',
                                  '-ac', '2', 'pipe:1'], capture_output=True, timeout=5, check=True).stdout
        self.assertEqual(len(decoded) // 4, 48000 * 3)
        self.assertGreater(max(abs(sample[0]) for sample in struct.iter_unpack('<h', decoded)), 1000)
        self.assertEqual(list((data_dir / '.jobs').iterdir()), [])
        second.terminate()
        _, stderr = second.communicate(timeout=5)
        self.assertEqual(second.returncode, 0, stderr)


if __name__ == '__main__':
    unittest.main()
