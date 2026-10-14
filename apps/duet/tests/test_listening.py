"""Spotify listening timeline: pure derivation, storage/sync against a loopback fake, and HTTP."""

import http.client
import json
import os
from pathlib import Path
import stat
import tempfile
import threading
import time
import unittest
from urllib.parse import parse_qs, urlsplit

from duet.listening import ListeningStore, derive_recommendations, derive_timeline
from duet.server import create_server
from duet.spotify import SpotifyClient, SpotifyError
from tests.fake_spotify import FakeSpotify, track

MINUTE = 60 * 1000
DAY = 24 * 60 * MINUTE
T0 = 1_760_000_000_000  # 2025-10-09T09:46:40Z


def row(first, last=None, plays=1, baseline=False):
    return {'firstAt': first, 'lastAt': last or first, 'plays': plays, 'baseline': baseline}


class DeriveTimelineTests(unittest.TestCase):
    def derive(self, **kwargs):
        values = dict(tracks={}, seen={}, plays={}, likes={}, overrides={}, manual=[])
        values.update(kwargs)
        return derive_timeline(**values)

    def test_both_played_reports_each_person_and_never_assumes_listening_together(self):
        entries = self.derive(
            seen={('host', 'a'): row(T0, T0 + DAY, plays=3), ('guest', 'a'): row(T0 + 2 * DAY, baseline=True)},
            plays={('host', 'a'): [T0, T0 + DAY], ('guest', 'a'): [T0 + 2 * DAY]})
        both = next(entry for entry in entries if entry['kind'] == 'both')
        self.assertEqual(both['key'], 'both-a')
        self.assertEqual(both['at'], T0 + 2 * DAY, 'dated when the second person had played it')
        self.assertEqual(both['people']['host']['plays'], 3)
        self.assertFalse(both['withinThirtyMinutes'])
        close = self.derive(seen={('host', 'a'): row(T0), ('guest', 'a'): row(T0 + 29 * MINUTE)},
                            plays={('host', 'a'): [T0], ('guest', 'a'): [T0 + 29 * MINUTE]})
        self.assertTrue(close[0]['withinThirtyMinutes'])

    def test_new_songs_exclude_the_connection_baseline_and_previously_liked_songs(self):
        entries = self.derive(
            seen={('host', 'old'): row(T0, baseline=True), ('host', 'fresh'): row(T0 + DAY, plays=2),
                  ('host', 'loved'): row(T0 + DAY)},
            likes={('host', 'loved'): {'addedAt': T0 - DAY, 'baseline': True}})
        self.assertEqual([entry['key'] for entry in entries], ['new-host-fresh'])
        self.assertEqual(entries[0]['plays'], 2)

    def test_favorites_are_only_likes_after_connecting(self):
        entries = self.derive(likes={('guest', 'x'): {'addedAt': T0, 'baseline': False},
                                     ('guest', 'y'): {'addedAt': T0, 'baseline': True}})
        self.assertEqual([entry['key'] for entry in entries], ['favorite-guest-x'])

    def test_overrides_and_manual_entries_with_date_ordering(self):
        entries = self.derive(
            seen={('host', 'n'): row(T0)},
            overrides={'new-host-n': {'hidden': True, 'caption': 'Road trip'}},
            manual=[{'id': 'f' * 32, 'author': 'guest', 'date': '2030-01-01', 'title': 'Concert', 'song': 'Song',
                     'note': '', 'createdAt': T0}])
        self.assertEqual(entries[0]['kind'], 'manual', 'a later chosen date sorts first')
        self.assertEqual(entries[1], {**entries[1], 'hidden': True, 'caption': 'Road trip'})


