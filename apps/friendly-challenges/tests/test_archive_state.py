import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from threading import Event
import time
import unittest
from unittest.mock import patch

from PIL import Image
from challenges import domain
from challenges.archive_common import ArchiveError, ImageFile, RecordSource
from challenges.archive_state import copy_library_image, read_library, validate_records, write_database
from challenges.store import _CHALLENGES_SQL, _IMAGES_SQL


def fixture(image=False, cid='1' * 32):
    state = domain.create_state(cid, dict(name='Alex', terms=dict(
        title='Original <title> 🎵', description='Literal\nline', successCriteria='Finish',
        evidenceRule='Notes and images', stake='pick-a-movie', deadline=2000)), 1000)
    domain.apply_claim(state, 'opponent', 'Sam', 1100)
    domain.apply_command(state, 'opponent', 'accept', dict(revision=2, termsVersion=1), 1200)
    raw_image = None
    if image:
        from challenges.images import validate_jpeg
        buffer = io.BytesIO()
        Image.new('RGB', (4, 3), (23, 81, 149)).save(buffer, format='JPEG')
        raw_image = buffer.getvalue()
        domain.apply_image_evidence(state, 'proposer', dict(revision=3, text='Image literal', url=None),
                                    validate_jpeg(raw_image), 2100, '2' * 32)
    record = dict(schemaVersion=2 if image else 1, state=state, hashes=dict(
        proposer='b' * 64, opponent='c' * 64, arbiter=None,
        opponentInvite=None, arbiterInvite=None))
    raw = (' \n' + json.dumps(record, ensure_ascii=False, indent=3) + '\n ').encode()
    return RecordSource(cid, raw), raw_image


def database(path, records, version=2, images=()):
    connection = sqlite3.connect(path)
    connection.execute(_CHALLENGES_SQL)
    if version == 2:
        connection.execute(_IMAGES_SQL)
    connection.execute(f'PRAGMA user_version={version}')
    connection.executemany('INSERT INTO challenges VALUES (?,?)',
                           [(record.challenge_id, record.raw.decode()) for record in records])
    if images:
        connection.executemany('INSERT INTO evidence_images VALUES (?,?,?)', images)
    connection.commit()
    connection.close()


