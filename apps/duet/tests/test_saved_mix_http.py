"""Named-mix HTTP contract over real loopback sockets and the real SQLite Store."""

import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest

from duet.server import create_server


class SavedMixHttpTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        dist = self.root / 'dist'
        dist.mkdir()
        (dist / 'index.html').write_text('<h1>HTTP fixture</h1>')
        self.server = create_server(self.root / 'data', port=0, dist_dir=dist,
                                    normalize=lambda *_: self.fail('No media worker is needed.'))
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()

        def stop():
            self.server.shutdown()
            self.server.server_close()
            thread.join(3)
            self.assertFalse(thread.is_alive())

        self.addCleanup(stop)
        self.server.store.now = lambda: 1_700_000_000.0
        status, headers, created = self.request('POST', '/api/rooms',
                                                {'title': 'Actual mix room', 'name': 'Host'})
        self.assertEqual(status, 201, created)
        self.room = created['roomId']
        self.host = created['token']
        self.cookie = headers['Set-Cookie'].split(';', 1)[0]
        self.endpoint = '/api/rooms/' + self.room
        status, _, joined = self.request('POST', self.endpoint + '/join',
                                         {'inviteToken': created['inviteToken'], 'name': 'Guest'})
        self.assertEqual(status, 200, joined)
        self.guest = joined['token']
        self.tracks = ['a' * 32, 'b' * 32, 'c' * 32]
        self.labels = [('First <literal>', 'Artist\nOne'), ('Second 😀', ''), ('Third', 'Artist Three')]
        for track_id, (title, artist) in zip(self.tracks, self.labels):
            self.server.store.add_track(self.room, self.host, track_id, title, artist, 10)
        status, _, value = self.request('PUT', self.endpoint + '/playlist',
                                        {'trackIds': self.tracks[:2], 'revision': 0}, self.host)
        self.assertEqual(status, 200, value)

    def request(self, method, path, body=None, token=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        headers = dict(headers or {})
        if token is not None:
            headers['Authorization'] = 'Bearer ' + token
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            headers.setdefault('Content-Type', 'application/json')
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            raw = response.read()
            return response.status, dict(response.getheaders()), json.loads(raw)
        finally:
            connection.close()

    def snapshot(self):
        status, _, value = self.request('GET', self.endpoint, token=self.host)
        self.assertEqual(status, 200, value)
        return value

    def save(self, name='Original mix', token=None):
        current = self.snapshot()
        status, _, value = self.request('POST', self.endpoint + '/mixes', {
            'name': name, 'playlistRevision': current['playlistRevision'],
            'savedMixesRevision': current.get('savedMixesRevision', 0),
        }, token or self.host)
        self.assertEqual(status, 201, value)
        self.assertEqual(set(value), {'mixId', 'room'})
        self.assertRegex(value['mixId'], r'^[0-9a-f]{32}$')
        return value['mixId'], value['room']

    def test_two_seats_save_update_rename_delete_without_transport_mutation(self):
        before = self.snapshot()
        mix_id, saved = self.save('  literal <mix> 😀  ')
        entries = [{'trackId': track, 'title': title, 'artist': artist}
                   for track, (title, artist) in zip(self.tracks[:2], self.labels[:2])]
        self.assertEqual(saved['savedMixes'], [{'id': mix_id, 'name': '  literal <mix> 😀  ',
                                              'entries': entries}])
        self.assertEqual(saved['savedMixesRevision'], 1)
        self.assertEqual(saved['playback'], before['playback'])
        self.assertEqual(saved['playlistRevision'], before['playlistRevision'])
        self.assertNotIn(self.host, json.dumps(saved))
        self.assertNotIn(self.guest, json.dumps(saved))
        status, _, changed = self.request('PUT', self.endpoint + '/playlist',
                                          {'trackIds': self.tracks[1:], 'revision': 1}, self.guest)
        self.assertEqual(status, 200, changed)
        path = self.endpoint + '/mixes/' + mix_id
        status, _, updated = self.request('PUT', path + '/playlist',
                                          {'playlistRevision': 2, 'savedMixesRevision': 1}, self.guest)
        self.assertEqual(status, 200, updated)
        self.assertEqual(updated['savedMixes'][0], {'id': mix_id, 'name': '  literal <mix> 😀  ',
                         'entries': [{'trackId': track, 'title': title, 'artist': artist}
                                     for track, (title, artist) in zip(self.tracks[1:], self.labels[1:])]})
        status, _, renamed = self.request('PUT', path + '/name',
                                          {'name': 'Renamed\nexactly', 'savedMixesRevision': 2}, self.host)
        self.assertEqual(status, 200, renamed)
        self.assertEqual(renamed['savedMixes'][0]['name'], 'Renamed\nexactly')
        self.assertEqual(renamed['savedMixes'][0]['entries'], updated['savedMixes'][0]['entries'])
        status, _, deleted = self.request('DELETE', path, {'savedMixesRevision': 3}, self.guest)
        self.assertEqual(status, 200, deleted)
        self.assertEqual(deleted['savedMixes'], [])
        self.assertEqual(deleted['savedMixesRevision'], 4)
        for key in ('playlist', 'playlistRevision', 'playback', 'tracks', 'memories'):
            self.assertEqual(deleted[key], changed[key])

    def test_explicit_load_pauses_at_first_and_invalidates_old_transport(self):
        mix_id, saved = self.save()
        status, _, playing = self.request('PUT', self.endpoint + '/playback', {
            'trackId': self.tracks[1], 'playing': True, 'position': 3,
            'revision': saved['playback']['revision'],
        }, self.host)
        self.assertEqual(status, 200, playing)
        path = self.endpoint + '/mixes/' + mix_id + '/load'
        status, _, loaded = self.request('POST', path, {
            'savedMixesRevision': 1, 'playlistRevision': saved['playlistRevision'],
            'playbackRevision': playing['playback']['revision'], 'availableOnly': False,
        }, self.guest)
        self.assertEqual(status, 200, loaded)
        self.assertEqual(loaded['playback'], {'trackId': self.tracks[0], 'playing': False,
                         'position': 0.0, 'revision': playing['playback']['revision'] + 1})
        self.assertEqual(loaded['playlist'], self.tracks[:2])
        self.assertEqual(loaded['playlistRevision'], saved['playlistRevision'] + 1)
        self.assertEqual(loaded['savedMixes'], saved['savedMixes'])
        self.assertEqual(loaded['savedMixesRevision'], 1)
        status, _, error = self.request('PUT', self.endpoint + '/playback', {
            'trackId': self.tracks[1], 'playing': True, 'position': 3,
            'revision': playing['playback']['revision'],
        }, self.host)
        self.assertEqual(status, 409, error)
        self.assertEqual(self.snapshot()['playback'], loaded['playback'])

    def test_deleted_references_need_explicit_consent_and_preserve_captured_labels(self):
        mix_id, saved = self.save()
        status, _, room = self.request('DELETE', self.endpoint + '/tracks/' + self.tracks[0], {}, self.host)
        self.assertEqual(status, 200, room)
        body = {'savedMixesRevision': 1, 'playlistRevision': room['playlistRevision'],
                'playbackRevision': room['playback']['revision'], 'availableOnly': False}
        path = self.endpoint + '/mixes/' + mix_id + '/load'
        before = self.snapshot()
        self.assertEqual(self.request('POST', path, body, self.guest)[0], 409)
        self.assertEqual(self.snapshot(), before)
        status, _, loaded = self.request('POST', path, {**body, 'availableOnly': True}, self.guest)
        self.assertEqual(status, 200, loaded)
        self.assertEqual(loaded['playlist'], [self.tracks[1]])
        self.assertEqual(loaded['savedMixes'], saved['savedMixes'])
        status, _, room = self.request('DELETE', self.endpoint + '/tracks/' + self.tracks[1], {}, self.host)
        self.assertEqual(status, 200, room)
        body.update(availableOnly=True, playlistRevision=room['playlistRevision'],
                    playbackRevision=room['playback']['revision'])
        self.assertEqual(self.request('POST', path, body, self.host)[0], 409)

    def test_stale_saved_and_playlist_revisions_refuse_without_retry(self):
        mix_id, _ = self.save()
        before = self.snapshot()
        requests = [
            ('POST', '/mixes', {'name': 'Stale', 'playlistRevision': 0, 'savedMixesRevision': 1}),
            ('POST', '/mixes', {'name': 'Stale', 'playlistRevision': 1, 'savedMixesRevision': 0}),
            ('PUT', f'/mixes/{mix_id}/playlist', {'playlistRevision': 0, 'savedMixesRevision': 1}),
            ('PUT', f'/mixes/{mix_id}/name', {'name': 'Stale', 'savedMixesRevision': 0}),
            ('DELETE', f'/mixes/{mix_id}', {'savedMixesRevision': 0}),
        ]
        for method, tail, body in requests:
            with self.subTest(method=method, tail=tail):
                self.assertEqual(self.request(method, self.endpoint + tail, body, self.guest)[0], 409)
                self.assertEqual(self.snapshot(), before)

    def test_exact_json_keys_names_and_safe_integer_admission(self):
        base = {'name': 'Valid', 'playlistRevision': 1, 'savedMixesRevision': 0}
        invalid = [{**base, 'entries': []}, {key: value for key, value in base.items() if key != 'name'}]
        for key in ('playlistRevision', 'savedMixesRevision'):
            invalid.extend({**base, key: value} for value in (True, None, '0', 0.0, -1, 2**53))
        invalid.extend({**base, 'name': value} for value in (None, 4, '', ' \t', 'x' * 81, 'nul\0', '\ud800'))
        before = self.snapshot()
        for body in invalid:
            with self.subTest(body=repr(body)):
                self.assertEqual(self.request('POST', self.endpoint + '/mixes', body, self.host)[0], 400)
                self.assertEqual(self.snapshot(), before)
        status, _, value = self.request('POST', self.endpoint + '/mixes', {**base, 'name': '😀' * 80}, self.host)
        self.assertEqual(status, 201, value)
        self.assertEqual(value['room']['savedMixes'][0]['name'], '😀' * 80)

    def test_other_routes_refuse_extra_fields_and_nonboolean_available_only(self):
        mix_id, room = self.save()
        path = self.endpoint + '/mixes/' + mix_id
        invalid = [
            ('PUT', '/playlist', {'playlistRevision': 1, 'savedMixesRevision': 1, 'entries': []}),
            ('PUT', '/name', {'name': 'Valid', 'savedMixesRevision': True}),
            ('DELETE', '', {'savedMixesRevision': 1, 'name': 'Not accepted'}),
        ]
        load = {'savedMixesRevision': 1, 'playlistRevision': 1,
                'playbackRevision': room['playback']['revision'], 'availableOnly': False}
        invalid.extend(('POST', '/load', {**load, 'availableOnly': value})
                       for value in (0, 1, 'false', None))
        invalid.append(('POST', '/load', {key: value for key, value in load.items() if key != 'availableOnly'}))
        before = self.snapshot()
        for method, tail, body in invalid:
            with self.subTest(method=method, tail=tail, body=body):
                self.assertEqual(self.request(method, path + tail, body, self.host)[0], 400)
                self.assertEqual(self.snapshot(), before)

    def test_capacity_and_empty_playlist_refusals_are_atomic(self):
        ids = [self.save('Repeated name')[0] for _ in range(8)]
        self.assertEqual(len(set(ids)), 8)
        before = self.snapshot()
        status, _, error = self.request('POST', self.endpoint + '/mixes',
                                        {'name': 'Ninth', 'playlistRevision': 1, 'savedMixesRevision': 8}, self.host)
        self.assertEqual(status, 409, error)
        self.assertEqual(self.snapshot(), before)
        status, _, room = self.request('PUT', self.endpoint + '/playlist',
                                       {'trackIds': [], 'revision': 1}, self.host)
        self.assertEqual(status, 200, room)
        status, _, error = self.request('PUT', self.endpoint + '/mixes/' + ids[0] + '/playlist',
                                        {'playlistRevision': 2, 'savedMixesRevision': 8}, self.host)
        self.assertEqual(status, 409, error)
        self.assertEqual(self.snapshot()['savedMixes'], before['savedMixes'])

    def test_capabilities_origin_and_body_bound_remain_required(self):
        path = self.endpoint + '/mixes'
        self.assertEqual(self.request('POST', path, b'not JSON')[0], 401)
        self.assertEqual(self.request('POST', path, b'not JSON', headers={'Cookie': self.cookie})[0], 401)
        self.assertEqual(self.request('POST', path, b'not JSON', 'f' * 64)[0], 401)
        self.assertEqual(self.request('POST', path, {}, self.host,
                                     {'Origin': 'https://foreign.invalid'})[0], 403)
        before = self.snapshot()
        status, headers, value = self.request('POST', path, b'x' * (65536 + 1), self.host,
                                              {'Content-Type': 'application/json'})
        self.assertEqual(status, 413, value)
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(self.snapshot(), before)

    def test_duplicate_json_keys_and_unknown_well_formed_mix_reject(self):
        before = self.snapshot()
        payload = b'{"name":"A","name":"B","playlistRevision":1,"savedMixesRevision":0}'
        self.assertEqual(self.request('POST', self.endpoint + '/mixes', payload, self.host,
                                     {'Content-Type': 'application/json'})[0], 400)
        unknown = self.endpoint + '/mixes/' + 'd' * 32
        for method, tail, body in [
            ('PUT', '/name', {'name': 'Unknown', 'savedMixesRevision': 0}),
            ('DELETE', '', {'savedMixesRevision': 0}),
            ('PUT', '/playlist', {'playlistRevision': 1, 'savedMixesRevision': 0}),
            ('POST', '/load', {'savedMixesRevision': 0, 'playlistRevision': 1,
                              'playbackRevision': before['playback']['revision'], 'availableOnly': False}),
        ]:
            with self.subTest(method=method, tail=tail):
                self.assertEqual(self.request(method, unknown + tail, body, self.host)[0], 404)
        self.assertEqual(self.snapshot(), before)