class RecommendationTests(unittest.TestCase):
    def picks(self, connected=('host', 'guest'), **kwargs):
        values = dict(tracks={}, seen={}, likes={}, overrides={})
        values.update(kwargs)
        return derive_recommendations(connected=list(connected), **values)

    def test_partner_favorites_and_repeats_the_other_has_not_heard_are_ranked_with_reasons(self):
        picks = self.picks(
            seen={('host', 'loop'): row(T0, T0 + DAY, plays=6), ('host', 'once'): row(T0), ('host', 'shared'): row(T0, plays=9),
                  ('guest', 'shared'): row(T0), ('host', 'liked'): row(T0, plays=1), ('guest', 'mine'): row(T0, plays=4)},
            likes={('host', 'liked'): {'addedAt': T0 + 2 * DAY, 'baseline': False},
                   ('host', 'old-love'): {'addedAt': T0 - DAY, 'baseline': True},
                   ('guest', 'known'): {'addedAt': T0, 'baseline': True}, ('host', 'known'): {'addedAt': T0, 'baseline': False}})
        for_guest = [(pick['track']['id'], pick['plays'], pick['liked']) for pick in picks['guest']]
        # Liked + 1 play (6) outranks 6 plays (6) by recency; a baseline favorite still counts; one play does not.
        self.assertEqual(for_guest, [('liked', 1, True), ('loop', 6, False), ('old-love', 0, True)])
        self.assertTrue(all(pick['from'] == 'host' for pick in picks['guest']))
        self.assertEqual([pick['track']['id'] for pick in picks['host']], ['mine'], 'the guest’s repeats go to the host')

    def test_hidden_songs_and_missing_partners_produce_no_picks(self):
        seen = {('host', 'secret'): row(T0, plays=5), ('host', 'fave'): row(T0, plays=3)}
        likes = {('host', 'fave'): {'addedAt': T0, 'baseline': False}}
        picks = self.picks(seen=seen, likes=likes, overrides={'new-host-secret': {'hidden': True, 'caption': ''},
                                                              'favorite-host-fave': {'hidden': True, 'caption': ''}})
        self.assertEqual(picks['guest'], [])
        self.assertEqual(self.picks(connected=('host',), seen=seen), {'host': [], 'guest': []},
                         'without the other person’s history, "not heard yet" cannot be judged')


class StorageSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.clock = [T0 / 1000]
        self.store = ListeningStore(Path(self.temp.name), now=lambda: self.clock[0])
        self.addCleanup(self.store.close)
        self.fake = FakeSpotify().__enter__()
        self.addCleanup(self.fake.__exit__)
        self.client = SpotifyClient('testclient1', accounts_url=self.fake.base, api_url=self.fake.base + '/v1')
        self.room = 'a' * 32

    def connect(self, role, user, name):
        self.fake.add_user(user, name)
        tokens = self.fake._issue(user, refresh=True)
        self.store.connect(self.room, role, {'accessToken': tokens['access_token'], 'expiresIn': 3600,
                                             'refreshToken': tokens['refresh_token']}, {'id': user, 'name': name})

    def play(self, user, ms, track_id, title):
        self.fake.users[user]['plays'].append((ms, track(track_id, title)))

    def keys(self, **kwargs):
        return [entry['key'] for entry in self.store.state(self.room, configured=True, **kwargs)['entries']]

    def test_credentials_file_is_owner_only(self):
        mode = stat.S_IMODE(os.stat(Path(self.temp.name) / 'listening.sqlite3').st_mode)
        self.assertEqual(mode, 0o600)

    def test_baseline_then_automatic_entries_and_durable_hiding(self):
        self.connect('host', 'ada', 'Ada')
        self.connect('guest', 'ben', 'Ben')
        self.play('ada', T0 - DAY, 'OldSong1', 'Old favourite')
        self.play('ben', T0 - 2 * DAY, 'OldSong1', 'Old favourite')
        self.fake.users['ben']['likes'].append((T0 - 5 * DAY, track('Liked1', 'Liked before')))
        self.assertTrue(self.store.sync(self.client, self.room, 'host'))
        self.assertTrue(self.store.sync(self.client, self.room, 'guest'))
        self.assertEqual(self.keys(), ['both-OldSong1'], 'history is a baseline; only the shared song appears')

        self.clock[0] += 3600
        self.play('ada', T0 + 10 * MINUTE, 'NewSong1', 'Brand new')
        self.play('ada', T0 + 20 * MINUTE, 'NewSong1', 'Brand new')
        self.play('ben', T0 + 30 * MINUTE, 'Liked1', 'Liked before')
        self.fake.users['ben']['likes'].append((T0 + 40 * MINUTE, track('Fave1', 'New favourite')))
        self.store.sync(self.client, self.room, 'host')
        self.store.sync(self.client, self.room, 'guest')
        state = self.store.state(self.room, configured=True)
        self.assertEqual(sorted(entry['key'] for entry in state['entries']),
                         ['both-OldSong1', 'favorite-guest-Fave1', 'new-host-NewSong1'])
        new = next(entry for entry in state['entries'] if entry['kind'] == 'new')
        self.assertEqual((new['plays'], new['track']['title']), (2, 'Brand new'), 'repeat plays are grouped')
        self.assertEqual(state['connections']['host']['displayName'], 'Ada')

        self.store.set_override(self.room, 'guest', 'new-host-NewSong1', True, 'Ada’s week')
        self.play('ada', T0 + 50 * MINUTE, 'NewSong1', 'Brand new')
        self.clock[0] += 600
        self.store.sync(self.client, self.room, 'host')
        self.assertNotIn('new-host-NewSong1', self.keys(), 'hidden entries stay hidden after re-ingestion')
        hidden = self.store.state(self.room, configured=True, include_hidden=True)
        entry = next(item for item in hidden['entries'] if item['key'] == 'new-host-NewSong1')
        self.assertEqual((entry['hidden'], entry['caption'], entry['plays']), (True, 'Ada’s week', 3))
        self.assertEqual(hidden['hiddenCount'], 1)

    def test_expired_access_refreshes_and_rotated_refresh_tokens_are_kept(self):
        self.connect('host', 'ada', 'Ada')
        self.play('ada', T0, 'Song1', 'One')
        self.fake.expire_all()
        self.clock[0] += 7200
        self.assertTrue(self.store.sync(self.client, self.room, 'host'))
        self.fake.expire_all()
        self.clock[0] += 7200
        self.assertTrue(self.store.sync(self.client, self.room, 'host'), 'the rotated refresh token was stored')

    def test_rate_limits_back_off_and_revocation_is_reported(self):
        self.connect('host', 'ada', 'Ada')
        self.fake.failures.append(('/v1/me/player', 429, {'Retry-After': '120'}))
        self.assertFalse(self.store.sync(self.client, self.room, 'host'))
        state = self.store.state(self.room, configured=True)
        self.assertEqual(state['connections']['host']['error'], 'Spotify asked Duet to slow down.')
        self.assertFalse(self.store.sync(self.client, self.room, 'host'), 'automatic sync waits for Retry-After')
        self.assertEqual(len([r for r in self.fake.requests if r[1] == '/v1/me/player/recently-played']), 1)
        self.clock[0] += 121
        self.assertTrue(self.store.sync(self.client, self.room, 'host'))
        self.assertIsNone(self.store.state(self.room, configured=True)['connections']['host']['error'])

        self.fake.expire_all()
        self.fake.refresh_tokens.clear()
        self.clock[0] += 7200
        self.assertFalse(self.store.sync(self.client, self.room, 'host'))
        self.assertIn('revoked or expired', self.store.state(self.room, configured=True)['connections']['host']['error'])

    def test_disconnect_and_room_deletion_remove_listening_data(self):
        self.connect('host', 'ada', 'Ada')
        self.connect('guest', 'ben', 'Ben')
        for user in ('ada', 'ben'):
            self.play(user, T0, 'Shared1', 'Shared')
        self.store.sync(self.client, self.room, 'host')
        self.store.sync(self.client, self.room, 'guest')
        self.store.add_manual(self.room, 'host', '2025-10-01', 'First date', 'Shared', '')
        self.store.disconnect(self.room, 'guest')
        state = self.store.state(self.room, configured=True)
        self.assertIsNone(state['connections']['guest'])
        self.assertEqual([entry['kind'] for entry in state['entries']], ['manual'], 'written entries are kept')
        self.store.delete_room(self.room)
        state = self.store.state(self.room, configured=True)
        self.assertEqual((state['entries'], state['connections']), ([], {'host': None, 'guest': None}))

    def test_disconnecting_during_a_fetch_discards_its_results(self):
        self.connect('host', 'ada', 'Ada')
        self.play('ada', T0, 'Song1', 'One')
        original = self.client.saved_tracks

        def disconnect_midway(token):
            self.store.disconnect(self.room, 'host')
            return original(token)
        self.client.saved_tracks = disconnect_midway
        self.assertFalse(self.store.sync(self.client, self.room, 'host'))
        self.assertEqual(self.store.state(self.room, configured=True)['entries'], [])

    def test_reconnecting_during_fetch_discards_previous_account_results(self):
        self.connect('host', 'ada', 'Ada')
        self.play('ada', T0, 'OldSong', 'Private old song')
        original = self.client.saved_tracks

        def reconnect(token):
            self.store.disconnect(self.room, 'host')
            self.connect('host', 'ben', 'Ben')
            return original(token)
        self.client.saved_tracks = reconnect
        self.assertFalse(self.store.sync(self.client, self.room, 'host'))
        self.assertEqual(self.store.database.execute('SELECT track_id FROM seen').fetchall(), [])
        state = self.store.state(self.room, configured=True)
        self.assertEqual(state['connections']['host']['displayName'], 'Ben')
        self.assertIsNone(state['connections']['host']['syncedAt'])

    def test_refresh_from_previous_connection_cannot_replace_new_credentials(self):
        self.connect('host', 'ada', 'Ada')
        self.clock[0] += 7200
        original = self.client.refresh

        def reconnect(token):
            tokens = original(token)
            self.store.disconnect(self.room, 'host')
            self.connect('host', 'ben', 'Ben')
            return tokens
        self.client.refresh = reconnect
        self.assertFalse(self.store.sync(self.client, self.room, 'host'))
        self.assertTrue(self.store.sync(self.client, self.room, 'host'))
        self.assertEqual(self.store.state(self.room, configured=True)['connections']['host']['displayName'], 'Ben')

    def test_old_sync_failure_does_not_mark_replacement_account_revoked(self):
        self.connect('host', 'ada', 'Ada')

        def reconnect(token, after):
            self.store.disconnect(self.room, 'host')
            self.connect('host', 'ben', 'Ben')
            raise SpotifyError('Old access revoked', 401)
        self.client.recently_played = reconnect
        self.assertFalse(self.store.sync(self.client, self.room, 'host'))
        self.assertIsNone(self.store.state(self.room, configured=True)['connections']['host']['error'])

    def test_new_authorization_invalidates_callback_already_taken(self):
        url = self.store.begin_auth(self.client, self.room, 'host', 'http://127.0.0.1/callback')
        pending = self.store.take_state(parse_qs(urlsplit(url).query)['state'][0])
        self.store.begin_auth(self.client, self.room, 'host', 'http://127.0.0.1/callback')
        tokens = {'refreshToken': 'refresh', 'accessToken': 'access', 'expiresIn': 3600}
        self.assertFalse(self.store.connect(self.room, 'host', tokens, {'id': 'ada', 'name': 'Ada'},
                                            generation=pending['generation']))
        self.store.record_failure(self.room, 'host', 'Late failure', generation=pending['generation'])
        self.assertEqual(self.store.state(self.room, configured=True)['authFailures'], {})

    def test_generation_survives_restart_and_disconnect_invalidates_taken_state(self):
        self.connect('host', 'ada', 'Ada')
        identity = self.store._credentials(self.room, 'host')[-1]
        url = self.store.begin_auth(self.client, self.room, 'host', 'http://127.0.0.1/callback')
        pending = self.store.take_state(parse_qs(urlsplit(url).query)['state'][0])
        self.store.close()
        self.store = ListeningStore(Path(self.temp.name), now=lambda: self.clock[0])
        self.addCleanup(self.store.close)
        self.assertEqual(self.store._credentials(self.room, 'host')[-1], identity)
        self.store.disconnect(self.room, 'host')
        tokens = {'refreshToken': 'refresh', 'accessToken': 'access', 'expiresIn': 3600}
        self.assertFalse(self.store.connect(self.room, 'host', tokens, {'id': 'ada', 'name': 'Ada'},
                                            generation=pending['generation']))

    def test_manual_entries_are_validated_and_author_owned(self):
        entry = self.store.add_manual(self.room, 'host', '2025-10-01', 'First dance', 'Our song', 'Kitchen')
        with self.assertRaises(Exception) as denied:
            self.store.update_manual(self.room, 'guest', entry, '2025-10-01', 'Changed', '', '')
        self.assertEqual(denied.exception.status, 403)
        with self.assertRaises(Exception) as invalid:
            self.store.add_manual(self.room, 'host', '2025-13-01', 'Bad date', '', '')
        self.assertEqual(invalid.exception.status, 400)
        with self.assertRaises(Exception) as unknown:
            self.store.set_override(self.room, 'host', 'both-../../x', True, '')
        self.assertEqual(unknown.exception.status, 404)


