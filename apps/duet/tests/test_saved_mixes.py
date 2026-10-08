"""Literal named-copy behavior and actual SQLite atomicity checks."""
import concurrent.futures
import copy
import json
from pathlib import Path
import tempfile
import threading
import unittest

from duet.store import DomainError, Store, _validate_record

MAX_REVISION = 2**53 - 1


def compact(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))


class SavedMixTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.clock = [1_700_000_000.0]
        self.store = Store(self.root, now=lambda: self.clock[0])
        self.addCleanup(self.store.close)
        created = self.store.create_room('Original room', 'Host')
        self.room, self.host, self.invite = created['roomId'], created['token'], created['inviteToken']
        self.tracks = [f'{index:032x}' for index in range(1, 4)]
        for index, track in enumerate(self.tracks, 1):
            self.store.add_track(self.room, self.host, track, f' Song {index} 🎵 ', f' Artist {index} ', 10)
        self.store.set_playlist(self.room, self.host, self.tracks[:2], 0)

    def raw(self):
        return self.store.database.execute('SELECT document FROM rooms WHERE id=?', (self.room,)).fetchone()[0]

    def install(self, value, spaced=False):
        text = json.dumps(value, ensure_ascii=False, indent=2) if spaced else compact(value)
        self.store.database.execute('UPDATE rooms SET document=? WHERE id=?', (text, self.room))
        return text

    def snap(self):
        return self.store.snapshot(self.room, self.host)

    def save(self, name='Date night', token=None):
        view = self.snap()
        return self.store.save_mix(self.room, token or self.host, name, view['playlistRevision'], view['savedMixesRevision'])

    def fail(self, status, call, *args):
        before = self.raw()
        with self.assertRaises(DomainError) as caught:
            call(*args)
        self.assertEqual(caught.exception.status, status)
        self.assertEqual(self.raw(), before)

    def test_exact_literal_snapshot_detached_and_new_schema(self):
        self.assertEqual(json.loads(self.raw())['schemaVersion'], 2)
        result = self.save('  Date <night> 🎵\n  ')
        self.assertEqual(set(result), {'mixId', 'room'})
        mix = result['room']['savedMixes'][0]
        self.assertEqual(mix, {'id': result['mixId'], 'name': '  Date <night> 🎵\n  ', 'entries': [
            {'trackId': self.tracks[0], 'title': ' Song 1 🎵 ', 'artist': ' Artist 1 '},
            {'trackId': self.tracks[1], 'title': ' Song 2 🎵 ', 'artist': ' Artist 2 '}]})
        mix['entries'][0]['title'] = 'external'
        self.assertEqual(self.snap()['savedMixes'][0]['entries'][0]['title'], ' Song 1 🎵 ')
        for secret in [self.host, self.invite]:
            self.assertNotIn(secret, json.dumps(result))

    def test_metadata_votes_transport_and_seat_independence(self):
        guest = self.store.join_room(self.room, self.invite, 'Guest')['token']
        self.store.rate(self.room, self.host, self.tracks[0], 1)
        self.store.set_playback(self.room, self.host, self.tracks[0], True, 3, 0)
        baseline = json.loads(self.raw())
        first, second = self.save('Same', guest)['mixId'], self.save('Same')['mixId']
        self.store.rename_mix(self.room, guest, first, 'Renamed', 2)
        self.store.update_mix(self.room, guest, first, 1, 3)
        after = self.store.delete_mix(self.room, guest, second, 4)
        self.assertEqual(after['savedMixesRevision'], 5)
        self.assertEqual([mix['id'] for mix in after['savedMixes']], [first])
        for field in ['playlist', 'playlistRevision', 'playback', 'ratings', 'capabilities', 'inviteHash', 'tracks', 'memories']:
            self.assertEqual(json.loads(self.raw())[field], baseline[field])

    def test_current_build_and_update_do_not_edit_saved_copy_implicitly(self):
        mix = self.save()['mixId']
        original = copy.deepcopy(self.snap()['savedMixes'])
        self.store.set_playlist(self.room, self.host, [self.tracks[2]], 1)
        self.assertEqual(self.snap()['savedMixes'], original)
        self.fail(409, self.store.update_mix, self.room, self.host, mix, 1, 1)
        result = self.store.update_mix(self.room, self.host, mix, 2, 1)
        self.assertEqual(result['savedMixes'][0]['entries'][0]['trackId'], self.tracks[2])
        self.store.build_playlist(self.room, self.host, 2)
        self.assertEqual(self.snap()['savedMixes'], result['savedMixes'])

    def test_load_pauses_first_zero_and_stales_old_command_even_identical_order(self):
        mix = self.save()['mixId']
        self.store.set_playback(self.room, self.host, self.tracks[1], True, 4, 0)
        result = self.store.load_mix(self.room, self.host, mix, 1, 1, 1, False)
        self.assertEqual(result['playlist'], self.tracks[:2])
        self.assertEqual(result['playlistRevision'], 2)
        self.assertEqual(result['savedMixesRevision'], 1)
        self.assertEqual(result['playback'], {'trackId': self.tracks[0], 'playing': False, 'position': 0.0, 'revision': 2})
        self.fail(409, self.store.set_playback, self.room, self.host, self.tracks[1], True, 4, 1)
        result = self.store.load_mix(self.room, self.host, mix, 1, 2, 2, False)
        self.assertEqual(result['playback']['revision'], 3)

    def test_removed_labels_explicit_available_only_and_all_missing(self):
        mix = self.save()['mixId']
        saved = copy.deepcopy(self.snap()['savedMixes'])
        self.store.delete_track(self.room, self.host, self.tracks[0])
        self.fail(409, self.store.load_mix, self.room, self.host, mix, 1, 2, 0, False)
        self.fail(400, self.store.load_mix, self.room, self.host, mix, 1, 2, 0, 1)
        result = self.store.load_mix(self.room, self.host, mix, 1, 2, 0, True)
        self.assertEqual(result['playlist'], [self.tracks[1]])
        self.assertEqual(result['savedMixes'], saved)
        self.store.delete_track(self.room, self.host, self.tracks[1])
        view = self.snap()
        self.fail(409, self.store.load_mix, self.room, self.host, mix, 1, view['playlistRevision'], view['playback']['revision'], True)

    def test_effective_conflict_materializes_natural_transition_monotonically(self):
        mix = self.save()['mixId']
        self.store.set_playback(self.room, self.host, self.tracks[0], True, 9, 0)
        self.clock[0] += 2
        with self.assertRaises(DomainError) as caught:
            self.store.load_mix(self.room, self.host, mix, 1, 1, 1, False)
        self.assertEqual(caught.exception.status, 409)
        anchor = json.loads(self.raw())['playback']
        self.assertEqual((anchor['trackId'], anchor['revision'], anchor['position']), (self.tracks[1], 2, 1))
        self.clock[0] -= 20
        self.assertEqual(self.snap()['playback']['revision'], 2)
        self.assertEqual(self.store.load_mix(self.room, self.host, mix, 1, 1, 2, False)['playback']['revision'], 3)

    def test_capacity_empty_invalid_unicode_and_revisions_are_atomic(self):
        first = self.save('🎵' * 80)['mixId']
        for name in ['🎵' * 81, '', ' \t\n ', '\0', '\ud800', None]:
            self.fail(400, self.store.save_mix, self.room, self.host, name, 1, 1)
        self.fail(401, self.store.save_mix, self.room, 'f' * 64, 'Valid', 1, 1)
        for _ in range(7):
            self.save('Same')
        self.fail(409, self.store.save_mix, self.room, self.host, 'Ninth', 1, 8)
        self.fail(409, self.store.rename_mix, self.room, self.host, first, 'New', 0)
        for revision in [True, -1, 1.0, MAX_REVISION + 1]:
            self.fail(400, self.store.delete_mix, self.room, self.host, first, revision)
        self.fail(404, self.store.rename_mix, self.room, self.host, 'f' * 32, 'New', 8)
        self.store.set_playlist(self.room, self.host, [], 1)
        self.fail(409, self.store.update_mix, self.room, self.host, first, 2, 8)

    def test_revision_exhaustion_refuses_before_increment(self):
        mix = self.save()['mixId']
        original = json.loads(self.raw())
        value = copy.deepcopy(original)
        value['savedMixesRevision'] = MAX_REVISION
        self.install(value)
        self.fail(409, self.store.rename_mix, self.room, self.host, mix, 'New', MAX_REVISION)
        for field in ['playlistRevision', 'playback']:
            value = copy.deepcopy(original)
            if field == 'playback':
                value[field]['revision'] = MAX_REVISION
            else:
                value[field] = MAX_REVISION
            self.install(value)
            self.fail(409, self.store.load_mix, self.room, self.host, mix, 1, value['playlistRevision'], value['playback']['revision'], False)

    def test_legacy_reads_and_automatic_pause_do_not_promote(self):
        value = json.loads(self.raw())
        value['schemaVersion'] = 1
        value.pop('savedMixes', None)
        value.pop('savedMixesRevision', None)
        text = self.install(value, spaced=True)
        self.assertIs(_validate_record(value, self.room), value)
        self.assertEqual(self.snap()['savedMixes'], [])
        self.assertEqual(self.raw(), text)
        other = Store(self.root, now=lambda: self.clock[0])
        self.addCleanup(other.close)
        self.assertEqual(self.raw(), text)
        self.fail(409, self.store.set_playlist, self.room, self.host, [], 0)
        self.store.pause_all()
        self.assertEqual(json.loads(self.raw())['schemaVersion'], 1)
        self.store.rate(self.room, self.host, self.tracks[0], 1)
        promoted = json.loads(self.raw())
        self.assertEqual(promoted['schemaVersion'], 2)
        self.assertEqual(promoted['savedMixes'], [])
        self.assertEqual(promoted['capabilities'], value['capabilities'])

    def test_two_connection_cas_one_winner_and_real_failed_write_rolls_back(self):
        other = Store(self.root, now=lambda: self.clock[0])
        self.addCleanup(other.close)
        barrier = threading.Barrier(2)
        def save(store):
            barrier.wait()
            try:
                store.save_mix(self.room, self.host, 'Concurrent', 1, 0)
                return 'saved'
            except DomainError as error:
                return error.status
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            result = list(pool.map(save, [self.store, other]))
        self.assertCountEqual(result, ['saved', 409])
        mix = self.snap()['savedMixes'][0]['id']
        self.store.database.execute("CREATE TRIGGER reject_write BEFORE UPDATE ON rooms BEGIN SELECT RAISE(ABORT, 'private failure'); END")
        self.fail(500, self.store.rename_mix, self.room, self.host, mix, 'Rejected', 1)
        self.store.database.execute('DROP TRIGGER reject_write')
        self.assertEqual(self.store.rename_mix(self.room, self.host, mix, 'Retry', 1)['savedMixesRevision'], 2)

    def test_exact_365429_bytes_preserve_262144_byte_core_and_complete_export(self):
        core = json.loads(self.raw())
        core['schemaVersion'] = 1
        core.pop('savedMixes')
        core.pop('savedMixesRevision')
        core['memories'] = [{'id': f'{index + 200:032x}', 'trackId': self.tracks[0],
                             'trackTitle': 'Original', 'date': '2026-10-05', 'text': 'x' * 500,
                             'author': 'host', 'createdAt': 1_700_000_000_000} for index in range(100)]
        controls, quotes = divmod(262144 - len(compact(core).encode()), 5)
        for memory in core['memories']:
            count = min(controls, 500)
            memory['text'] = '\x01' * count + 'x' * (500 - count)
            controls -= count
        self.assertEqual(controls, 0)
        core['memories'][-1]['text'] = '"' * quotes + core['memories'][-1]['text'][quotes:]
        self.assertEqual(len(compact(core).encode()), 262144)
        self.assertIs(_validate_record(core, self.room), core)
        entries = [{'trackId': f'{index:032x}', 'title': '\x01' * 80, 'artist': '\x01' * 80} for index in range(12)]
        mixes = [{'id': f'{index + 100:032x}', 'name': '\x01' * 80,
                  'entries': copy.deepcopy(entries)} for index in range(8)]
        value = {**core, 'schemaVersion': 2, 'savedMixes': mixes, 'savedMixesRevision': MAX_REVISION}
        self.assertEqual(len(compact(entries[0]).encode()), 1029)
        self.assertEqual(len(compact(mixes[0]).encode()), 12903)
        self.assertEqual(len(compact(mixes).encode()), 103233)
        self.assertEqual(len(compact(value).encode()), 365429)
        self.assertIs(_validate_record(value, self.room), value)
        self.install(value)
        exported = self.store.export_room(self.room, self.host)
        self.assertEqual(exported['schemaVersion'], 2)
        self.assertEqual(exported['savedMixes'], mixes)
        self.assertEqual(len(exported['memories']), 100)
        self.assertLessEqual(len(json.dumps(exported, ensure_ascii=False).encode()), 393216)
        # One extra escaped byte in the unchanged core must refuse even if
        # the saved mix array is tiny and aggregate remains below365429.
        invalid = copy.deepcopy(value)
        invalid['savedMixes'] = []
        text = invalid['memories'][-1]['text']
        index = text.index('x')
        invalid['memories'][-1]['text'] = text[:index] + '"' + text[index + 1:]
        with self.assertRaises(DomainError) as caught:
            _validate_record(invalid, self.room)
        self.assertEqual(caught.exception.status, 500)
        # The native raw-length gate also rejects bound+1 before parsing.
        before = compact(value) + ' '
        self.store.database.execute('UPDATE rooms SET document=? WHERE id=?', (before, self.room))
        with self.assertRaises(DomainError):
            self.snap()
        self.assertEqual(self.raw(), before)

    def test_exact_record_shapes_and_entry_uniqueness_reject_corruption(self):
        self.save()
        value = json.loads(self.raw())
        self.assertIs(_validate_record(value, self.room), value)
        bad = []
        legacy_mixed = copy.deepcopy(value)
        legacy_mixed['schemaVersion'] = 1
        bad.append(legacy_mixed)
        unknown = copy.deepcopy(value)
        unknown['savedMixes'][0]['entries'][0]['available'] = True
        bad.append(unknown)
        duplicate = copy.deepcopy(value)
        duplicate['savedMixes'][0]['entries'].append(copy.deepcopy(duplicate['savedMixes'][0]['entries'][0]))
        bad.append(duplicate)
        oversize = copy.deepcopy(value)
        oversize['savedMixes'][0]['entries'] = [{'trackId': f'{index:032x}', 'title': 'Original', 'artist': ''} for index in range(13)]
        bad.append(oversize)
        boolean = copy.deepcopy(value)
        boolean['savedMixesRevision'] = True
        bad.append(boolean)
        for candidate in bad:
            original = copy.deepcopy(candidate)
            with self.subTest(candidate=candidate):
                with self.assertRaises(DomainError):
                    _validate_record(candidate, self.room)
                self.assertEqual(candidate, original)

    def test_legacy_natural_transition_and_rejected_load_do_not_promote(self):
        value = json.loads(self.raw())
        value['schemaVersion'] = 1
        value.pop('savedMixes')
        value.pop('savedMixesRevision')
        value['playback'].update(trackId=self.tracks[0], playing=True, position=9, revision=1)
        self.install(value)
        self.clock[0] += 2
        self.assertEqual(self.snap()['playback']['revision'], 2)
        self.assertEqual(json.loads(self.raw())['schemaVersion'], 1)
        self.fail(404, self.store.load_mix, self.room, self.host, 'f' * 32, 0, 1, 2, False)
        self.assertEqual(json.loads(self.raw())['schemaVersion'], 1)


if __name__ == '__main__':
    unittest.main()
