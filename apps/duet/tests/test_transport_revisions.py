"""Delayed transport commands cannot rewind a newer song or restart pause."""
import tempfile
from pathlib import Path
import unittest

from duet.store import DomainError, Store


class TransportRevisionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.clock = [1_700_000_000.0]
        self.store = Store(self.root, now=lambda: self.clock[0])
        self.addCleanup(lambda: self.store.close())
        created = self.store.create_room('Songs', 'Host')
        self.room, self.token = created['roomId'], created['token']
        self.tracks = [f'{number:032x}' for number in (1, 2, 3)]
        for track in self.tracks:
            self.store.add_track(self.room, self.token, track, 'Song', '', 10)
        self.store.set_playlist(self.room, self.token, self.tracks, 0)

    def view(self):
        return self.store.snapshot(self.room, self.token)['playback']

    def play(self):
        return self.store.set_playback(self.room, self.token, self.tracks[0], True, 0, 0)['playback']

    def stale(self, track, revision, store=None):
        with self.assertRaises(DomainError) as caught:
            (store or self.store).set_playback(self.room, self.token, track, False, 1, revision)
        self.assertEqual(caught.exception.status, 409)

    def test_transition_rejects_stale_command_before_any_poll(self):
        old = self.play()
        self.clock[0] += 12
        self.stale(old['trackId'], old['revision'])
        current = self.view()
        self.assertEqual(current, {'trackId': self.tracks[1], 'playing': True, 'position': 2, 'revision': 2})
        updated = self.store.set_playback(self.room, self.token, current['trackId'], False, 2, 2)
        self.assertEqual(updated['playback']['revision'], 3)

    def test_polling_materializes_transition_once_across_connections(self):
        self.play()
        self.clock[0] += 22
        self.assertEqual(self.view()['revision'], 3)
        other = Store(self.root, now=lambda: self.clock[0])
        self.addCleanup(other.close)
        self.assertEqual(other.snapshot(self.room, self.token)['playback']['revision'], 3)
        self.stale(self.tracks[0], 1, other)
        self.clock[0] += 1
        self.assertEqual(self.view(), {'trackId': self.tracks[2], 'playing': True, 'position': 3, 'revision': 3})
        self.clock[0] -= 20
        self.assertEqual(self.view()['revision'], 3)
        self.assertEqual(self.view()['trackId'], self.tracks[2])

    def test_final_stop_rejects_delayed_play_command(self):
        old = self.play()
        self.clock[0] += 30
        self.stale(old['trackId'], old['revision'])
        self.assertEqual(self.view(), {'trackId': self.tracks[2], 'playing': False, 'position': 10, 'revision': 4})
        self.clock[0] += 100
        self.assertEqual(self.view()['revision'], 4)

    def test_materialized_playlist_and_deletion_do_not_lose_transition_revision(self):
        self.play()
        self.clock[0] += 12
        changed = self.store.set_playlist(self.room, self.token, self.tracks[1:], 1)
        self.assertEqual(changed['playback']['revision'], 2)
        self.stale(self.tracks[0], 1)
        self.store.delete_track(self.room, self.token, self.tracks[0])
        self.assertEqual(self.view()['revision'], 2)
        self.clock[0] += 10
        self.assertEqual(self.view(), {'trackId': self.tracks[2], 'playing': True, 'position': 2, 'revision': 3})

    def test_restart_pause_invalidates_prior_commands_once(self):
        self.play()
        self.clock[0] += 12
        self.store.close()
        self.store = Store(self.root, now=lambda: self.clock[0])
        self.store.pause_all()
        self.stale(self.tracks[0], 1)
        self.assertEqual(self.view(), {'trackId': self.tracks[1], 'playing': False, 'position': 2, 'revision': 3})
        self.store.pause_all()
        self.assertEqual(self.view()['revision'], 3)

    def test_ordinary_elapsed_playback_keeps_revision(self):
        self.play()
        self.clock[0] += 3
        self.assertEqual(self.view(), {'trackId': self.tracks[0], 'playing': True, 'position': 3, 'revision': 1})
        self.store.set_playback(self.room, self.token, self.tracks[0], False, 3, 1)
        self.assertEqual(self.view()['revision'], 2)

    def test_rejected_command_materializes_observed_transition_before_clock_reversal(self):
        self.play()
        self.clock[0] += 12
        self.stale(self.tracks[0], 1)
        self.clock[0] -= 5
        self.stale(self.tracks[0], 1)
        self.assertEqual(self.view(), {'trackId': self.tracks[1], 'playing': True, 'position': 2, 'revision': 2})
