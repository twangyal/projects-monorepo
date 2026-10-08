"""Producer gates using independently authored canonical media/container bytes."""
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import struct
import tempfile
import threading
import unittest
import zipfile
from unittest.mock import patch

from karaoke.archive import (ArchiveError, export_archive, import_archive,
                             read_archive_origin, read_archive_project)


def wav(frames=44100):
    pcm = struct.pack('<hh', -32768, 12345) * frames
    return struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF', 36 + len(pcm), b'WAVE',
                       b'fmt ', 16, 1, 2, 44100, 176400, 4, 16, b'data', len(pcm)) + pcm


def project():
    return dict(schemaVersion=1, id='a' * 32, title='海 <song>\n☀', duration=1.0,
                revision=7, cues=[dict(start=0.1, end=0.8, text='literal <b>🎶</b>')])


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def authored_archive(project_bytes=None, audio=None, processing=None):
    audio = wav() if audio is None else audio
    parts = [('project.json', encode(project()) if project_bytes is None else project_bytes)]
    parts += [(name + '.wav', audio) for name in ('source', 'vocals', 'backing')]
    if processing is not None:
        parts.append(('processing.json', processing))
    manifest = dict(schemaVersion=1, kind='karaoke-studio-project', origin='local-library',
                    audio=dict(sampleRate=44100, channels=2, sampleWidth=2, frames=44100),
                    files=[dict(name=name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
                           for name, data in parts])
    parts.append(('manifest.json', encode(manifest)))
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name, data in parts:
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            archive.writestr(info, data)
    return output.getvalue()


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.work = self.root / 'work'
        self.source.mkdir()
        self.work.mkdir()
        self.source_fd = os.open(self.source, os.O_RDONLY | os.O_DIRECTORY)
        self.work_fd = os.open(self.work, os.O_RDONLY | os.O_DIRECTORY)
        self.cancel = threading.Event()
        for name in ('source', 'vocals', 'backing'):
            (self.source / (name + '.wav')).write_bytes(wav())

    def tearDown(self):
        os.close(self.source_fd)
        os.close(self.work_fd)
        self.temp.cleanup()

    def restore(self, data=None):
        (self.work / 'input.karaoke.zip').write_bytes(authored_archive() if data is None else data)
        return import_archive(self.work_fd, 'b' * 32, self.cancel, lambda _: None)

    def test_authored_import_preserves_bytes_revision_and_creates_origin_receipt(self):
        result = self.restore()
        expected = {**project(), 'id': 'b' * 32}
        self.assertEqual(result.project, expected)
        self.assertEqual(result.origin, 'imported-declared')
        directory = self.work / 'completed'
        status = directory.stat()
        self.assertEqual(result.output_identity, (status.st_dev, status.st_ino))
        for name in ('source', 'vocals', 'backing'):
            self.assertEqual((directory / (name + '.wav')).read_bytes(), wav())
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            origin = read_archive_origin(fd)
        finally:
            os.close(fd)
        self.assertEqual(origin['sourceRevision'], 7)
        self.assertEqual(origin['archiveSha256'], hashlib.sha256(authored_archive()).hexdigest())

    def test_export_is_readable_by_independent_zip_decoder_and_snapshot_is_detached(self):
        snapshot = project()
        result = export_archive(snapshot, self.source_fd, self.work_fd, self.cancel, lambda _: None)
        output = self.work / 'export.karaoke.zip'
        status = output.stat()
        self.assertEqual(result.output_identity, (status.st_dev, status.st_ino))
        self.assertEqual(result.archive_sha256, hashlib.sha256(output.read_bytes()).hexdigest())
        snapshot['cues'][0]['text'] = 'changed'
        self.assertEqual(result.project['cues'][0]['text'], project()['cues'][0]['text'])
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(archive.namelist(), ['project.json', 'source.wav', 'vocals.wav',
                                                 'backing.wav', 'manifest.json'])
            self.assertEqual(archive.read('backing.wav'), wav())
            self.assertIsNone(archive.testzip())
            self.assertEqual(json.loads(archive.read('manifest.json'))['origin'], 'local-library')
        with output.open('rb') as source:
            self.assertEqual(read_archive_project(source), project())
            self.assertFalse(source.closed)

    def test_processing_literal_bytes_and_imported_origin_survive_reexport(self):
        raw = b'{ "sourceGain": 0.5, "windowRanges": [{"start":0,"frames":44100}], "windowCount":1 }\n'
        restored = self.restore(authored_archive(processing=raw))
        fd = os.open(self.work / 'completed', os.O_RDONLY | os.O_DIRECTORY)
        try:
            result = export_archive(restored.project, fd, self.work_fd, self.cancel, lambda _: None)
        finally:
            os.close(fd)
        self.assertTrue(result.has_processing)
        self.assertEqual(result.origin, 'imported-declared')
        with zipfile.ZipFile(self.work / 'export.karaoke.zip') as archive:
            self.assertEqual(archive.read('processing.json'), raw)

    def test_strict_project_json_rejections(self):
        valid = encode(project())
        bad = [valid.replace(b'"revision":7', b'"revision":true'),
               valid.replace(b'"revision":7', b'"revision":2147483648'),
               valid.replace(b'"revision":7', b'"revision":7,"revision":7'),
               valid.replace(b'"revision":7', b'"revision":' + b'1' * 33),
               valid.replace(b'"cues":', b'"private":"path","cues":'),
               valid.replace(b'"title":', b'"title":"\\ud800","unused":'),
               b'\xef\xbb\xbf' + valid, b'[' * 17 + b'0' + b']' * 17]
        for payload in bad:
            with self.subTest(payload=payload[:50]), self.assertRaises(ArchiveError):
                self.restore(authored_archive(project_bytes=payload))

    def test_export_admits_bounded_project_before_serializing_direct_caller(self):
        oversized = {**project(), 'cues': [project()['cues'][0]] * 201}
        with patch('karaoke.archive.json.dumps', side_effect=AssertionError('serialized first')):
            with self.assertRaises(ArchiveError):
                export_archive(oversized, self.source_fd, self.work_fd, self.cancel, lambda _: None)

    def test_export_nonportable_revision_has_actionable_error_without_outputs(self):
        with self.assertRaisesRegex(ArchiveError, 'revision.*2147483647'):
            export_archive({**project(), 'revision': 2147483648}, self.source_fd,
                           self.work_fd, self.cancel, lambda _: None)
        self.assertFalse((self.work / 'export.karaoke.zip').exists())
        self.assertEqual((self.source / 'source.wav').read_bytes(), wav())

    def test_noncanonical_wav_and_checksum_damage_fail(self):
        broken = bytearray(wav())
        broken[22:24] = struct.pack('<H', 1)
        with self.assertRaises(ArchiveError):
            self.restore(authored_archive(audio=bytes(broken)))
        data = bytearray(authored_archive())
        offset = data.find(b'RIFF') + 100
        data[offset] ^= 1
        with self.assertRaises(ArchiveError):
            self.restore(bytes(data))

    def test_container_prefix_trailing_local_disagreement_and_central_bound(self):
        good = authored_archive()
        variants = [b'x' + good, good + b'x']
        mismatch = bytearray(good)
        mismatch[14] ^= 1
        variants.append(bytes(mismatch))
        central = bytearray(good)
        struct.pack_into('<I', central, len(central) - 10, 4097)
        variants.append(bytes(central))
        for data in variants:
            with self.subTest(kind=data[:8]), self.assertRaises(ArchiveError):
                self.restore(data)

    def test_export_rejects_unknown_processing_symlink_and_duration_mismatch(self):
        (self.source / 'processing.json').write_bytes(b'{"privatePath":"secret"}')
        with self.assertRaises(ArchiveError):
            export_archive(project(), self.source_fd, self.work_fd, self.cancel, lambda _: None)
        (self.source / 'processing.json').unlink()
        (self.source / 'archive-origin.json').symlink_to(self.source / 'source.wav')
        with self.assertRaises(ArchiveError):
            export_archive(project(), self.source_fd, self.work_fd, self.cancel, lambda _: None)
        (self.source / 'archive-origin.json').unlink()
        with self.assertRaises(ArchiveError):
            export_archive({**project(), 'duration': 1.1}, self.source_fd, self.work_fd,
                           self.cancel, lambda _: None)

    def test_cancellation_and_deadline_are_bounded_and_no_completed_result(self):
        self.cancel.set()
        with self.assertRaises(ArchiveError):
            self.restore()
        self.cancel.clear()
        with patch('karaoke.archive.ARCHIVE_TIMEOUT', 0), self.assertRaises(ArchiveError):
            self.restore()
        self.assertFalse((self.work / 'completed').exists())

    def test_export_receipt_keeps_original_fd_when_output_name_is_replaced(self):
        def stage(message):
            if message == 'Verifying saved archive':
                os.rename(self.work / 'export.karaoke.zip', self.work / 'original.zip')
                (self.work / 'export.karaoke.zip').write_bytes(b'replacement')
        result = export_archive(project(), self.source_fd, self.work_fd, self.cancel, stage)
        original = (self.work / 'original.zip').stat()
        replacement = (self.work / 'export.karaoke.zip').stat()
        self.assertEqual(result.output_identity, (original.st_dev, original.st_ino))
        self.assertNotEqual(result.output_identity, (replacement.st_dev, replacement.st_ino))
        self.assertEqual(result.archive_sha256,
                         hashlib.sha256((self.work / 'original.zip').read_bytes()).hexdigest())

    def test_import_receipt_and_writes_stay_on_original_created_directory(self):
        from karaoke import archive
        original_create = archive._create_file
        def replace_after_directory_open(directory, name):
            if name == 'project.json':
                os.rename(self.work / 'completed', self.work / 'original-completed')
                (self.work / 'completed').mkdir()
                (self.work / 'completed' / 'sentinel').write_text('keep')
            return original_create(directory, name)
        with patch('karaoke.archive._create_file', replace_after_directory_open):
            result = self.restore()
        original = (self.work / 'original-completed').stat()
        self.assertEqual(result.output_identity, (original.st_dev, original.st_ino))
        self.assertEqual(sorted(p.name for p in (self.work / 'completed').iterdir()), ['sentinel'])
        self.assertEqual((self.work / 'original-completed' / 'source.wav').read_bytes(), wav())

    def test_cancel_during_pcm_copy_stops_before_another_block(self):
        from karaoke import archive
        original_read = archive._read_exact
        def interrupt(source, length):
            data = original_read(source, length)
            if length == 65536:
                self.cancel.set()
            return data
        with patch('karaoke.archive._read_exact', interrupt), self.assertRaisesRegex(
                ArchiveError, 'cancelled'):
            export_archive(project(), self.source_fd, self.work_fd, self.cancel, lambda _: None)
        self.assertLess((self.work / 'export.karaoke.zip').stat().st_size, len(wav()))
        self.assertEqual((self.source / 'source.wav').read_bytes(), wav())
        self.assertEqual((self.source / 'vocals.wav').read_bytes(), wav())

    def test_large_unicode_metadata_is_written_in_bounded_blocks(self):
        from karaoke import archive
        value = project()
        value['cues'] = [dict(start=index / 100, end=(index + 1) / 100, text='🎵' * 200)
                         for index in range(100)]
        original_create = archive._create_file
        class Writes:
            def __init__(self, output):
                self.output = output
            def __enter__(self):
                self.output.__enter__()
                return self
            def __exit__(self, *args):
                return self.output.__exit__(*args)
            def __getattr__(self, name):
                return getattr(self.output, name)
            def write(self, data):
                if len(data) > 65536:
                    raise AssertionError('unbounded write')
                return self.output.write(data)
        def bounded_create(directory, name):
            return Writes(original_create(directory, name))
        with patch('karaoke.archive._create_file', bounded_create):
            result = self.restore(authored_archive(project_bytes=encode(value)))
        self.assertEqual(result.project['cues'], value['cues'])

    def test_cache_metadata_reader_does_not_rehash_audio(self):
        class Meter(io.BytesIO):
            def __init__(self, data):
                super().__init__(data)
                self.total = 0
                self.maximum = 0
            def read(self, size=-1):
                self.assert_bounded(size)
                result = super().read(size)
                self.total += len(result)
                self.maximum = max(self.maximum, len(result))
                return result
            @staticmethod
            def assert_bounded(size):
                if not 0 <= size <= 65536:
                    raise AssertionError('unbounded read')
        source = Meter(authored_archive())
        self.assertEqual(read_archive_project(source), project())
        self.assertLess(source.total, 8192)
        self.assertFalse(source.closed)

    def test_absent_origin_does_not_close_caller_fd(self):
        self.assertIsNone(read_archive_origin(self.source_fd))
        self.assertTrue(stat.S_ISDIR(os.fstat(self.source_fd).st_mode))


if __name__ == '__main__':
    unittest.main()
