import concurrent.futures
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest

from duet.store import DomainError, Store


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.clock = [1_700_000_000.0]
        self.store = Store(self.root, now=lambda: self.clock[0])
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(lambda: self.store.close())
        self.created = self.store.create_room('Shared songs', 'Host')
        self.room_id, self.host = self.created['roomId'], self.created['token']

    def join(self):
        return self.store.join_room(self.room_id, self.created['inviteToken'], 'Guest')['token']

    def add(self, n=1, duration=10, token=None):
        track = f'{n:032x}'
        self.store.add_track(self.room_id, token or self.host, track, f'Song {n}', '', duration)
        return track

    def snap(self):
        return self.store.snapshot(self.room_id, self.host)

    def failure(self, status, call, *args):
        with self.assertRaises(DomainError) as caught:
            call(*args)
        self.assertEqual(caught.exception.status, status)

    def test_capabilities_are_private_hashed_and_snapshots_are_independent(self):
        guest = self.join()
        self.assertEqual(self.store.authenticate(self.room_id, self.host), 'host')
        self.assertEqual(self.store.authenticate(self.room_id, guest), 'guest')
        view = self.snap()
        self.assertEqual(view['profiles'], {'host': {'name': 'Host'}, 'guest': {'name': 'Guest'}})
        self.assertEqual(view['serverTime'], self.clock[0] * 1000)
        view['profiles']['host']['name'] = 'Changed externally'
        self.assertEqual(self.snap()['profiles']['host']['name'], 'Host')
        self.failure(401, self.store.authenticate, self.room_id, '0' * 64)
        with sqlite3.connect(self.root / 'rooms.sqlite3') as database:
            disk = '\n'.join(database.iterdump())
        for secret in [self.host, guest, self.created['inviteToken']]:
            self.assertNotIn(secret, disk)
            self.assertNotIn(secret, json.dumps(self.snap()))

    def test_invite_rotation_host_only_and_join_is_one_use(self):
        replacement = self.store.rotate_invite(self.room_id, self.host)['inviteToken']
        self.failure(401, self.store.join_room, self.room_id, self.created['inviteToken'], 'Guest')
        guest = self.store.join_room(self.room_id, replacement, 'Guest')['token']
        self.failure(409, self.store.join_room, self.room_id, replacement, 'Other')
        self.failure(403, self.store.rotate_invite, self.room_id, guest)
        self.failure(409, self.store.rotate_invite, self.room_id, self.host)

    def test_concurrent_join_has_exactly_one_winner_across_connections(self):
        other = Store(self.root, now=lambda: self.clock[0])
        self.addCleanup(other.close)
        barrier = threading.Barrier(2)
        def claim(store):
            barrier.wait()
            try:
                return store.join_room(self.room_id, self.created['inviteToken'], 'Guest')['token']
            except DomainError as error:
                return error.status
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            results = list(pool.map(claim, [self.store, other]))
        self.assertEqual(sum(isinstance(item, str) for item in results), 1)
        self.assertIn(409, results)

    def test_rating_blend_is_deterministic_and_changes_only_callers_rating(self):
        guest = self.join()
        votes = [(1, 1), (1, 0), (0, 0), (1, -1), (-1, 0), (-1, -1)]
        tracks = [self.add(n) for n in range(1, 7)]
        for track, (host_vote, guest_vote) in zip(tracks, votes):
            self.store.rate(self.room_id, self.host, track, host_vote)
            self.store.rate(self.room_id, guest, track, guest_vote)
        snapshot = self.snap()
        self.assertEqual([item['category'] for item in snapshot['blend']], ['mutual', 'discovery', 'unrated', 'mixed', 'avoid', 'avoid'])
        self.assertEqual([item['trackId'] for item in snapshot['blend']], tracks)
        self.assertTrue(all(item['reason'] for item in snapshot['blend']))
        self.assertEqual(snapshot['ratings'][tracks[3]], {'host': 1, 'guest': -1})
        mixed = self.store.build_playlist(self.room_id, guest, 0)
        self.assertEqual(mixed['playlist'], tracks[:4])
        self.assertEqual(mixed['playlistRevision'], 1)
        self.assertEqual(mixed['playback']['revision'], 0)

    def test_playback_advances_clamps_and_keeps_command_revision(self):
        first, second, third = [self.add(n) for n in range(1, 4)]
        self.store.set_playlist(self.room_id, self.host, [first, second, third], 0)
        playing = self.store.set_playback(self.room_id, self.host, first, True, 8, 0)
        self.assertEqual(playing['playback']['revision'], 1)
        self.clock[0] += 5
        self.assertEqual(self.snap()['playback'], {'trackId': second, 'playing': True, 'position': 3.0, 'revision': 1})
        self.clock[0] += 20
        self.assertEqual(self.snap()['playback'], {'trackId': third, 'playing': False, 'position': 10.0, 'revision': 1})
        self.store.set_playback(self.room_id, self.host, None, False, 0, 1)
        self.assertIsNone(self.snap()['playback']['trackId'])

    def test_playlist_edits_preserve_elapsed_position_and_revisions_are_independent(self):
        first, second = self.add(1), self.add(2)
        self.store.set_playlist(self.room_id, self.host, [first, second], 0)
        self.store.set_playback(self.room_id, self.host, first, True, 9, 0)
        self.clock[0] += 4
        updated = self.store.set_playlist(self.room_id, self.host, [second], 1)
        self.assertEqual(updated['playback'], {'trackId': second, 'playing': True, 'position': 3.0, 'revision': 1})
        self.store.rate(self.room_id, self.host, first, 1)
        self.failure(409, self.store.set_playlist, self.room_id, self.host, [], 1)
        self.failure(409, self.store.set_playback, self.room_id, self.host, second, False, 3, 0)
        self.store.set_playback(self.room_id, self.host, second, False, 3, 1)
        self.assertEqual(self.snap()['playlistRevision'], 2)

    def test_concurrent_playback_commands_reject_stale_revision(self):
        track = self.add()
        barrier = threading.Barrier(2)
        def command(position):
            barrier.wait()
            try:
                return self.store.set_playback(self.room_id, self.host, track, True, position, 0)['playback']['revision']
            except DomainError as error:
                return error.status
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            self.assertCountEqual(list(pool.map(command, [2, 4])), [1, 409])

    def test_deleting_effective_track_resets_playback_but_retains_memory(self):
        guest = self.join()
        first, second = self.add(1), self.add(2, token=guest)
        self.store.add_memory(self.room_id, guest, second, '2024-02-29', 'A real shared moment')
        self.store.set_playlist(self.room_id, self.host, [first, second], 0)
        self.store.set_playback(self.room_id, self.host, first, True, 9, 0)
        self.clock[0] += 3
        result = self.store.delete_track(self.room_id, guest, second)
        self.assertEqual(result['playback'], {'trackId': None, 'playing': False, 'position': 0, 'revision': 2})
        self.assertEqual(result['playlist'], [first])
        self.assertEqual(result['playlistRevision'], 2)
        self.assertNotIn(second, result['ratings'])
        self.assertEqual(result['memories'][0]['trackTitle'], 'Song 2')
        self.failure(403, self.store.delete_track, self.room_id, guest, first)

    def test_deleting_elapsed_anchor_track_keeps_effective_playback(self):
        first, second = self.add(1), self.add(2)
        self.store.set_playlist(self.room_id, self.host, [first, second], 0)
        self.store.set_playback(self.room_id, self.host, first, True, 9, 0)
        self.clock[0] += 4
        result = self.store.delete_track(self.room_id, self.host, first)
        self.assertEqual(result['playback'], {'trackId': second, 'playing': True, 'position': 3, 'revision': 1})
        self.clock[0] += 2
        self.assertEqual(self.snap()['playback']['position'], 5)

    def test_memory_dates_authorship_and_export_exclude_secrets(self):
        guest, track = self.join(), self.add()
        snapshot = self.store.add_memory(self.room_id, guest, track, '2024-02-29', '<script>literal words</script>')
        memory = snapshot['memories'][0]
        self.failure(403, self.store.delete_memory, self.room_id, self.host, memory['id'])
        for date in ['2023-02-29', '1899-12-31', '2101-01-01', '20240101']:
            self.failure(400, self.store.add_memory, self.room_id, guest, track, date, 'Words')
        exported = self.store.export_room(self.room_id, guest)
        self.assertEqual(exported['schemaVersion'], 1)
        self.assertNotIn('myRole', exported)
        self.assertNotIn('serverTime', exported)
        self.assertEqual(exported['memories'][0]['text'], memory['text'])
        for secret in [self.host, guest, self.created['inviteToken']]:
            self.assertNotIn(secret, json.dumps(exported))
        self.assertEqual(self.store.delete_memory(self.room_id, guest, memory['id'])['memories'], [])

    def test_reopen_preserves_data_and_pause_all_captures_effective_position(self):
        track = self.add()
        self.store.set_playback(self.room_id, self.host, track, True, 2, 0)
        self.clock[0] += 3
        self.store.close()
        self.store = Store(self.root, now=lambda: self.clock[0])
        self.store.pause_all()
        self.clock[0] += 100
        self.assertEqual(self.snap()['playback'], {'trackId': track, 'playing': False, 'position': 5.0, 'revision': 1})

    def test_room_quota_and_host_only_deletion(self):
        guest = self.join()
        for _ in range(4):
            self.store.create_room('Room', 'Host')
        self.failure(409, self.store.create_room, 'Overflow', 'Host')
        self.failure(403, self.store.delete_room, self.room_id, guest)
        self.store.delete_room(self.room_id, self.host)
        self.failure(404, self.store.snapshot, self.room_id, self.host)
        self.store.create_room('Replacement', 'Host')

    def test_validation_limits_and_failed_mutations_preserve_state(self):
        track = self.add()
        baseline = self.snap()
        for vote in [True, 2, -2, '1', 0.5]:
            self.failure(400, self.store.rate, self.room_id, self.host, track, vote)
        for position in [True, -1, 11, float('nan'), float('inf')]:
            self.failure(400, self.store.set_playback, self.room_id, self.host, track, True, position, 0)
        self.failure(400, self.store.set_playback, self.room_id, self.host, track, 1, 0, 0)
        self.failure(400, self.store.set_playback, self.room_id, self.host, None, True, 0, 0)
        self.failure(400, self.store.set_playlist, self.room_id, self.host, [track, track], 0)
        self.failure(404, self.store.rate, self.room_id, self.host, 'f' * 32, 1)
        self.assertEqual(self.snap(), baseline)
        for n in range(2, 13):
            self.add(n)
        self.failure(409, self.store.add_track, self.room_id, self.host, 'f' * 32, 'Full', '', 1)
        for _ in range(100):
            self.store.add_memory(self.room_id, self.host, track, '2000-01-01', 'x' * 500)
        self.failure(409, self.store.add_memory, self.room_id, self.host, track, '2000-01-01', 'overflow')

    def test_invalid_persisted_state_is_reported_at_startup_without_replacing_it(self):
        self.store.close()
        with sqlite3.connect(self.root / 'rooms.sqlite3') as database:
            original = database.execute('SELECT document FROM rooms').fetchone()[0]
            bad = json.loads(original)
            bad['playlist'] = ['f' * 32]
            altered = json.dumps(bad)
            database.execute('UPDATE rooms SET document=?', (altered,))
        with self.assertRaisesRegex(DomainError, 'stored|Stored|saved|Saved'):
            unexpected = Store(self.root)
            unexpected.close()
        with sqlite3.connect(self.root / 'rooms.sqlite3') as database:
            self.assertEqual(database.execute('SELECT document FROM rooms').fetchone()[0], altered)

    def test_cross_room_capabilities_never_authorize_another_room(self):
        other = self.store.create_room('Other', 'Elsewhere')
        self.failure(401, self.store.snapshot, other['roomId'], self.host)
        self.failure(401, self.store.snapshot, self.room_id, other['token'])
        self.failure(401, self.store.join_room, self.room_id, other['inviteToken'], 'Guest')
        self.failure(401, self.store.snapshot, self.room_id, self.created['inviteToken'])

    def test_paused_or_unlisted_tracks_do_not_auto_advance_and_clock_reversal_cannot_rewind(self):
        first, second = self.add(1), self.add(2)
        self.store.set_playlist(self.room_id, self.host, [first], 0)
        self.store.set_playback(self.room_id, self.host, second, True, 8, 0)
        self.clock[0] -= 5
        self.assertEqual(self.snap()['playback']['position'], 8)
        self.clock[0] += 20
        self.assertEqual(self.snap()['playback'], {'trackId': second, 'playing': False, 'position': 10, 'revision': 1})
        self.store.set_playback(self.room_id, self.host, first, False, 2, 1)
        self.clock[0] += 20
        self.assertEqual(self.snap()['playback']['position'], 2)

    def test_text_and_duration_boundaries_are_strict_without_coercion(self):
        for title, name in [('', 'Name'), ('x' * 81, 'Name'), ('Room', 'x' * 41), ('Room', True), ('Room', '\ud800')]:
            self.failure(400, self.store.create_room, title, name)
        for duration in [True, 0.999, 300.001, '5', 10**1000, float('nan')]:
            self.failure(400, self.store.add_track, self.room_id, self.host, 'e' * 32, 'Track', '', duration)
        self.add(1, 1)
        self.add(2, 300)

    def test_failed_database_write_rolls_back_without_changing_preferences(self):
        track = self.add()
        original = self.snap()
        with sqlite3.connect(self.root / 'rooms.sqlite3') as database:
            database.execute("CREATE TRIGGER refuse_update BEFORE UPDATE ON rooms BEGIN SELECT RAISE(ABORT, 'fixture disk failure'); END")
        self.failure(500, self.store.rate, self.room_id, self.host, track, 1)
        self.assertEqual(self.snap(), original)

    def test_maximum_unicode_memories_export_within_limit_without_ascii_amplification(self):
        track = self.add()
        for _ in range(100):
            self.store.add_memory(self.room_id, self.host, track, '2000-01-01', '😀' * 500)
        exported = self.store.export_room(self.room_id, self.host)
        self.assertEqual(len(exported['memories']), 100)
        self.assertLessEqual(len(json.dumps(exported, ensure_ascii=False).encode('utf-8')), 256 * 1024)


if __name__ == '__main__':
    unittest.main()