FULL_SCOPE = 'user-read-recently-played user-library-read playlist-modify-private'
EVERYTHING = {'kinds': ['both', 'new', 'favorite'], 'from': '', 'to': '', 'memoriesOnly': False}


class PlaylistTests(StorageSyncTests):
    """Occasion playlists: a chosen slice of the timeline becomes a private playlist in one person's account."""

    def connect(self, role, user, name, scope=FULL_SCOPE):
        if user not in self.fake.users:
            self.fake.add_user(user, name)
        tokens = self.fake._issue(user, refresh=True, scope=scope)
        self.store.connect(self.room, role, {'accessToken': tokens['access_token'], 'expiresIn': 3600,
                                             'refreshToken': tokens['refresh_token'], 'scope': scope}, {'id': user, 'name': name})

    def build_timeline(self):
        self.connect('host', 'ada', 'Ada')
        self.connect('guest', 'ben', 'Ben')
        self.play('ada', T0 - 3 * DAY, 'Shared1', 'Our song')
        self.play('ben', T0 - 2 * DAY, 'Shared1', 'Our song')
        self.store.sync(self.client, self.room, 'host')
        self.store.sync(self.client, self.room, 'guest')
        self.clock[0] += 3600
        self.play('ada', T0 + 2 * DAY, 'Fresh1', 'Fresh')
        self.play('ada', T0 + 3 * DAY, 'Hidden1', 'Hidden')
        self.fake.users['ben']['likes'].append((T0 + 4 * DAY, track('Fave1', 'Favourite')))
        self.store.sync(self.client, self.room, 'host')
        self.store.sync(self.client, self.room, 'guest')
        self.store.set_override(self.room, 'guest', 'new-host-Hidden1', True, '')
        self.store.add_memory(self.room, 'host', 'track-Fave1', '2025-10-13', 'Dancing in the kitchen')
        self.store.add_manual(self.room, 'host', '2025-10-01', 'First date', 'Our song', '')

    def titles(self, **selection):
        return [song['title'] for song in self.store.playlist_preview(self.room, 'guest', {**EVERYTHING, **selection})]

    def test_selection_by_kind_dates_and_memories_skips_hidden_and_written_entries(self):
        self.build_timeline()
        self.assertEqual(self.titles(), ['Our song', 'Fresh', 'Favourite'], 'oldest first; hidden and manual entries excluded')
        self.assertEqual(self.titles(kinds=['both']), ['Our song'])
        self.assertEqual(self.titles(kinds=['new', 'favorite'], memoriesOnly=True), ['Favourite'])
        self.assertEqual(self.titles(**{'from': '2025-10-11', 'to': '2025-10-12'}), ['Fresh'])
        self.assertEqual(self.titles(**{'from': '2030-01-01'}), [])
        # Ada played "Hidden" once and hid it; nothing of hers qualifies yet, so no picks for Ben.
        self.assertEqual(self.titles(kinds=['picks']), [])
        self.play('ada', T0 + 5 * DAY, 'Repeat1', 'On repeat')
        self.play('ada', T0 + 5 * DAY + MINUTE, 'Repeat1', 'On repeat')
        self.clock[0] += 600
        self.store.sync(self.client, self.room, 'host')
        self.assertEqual(self.titles(kinds=['picks']), ['On repeat'], 'Ada’s repeats Ben has not heard')
        for_ada = self.store.state(self.room, configured=True)['recommendations']['host']
        self.assertEqual([(pick['track']['title'], pick['liked'], len(pick['memories'])) for pick in for_ada], [('Favourite', True, 1)],
                         'Ben’s new favorite, with its memory, is a pick for Ada')
        for bad in [{**EVERYTHING, 'kinds': []}, {**EVERYTHING, 'kinds': ['manual']}, {**EVERYTHING, 'kinds': ['new', 'new']},
                    {**EVERYTHING, 'from': '2025-10-12', 'to': '2025-10-11'}, {**EVERYTHING, 'memoriesOnly': 1},
                    {**EVERYTHING, 'extra': True}, ['both'], {**EVERYTHING, 'to': '2025-02-30'}]:
            with self.assertRaises(Exception) as invalid:
                self.store.playlist_preview(self.room, 'guest', bad)
            self.assertEqual(invalid.exception.status, 400, bad)

    def test_creating_a_private_playlist_in_one_persons_account(self):
        self.build_timeline()
        self.assertTrue(self.store.state(self.room, configured=True)['connections']['guest']['canCreatePlaylists'])
        record = self.store.create_playlist(self.client, self.room, 'guest', 'Our autumn', EVERYTHING)
        self.assertEqual((record['name'], record['tracks'], record['role']), ('Our autumn', 3, 'guest'))
        self.assertRegex(record['url'], r'^https://open\.spotify\.com/playlist/[0-9a-f]+$')
        stored = self.fake.playlists[record['id']]
        self.assertEqual((stored['user'], stored['public'], stored['name']), ('ben', False, 'Our autumn'))
        self.assertEqual(stored['uris'], ['spotify:track:Shared1', 'spotify:track:Fresh1', 'spotify:track:Fave1'])
        state = self.store.state(self.room, configured=True)
        self.assertEqual([(item['name'], item['role']) for item in state['playlists']], [('Our autumn', 'guest')])
        self.assertNotIn('playlist-modify', json.dumps(state), 'grants are summarised, not exposed')

        with self.assertRaises(Exception) as empty:
            self.store.create_playlist(self.client, self.room, 'guest', 'Nothing', {**EVERYTHING, 'from': '2030-01-01'})
        self.assertEqual(empty.exception.status, 409)
        with self.assertRaises(Exception) as unnamed:
            self.store.create_playlist(self.client, self.room, 'guest', '  ', EVERYTHING)
        self.assertEqual(unnamed.exception.status, 400)

        # Expired access is refreshed first and the playlist grant survives the refresh.
        self.fake.expire_all()
        self.clock[0] += 7200
        self.assertEqual(self.store.create_playlist(self.client, self.room, 'host', 'Ada’s copy', EVERYTHING)['tracks'], 3)
        self.assertEqual(len(self.store.state(self.room, configured=True)['playlists']), 2)

        self.store.delete_room(self.room)
        self.assertEqual(self.store.state(self.room, configured=True)['playlists'], [])

    def test_older_connections_must_reconnect_and_spotify_refusals_are_explained(self):
        self.build_timeline()
        self.connect('host', 'ada', 'Ada', scope='user-read-recently-played user-library-read')
        self.assertFalse(self.store.state(self.room, configured=True)['connections']['host']['canCreatePlaylists'])
        self.assertEqual(self.titles(), ['Our song', 'Fresh', 'Favourite'], 're-authorizing the same account keeps its listening')
        before = len(self.fake.requests)
        with self.assertRaises(Exception) as missing:
            self.store.create_playlist(self.client, self.room, 'host', 'Ours', {**EVERYTHING, 'kinds': ['both']})
        self.assertEqual(missing.exception.status, 409)
        self.assertIn('Reconnect', str(missing.exception))
        self.assertEqual(len(self.fake.requests), before, 'nothing is sent to Spotify without the grant')

        # Spotify may still refuse (e.g. the app lost the permission): that is a reconnect hint, not a crash.
        self.fake.failures.append(('/v1/me/playlists', 403, {}))
        with self.assertRaises(Exception) as refused:
            self.store.create_playlist(self.client, self.room, 'guest', 'Ours', EVERYTHING)
        self.assertEqual(refused.exception.status, 409)
        self.fake.failures.append(('/v1/playlists/', 500, {}))
        with self.assertRaises(Exception) as partial:
            self.store.create_playlist(self.client, self.room, 'guest', 'Ours', EVERYTHING)
        self.assertEqual(partial.exception.status, 502)
        self.assertIn('did not add its songs', str(partial.exception))
        self.assertEqual(self.store.state(self.room, configured=True)['playlists'], [])

        # Granting the permission later is a plain re-authorization; a different account starts afresh.
        self.connect('host', 'ada', 'Ada')
        self.assertEqual(self.store.create_playlist(self.client, self.room, 'host', 'Ours', EVERYTHING)['tracks'], 3)
        self.connect('host', 'cy', 'Cy')
        self.assertEqual(self.titles(), ['Favourite'], 'the other account’s plays are not reused')

        self.store.disconnect(self.room, 'guest')
        with self.assertRaises(Exception) as disconnected:
            self.store.create_playlist(self.client, self.room, 'guest', 'Ours', EVERYTHING)
        self.assertEqual(disconnected.exception.status, 409)


