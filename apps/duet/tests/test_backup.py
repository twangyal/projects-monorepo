"""Offline archive publication, immutability and actual command acceptance."""
from contextlib import redirect_stderr, redirect_stdout
import fcntl
import hashlib
import io
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

from duet.archive_common import ArchiveError
from duet.backup import create_archive, inspect_archive, restore_archive, main

ROOM = '1' * 32
TRACK = '2' * 32
HOST = 'a' * 64
GUEST = 'b' * 64


def snapshot(root):
    result = {}
    for child in sorted(root.rglob('*')):
        info = child.lstat()
        content = (os.readlink(child) if child.is_symlink() else
                   hashlib.sha256(child.read_bytes()).hexdigest() if child.is_file() else None)
        result[str(child.relative_to(root))] = (info.st_mode, info.st_size, info.st_mtime_ns, content)
    return result


class BackupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / 'tone.ogg'
            subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-f', 'lavfi', '-i',
                            'sine=frequency=440:sample_rate=48000:duration=1', '-ac', '2',
                            '-c:a', 'libopus', '-b:a', '128k', str(audio)], check=True,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
            cls.audio = audio.read_bytes()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='duet-backup-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.library = self.root / 'source'
        self.library.mkdir()
        (self.library / '.server.lock').touch()
        (self.library / '.jobs').mkdir()
        (self.library / '.jobs' / 'runtime-only').write_bytes(b'preserve temporary runtime state')
        self.media = self.library / 'media' / ROOM
        self.media.mkdir(parents=True)
        (self.media / f'{TRACK}.ogg').write_bytes(self.audio)
        self.room = {'schemaVersion': 1, 'id': ROOM, 'title': 'PRIVATE room title', 'createdAt': 1000,
            'profiles': {'host': {'name': 'PRIVATE Host'}, 'guest': {'name': 'PRIVATE Guest'}},
            'capabilities': {'host': hashlib.sha256(HOST.encode()).hexdigest(),
                             'guest': hashlib.sha256(GUEST.encode()).hexdigest()}, 'inviteHash': None,
            'tracks': [{'id': TRACK, 'title': 'PRIVATE Song', 'artist': 'PRIVATE Artist', 'duration': 1.0,
                        'uploadedBy': 'host', 'createdAt': 1100}],
            'ratings': {TRACK: {'host': 1, 'guest': -1}}, 'playlist': [TRACK], 'playlistRevision': 3,
            'playback': {'trackId': TRACK, 'playing': True, 'position': .25, 'revision': 7, 'updatedAt': 2000},
            'memories': [{'id': '3' * 32, 'trackId': '4' * 32, 'trackTitle': 'PRIVATE Deleted song',
                          'date': '2025-05-06', 'text': 'PRIVATE memory', 'author': 'guest', 'createdAt': 1900}]}
        self.write_room()
        self.archive = self.root / 'library.duet.zip'

    def write_room(self):
        with sqlite3.connect(self.library / 'rooms.sqlite3') as database:
            database.execute('CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, document TEXT NOT NULL)')
            database.execute('INSERT OR REPLACE INTO rooms VALUES (?,?)', (ROOM, json.dumps(self.room)))

    def assert_code(self, code, operation):
        with self.assertRaises(ArchiveError) as caught:
            operation()
        self.assertEqual(caught.exception.code, code)
        self.assertNotIn('PRIVATE', str(caught.exception))
        return caught.exception

    def test_real_roundtrip_preserves_entire_source_audio_private_seats_and_original_anchor(self):
        for name in ('rooms.sqlite3-wal', 'rooms.sqlite3-journal', 'rooms.sqlite3-shm'):
            (self.library / name).touch()
        before = snapshot(self.library)
        created = create_archive(self.library, self.archive)
        inspected = inspect_archive(self.archive)
        self.assertEqual(created, inspected)
        self.assertEqual((created.rooms, created.tracks, created.memories, created.paired_rooms, created.pending_invites), (1, 1, 1, 1, 0))
        self.assertEqual(created.media_bytes, len(self.audio))
        self.assertEqual(created.archive_bytes, self.archive.stat().st_size)
        self.assertEqual(created.playback_policy, 'saved-anchor-paused')
        target = self.root / 'restored'
        restored = restore_archive(self.archive, target)
        self.assertEqual(restored, created)
        self.assertEqual((target / 'media' / ROOM / f'{TRACK}.ogg').read_bytes(), self.audio)
        with sqlite3.connect(target / 'rooms.sqlite3') as database:
            saved = json.loads(database.execute('SELECT document FROM rooms WHERE id=?', (ROOM,)).fetchone()[0])
        expected = json.loads(json.dumps(self.room))
        expected['playback'].update(playing=False, revision=8, updatedAt=saved['playback']['updatedAt'])
        self.assertEqual(saved, expected)
        self.assertEqual(snapshot(self.library), before)
        from duet.server import create_server
        service = create_server(target, port=0)
        try:
            self.assertEqual(service.store.authenticate(ROOM, HOST), 'host')
            self.assertEqual(service.store.authenticate(ROOM, GUEST), 'guest')
            document = service.store.database.execute('SELECT document FROM rooms').fetchone()[0]
            playback = json.loads(document)['playback']
            self.assertEqual((playback['position'], playback['revision'], playback['playing']), (.25, 8, False))
        finally:
            service.server_close()

    def test_busy_or_missing_lock_rejects_before_staging_without_source_repair(self):
        with (self.library / '.server.lock').open('rb') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            before = snapshot(self.library)
            self.assert_code('busy', lambda: create_archive(self.library, self.archive))
            self.assertEqual(snapshot(self.library), before)
            self.assertEqual(sorted(path.name for path in self.root.iterdir()), ['source'])
        (self.library / '.server.lock').unlink()
        before = snapshot(self.library)
        self.assert_code('input', lambda: create_archive(self.library, self.archive))
        self.assertEqual(snapshot(self.library), before)

    def test_nonempty_wal_journal_and_nonregular_sidecars_are_never_recovered(self):
        for name in ('rooms.sqlite3-wal', 'rooms.sqlite3-journal'):
            path = self.library / name
            for kind in ('nonempty', 'symlink', 'fifo'):
                with self.subTest(name=name, kind=kind):
                    if kind == 'nonempty':
                        path.write_bytes(b'PRIVATE hot transaction')
                    elif kind == 'symlink':
                        path.symlink_to(self.media / f'{TRACK}.ogg')
                    else:
                        os.mkfifo(path)
                    before = snapshot(self.library)
                    error = self.assert_code('input', lambda: create_archive(self.library, self.archive))
                    self.assertRegex(str(error), 'shutdown|checkpoint|sidecar')
                    self.assertEqual(snapshot(self.library), before)
                    self.assertFalse(self.archive.exists())
                    path.unlink()

    def test_media_membership_symlink_or_missing_file_rejects_without_cleanup(self):
        extra = self.media / 'unrelated.txt'
        extra.write_bytes(b'PRIVATE unrelated sentinel')
        before = snapshot(self.library)
        self.assert_code('input', lambda: create_archive(self.library, self.archive))
        self.assertEqual(snapshot(self.library), before)
        extra.unlink()
        audio = self.media / f'{TRACK}.ogg'
        audio.unlink()
        self.assert_code('input', lambda: create_archive(self.library, self.archive))
        audio.symlink_to(self.root / 'outside.ogg')
        (self.root / 'outside.ogg').write_bytes(self.audio)
        before = snapshot(self.library)
        self.assert_code('input', lambda: create_archive(self.library, self.archive))
        self.assertEqual(snapshot(self.library), before)

    def test_output_inside_library_or_existing_output_is_preserved(self):
        for output in (self.library / 'backup.zip', self.library / 'not-created' / 'backup.zip',
                       self.library / '.jobs' / '..' / 'backup.zip'):
            self.assert_code('destination', lambda: create_archive(self.library, output))
            self.assertFalse(output.exists())
        self.archive.write_bytes(b'preexisting archive')
        before = snapshot(self.library)
        self.assert_code('destination', lambda: create_archive(self.library, self.archive))
        self.assertEqual(self.archive.read_bytes(), b'preexisting archive')
        self.assertEqual(snapshot(self.library), before)

    def test_symlink_components_and_fifo_inputs_do_not_follow_or_block(self):
        link = self.root / 'alias'
        link.symlink_to(self.library, target_is_directory=True)
        self.assert_code('input', lambda: create_archive(link, self.archive))
        os.mkfifo(self.archive)
        self.assert_code('input', lambda: inspect_archive(self.archive))
        self.assert_code('input', lambda: restore_archive(self.archive, self.root / 'restored'))
        self.assertFalse((self.root / 'restored').exists())

    def test_cancellation_at_entry_and_during_copy_does_not_publish_or_change_source(self):
        cancel = Event()
        cancel.set()
        self.assert_code('cancelled', lambda: create_archive(self.library, self.archive, cancel=cancel))
        cancel.clear()
        before = snapshot(self.library)
        from duet.archive_format import write_archive

        def cancel_write(*args, **kwargs):
            write_archive(*args, **kwargs)
            cancel.set()

        with patch('duet.backup.write_archive', side_effect=cancel_write):
            self.assert_code('cancelled', lambda: create_archive(self.library, self.archive, cancel=cancel))
        self.assertFalse(self.archive.exists())
        self.assertEqual(snapshot(self.library), before)
        self.assertEqual(sorted(path.name for path in self.root.iterdir()), ['source'])

    def test_existing_restore_target_never_merges_even_if_empty(self):
        create_archive(self.library, self.archive)
        target = self.root / 'destination'
        target.mkdir()
        self.assert_code('destination', lambda: restore_archive(self.archive, target))
        self.assertEqual(list(target.iterdir()), [])
        self.assertEqual(sorted(path.name for path in self.root.iterdir()), ['destination', 'library.duet.zip', 'source'])

    def test_cli_actual_process_roundtrip_has_only_counts_and_separate_link_requirement(self):
        app = Path(__file__).resolve().parents[1]
        outputs = []
        for arguments in [
            ['create', '--data-dir', str(self.library), '--output', str(self.archive)],
            ['inspect', '--archive', str(self.archive)],
            ['restore', '--archive', str(self.archive), '--data-dir', str(self.root / 'restored')],
        ]:
            completed = subprocess.run([sys.executable, '-B', '-m', 'duet.backup', *arguments], cwd=app,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
            self.assertEqual(completed.returncode, 0, completed.stderr.decode())
            output = completed.stdout.decode()
            outputs.append(output)
            self.assertRegex(output.lower(), 'separate|separately')
            for forbidden in ['PRIVATE', str(self.library), HOST, GUEST, ROOM, TRACK, self.room['capabilities']['host']]:
                self.assertNotIn(forbidden, output + completed.stderr.decode())
        self.assertTrue(all('saved-anchor-paused' in output for output in outputs))

    def test_main_cancel_error_and_success_restore_signal_handlers(self):
        previous = {name: signal.getsignal(name) for name in (signal.SIGINT, signal.SIGTERM)}
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(main(['inspect', '--archive', str(self.root / 'missing')]), 2)
            with patch('duet.backup.inspect_archive', side_effect=ArchiveError('cancelled', 'Archive operation cancelled.')):
                self.assertEqual(main(['inspect', '--archive', str(self.archive)]), 130)
        self.assertEqual({name: signal.getsignal(name) for name in previous}, previous)

    def test_cleanup_does_not_reopen_replaced_owned_root(self):
        import duet.backup as backup
        stage = self.root / 'owned'
        stage.mkdir()
        (stage / 'owned-file').write_bytes(b'owned')
        parent_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        stage_fd = os.open(stage, os.O_RDONLY | os.O_DIRECTORY)
        real_stat = os.stat
        displaced = self.root / 'displaced'
        swapped = False
        def swap_after_receipt(path, *args, **kwargs):
            nonlocal swapped
            result = real_stat(path, *args, **kwargs)
            if path == 'owned' and kwargs.get('dir_fd') == parent_fd and not swapped:
                swapped = True
                stage.rename(displaced)
                stage.mkdir()
                (stage / 'sentinel').write_bytes(b'unrelated root')
            return result
        try:
            owned = backup._Owned(backup._Pin(stage_fd, parent_fd, 'owned', backup._stamp(os.fstat(stage_fd))), True)
            with patch('duet.backup.os.stat', side_effect=swap_after_receipt):
                owned.cleanup()
            self.assertTrue(swapped)
            self.assertEqual((stage / 'sentinel').read_bytes(), b'unrelated root')
        finally:
            os.close(stage_fd)
            os.close(parent_fd)

    def test_parent_fsync_failure_preserves_complete_archive_and_library(self):
        real_fsync = os.fsync
        parent = self.root.stat()
        def fail_parent(fd):
            info = os.fstat(fd)
            if (info.st_dev, info.st_ino) == (parent.st_dev, parent.st_ino):
                raise OSError('private failure')
            real_fsync(fd)
        with patch('duet.backup.os.fsync', side_effect=fail_parent):
            error = self.assert_code('storage', lambda: create_archive(self.library, self.archive))
        self.assertIn('COMPLETE', str(error))
        self.assertEqual(inspect_archive(self.archive).tracks, 1)
        target = self.root / 'restored'
        with patch('duet.backup.os.fsync', side_effect=fail_parent):
            error = self.assert_code('storage', lambda: restore_archive(self.archive, target))
        self.assertIn('COMPLETE', str(error))
        self.assertEqual((target / 'media' / ROOM / f'{TRACK}.ogg').read_bytes(), self.audio)
        self.assertTrue((target / 'rooms.sqlite3').is_file())
        self.assertFalse(any(p.name.startswith('.duet-') for p in self.root.iterdir()))

    def test_restore_destination_race_and_postpublication_cancel_preserve_target(self):
        import duet.backup as backup
        create_archive(self.library, self.archive)
        target = self.root / 'restored'
        real_rename = backup._rename_noreplace
        def race(parent, stage, destination):
            target.mkdir()
            (target / 'sentinel').write_bytes(b'unrelated target')
            real_rename(parent, stage, destination)
        with patch('duet.backup._rename_noreplace', side_effect=race):
            self.assert_code('destination', lambda: restore_archive(self.archive, target))
        self.assertEqual((target / 'sentinel').read_bytes(), b'unrelated target')
        self.assertFalse(any(p.name.startswith('.duet-') for p in self.root.iterdir()))
        (target / 'sentinel').unlink()
        target.rmdir()
        cancel = Event()
        def publish_then_cancel(*args):
            real_rename(*args)
            cancel.set()
        with patch('duet.backup._rename_noreplace', side_effect=publish_then_cancel):
            result = restore_archive(self.archive, target, cancel=cancel)
        self.assertTrue(cancel.is_set())
        self.assertEqual(result.tracks, 1)
        self.assertEqual((target / 'media' / ROOM / f'{TRACK}.ogg').read_bytes(), self.audio)

    def test_cli_invalid_arguments_never_echo_private_values(self):
        output, error = io.StringIO(), io.StringIO()
        with redirect_stdout(output), redirect_stderr(error):
            result = main(['inspect', '--archive', str(self.archive), '--PRIVATE-secret'])
        self.assertEqual(result, 2)
        self.assertNotIn('PRIVATE', output.getvalue() + error.getvalue())

    def test_final_sidecar_media_and_stage_receipts_reject_replacement_without_cleanup(self):
        from duet.archive_format import write_archive
        audio = self.media / f'{TRACK}.ogg'
        for change in ('sidecar', 'media', 'stage'):
            with self.subTest(change=change):
                moved = None
                replaced = None
                def replace(*args, **kwargs):
                    nonlocal moved, replaced
                    write_archive(*args, **kwargs)
                    if change == 'sidecar':
                        (self.library / 'rooms.sqlite3-wal').write_bytes(b'late transaction')
                    elif change == 'media':
                        moved = audio.with_suffix('.original')
                        audio.rename(moved)
                        audio.write_bytes(b'unrelated audio')
                    else:
                        replaced = next(p for p in self.root.iterdir() if p.name.startswith('.duet-archive-'))
                        moved = self.root / 'displaced-stage'
                        replaced.rename(moved)
                        replaced.write_bytes(b'unrelated stage')
                with patch('duet.backup.write_archive', side_effect=replace):
                    self.assert_code('input', lambda: create_archive(self.library, self.archive))
                self.assertFalse(self.archive.exists())
                if change == 'sidecar':
                    self.assertEqual((self.library / 'rooms.sqlite3-wal').read_bytes(), b'late transaction')
                    (self.library / 'rooms.sqlite3-wal').unlink()
                elif change == 'media':
                    self.assertEqual(audio.read_bytes(), b'unrelated audio')
                    audio.unlink()
                    moved.rename(audio)
                else:
                    self.assertEqual(replaced.read_bytes(), b'unrelated stage')
                    self.assertTrue(moved.is_file())

    def test_prepublication_fsync_failure_and_restore_copy_cancel_do_not_publish(self):
        with patch('duet.backup.os.fsync', side_effect=OSError('private failure')):
            self.assert_code('storage', lambda: create_archive(self.library, self.archive))
        self.assertFalse(self.archive.exists())
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ['source'])
        create_archive(self.library, self.archive)
        from duet.archive_format import copy_member
        cancel = Event()
        def copy_then_cancel(*args, **kwargs):
            copy_member(*args, **kwargs)
            cancel.set()
        target = self.root / 'restored'
        before = snapshot(self.library)
        with patch('duet.backup.copy_member', side_effect=copy_then_cancel):
            self.assert_code('cancelled', lambda: restore_archive(self.archive, target, cancel=cancel))
        self.assertFalse(target.exists())
        self.assertEqual(snapshot(self.library), before)
        self.assertFalse(any(p.name.startswith('.duet-') for p in self.root.iterdir()))
