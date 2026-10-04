"""Real SQLite migration and immutable-image transaction acceptance."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
from io import BytesIO
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch

from PIL import Image

from challenges.images import MAX_IMAGE_BYTES, validate_jpeg
from challenges.store import DomainError, Store


def jpeg():
    stream = BytesIO()
    Image.new('RGB', (4, 3), (23, 81, 149)).save(stream, 'JPEG', quality=85)
    return stream.getvalue()


class ImageStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='friendly-image-store-')
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.now = 1900000000.0
        self.store = self.open()
        self.data = jpeg()
        self.created = self.store.create({'name': 'Alex', 'terms': {
            'title': 'Retained supplied evidence', 'description': 'Compare literal claims.',
            'successCriteria': 'Both participants review the same record.',
            'evidenceRule': 'Supplied text and a normalized image.', 'stake': 'pick-a-movie',
            'deadline': int(self.now * 1000) + 10000,
        }})
        self.id = self.created['challengeId']
        self.token = self.created['token']
        self.joined = self.store.join(self.id, {'inviteToken': self.created['inviteToken'], 'name': 'Sam'})
        self.command(self.joined['token'], 'accept', termsVersion=1)

    def open(self, path=None):
        store = Store(path or self.path, clock=lambda: self.now)
        self.addCleanup(store.close)
        return store

    def command(self, token, action, **arguments):
        revision = self.store.get(self.id, token)['revision']
        return self.store.command(self.id, token, action, {'revision': revision, **arguments})

    def add(self, store=None, token=None, payload=None):
        store, token = store or self.store, token or self.token
        if payload is None:
            payload = {'revision': store.get(self.id, token)['revision'],
                       'text': ' Literal <script>claim</script> café 🧵 ', 'url': None}
        return store.add_image(self.id, token, payload, self.data)

    def error(self, code, function):
        with self.assertRaises(DomainError) as caught:
            function()
        self.assertEqual(caught.exception.code, code)
        self.assertNotIn(self.token, str(caught.exception))
        return caught.exception

    def rows(self):
        with sqlite3.connect(self.path / 'challenges.sqlite3') as connection:
            return connection.execute('SELECT evidence_id,length(data) FROM evidence_images ORDER BY evidence_id').fetchall()

    def raw_record(self):
        with sqlite3.connect(self.path / 'challenges.sqlite3') as connection:
            return connection.execute('SELECT record FROM challenges WHERE id=?', (self.id,)).fetchone()[0]

    def legacy(self, directory, *, corrupt=False):
        # Genuine old schema and old event shapes; whitespace and Unicode in
        # its actual persisted TEXT must survive migration without rewriting.
        record = json.loads(self.raw_record())
        record['schemaVersion'] = 1
        if corrupt:
            record['state']['revision'] += 1
        raw = json.dumps(record, indent=3, ensure_ascii=False) + '\n'
        with sqlite3.connect(directory / 'challenges.sqlite3') as connection:
            connection.execute('CREATE TABLE challenges (id TEXT PRIMARY KEY NOT NULL, record TEXT NOT NULL)')
            connection.execute('INSERT INTO challenges(id,record) VALUES (?,?)', (self.id, raw))
            connection.execute('PRAGMA user_version=1')
        return raw

    def test_old_text_migrates_atomically_without_rewriting_and_text_commands_stay_version_one(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            original = self.legacy(path)
            migrated = self.open(path)
            with sqlite3.connect(path / 'challenges.sqlite3') as connection:
                self.assertEqual(connection.execute('PRAGMA user_version').fetchone()[0], 2)
                self.assertEqual(connection.execute('SELECT record FROM challenges').fetchone()[0], original)
                self.assertEqual(connection.execute('SELECT count(*) FROM evidence_images').fetchone()[0], 0)
            self.assertEqual(migrated._connection.execute('PRAGMA foreign_keys').fetchone()[0], 1)
            revision = migrated.get(self.id, self.token)['revision']
            migrated.command(self.id, self.token, 'evidence', {'revision': revision, 'text': 'Plain correction', 'url': None})
            self.assertEqual(migrated.export(self.id, self.token)['schemaVersion'], 1)
            self.add(migrated)
            self.assertEqual(migrated.export(self.id, self.token)['schemaVersion'], 2)
            with sqlite3.connect(path / 'challenges.sqlite3') as connection:
                record = json.loads(connection.execute('SELECT record FROM challenges').fetchone()[0])
            self.assertEqual(record['state']['events'][:-2], json.loads(original)['state']['events'])
            self.assertEqual(record['state']['events'][-2]['kind'], 'evidence_added')
            self.assertEqual(record['state']['events'][-1]['kind'], 'evidence_image_added')

    def test_corrupt_v1_or_untrusted_schema_does_not_partially_migrate(self):
        for corrupt_record, extra_schema in ((True, False), (False, True)):
            with self.subTest(record=corrupt_record, schema=extra_schema), tempfile.TemporaryDirectory() as directory:
                path = Path(directory)
                original = self.legacy(path, corrupt=corrupt_record)
                if extra_schema:
                    with sqlite3.connect(path / 'challenges.sqlite3') as connection:
                        connection.execute("CREATE TRIGGER forbidden_schema BEFORE UPDATE ON challenges BEGIN SELECT RAISE(ABORT,'untrusted schema'); END")
                self.error('internal_error', lambda: self.open(path))
                with sqlite3.connect(path / 'challenges.sqlite3') as connection:
                    self.assertEqual(connection.execute('PRAGMA user_version').fetchone()[0], 1)
                    self.assertEqual(connection.execute('SELECT record FROM challenges').fetchone()[0], original)
                    self.assertEqual(connection.execute("SELECT count(*) FROM sqlite_master WHERE name='evidence_images'").fetchone()[0], 0)

    def test_image_append_pairs_exact_bytes_and_descriptor_and_survives_restart(self):
        snapshot = self.add()
        item = snapshot['evidence'][-1]
        expected = {'mime': 'image/jpeg', 'bytes': len(self.data), 'width': 4, 'height': 3,
                    'sha256': hashlib.sha256(self.data).hexdigest()}
        self.assertEqual(item['image'], expected)
        self.assertEqual(snapshot['events'][-1]['kind'], 'evidence_image_added')
        self.assertEqual(snapshot['events'][-1]['details']['evidence'], item)
        self.assertEqual(self.store.image(self.id, self.joined['token'], item['id']), self.data)
        record = json.loads(self.raw_record())
        self.assertEqual(record['schemaVersion'], 2)
        self.assertEqual(self.store.export(self.id, self.token)['schemaVersion'], 2)
        snapshot['evidence'][-1]['image']['width'] = 99
        self.store.close()
        reopened = self.open()
        self.assertEqual(reopened.get(self.id, self.token)['evidence'][-1]['image'], expected)
        self.assertEqual(reopened.image(self.id, self.token, item['id']), self.data)

    def test_bad_capability_is_rejected_before_decode_and_before_image_enumeration(self):
        with patch('challenges.store.validate_jpeg', wraps=validate_jpeg) as decoder:
            self.error('unauthorized', lambda: self.store.add_image(self.id, '0' * 64, {}, b'bad JPEG'))
            self.assertEqual(decoder.call_count, 0)
        snapshot = self.add()
        evidence_id = snapshot['evidence'][-1]['id']
        for method in (lambda: self.store.image(self.id, self.created['inviteToken'], evidence_id),
                       lambda: self.store.export_images(self.id, '0' * 64)):
            self.error('unauthorized', method)
        self.error('not_found', lambda: self.store.image(self.id, self.token, 'f' * 32))
        text = self.command(self.token, 'evidence', text='Text only', url=None)['evidence'][-1]
        self.error('not_found', lambda: self.store.image(self.id, self.token, text['id']))

    def test_decode_outside_transaction_is_followed_by_revision_and_auth_rechecks(self):
        payload = {'revision': self.store.get(self.id, self.token)['revision'], 'text': 'Pending image', 'url': None}

        def changed(data):
            result = validate_jpeg(data)
            self.command(self.joined['token'], 'evidence', text='Concurrent text', url=None)
            return result
        with patch('challenges.store.validate_jpeg', side_effect=changed):
            self.error('conflict', lambda: self.add(payload=payload))
        self.assertEqual(self.rows(), [])
        self.assertEqual(len(self.store.get(self.id, self.token)['evidence']), 1)
        payload['revision'] = self.store.get(self.id, self.token)['revision']

        def revoked(data):
            result = validate_jpeg(data)
            with sqlite3.connect(self.path / 'challenges.sqlite3') as connection:
                record = json.loads(connection.execute('SELECT record FROM challenges WHERE id=?', (self.id,)).fetchone()[0])
                record['hashes']['proposer'] = hashlib.sha256(b'replacement fixture capability').hexdigest()
                connection.execute('UPDATE challenges SET record=? WHERE id=?', (json.dumps(record), self.id))
            return result
        with patch('challenges.store.validate_jpeg', side_effect=revoked):
            self.error('unauthorized', lambda: self.add(payload=payload))
        self.assertEqual(self.rows(), [])

    def test_failed_record_update_rolls_back_inserted_blob_and_schema_upgrade(self):
        original = self.raw_record()
        with sqlite3.connect(self.path / 'challenges.sqlite3') as connection:
            connection.execute("CREATE TRIGGER reject_record BEFORE UPDATE ON challenges BEGIN SELECT RAISE(ABORT,'private fault fixture'); END")
        error = self.error('internal_error', self.add)
        self.assertNotIn('private fault', str(error))
        self.assertEqual(self.rows(), [])
        self.assertEqual(self.raw_record(), original)

    def test_last_image_slot_has_exactly_one_winner_and_no_orphan(self):
        for _ in range(7):
            self.add()
        other = self.open()
        payload = {'revision': self.store.get(self.id, self.token)['revision'], 'text': 'Final image slot', 'url': None}
        barrier = threading.Barrier(2)

        def submit(store):
            barrier.wait()
            try:
                self.add(store, payload=deepcopy(payload))
                return 'ok'
            except DomainError as error:
                return error.code
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(submit, store) for store in (self.store, other)]
            self.assertEqual(sorted(future.result() for future in futures), ['conflict', 'ok'])
        self.assertEqual(len(self.rows()), 8)
        self.error('limit', self.add)
        state = self.store.get(self.id, self.token)
        self.assertEqual(len(state['evidence']), 8)
        self.assertEqual(len(state['events']), state['revision'])

    def test_total_evidence_quota_counts_text_and_images_without_implicit_eviction(self):
        self.add()
        for index in range(39):
            self.command(self.token, 'evidence', text=f'Literal text entry {index}', url=None)
        before = self.raw_record()
        self.error('limit', self.add)
        self.assertEqual(self.raw_record(), before)
        self.assertEqual(len(self.rows()), 1)

    def test_export_captures_one_complete_public_record_and_exact_images_without_capabilities(self):
        first = self.add()['evidence'][-1]
        self.command(self.joined['token'], 'evidence', text='Text between images', url=None)
        second = self.add()['evidence'][-1]
        exported, images = self.store.export_images(self.id, self.joined['token'])
        self.assertEqual(exported, self.store.export(self.id, self.token))
        self.assertEqual([entry[0] for entry in images], [first['id'], second['id']])
        for evidence_id, descriptor, data in images:
            self.assertEqual(data, self.data)
            self.assertEqual(descriptor, next(item['image'] for item in exported['challenge']['evidence'] if item['id'] == evidence_id))
        text = json.dumps(exported)
        for secret in (self.token, self.joined['token'], self.created['inviteToken'], hashlib.sha256(self.token.encode()).hexdigest()):
            self.assertNotIn(secret, text)
        images[0][1]['width'] = 99
        exported['challenge']['evidence'].clear()
        self.assertEqual(len(self.store.get(self.id, self.token)['evidence']), 3)

    def test_missing_orphan_hash_and_oversized_blobs_fail_closed_without_repair(self):
        for kind in ('missing', 'orphan', 'hash', 'oversize'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                path = Path(directory)
                original = self.legacy(path)
                store = self.open(path)
                payload = {'revision': json.loads(original)['state']['revision'], 'text': 'Image fixture', 'url': None}
                store.add_image(self.id, self.token, payload, self.data)
                with sqlite3.connect(path / 'challenges.sqlite3') as connection:
                    if kind == 'missing':
                        connection.execute('DELETE FROM evidence_images')
                    elif kind == 'orphan':
                        connection.execute('INSERT INTO evidence_images VALUES (?,?,?)', ('f' * 32, 'e' * 32, self.data))
                    elif kind == 'hash':
                        connection.execute('UPDATE evidence_images SET data=?', (self.data[:-1] + b'x',))
                    else:
                        connection.execute('PRAGMA ignore_check_constraints=ON')
                        connection.execute('UPDATE evidence_images SET data=?', (b'x' * (MAX_IMAGE_BYTES + 1),))
                if kind != 'orphan':
                    self.error('internal_error', lambda: store.get(self.id, self.token))
                store.close()
                self.error('internal_error', lambda: self.open(path))
                with sqlite3.connect(path / 'challenges.sqlite3') as connection:
                    self.assertEqual(connection.execute('PRAGMA user_version').fetchone()[0], 2)
                    count = connection.execute('SELECT count(*) FROM evidence_images').fetchone()[0]
                    self.assertEqual(count, 0 if kind == 'missing' else 2 if kind == 'orphan' else 1)

    def test_startup_decodes_jpeg_but_ordinary_authenticated_reads_do_not(self):
        item = self.add()['evidence'][-1]
        with patch('challenges.store.validate_jpeg', side_effect=AssertionError('Poll must not decode')):
            self.store.get(self.id, self.token)
            self.store.image(self.id, self.token, item['id'])
            self.store.export_images(self.id, self.token)
        self.store.close()
        with patch('challenges.store.validate_jpeg', wraps=validate_jpeg) as decoder:
            self.open()
            self.assertEqual(decoder.call_count, 1)


if __name__ == '__main__':
    unittest.main()
