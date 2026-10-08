"""Real SQLite/JPEG orchestration and native publication ownership."""
from contextlib import redirect_stderr, redirect_stdout
import fcntl
from io import BytesIO, StringIO
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import tempfile
from threading import Event
import unittest
from unittest.mock import patch

from PIL import Image
from challenges import backup
from challenges.archive_common import ArchiveError
from challenges.store import Store


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='friendly-backup-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        (self.source / '.server.lock').write_bytes(b'original lock bytes')
        self.output = self.root / 'library.zip'
        self.target = self.root / 'restored'
        store = Store(self.source, clock=lambda: 1900000000.0)
        self.created = store.create({'name': 'Private café', 'terms': {
            'title': 'Private title', 'description': 'Original description',
            'successCriteria': 'Review together', 'evidenceRule': 'Supplied photos',
            'stake': 'pick-a-movie', 'deadline': 1900000010000}})
        joined = store.join(self.created['challengeId'], {
            'inviteToken': self.created['inviteToken'], 'name': 'Other private participant'})
        store.command(self.created['challengeId'], joined['token'], 'accept', {
            'revision': joined['challenge']['revision'], 'termsVersion': 1})
        with sqlite3.connect(self.source / 'challenges.sqlite3') as db:
            self.legacy_raw = json.dumps(json.loads(db.execute('SELECT record FROM challenges').fetchone()[0]), indent=2, ensure_ascii=False) + '\n'
        stream = BytesIO()
        Image.new('RGB', (4, 3), (23, 81, 149)).save(stream, 'JPEG', quality=85)
        self.jpeg = stream.getvalue()
        snapshot = store.get(self.created['challengeId'], self.created['token'])
        store.add_image(self.created['challengeId'], self.created['token'], {
            'revision': snapshot['revision'], 'text': 'Private supplied caption 🧵', 'url': None}, self.jpeg)
        store.close()
        with sqlite3.connect(self.source / 'challenges.sqlite3') as db:
            value = json.loads(db.execute('SELECT record FROM challenges').fetchone()[0])
            self.raw = json.dumps(value, ensure_ascii=False, indent=3) + '\n  '
            db.execute('UPDATE challenges SET record=?', (self.raw,))
        self.original = self.source_bytes()

    def source_bytes(self):
        return {p.name: p.read_bytes() for p in self.source.iterdir() if p.is_file()}

    def unchanged(self):
        self.assertEqual(self.source_bytes(), self.original)

    def rejection(self, call, code=None):
        with self.assertRaises(ArchiveError) as error:
            call()
        if code:
            self.assertEqual(error.exception.code, code)
        for private in (self.raw, self.created['token'], self.created['inviteToken'],
                        'Private title', 'Private supplied caption'):
            self.assertNotIn(private, str(error.exception))
        self.unchanged()
        return error.exception

    def test_actual_round_trip_preserves_raw_text_jpeg_and_source(self):
        made = backup.create_archive(self.source, self.output)
        self.assertEqual(made, backup.inspect_archive(self.output))
        self.assertEqual(made, backup.restore_archive(self.output, self.target))
        self.assertEqual((made.challenges, made.evidence, made.images, made.claimed_seats), (1, 1, 1, 2))
        self.assertEqual(made.media_bytes, len(self.jpeg))
        self.assertEqual(set(p.name for p in self.target.iterdir()), {'challenges.sqlite3'})
        with sqlite3.connect(self.target / 'challenges.sqlite3') as db:
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 2)
            self.assertEqual(db.execute('SELECT record FROM challenges').fetchone()[0], self.raw)
            self.assertEqual(db.execute('SELECT data FROM evidence_images').fetchone()[0], self.jpeg)
        self.unchanged()
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o700)

    def test_cooperative_lock_busy(self):
        with (self.source / '.server.lock').open('rb') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.rejection(lambda: backup.create_archive(self.source, self.output), 'busy')
        self.assertFalse(self.output.exists())

    def test_unknown_children_and_nonempty_sidecars_refused(self):
        for name in ('unknown', 'challenges.sqlite3-wal', 'challenges.sqlite3-shm',
                     'challenges.sqlite3-journal'):
            with self.subTest(name=name):
                path = self.source / name
                path.write_bytes(b'preserve me')
                self.original = self.source_bytes()
                self.rejection(lambda: backup.create_archive(self.source, self.output), 'input')
                path.unlink()
        self.original = self.source_bytes()

    def test_zero_sidecars_unchanged(self):
        for suffix in ('-wal', '-shm', '-journal'):
            (self.source / ('challenges.sqlite3' + suffix)).write_bytes(b'')
        self.original = self.source_bytes()
        backup.create_archive(self.source, self.output)
        self.unchanged()

    def test_inside_source_output_and_symlink_alias_refused(self):
        for path in (self.source / 'archive.zip', self.source / 'missing' / 'archive.zip',
                     self.source / '..' / 'source' / 'archive.zip'):
            self.rejection(lambda: backup.create_archive(self.source, path), 'destination')
        alias = self.root / 'alias'
        alias.symlink_to(self.source, target_is_directory=True)
        self.rejection(lambda: backup.create_archive(self.source, alias / 'archive.zip'), 'destination')

    def test_existing_destinations_never_overwritten(self):
        self.output.write_bytes(b'foreign archive')
        self.rejection(lambda: backup.create_archive(self.source, self.output), 'destination')
        self.assertEqual(self.output.read_bytes(), b'foreign archive')
        self.output.unlink()
        backup.create_archive(self.source, self.output)
        self.target.mkdir()
        self.rejection(lambda: backup.restore_archive(self.output, self.target), 'destination')
        self.assertEqual(list(self.target.iterdir()), [])

    def test_cancelled_operations_never_publish(self):
        cancel = Event()
        cancel.set()
        self.rejection(lambda: backup.create_archive(self.source, self.output, cancel=cancel), 'cancelled')
        cancel.clear()
        backup.create_archive(self.source, self.output)
        cancel.set()
        before = self.output.read_bytes()
        self.rejection(lambda: backup.inspect_archive(self.output, cancel=cancel), 'cancelled')
        self.rejection(lambda: backup.restore_archive(self.output, self.target, cancel=cancel), 'cancelled')
        self.assertEqual(self.output.read_bytes(), before)
        self.assertFalse(self.target.exists())

    def test_cli_counts_private_safe_and_restores_handlers(self):
        previous = {s: signal.getsignal(s) for s in (signal.SIGINT, signal.SIGTERM)}
        output, errors = StringIO(), StringIO()
        with redirect_stdout(output), redirect_stderr(errors):
            self.assertEqual(backup.main(['create', '--data-dir', str(self.source),
                                          '--output', str(self.output)]), 0)
        counts = json.loads(output.getvalue().splitlines()[0])
        self.assertEqual(counts['images'], 1)
        self.assertEqual(errors.getvalue(), '')
        self.assertEqual(previous, {s: signal.getsignal(s) for s in previous})
        result = subprocess.run([sys.executable, '-m', 'challenges.backup', 'inspect',
                                 '--archive', str(self.output)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout.splitlines()[0]), counts)
        for private in ('Private title', 'Private supplied caption', self.created['token']):
            self.assertNotIn(private, output.getvalue() + result.stdout + result.stderr)
        self.unchanged()

    def test_late_output_winner_is_preserved(self):
        original = os.link

        def late(*args, **kwargs):
            self.output.write_bytes(b'late foreign winner')
            return original(*args, **kwargs)

        with patch.object(backup.os, 'link', side_effect=late):
            self.rejection(lambda: backup.create_archive(self.source, self.output), 'destination')
        self.assertEqual(self.output.read_bytes(), b'late foreign winner')
        self.assertFalse(any(p.name.startswith('.friendly-') for p in self.root.iterdir()))

    def test_raced_empty_restore_destination_is_preserved(self):
        backup.create_archive(self.source, self.output)
        original = os.fsync

        def late(fd):
            if not self.target.exists():
                self.target.mkdir()
            return original(fd)

        with patch.object(backup.os, 'fsync', side_effect=late):
            self.rejection(lambda: backup.restore_archive(self.output, self.target), 'destination')
        self.assertEqual(list(self.target.iterdir()), [])
        self.assertFalse(any(p.name.startswith('.friendly-') for p in self.root.iterdir()))

    def test_cancel_after_write_before_publication_cleans_only_owned_files(self):
        cancel = Event()
        original = backup.write_archive

        def late(*args, **kwargs):
            original(*args, **kwargs)
            cancel.set()

        sibling = self.root / 'unrelated'
        sibling.write_bytes(b'keep me')
        with patch.object(backup, 'write_archive', side_effect=late):
            self.rejection(lambda: backup.create_archive(self.source, self.output, cancel=cancel), 'cancelled')
        self.assertFalse(self.output.exists())
        self.assertEqual(sibling.read_bytes(), b'keep me')
        self.assertFalse(any(p.name.startswith('.friendly-') for p in self.root.iterdir()))

    def test_cancellation_after_file_publication_is_completion(self):
        cancel = Event()
        original = os.link

        def late(*args, **kwargs):
            original(*args, **kwargs)
            cancel.set()

        with patch.object(backup.os, 'link', side_effect=late):
            result = backup.create_archive(self.source, self.output, cancel=cancel)
        self.assertEqual(result, backup.inspect_archive(self.output))
        self.unchanged()

    def test_postpublication_fsync_failure_reports_complete_preserved_output(self):
        original = os.fsync

        def fault(fd):
            if self.output.exists():
                raise OSError('Private path/digest must not appear')
            return original(fd)

        with patch.object(backup.os, 'fsync', side_effect=fault):
            error = self.rejection(lambda: backup.create_archive(self.source, self.output), 'storage')
        self.assertIn('COMPLETE', str(error))
        self.assertIn('durability', str(error))
        self.assertEqual(backup.inspect_archive(self.output).images, 1)
        self.assertFalse(any(p.name.startswith('.friendly-') for p in self.root.iterdir()))

    def test_postpublication_restore_fsync_failure_retains_complete_target(self):
        backup.create_archive(self.source, self.output)
        original = os.fsync

        def fault(fd):
            if self.target.exists():
                raise OSError('private failure detail')
            return original(fd)

        with patch.object(backup.os, 'fsync', side_effect=fault):
            error = self.rejection(lambda: backup.restore_archive(self.output, self.target), 'storage')
        self.assertIn('COMPLETE', str(error))
        with sqlite3.connect(self.target / 'challenges.sqlite3') as db:
            self.assertEqual(db.execute('SELECT record FROM challenges').fetchone()[0], self.raw)
            self.assertEqual(db.execute('SELECT data FROM evidence_images').fetchone()[0], self.jpeg)

    def test_replaced_owned_stage_root_and_foreign_child_survive_cleanup(self):
        orphan = self.root / 'owned-orphan'
        rebound = []

        def callback(files):
            parent = files.directory(self.root)
            stage = files.temporary(parent.fd, directory=True)
            child = files.file(stage.pin.fd, 'owned', 32, create=True)
            os.write(child.fd, b'original')
            root = self.root / stage.pin.name
            os.rename(root, orphan)
            root.mkdir()
            (root / 'foreign').write_bytes(b'preserve foreign root')
            rebound.append(root)
            raise ArchiveError('storage', 'Controlled prepublication failure.')

        self.rejection(lambda: backup._operation(callback), 'storage')
        self.assertEqual((rebound[0] / 'foreign').read_bytes(), b'preserve foreign root')
        self.assertEqual(list(orphan.iterdir()), [])

    def test_source_lock_replacement_detected_before_publication(self):
        original = backup.write_archive
        lock = self.source / '.server.lock'

        def fault(*args, **kwargs):
            original(*args, **kwargs)
            lock.rename(self.root / 'original-lock')
            lock.write_bytes(b'foreign lock')

        with patch.object(backup, 'write_archive', side_effect=fault):
            with self.assertRaises(ArchiveError) as error:
                backup.create_archive(self.source, self.output)
        self.assertEqual(error.exception.code, 'input')
        self.assertEqual(lock.read_bytes(), b'foreign lock')
        self.assertFalse(self.output.exists())
        self.assertEqual((self.source / 'challenges.sqlite3').read_bytes(), self.original['challenges.sqlite3'])

    def test_unsupported_restore_and_deadline_fail_before_staging(self):
        backup.create_archive(self.source, self.output)
        with patch.object(backup.sys, 'platform', 'unsupported'):
            self.rejection(lambda: backup.restore_archive(self.output, self.target), 'input')
        with patch.object(backup, 'OPERATION_SECONDS', -1):
            self.rejection(lambda: backup.restore_archive(self.output, self.target), 'timeout')
        self.assertFalse(self.target.exists())

    def test_cli_unknown_arguments_never_echo_private_literals(self):
        output = StringIO()
        with redirect_stderr(output):
            self.assertEqual(backup.main(['inspect', '--archive', 'x', '--Private-secret=CAPABILITY']), 2)
        self.assertNotIn('CAPABILITY', output.getvalue())
        self.assertNotIn('Private-secret', output.getvalue())

    def test_empty_valid_library_and_legacy_raw_records_round_trip(self):
        for legacy in (False, True):
            with self.subTest(legacy=legacy):
                source = self.root / ('legacy' if legacy else 'empty')
                source.mkdir()
                (source / '.server.lock').write_bytes(b'')
                if legacy:
                    with sqlite3.connect(source / 'challenges.sqlite3') as db:
                        db.execute('CREATE TABLE challenges (id TEXT PRIMARY KEY NOT NULL, record TEXT NOT NULL)')
                        db.execute('PRAGMA user_version=1')
                        db.execute('INSERT INTO challenges VALUES (?,?)', (self.created['challengeId'], self.legacy_raw))
                else:
                    Store(source).close()
                original = (source / 'challenges.sqlite3').read_bytes()
                archive, target = self.root / ('legacy.zip' if legacy else 'empty.zip'), self.root / ('legacy-restored' if legacy else 'empty-restored')
                made = backup.create_archive(source, archive)
                self.assertEqual(made.challenges, int(legacy))
                self.assertEqual(made.images, 0)
                self.assertEqual(made.source_schema_version, 1 if legacy else 2)
                self.assertEqual(made, backup.inspect_archive(archive))
                self.assertEqual(made, backup.restore_archive(archive, target))
                with sqlite3.connect(target / 'challenges.sqlite3') as db:
                    self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 2)
                    rows = db.execute('SELECT record FROM challenges').fetchall()
                    self.assertEqual(rows, [(self.legacy_raw,)] if legacy else [])
                self.assertEqual((source / 'challenges.sqlite3').read_bytes(), original)

    def test_source_symlink_and_special_database_refused_without_mutation(self):
        alias = self.root / 'source-alias'
        alias.symlink_to(self.source, target_is_directory=True)
        self.rejection(lambda: backup.create_archive(alias, self.output), 'input')
        source = self.root / 'special-source'
        source.mkdir()
        (source / '.server.lock').write_bytes(b'')
        os.mkfifo(source / 'challenges.sqlite3')
        self.rejection(lambda: backup.create_archive(source, self.output), 'input')
        self.assertFalse(self.output.exists())

    def test_cancel_after_directory_publication_is_completion(self):
        backup.create_archive(self.source, self.output)
        cancel = Event()
        original = backup._rename_noreplace

        def late(*args):
            original(*args)
            cancel.set()

        with patch.object(backup, '_rename_noreplace', side_effect=late):
            summary = backup.restore_archive(self.output, self.target, cancel=cancel)
        self.assertEqual(summary.images, 1)
        with sqlite3.connect(self.target / 'challenges.sqlite3') as db:
            self.assertEqual(db.execute('SELECT record FROM challenges').fetchone()[0], self.raw)
        self.unchanged()

    def test_unsupported_rename_feature_preserves_absent_destination(self):
        backup.create_archive(self.source, self.output)
        with patch.object(backup, '_rename_supported', side_effect=ArchiveError('destination', 'Atomic no-replace restore unavailable.')):
            self.rejection(lambda: backup.restore_archive(self.output, self.target), 'destination')
        self.assertFalse(self.target.exists())

    def test_restore_feature_probe_closes_its_native_sqlite_connection(self):
        closed = []
        native_connect = sqlite3.connect

        class ProbeConnection(sqlite3.Connection):
            def close(self):
                closed.append(True)
                super().close()

        def connect(*args, **kwargs):
            return native_connect(*args, **kwargs, factory=ProbeConnection)

        with patch.object(backup.sqlite3, 'connect', side_effect=connect):
            backup._platform(restore=True)
        self.assertEqual(closed, [True])


if __name__ == '__main__':
    unittest.main()