class ClientValidationTests(unittest.TestCase):
    def test_only_official_or_loopback_endpoints_and_valid_client_ids(self):
        with self.assertRaises(ValueError):
            SpotifyClient('short')
        with self.assertRaises(ValueError):
            SpotifyClient('testclient1', accounts_url='http://evil.example')
        SpotifyClient('testclient1')

    def test_malformed_items_are_dropped_and_huge_responses_refused(self):
        with FakeSpotify() as fake:
            fake.add_user('ada', 'Ada')
            fake.users['ada']['plays'] += [(T0, {'type': 'episode', 'id': 'Ep1', 'name': 'Podcast'}),
                                           (T0 + 1, {**track('Local1', 'Local'), 'is_local': True}),
                                           (T0 + 2, track('Good1', 'Good'))]
            client = SpotifyClient('testclient1', accounts_url=fake.base, api_url=fake.base + '/v1')
            access = fake._issue('ada', refresh=False)['access_token']
            self.assertEqual([play['id'] for play in client.recently_played(access)], ['Good1'])
            fake.failures.append(('/v1/me/tracks', 500, {}))
            with self.assertRaises(SpotifyError):
                client.saved_tracks(access)


class ListeningHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        (root / 'dist').mkdir()
        (root / 'dist' / 'index.html').write_text('<h1>Duet</h1>')
        self.fake = FakeSpotify().__enter__()
        self.addCleanup(self.fake.__exit__)
        client = SpotifyClient('testclient1', accounts_url=self.fake.base, api_url=self.fake.base + '/v1')
        self.server = create_server(root / 'data', port=0, dist_dir=root / 'dist', normalize=lambda *a: 1.0,
                                    spotify=client, sync_seconds=3600)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()

        def stop():
            self.server.shutdown()
            self.server.server_close()
            thread.join(3)
        self.addCleanup(stop)
        status, created = self.request('POST', '/api/rooms', {'title': 'Us', 'name': 'Ada'})
        self.room, self.host = created['roomId'], created['token']
        status, joined = self.request('POST', f'/api/rooms/{self.room}/join', {'inviteToken': created['inviteToken'], 'name': 'Ben'})
        self.guest = joined['token']
        self.base = f'/api/rooms/{self.room}/listening'

    def request(self, method, path, body=None, token=None, headers=None, raw=False):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        values = {'Host': f'127.0.0.1:{self.server.server_port}', **(headers or {})}
        if token:
            values['Authorization'] = f'Bearer {token}'
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            values['Content-Type'] = 'application/json'
        elif method in ('POST', 'PUT', 'DELETE'):
            data = b''
            values['Content-Type'] = 'application/json'
        values['Content-Length'] = str(len(data or b''))
        connection.request(method, path, data, values)
        response = connection.getresponse()
        payload = response.read()
        connection.close()
        if raw:
            return response.status, response.getheader('Location'), payload.decode()
        return response.status, json.loads(payload) if payload else None

    def connect(self, token, user, name):
        if user not in self.fake.users:
            self.fake.add_user(user, name)
        self.fake.next_user = user
        status, value = self.request('POST', f'{self.base}/connect', {}, token)
        self.assertEqual(status, 200, value)
        query = parse_qs(urlsplit(value['authorizeUrl']).query)
        self.assertEqual(query['redirect_uri'], [f'http://127.0.0.1:{self.server.server_port}/spotify/callback'])
        self.assertEqual(query['code_challenge_method'], ['S256'])
        self.assertNotIn('client_secret', query)
        # The browser follows Spotify's redirect: emulate both hops.
        connection = http.client.HTTPConnection('127.0.0.1', self.fake.server.server_port, timeout=5)
        connection.request('GET', urlsplit(value['authorizeUrl']).path + '?' + urlsplit(value['authorizeUrl']).query)
        callback = urlsplit(connection.getresponse().getheader('Location'))
        connection.close()
        return self.request('GET', f'{callback.path}?{callback.query}', headers={'Sec-Fetch-Site': 'cross-site'}, raw=True), callback

    def test_disconnect_during_callback_cannot_restore_consent(self):
        original = self.server.spotify.exchange

        def disconnect(*args):
            self.assertEqual(self.request('DELETE', self.base + '/connection', {}, self.host)[0], 200)
            return original(*args)
        self.server.spotify.exchange = disconnect
        self.connect(self.host, 'ada', 'Ada')
        state = self.request('GET', self.base, token=self.host)[1]
        self.assertIsNone(state['connections']['host'])

    def test_room_deleted_during_callback_keeps_listening_deleted(self):
        original = self.server.spotify.exchange

        def delete(*args):
            self.assertEqual(self.request('DELETE', f'/api/rooms/{self.room}', {}, self.host)[0], 200)
            return original(*args)
        self.server.spotify.exchange = delete
        self.connect(self.host, 'ada', 'Ada')
        self.assertEqual(self.server.listening.connected(), [])

    def test_connect_callback_sync_curate_and_disconnect(self):
        now = int(time.time() * 1000)
        self.fake.add_user('ada', 'Ada')
        self.fake.users['ada']['plays'].append((now - DAY, track('Shared1', 'Our song')))
        (status, location, _), callback = self.connect(self.host, 'ada', 'Ada')
        self.assertEqual((status, location), (303, f'/?room={self.room}'))
        replay = self.request('GET', f'{callback.path}?{callback.query}', headers={'Sec-Fetch-Site': 'cross-site'}, raw=True)
        self.assertEqual(replay[0], 400, 'authorization state is single use')

        self.fake.users['ben'] = {'name': 'Ben', 'plays': [(now - 2 * DAY, track('Shared1', 'Our song'))], 'likes': []}
        self.fake.next_user = 'ben'
        status, value = self.request('POST', f'{self.base}/connect', {}, self.guest)
        authorize = urlsplit(value['authorizeUrl'])
        connection = http.client.HTTPConnection('127.0.0.1', self.fake.server.server_port, timeout=5)
        connection.request('GET', f'{authorize.path}?{authorize.query}')
        callback = urlsplit(connection.getresponse().getheader('Location'))
        connection.close()
        self.assertEqual(self.request('GET', f'{callback.path}?{callback.query}', raw=True)[0], 303)

        status, state = self.request('GET', self.base, token=self.guest)
        self.assertEqual(status, 200)
        self.assertEqual(state['connections']['host']['displayName'], 'Ada')
        self.assertEqual([entry['key'] for entry in state['entries']], ['both-Shared1'])
        self.assertEqual(state['redirectUri'], f'http://127.0.0.1:{self.server.server_port}/spotify/callback')
        self.assertNotIn('refresh', json.dumps(state).lower(), 'credentials never leave the service')

        self.fake.users['ada']['plays'].append((now + MINUTE, track('Fresh1', 'Fresh')))
        status, state = self.request('POST', f'{self.base}/sync', {}, self.host)
        self.assertEqual(sorted(entry['key'] for entry in state['entries']), ['both-Shared1', 'new-host-Fresh1'])
        status, state = self.request('PUT', f'{self.base}/entries/new-host-Fresh1', {'hidden': True, 'caption': ''}, self.guest)
        self.assertEqual((status, state['hiddenCount']), (200, 1))
        status, hidden = self.request('GET', f'{self.base}/hidden', token=self.host)
        self.assertTrue(any(entry['key'] == 'new-host-Fresh1' and entry['hidden'] for entry in hidden['entries']))

        status, state = self.request('POST', f'{self.base}/manual',
                                     {'date': '2025-06-01', 'title': 'Our first concert', 'song': 'Our song', 'note': 'Rain'}, self.guest)
        self.assertEqual(status, 201)
        manual = next(entry for entry in state['entries'] if entry['kind'] == 'manual')
        self.assertEqual(self.request('DELETE', f"{self.base}/manual/{manual['id']}", {}, self.host)[0], 403)
        self.assertEqual(self.request('PUT', f"{self.base}/manual/{manual['id']}",
                                      {'date': '2025-06-02', 'title': 'Concert', 'song': '', 'note': ''}, self.guest)[0], 200)

        status, state = self.request('DELETE', f'{self.base}/connection', {}, self.host)
        self.assertIsNone(state['connections']['host'])
        self.assertEqual([entry['kind'] for entry in state['entries']], ['manual'])
        self.assertEqual(self.request('DELETE', f'/api/rooms/{self.room}', {}, self.host)[0], 200)
        self.assertEqual(self.server.listening.state(self.room, configured=True)['entries'], [])

    def test_playlist_preview_and_creation_over_http(self):
        now = int(time.time() * 1000)
        self.fake.add_user('ada', 'Ada')
        self.fake.users['ada']['plays'].append((now - DAY, track('Shared1', 'Our song')))
        self.fake.add_user('ben', 'Ben')
        self.fake.users['ben']['plays'].append((now - DAY, track('Shared1', 'Our song')))
        self.connect(self.host, 'ada', 'Ada')
        self.connect(self.guest, 'ben', 'Ben')
        selection = {'kinds': ['both'], 'from': '', 'to': '', 'memoriesOnly': False}
        status, preview = self.request('POST', f'{self.base}/playlists/preview', {'selection': selection}, self.guest)
        self.assertEqual((status, [song['id'] for song in preview['tracks']]), (200, ['Shared1']))
        self.assertEqual(self.request('POST', f'{self.base}/playlists/preview', {'selection': {}}, self.guest)[0], 400)
        self.assertEqual(self.request('POST', f'{self.base}/playlists', {'name': 'Ours', 'selection': selection})[0], 401)
        status, created = self.request('POST', f'{self.base}/playlists', {'name': 'Ours', 'selection': selection}, self.guest)
        self.assertEqual(status, 201, created)
        self.assertEqual(created['listening']['playlists'][0]['url'], created['playlist']['url'])
        self.assertTrue(created['listening']['connections']['host']['canCreatePlaylists'])
        self.assertEqual(self.fake.playlists[created['playlist']['id']]['user'], 'ben', 'made in the requester’s own account')
        # The other participant sees it in the shared state.
        status, state = self.request('GET', self.base, token=self.host)
        self.assertEqual([item['name'] for item in state['playlists']], ['Ours'])

    def test_refused_authorization_is_reported_without_connecting(self):
        self.fake.next_user = None
        status, value = self.request('POST', f'{self.base}/connect', {}, self.host)
        authorize = urlsplit(value['authorizeUrl'])
        connection = http.client.HTTPConnection('127.0.0.1', self.fake.server.server_port, timeout=5)
        connection.request('GET', f'{authorize.path}?{authorize.query}')
        callback = urlsplit(connection.getresponse().getheader('Location'))
        connection.close()
        self.assertEqual(self.request('GET', f'{callback.path}?{callback.query}', raw=True)[:2], (303, f'/?room={self.room}'))
        status, state = self.request('GET', self.base, token=self.host)
        self.assertIsNone(state['connections']['host'])
        self.assertIn('cancelled or refused', state['authFailures']['host'])

    def test_security_exceptions_stay_narrow(self):
        forged = self.request('GET', '/spotify/callback?code=abc&state=' + 'x' * 43, raw=True)
        self.assertEqual(forged[0], 400, 'unknown state is refused')
        self.assertEqual(self.request('GET', '/api/status?x=1')[0], 400, 'other query strings are still rejected')
        self.assertEqual(self.request('GET', self.base, token=self.host, headers={'Sec-Fetch-Site': 'cross-site'})[0], 403)
        self.assertEqual(self.request('POST', '/spotify/callback?code=a&state=b', {}, raw=True)[0], 400)
        self.assertEqual(self.request('GET', self.base)[0], 401, 'listening state requires a participant')
        self.assertEqual(self.request('PUT', f'{self.base}/entries/both-x', {'hidden': 'yes', 'caption': ''}, self.host)[0], 400)

    def test_unconfigured_services_explain_that_spotify_is_off(self):
        self.server.spotify = None
        status, value = self.request('POST', f'{self.base}/connect', {}, self.host)
        self.assertEqual(status, 409)
        self.assertIn('not set up', value['error'])
        status, state = self.request('GET', self.base, token=self.host)
        self.assertEqual((state['configured'], state['redirectUri']), (False, None))


if __name__ == '__main__':
    unittest.main()