class ArchiveStateTests(unittest.TestCase):
    def options(self):
        return dict(cancel=Event(), deadline=time.monotonic() + 30)

    def test_legacy_raw_text_readonly_and_current_reconstruction(self):
        record, _ = fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.sqlite3'
            database(source, (record,), version=1)
            before = source.read_bytes()
            fd = os.open(source, os.O_RDONLY)
            stage = root / 'stage'
            stage.mkdir()
            directory_fd = os.open(stage, os.O_RDONLY | os.O_DIRECTORY)
            try:
                library = read_library(fd, **self.options())
                self.assertEqual(library.records, (record,))
                self.assertEqual((library.source_schema_version, library.claimed_seats, library.evidence_count), (1, 2, 0))
                write_database(directory_fd, library, (), **self.options())
            finally:
                os.close(fd)
                os.close(directory_fd)
            self.assertEqual(source.read_bytes(), before)
            connection = sqlite3.connect(stage / 'challenges.sqlite3')
            self.assertEqual(connection.execute('PRAGMA user_version').fetchone()[0], 2)
            self.assertEqual(connection.execute('SELECT record FROM challenges').fetchone()[0].encode(), record.raw)
            connection.close()

    def test_image_membership_copy_and_exact_original_restore(self):
        record, raw = fixture(image=True)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.sqlite3'
            database(source, (record,), images=((record.challenge_id, '2' * 32, raw),))
            fd = os.open(source, os.O_RDONLY)
            stage = root / 'stage'
            stage.mkdir()
            directory_fd = os.open(stage, os.O_RDONLY | os.O_DIRECTORY)
            try:
                library = read_library(fd, **self.options())
                image = library.images[0]
                with tempfile.TemporaryFile() as file:
                    copy_library_image(fd, image, file.fileno(), **self.options())
                    self.assertEqual(os.pread(file.fileno(), len(raw), 0), raw)
                    write_database(directory_fd, library, (ImageFile(image, file.fileno()),), **self.options())
            finally:
                os.close(fd)
                os.close(directory_fd)
            connection = sqlite3.connect(stage / 'challenges.sqlite3')
            self.assertEqual(connection.execute('SELECT data FROM evidence_images').fetchone()[0], raw)
            connection.close()

    def test_schema_one_private_two_even_without_images_rejects(self):
        record, _ = fixture()
        value = json.loads(record.raw)
        value['schemaVersion'] = 2
        invalid = RecordSource(record.challenge_id, json.dumps(value).encode())
        with self.assertRaises(ArchiveError):
            validate_records((invalid,), 1, **self.options())
        self.assertEqual(validate_records((invalid,), 2, **self.options()).records, (invalid,))

    def test_replay_id_duplicates_bytes_and_depth_reject_atomically(self):
        record, _ = fixture()
        value = json.loads(record.raw)
        value['state']['revision'] += 1
        invalid = [RecordSource(record.challenge_id, json.dumps(value).encode()),
                   RecordSource('3' * 32, record.raw), RecordSource(record.challenge_id, b'[' * 33 + b']' * 33),
                   RecordSource(record.challenge_id, b' ' * (1048576 + 1))]
        for item in invalid:
            with self.subTest(size=len(item.raw)), self.assertRaises(ArchiveError):
                validate_records((item,), 2, **self.options())
        with self.assertRaises(ArchiveError):
            validate_records((record, record), 2, **self.options())
        self.assertEqual(validate_records((), 1, **self.options()).records, ())

    def test_unsupported_sql_and_missing_or_extra_images_reject_without_writes(self):
        record, raw = fixture(image=True)
        for corruption in ('missing', 'orphan', 'trigger', 'quoted-literal'):
            with self.subTest(corruption=corruption), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'source.sqlite3'
                database(path, (record,), images=() if corruption == 'missing' else ((record.challenge_id, '2' * 32, raw),))
                connection = sqlite3.connect(path)
                if corruption == 'quoted-literal':
                    connection.execute('PRAGMA writable_schema=ON')
                    connection.execute("UPDATE sqlite_master SET sql=replace(sql, ? , ?) WHERE name='evidence_images'",
                                       ("'blob'", "'b l o b'"))
                if corruption == 'orphan':
                    connection.execute('INSERT INTO evidence_images VALUES (?,?,?)', ('f' * 32, 'e' * 32, raw))
                if corruption == 'trigger':
                    connection.execute('CREATE TRIGGER hostile AFTER INSERT ON challenges BEGIN SELECT 1; END')
                connection.commit()
                connection.close()
                before = path.read_bytes()
                fd = os.open(path, os.O_RDONLY)
                try:
                    with self.assertRaises(ArchiveError):
                        read_library(fd, **self.options())
                finally:
                    os.close(fd)
                self.assertEqual(hashlib.sha256(path.read_bytes()).digest(), hashlib.sha256(before).digest())

    def test_restore_never_clobbers_and_failure_removes_only_owned_database(self):
        record, _ = fixture()
        library = validate_records((record,), 1, **self.options())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            target = root / 'challenges.sqlite3'
            try:
                with patch('os.write', side_effect=OSError('controlled write failure')), self.assertRaises(ArchiveError):
                    write_database(fd, library, (), **self.options())
                self.assertFalse(target.exists())
                target.write_bytes(b'untouched')
                with self.assertRaises(ArchiveError):
                    write_database(fd, library, (), **self.options())
                self.assertEqual(target.read_bytes(), b'untouched')
            finally:
                os.close(fd)

    def test_pinned_source_descriptor_survives_path_replacement(self):
        record, _ = fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'source.sqlite3'
            database(path, (record,), version=1)
            fd = os.open(path, os.O_RDONLY)
            try:
                path.rename(root / 'original.sqlite3')
                other, _ = fixture(cid='3' * 32)
                database(path, (other,), version=1)
                self.assertEqual(read_library(fd, **self.options()).records, (record,))
            finally:
                os.close(fd)
