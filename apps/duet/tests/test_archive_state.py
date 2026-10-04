"""Literal private-state and pinned SQLite archive gates, without Store writes."""
import copy
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from threading import Event
import time
import unittest
from unittest.mock import patch

from duet.archive_common import (
    ArchiveError, MAX_DATABASE_BYTES, MAX_REVISION, MAX_ROOM_BYTES, MAX_ROOMS_JSON_BYTES,
    canonical_json, check_archive, parse_json,
)
from duet.archive_state import paused_rooms, read_library, validate_rooms, write_database


def record(room_id='a' * 32, paired=True):
    tracks = [{'id': tid * 32, 'title': 'Song ' + tid, 'artist': 'Original artist',
               'duration': 12.25, 'uploadedBy': 'host', 'createdAt': 1000}
              for tid in ('2', '1')]
    return {'schemaVersion': 1, 'id': room_id, 'title': 'Private café room', 'createdAt': 1000,
            'profiles': {'host': {'name': 'Host'}, 'guest': {'name': 'Guest'} if paired else None},
            'capabilities': {'host': 'a' * 64, 'guest': 'b' * 64 if paired else None},
            'inviteHash': None if paired else 'c' * 64, 'tracks': tracks,
            'ratings': {t['id']: {'host': 1, 'guest': -1 if paired else 0} for t in tracks},
            'playlist': [tracks[1]['id'], tracks[0]['id']], 'playlistRevision': 7,
            'playback': {'trackId': tracks[1]['id'], 'playing': True, 'position': 3.125,
                         'revision': 8, 'updatedAt': 2000},
            'memories': [{'id': '9' * 32, 'trackId': 'e' * 32, 'trackTitle': 'Deleted song',
                          'date': '2025-02-28', 'text': 'Keep this memory exactly.',
                          'author': 'host', 'createdAt': 3000}]}


def envelope(rooms):
    return json.dumps({'schemaVersion': 1, 'kind': 'duet-library-records', 'rooms': rooms},
                      ensure_ascii=False, allow_nan=False).encode()


class ArchiveStateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)
        self.cancel = Event()
        self.deadline = time.monotonic() + 30
        self.kw = {'cancel': self.cancel, 'deadline': self.deadline}

    def database(self, rows=None, schema=None):
        path = self.root / ('source' + str(len(list(self.root.iterdir()))) + '.db')
        with sqlite3.connect(path) as db:
            db.execute(schema or 'CREATE TABLE rooms (id TEXT PRIMARY KEY, document TEXT NOT NULL)')
            for room in rows or []:
                db.execute('INSERT INTO rooms VALUES (?,?)', (room['id'], json.dumps(room)))
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        self.addCleanup(os.close, fd)
        return path, fd

    def rejects(self, callback, *args, code=None, **kwargs):
        with self.assertRaises(ArchiveError) as caught:
            callback(*args, **kwargs)
        if code:
            self.assertEqual(caught.exception.code, code)
        self.assertNotIn('PRIVATE_SENTINEL', str(caught.exception))
        return caught.exception

    def test_common_deadline_cancellation_order_and_readonly_error_code(self):
        check_archive(**self.kw)
        for invalid in (True, float('nan'), float('inf'), 'now', 10**1000):
            self.rejects(check_archive, self.cancel, invalid, code='input')
        self.cancel.set()
        self.rejects(check_archive, self.cancel, time.monotonic() - 1, code='cancelled')
        self.cancel.clear()
        self.rejects(check_archive, self.cancel, time.monotonic() - 1, code='timeout')
        error = ArchiveError('format', 'Invalid archive.')
        with self.assertRaises(AttributeError):
            error.code = 'input'

    def test_common_strict_json_and_canonical_writer(self):
        data = b'{"z":[true,null,1.25],"a":"caf\\u00e9 { ["}'
        value = parse_json(data, 1000, **self.kw)
        self.assertEqual(canonical_json(value), '{"a":"café { [","z":[true,null,1.25]}'.encode())
        for raw in (b'{"a":1,"a":2}', b'{"a":{"b":1,"b":2}}', b'NaN', b'1e999',
                    b'{"PRIVATE_SENTINEL":"\\ud800"}', b'{"a":"\\u0000"}', b'"\xff"',
                    b'\xef\xbb\xbf{}', b'[' * 33 + b'0' + b']' * 33):
            with self.subTest(raw=raw[:40]):
                self.rejects(parse_json, raw, 1000, **self.kw)
        self.rejects(parse_json, b'{}', 1, code='limit', **self.kw)
        self.rejects(canonical_json, {'a': float('nan')})
        self.cancel.set()
        self.rejects(parse_json, b'{}', 1000, code='cancelled', **self.kw)

    def test_exact_private_records_order_deleted_memories_and_detached_output(self):
        pending, paired = record('b' * 32, False), record()
        original = copy.deepcopy([pending, paired])
        result = validate_rooms(envelope([pending, paired]), **self.kw)
        value = json.loads(result.rooms_json)
        self.assertEqual(value['rooms'], [paired, pending])
        self.assertEqual(result.room_ids, ('a' * 32, 'b' * 32))
        self.assertEqual([(t.room_id, t.track_id) for t in result.tracks],
                         [('a' * 32, '1' * 32), ('a' * 32, '2' * 32),
                          ('b' * 32, '1' * 32), ('b' * 32, '2' * 32)])
        self.assertEqual((result.memory_count, result.paired_rooms, result.pending_invites), (2, 1, 1))
        self.assertEqual([pending, paired], original)
        value['rooms'][0]['capabilities']['host'] = 'changed'
        self.assertEqual(json.loads(result.rooms_json)['rooms'][0]['capabilities']['host'], 'a' * 64)
        with self.assertRaises(AttributeError):
            result.memory_count = 10

    def test_metadata_rejects_shape_relations_revisions_and_invalid_counts(self):
        changes = [lambda r: r.update(extra='PRIVATE_SENTINEL'),
                   lambda r: r['capabilities'].update(guest=None),
                   lambda r: r.update(inviteHash='c' * 64),
                   lambda r: r['ratings']['1' * 32].update(host=True),
                   lambda r: r['playlist'].append('f' * 32),
                   lambda r: r['tracks'].append(copy.deepcopy(r['tracks'][0])),
                   lambda r: r.update(playlistRevision=MAX_REVISION + 1),
                   lambda r: r['playback'].update(revision=MAX_REVISION),
                   lambda r: r['playback'].update(revision=True),
                   lambda r: r['memories'][0].update(date='2025-02-30'),
                   lambda r: r['playback'].update(position=13),
                   lambda r: r.update(memories=r['memories'] * 101)]
        for change in changes:
            room = record()
            change(room)
            self.rejects(validate_rooms, envelope([room]), **self.kw)
        self.rejects(validate_rooms, envelope([record()] * 6), **self.kw)
        self.rejects(validate_rooms, envelope([record(), record()]), **self.kw)
        self.rejects(validate_rooms, b' ' * (MAX_ROOMS_JSON_BYTES + 1), code='limit', **self.kw)
        self.rejects(validate_rooms, b'{"schemaVersion":1,"kind":"duet-library-records","rooms":[],"extra":0}', **self.kw)

    def test_pause_uses_saved_anchor_once_and_preserves_paused_max_revision(self):
        playing, paused = record(), record('b' * 32, False)
        paused['playback'].update(playing=False, revision=MAX_REVISION)
        before = validate_rooms(envelope([playing, paused]), **self.kw)
        result = json.loads(paused_rooms(before, 987654321.25, **self.kw))
        self.assertEqual(result['rooms'][0]['playback'],
                         {'trackId': '1' * 32, 'position': 3.125, 'playing': False,
                          'revision': 9, 'updatedAt': 987654321.25})
        self.assertEqual(result['rooms'][1]['playback']['revision'], MAX_REVISION)
        self.assertEqual(json.loads(before.rooms_json)['rooms'][0], playing)
        again = json.loads(paused_rooms(validate_rooms(canonical_json(result), **self.kw),
                                        999999999, **self.kw))
        self.assertEqual(again['rooms'][0]['playback']['revision'], 9)
        for invalid in (True, float('inf'), -1, 1e15 + 1):
            self.rejects(paused_rooms, before, invalid, **self.kw)

    def test_read_only_pinned_main_db_never_constructs_store_or_changes_source(self):
        room = record()
        path, fd = self.database([room])
        before = path.read_bytes()
        before_stat = path.stat()
        renamed = path.with_suffix('.pinned')
        path.rename(renamed)
        path.write_bytes(b'PRIVATE_SENTINEL replacement')
        with patch('duet.store.Store', side_effect=AssertionError('Store must not be constructed')):
            result = read_library(fd, **self.kw)
        self.assertEqual(json.loads(result.rooms_json)['rooms'], [room])
        self.assertEqual(renamed.read_bytes(), before)
        self.assertEqual(renamed.stat().st_mtime_ns, before_stat.st_mtime_ns)
        self.assertEqual(path.read_bytes(), b'PRIVATE_SENTINEL replacement')
        self.assertFalse(any(p.name.endswith(('-journal', '-wal', '-shm')) for p in self.root.iterdir()))

    def test_schema_rejection_precedes_document_reads(self):
        schemas = ['CREATE TABLE rooms (id TEXT PRIMARY KEY, document TEXT)',
                   'CREATE TABLE rooms (id TEXT PRIMARY KEY, document BLOB NOT NULL)',
                   'CREATE TABLE rooms (id TEXT PRIMARY KEY, document TEXT NOT NULL, extra TEXT)',
                   'CREATE TABLE rooms (id TEXT PRIMARY KEY, document TEXT NOT NULL) WITHOUT ROWID',
                   'CREATE VIEW rooms AS SELECT "PRIVATE_SENTINEL" AS id, "{}" AS document',
                   'CREATE TABLE rooms (id TEXT PRIMARY KEY, document TEXT NOT NULL CHECK(length(document)>0))']
        for schema in schemas:
            _, fd = self.database(schema=schema)
            self.rejects(read_library, fd, **self.kw)
        for sql in ('CREATE TABLE extra (secret TEXT)',
                    'CREATE INDEX extra ON rooms(document)',
                    'CREATE TRIGGER extra AFTER INSERT ON rooms BEGIN SELECT 1; END'):
            path, fd = self.database([record()])
            with sqlite3.connect(path) as db:
                db.execute(sql)
            self.rejects(read_library, fd, **self.kw)

    def test_source_document_and_database_bounds_before_json_materialization(self):
        path, fd = self.database()
        with sqlite3.connect(path) as db:
            db.execute('INSERT INTO rooms VALUES (?,?)', ('a' * 32, 'PRIVATE_SENTINEL' + ' ' * MAX_ROOM_BYTES))
        with patch('duet.archive_state.parse_json', side_effect=AssertionError('Oversize must not parse')):
            self.rejects(read_library, fd, **self.kw)
        other, large = self.database()
        with other.open('ab') as stream:
            stream.truncate(MAX_DATABASE_BYTES + 1)
        self.rejects(read_library, large, code='limit', **self.kw)
        _, count_fd = self.database([record(f'{i:032x}') for i in range(6)])
        self.rejects(read_library, count_fd, **self.kw)

    def test_trusted_reconstruction_is_clean_fsynced_and_no_clobber(self):
        records = validate_rooms(envelope([record()]), **self.kw)
        paused = paused_rooms(records, 10000, **self.kw)
        target = self.root / 'target'
        target.mkdir()
        directory_fd = os.open(target, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, directory_fd)
        with patch('duet.store.Store', side_effect=AssertionError('No Store construction')):
            write_database(directory_fd, paused, **self.kw)
        self.assertEqual([p.name for p in target.iterdir()], ['rooms.sqlite3'])
        self.assertEqual((target / 'rooms.sqlite3').stat().st_mode & 0o777, 0o600)
        fd = os.open(target / 'rooms.sqlite3', os.O_RDONLY)
        self.addCleanup(os.close, fd)
        self.assertEqual(read_library(fd, **self.kw).rooms_json, paused)
        before = hashlib.sha256((target / 'rooms.sqlite3').read_bytes()).digest()
        self.rejects(write_database, directory_fd, paused, **self.kw)
        self.assertEqual(hashlib.sha256((target / 'rooms.sqlite3').read_bytes()).digest(), before)
        with sqlite3.connect(target / 'rooms.sqlite3') as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')

    def test_cancel_and_failed_write_leave_owned_destination_absent(self):
        records = validate_rooms(envelope([]), **self.kw)
        directory_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, directory_fd)
        self.cancel.set()
        self.rejects(write_database, directory_fd, records.rooms_json, code='cancelled', **self.kw)
        self.assertFalse((self.root / 'rooms.sqlite3').exists())
        self.cancel.clear()
        with patch('duet.archive_state.os.write', side_effect=OSError('PRIVATE_SENTINEL')):
            self.rejects(write_database, directory_fd, records.rooms_json, **self.kw)
        self.assertFalse((self.root / 'rooms.sqlite3').exists())

    def test_source_duplicate_keys_and_rows_reject_before_reencoding(self):
        path, fd = self.database()
        raw = json.dumps(record()).replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1')
        with sqlite3.connect(path) as db:
            db.execute('INSERT INTO rooms VALUES (?,?)', ('a' * 32, raw))
        self.rejects(read_library, fd, **self.kw)
        _, count_fd = self.database([record(f'{i:032x}') for i in range(6)])
        with patch('duet.archive_state.parse_json', side_effect=AssertionError('Count guard first')):
            self.rejects(read_library, count_fd, **self.kw)

    def test_unlinked_database_fd_never_reads_path_replacement(self):
        path, fd = self.database([record()])
        path.unlink()
        path.write_bytes(b'PRIVATE_SENTINEL replacement')
        # Linux SQLite may reject a deleted FD path; it must never read a rebound
        # pathname or return another room as the pinned library.
        try:
            result = read_library(fd, **self.kw)
        except ArchiveError:
            pass
        else:
            self.assertEqual(json.loads(result.rooms_json)['rooms'], [record()])
        self.assertEqual(path.read_bytes(), b'PRIVATE_SENTINEL replacement')

    def test_sqlite_progress_cancellation_is_sanitized(self):
        _, fd = self.database([record()])
        native_connect = sqlite3.connect
        cancel, calls = self.cancel, []

        class ObservedConnection(sqlite3.Connection):
            def set_progress_handler(self, callback, steps):
                def observed():
                    calls.append(True)
                    cancel.set()
                    return callback()
                # Deliver the real SQLite VM callback at its first instruction;
                # cancellation still travels through the production callback.
                return super().set_progress_handler(observed, 1)

        def connect(*args, **kwargs):
            return native_connect(*args, **kwargs, factory=ObservedConnection)

        with patch('duet.archive_state.sqlite3.connect', side_effect=connect):
            self.rejects(read_library, fd, code='cancelled', **self.kw)
        self.assertTrue(calls)

    def test_writer_uses_acquired_directory_even_after_rename(self):
        target = self.root / 'stage'
        target.mkdir()
        directory_fd = os.open(target, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, directory_fd)
        moved = self.root / 'pinned'
        target.rename(moved)
        target.mkdir()
        (target / 'rooms.sqlite3').write_bytes(b'PRIVATE_SENTINEL')
        data = validate_rooms(envelope([]), **self.kw).rooms_json
        write_database(directory_fd, data, **self.kw)
        self.assertEqual((target / 'rooms.sqlite3').read_bytes(), b'PRIVATE_SENTINEL')
        with sqlite3.connect(moved / 'rooms.sqlite3') as db:
            self.assertEqual(db.execute('SELECT count(*) FROM rooms').fetchone()[0], 0)

    def test_short_writes_are_complete_and_cancel_after_write_removes_only_owned_file(self):
        directory_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, directory_fd)
        data = validate_rooms(envelope([]), **self.kw).rooms_json
        native_write = os.write
        with patch('duet.archive_state.os.write', side_effect=lambda fd, block: native_write(fd, block[:31])):
            write_database(directory_fd, data, **self.kw)
        with sqlite3.connect(self.root / 'rooms.sqlite3') as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
        (self.root / 'rooms.sqlite3').unlink()

        def cancelled_write(fd, block):
            result = native_write(fd, block)
            self.cancel.set()
            return result

        with patch('duet.archive_state.os.write', side_effect=cancelled_write):
            self.rejects(write_database, directory_fd, data, code='cancelled', **self.kw)
        self.assertFalse((self.root / 'rooms.sqlite3').exists())

    def test_replaced_database_child_is_never_unlinked_on_failure(self):
        directory_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, directory_fd)
        data = validate_rooms(envelope([]), **self.kw).rooms_json
        native_fsync = os.fsync

        def replaced(fd):
            native_fsync(fd)
            (self.root / 'rooms.sqlite3').rename(self.root / 'owned-moved.sqlite3')
            (self.root / 'rooms.sqlite3').write_bytes(b'PRIVATE_SENTINEL replacement')

        with patch('duet.archive_state.os.fsync', side_effect=replaced):
            self.rejects(write_database, directory_fd, data, code='storage', **self.kw)
        self.assertEqual((self.root / 'rooms.sqlite3').read_bytes(), b'PRIVATE_SENTINEL replacement')


if __name__ == '__main__':
    unittest.main()
