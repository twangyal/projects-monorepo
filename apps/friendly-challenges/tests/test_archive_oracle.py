"""Independent #103 byte/state/filesystem expectations, frozen before producer reads."""
from copy import deepcopy
import fcntl
from hashlib import sha256
import json
import os
from pathlib import Path
import sqlite3
import struct
import tempfile
from threading import Event
import time
import unittest
from unittest.mock import patch
import zipfile

from archive_oracle_fixtures import (
    CREATED, EVIDENCE_IDS, IMAGE_ID, LEGACY_ID,
    archive_bytes, file_snapshot, manifest, original_fixture, payload_members,
    physical_zip, source_database,
)
from challenges.archive_common import ArchiveError, RecordSource
from challenges.archive_format import read_index, read_records
from challenges.archive_state import read_library, validate_records
from challenges.backup import create_archive, inspect_archive, restore_archive


class ArchiveIndependentOracle(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='friendly103-oracle-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.records, self.media = original_fixture()
        self.cancel = Event()

    def options(self):
        return {'cancel': self.cancel, 'deadline': time.monotonic() + 30}

    def fixture_archive(self, data=None, name='original.zip'):
        path = self.root / name
        path.write_bytes(archive_bytes(self.records, self.media) if data is None else data)
        return path

    def rejected(self, operation, codes=None):
        with self.assertRaises(ArchiveError) as caught:
            operation()
        error = caught.exception
        self.assertLessEqual(len(str(error)), 1000)
        for private in ('Café', 'Zoë', 'Literal <script>', '3' * 64, '4' * 64):
            self.assertNotIn(private, str(error))
        if codes:
            self.assertIn(error.code, codes)
        return error

    def database_rows(self, root):
        db = sqlite3.connect(f'file:{root / "challenges.sqlite3"}?mode=ro', uri=True)
        try:
            version = db.execute('PRAGMA user_version').fetchone()[0]
            records = tuple((identity, raw.encode('utf-8')) for identity, raw in
                            db.execute('SELECT id,record FROM challenges ORDER BY id'))
            media = tuple(db.execute('SELECT challenge_id,evidence_id,data FROM evidence_images '
                                     'ORDER BY challenge_id,evidence_id'))
            return version, records, media
        finally:
            db.close()

    def test_original_independent_archive_full_state_and_exact_restore(self):
        archive = self.fixture_archive()
        before = archive.read_bytes()
        summary = inspect_archive(archive)
        self.assertEqual((summary.schema_version, summary.source_schema_version,
                          summary.challenges, summary.evidence, summary.images,
                          summary.claimed_seats, summary.pending_invites, summary.media_bytes,
                          summary.archive_bytes), (1, 2, 2, 2, 2, 3, 1, 1374, 7878))
        target = self.root / 'restored'
        restored = restore_archive(archive, target)
        self.assertEqual(restored, summary)
        self.assertEqual(self.database_rows(target), (2, self.records, self.media))
        self.assertEqual({p.name for p in target.iterdir()}, {'challenges.sqlite3'})
        self.assertEqual(target.stat().st_mode & 0o777, 0o700)
        self.assertEqual((target / 'challenges.sqlite3').stat().st_mode & 0o777, 0o600)
        self.assertEqual(archive.read_bytes(), before)
        # Literal late flag, original revision and all invitation hashes survived exactly.
        raw = json.loads(self.database_rows(target)[1][1][1])
        self.assertEqual(raw['state']['revision'], 5)
        self.assertEqual([item['late'] for item in raw['state']['evidence']], [False, True])

    def test_creator_bytes_checked_by_stdlib_and_literal_expected_members(self):
        source = source_database(self.root / 'source', self.records, self.media)
        (source / 'challenges.sqlite3-wal').write_bytes(b'')
        before = file_snapshot(source)
        archive = self.root / 'created.zip'
        result = create_archive(source, archive)
        self.assertEqual(result.challenges, 2)
        with zipfile.ZipFile(archive) as zf:
            expected = payload_members(self.records, self.media)
            self.assertEqual(zf.namelist(), ['manifest.json', *(name for name, _ in expected)])
            meta = json.loads(zf.read('manifest.json'))
            expected_meta = manifest(expected)
            expected_meta['createdAtMs'] = meta['createdAtMs']
            self.assertEqual(meta, expected_meta)
            self.assertEqual(zf.read('manifest.json'), json.dumps(meta, ensure_ascii=False,
                             sort_keys=True, separators=(',', ':')).encode())
            for name, raw in expected:
                self.assertEqual(zf.read(name), raw)
            for info in zf.infolist():
                self.assertEqual((info.compress_type, info.flag_bits, info.create_system,
                                  info.create_version, info.extract_version, info.date_time,
                                  info.extra, info.comment, info.external_attr, info.internal_attr),
                                 (0, 0, 3, 20, 20, (1980, 1, 1, 0, 0, 0), b'', b'',
                                  0o100600 << 16, 0))
        self.assertEqual(file_snapshot(source), before)
        self.assertEqual({p.name for p in self.root.iterdir()}, {'source', 'created.zip'})

    def test_legacy_source_no_migration_and_restore_current_schema_raw_text(self):
        records = self.records[:1]
        source = source_database(self.root / 'legacy', records, version=1)
        before = file_snapshot(source)
        path = self.root / 'legacy.zip'
        summary = create_archive(source, path)
        self.assertEqual((summary.source_schema_version, summary.images, summary.pending_invites),
                         (1, 0, 1))
        self.assertEqual(file_snapshot(source), before)
        target = self.root / 'restored'
        restore_archive(path, target)
        self.assertEqual(self.database_rows(target), (2, records, ()))
        self.assertEqual(json.loads(self.database_rows(target)[1][0][1])['schemaVersion'], 1)

    def test_empty_library_is_complete_and_current_schema(self):
        path = self.fixture_archive(archive_bytes((), (), 1))
        result = inspect_archive(path)
        self.assertEqual((result.challenges, result.images, result.claimed_seats,
                          result.pending_invites, result.media_bytes), (0, 0, 0, 0, 0))
        target = self.root / 'empty'
        restore_archive(path, target)
        self.assertEqual(self.database_rows(target), (2, (), ()))

    def test_fd_reader_retains_original_inode_after_path_substitution(self):
        source = source_database(self.root / 'source', self.records, self.media)
        path = source / 'challenges.sqlite3'
        fd = os.open(path, os.O_RDONLY)
        self.addCleanup(os.close, fd)
        path.rename(source / 'original-pinned')
        path.write_bytes(b'not a database and not an accepted replacement')
        result = read_library(fd, **self.options())
        self.assertEqual(tuple((r.challenge_id, r.raw) for r in result.records), self.records)
        self.assertEqual(len(result.images), 2)
        self.assertEqual(path.read_bytes(), b'not a database and not an accepted replacement')

    def test_physical_zip_corruptions_rejected_without_destination(self):
        original = archive_bytes(self.records, self.media)
        central = struct.unpack_from('<I', original, len(original) - 6)[0]
        mutations = {'trailing': original + b'x', 'prefix': b'x' + original,
                     'truncated': original[:-1]}
        # Fixed offsets from independently packed ZIP header, not production index.
        for name, offset, fmt, value in (
            ('local-flags', 6, '<H', 8), ('local-method', 8, '<H', 8),
            ('local-date', 12, '<H', 34), ('local-crc', 14, '<I', 0),
            ('local-extra', 28, '<H', 1), ('central-version', central + 4, '<H', 20),
            ('central-flags', central + 8, '<H', 2048),
            ('central-attrs', central + 38, '<I', 0o120777 << 16),
            ('central-offset', central + 42, '<I', 1),
            ('footer-disk', len(original) - 18, '<H', 1),
            ('footer-comment', len(original) - 2, '<H', 1),
        ):
            changed = bytearray(original)
            struct.pack_into(fmt, changed, offset, value)
            mutations[name] = bytes(changed)
        for name, data in mutations.items():
            with self.subTest(name=name):
                archive = self.fixture_archive(data, name + '.zip')
                target = self.root / (name + '-target')
                self.rejected(lambda: restore_archive(archive, target))
                self.assertFalse(target.exists())
                self.assertEqual(archive.read_bytes(), data)
        self.assertFalse(any(p.name.startswith('.') for p in self.root.iterdir()))

    def test_manifest_hash_types_duplicates_unicode_and_path_admission(self):
        members = payload_members(self.records, self.media)
        valid = manifest(members)
        bad = []
        for update in (
            lambda m: m.update(schemaVersion=True),
            lambda m: m.update(createdAtMs=9007199254740992),
            lambda m: m.update(sourceSchemaVersion=3),
            lambda m: m['members'][0].update(sha256='0' * 64),
            lambda m: m['members'][0].update(bytes=True),
            lambda m: m['members'][0].update(name='../escape'),
            lambda m: m.update(extra='unexpected'),
        ):
            value = deepcopy(valid)
            update(value)
            bad.append(json.dumps(value).encode())
        raw = json.dumps(valid).encode()
        bad.extend([b'{"schemaVersion":1,' + raw[1:], raw[:-1] + b',"bad":"\\ud800"}',
                    raw[:-1] + b',"bad":NaN}', b'[' * 33 + b'0' + b']' * 33])
        for i, metadata in enumerate(bad):
            with self.subTest(case=i):
                archive = self.fixture_archive(physical_zip([('manifest.json', metadata), *members]))
                self.rejected(lambda: inspect_archive(archive))
        for entries in ([members[0], *members], list(reversed(members)),
                        [('../escape', self.records[0][1]), *members[1:]]):
            meta = json.dumps(manifest(entries)).encode()
            self.rejected(lambda: inspect_archive(self.fixture_archive(
                physical_zip([('manifest.json', meta), *entries]))))

    def test_replay_hash_collision_and_record_identity_are_not_just_json_checks(self):
        for mutation in (
            lambda p: p['state'].update(revision=77),
            lambda p: p['state'].update(status='resolved'),
            lambda p: p['hashes'].update(opponentInvite=p['hashes']['proposer']),
            lambda p: p['hashes'].update(opponentInvite=None),
            lambda p: p['state'].update(id='f' * 32),
            lambda p: p['state']['events'][0]['details'].update(name='forged'),
        ):
            value = json.loads(self.records[0][1])
            mutation(value)
            record = ((LEGACY_ID, json.dumps(value).encode()),)
            archive = self.fixture_archive(archive_bytes(record, version=1))
            self.rejected(lambda: inspect_archive(archive))
        sources = tuple(RecordSource(identity, raw) for identity, raw in self.records)
        self.rejected(lambda: validate_records(sources, 1, **self.options()))

    def test_missing_orphan_wrong_association_and_undecodable_media(self):
        variants = [self.media[:1], (*self.media, (LEGACY_ID, 'c' * 32, self.media[0][2])),
                    ((IMAGE_ID, EVIDENCE_IDS[0], self.media[1][2]), self.media[1])]
        for media in variants:
            self.rejected(lambda: inspect_archive(self.fixture_archive(
                archive_bytes(self.records, media))))
        # Internally matching length/SHA/CRC still cannot replace actual JPEG decode.
        active = json.loads(self.records[1][1])
        invalid = b'X' * len(self.media[0][2])
        for entry in (active['state']['evidence'][0],
                      active['state']['events'][3]['details']['evidence']):
            entry['image']['sha256'] = sha256(invalid).hexdigest()
        records = (self.records[0], (IMAGE_ID, json.dumps(active).encode()))
        media = ((IMAGE_ID, EVIDENCE_IDS[0], invalid), self.media[1])
        self.rejected(lambda: inspect_archive(self.fixture_archive(archive_bytes(records, media))))

    def test_hostile_sql_and_blob_relationships_fail_without_touching_source(self):
        for index, statement in enumerate((
            'CREATE VIEW malicious AS SELECT record FROM challenges',
            'CREATE TRIGGER malicious AFTER INSERT ON challenges BEGIN DELETE FROM challenges; END',
            'CREATE TABLE extra(secret TEXT)',
            f"DELETE FROM evidence_images WHERE evidence_id='{EVIDENCE_IDS[0]}'",
            "INSERT INTO evidence_images VALUES ('" + LEGACY_ID + "','" + 'c' * 32 + "',X'01')",
        )):
            with self.subTest(case=index):
                source = source_database(self.root / f'source{index}', self.records, self.media)
                with sqlite3.connect(source / 'challenges.sqlite3') as db:
                    db.execute(statement)
                before = file_snapshot(source)
                output = self.root / f'bad{index}.zip'
                self.rejected(lambda: create_archive(source, output))
                self.assertFalse(output.exists())
                self.assertEqual(file_snapshot(source), before)

    def test_unknown_source_children_sidecars_and_live_lock_are_not_ignored(self):
        source = source_database(self.root / 'source', self.records, self.media)
        for child, data in (('forgotten-note.txt', b'private'),
                            ('challenges.sqlite3-wal', b'pending recovery')):
            path = source / child
            path.write_bytes(data)
            before = file_snapshot(source)
            self.rejected(lambda: create_archive(source, self.root / 'archive.zip'))
            self.assertEqual(file_snapshot(source), before)
            path.unlink()
        with (source / '.server.lock').open('rb') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.rejected(lambda: create_archive(source, self.root / 'archive.zip'), {'busy'})
        self.assertFalse((self.root / 'archive.zip').exists())

    def test_no_clobber_existing_files_directories_or_nested_source_output(self):
        source = source_database(self.root / 'source', self.records, self.media)
        before = file_snapshot(source)
        archive = self.fixture_archive()
        existing = self.root / 'keep.zip'
        existing.write_bytes(b'owned by somebody else')
        self.rejected(lambda: create_archive(source, existing))
        self.assertEqual(existing.read_bytes(), b'owned by somebody else')
        target = self.root / 'existing'
        target.mkdir()
        self.rejected(lambda: restore_archive(archive, target))
        self.assertEqual(list(target.iterdir()), [])
        self.rejected(lambda: create_archive(source, source / 'nested.zip'))
        alias = self.root / 'source-alias'
        alias.symlink_to(source, target_is_directory=True)
        self.rejected(lambda: create_archive(source, alias / 'nested.zip'))
        self.assertEqual(file_snapshot(source), before)

    def test_late_create_target_wins_actual_hardlink_race(self):
        source = source_database(self.root / 'source', self.records, self.media)
        before = file_snapshot(source)
        target = self.root / 'late.zip'
        real_link = os.link
        reached = []

        def arrive(*args, **kwargs):
            reached.append(True)
            target.write_bytes(b'independent late winner')
            return real_link(*args, **kwargs)

        with patch('os.link', side_effect=arrive):
            self.rejected(lambda: create_archive(source, target))
        self.assertTrue(reached)
        self.assertEqual(target.read_bytes(), b'independent late winner')
        self.assertEqual(file_snapshot(source), before)
        self.assertEqual({p.name for p in self.root.iterdir()}, {'source', 'late.zip'})

    def test_late_restore_destination_preserved_and_owned_stage_cleaned(self):
        archive = self.fixture_archive()
        target = self.root / 'late-directory'
        real_fsync = os.fsync
        reached = []

        def arrive(fd):
            if not reached:
                reached.append(True)
                target.mkdir()
                (target / 'winner').write_bytes(b'keep late directory')
            return real_fsync(fd)

        with patch('os.fsync', side_effect=arrive):
            self.rejected(lambda: restore_archive(archive, target))
        self.assertTrue(reached)
        self.assertEqual(file_snapshot(target), {'winner': b'keep late directory'})
        self.assertEqual({p.name for p in self.root.iterdir()}, {'original.zip', 'late-directory'})

    def test_cancel_timeout_and_prepublication_io_error_leave_inputs_unchanged(self):
        source = source_database(self.root / 'source', self.records, self.media)
        before = file_snapshot(source)
        archive = self.fixture_archive()
        original = archive.read_bytes()
        cancelled = Event()
        cancelled.set()
        self.rejected(lambda: create_archive(source, self.root / 'cancel.zip', cancel=cancelled),
                      {'cancelled'})
        self.rejected(lambda: restore_archive(archive, self.root / 'cancel', cancel=cancelled),
                      {'cancelled'})
        with archive.open('rb') as file:
            self.rejected(lambda: read_index(file.fileno(), cancel=Event(),
                                             deadline=time.monotonic() - 1), {'timeout'})
        with patch('os.fsync', side_effect=OSError('synthetic prepublication disk failure')):
            self.rejected(lambda: restore_archive(archive, self.root / 'io-error'))
        self.assertEqual(file_snapshot(source), before)
        self.assertEqual(archive.read_bytes(), original)
        self.assertEqual({p.name for p in self.root.iterdir()}, {'source', 'original.zip'})

    def test_format_reader_returns_literal_records_not_reserialized_json(self):
        archive = self.fixture_archive()
        with archive.open('rb') as file:
            index = read_index(file.fileno(), **self.options())
            self.assertEqual(index.created_at_ms, CREATED)
            self.assertEqual(index.source_schema_version, 2)
            actual = read_records(file.fileno(), index, **self.options())
        self.assertEqual(tuple((r.challenge_id, r.raw) for r in actual), self.records)
        # Output has exact raw leading CRLF/tab, not just equivalent parsed values.
        self.assertTrue(actual[0].raw.startswith(b' \r\n\t{'))
        self.assertEqual(sha256(archive.read_bytes()).hexdigest(),
                         '2e178a121106010976efe3b4e56b2fe57f1904212bc588396a5bd2cbc5eff8b8')


if __name__ == '__main__':
    unittest.main()
