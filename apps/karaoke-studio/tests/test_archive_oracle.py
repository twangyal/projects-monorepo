"""Independent, hand-authored ZIP/PCM oracle; no producer fixture helpers."""
from __future__ import annotations

import copy
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
import zlib

from karaoke.archive import (
    ArchiveError, export_archive, import_archive, read_archive_origin,
    read_archive_project,
)


OLD_ID = 'a' * 32
NEW_ID = 'b' * 32


def encoded(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def pcm(frames: int = 44100, offset: int = 0) -> bytes:
    # Both channels exercise negative values and exact signed endpoints.
    sequence = [(-32768, 32767), (-17, 29), (0, 0), (32767, -32768)]
    payload = b''.join(struct.pack('<hh', *sequence[(i + offset) % 4]) for i in range(frames))
    return struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF', 36 + len(payload), b'WAVE',
                       b'fmt ', 16, 1, 2, 44100, 176400, 4, 16, b'data', len(payload)) + payload


def project(frames: int = 44100) -> dict:
    return dict(schemaVersion=1, id=OLD_ID, title='Original <song> — café 🎵',
                duration=frames / 44100, revision=7,
                cues=[dict(start=0.125, end=0.875, text='Literal <tag> & café\nsecond line')])


def members(record: dict | None = None, processing: bytes | None = None,
            wavs: list[bytes] | None = None, origin: str = 'local-library') -> list[tuple[str, bytes]]:
    record = project() if record is None else record
    audio = [pcm(offset=i) for i in range(3)] if wavs is None else wavs
    rows = [('project.json', encoded(record))] + list(zip(
        ['source.wav', 'vocals.wav', 'backing.wav'], audio, strict=True))
    if processing is not None:
        rows.append(('processing.json', processing))
    manifest = dict(schemaVersion=1, kind='karaoke-studio-project', origin=origin,
                    audio=dict(sampleRate=44100, channels=2, sampleWidth=2,
                               frames=(len(audio[0]) - 44) // 4),
                    files=[dict(name=name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
                           for name, data in rows])
    return rows + [('manifest.json', encoded(manifest))]


def stored_zip(rows: list[tuple[str, bytes]]) -> bytes:
    """Literal own-format ZIP records; never call zipfile or archive writer."""
    local, central = bytearray(), bytearray()
    for name, data in rows:
        raw = name.encode('ascii')
        crc = zlib.crc32(data)
        offset = len(local)
        local += struct.pack('<IHHHHHIIIHH', 0x04034B50, 20, 0, 0, 0, 33,
                             crc, len(data), len(data), len(raw), 0) + raw + data
        central += struct.pack('<IHHHHHHIIIHHHHHII', 0x02014B50, 788, 20, 0, 0, 0, 33,
                               crc, len(data), len(data), len(raw), 0, 0, 0, 0,
                               (stat.S_IFREG | 0o600) << 16, offset) + raw
    return bytes(local + central + struct.pack('<IHHHHIIH', 0x06054B50, 0, 0, len(rows),
                                              len(rows), len(central), len(local), 0))


def inspect_zip(raw: bytes) -> dict[str, bytes]:
    """Check export bytes independently, including every fixed header field."""
    end = struct.unpack('<IHHHHIIH', raw[-22:])
    assert end[:3] == (0x06054B50, 0, 0) and end[3] == end[4] and end[7] == 0
    count, central_bytes, central_start = end[3], end[5], end[6]
    assert count in (5, 6) and central_bytes <= 4096
    assert central_start + central_bytes == len(raw) - 22
    cursor, local_end, result = central_start, 0, {}
    for _ in range(count):
        c = struct.unpack_from('<IHHHHHHIIIHHHHHII', raw, cursor)
        assert c[:7] == (0x02014B50, 788, 20, 0, 0, 0, 33)
        assert c[8] == c[9] and c[11:15] == (0, 0, 0, 0)
        assert c[15] == (stat.S_IFREG | 0o600) << 16 and c[16] == local_end
        name = raw[cursor + 46:cursor + 46 + c[10]]
        local = struct.unpack_from('<IHHHHHIIIHH', raw, local_end)
        assert local[:6] == (0x04034B50, 20, 0, 0, 0, 33)
        assert local[6:9] == c[7:10] and local[9] == len(name) and local[10] == 0
        assert raw[local_end + 30:local_end + 30 + len(name)] == name
        start = local_end + 30 + len(name)
        data = raw[start:start + c[9]]
        assert len(data) == c[9] and zlib.crc32(data) == c[7]
        result[name.decode('ascii')] = data
        local_end = start + c[9]
        cursor += 46 + len(name)
    assert local_end == central_start and cursor == len(raw) - 22
    names = ['project.json', 'source.wav', 'vocals.wav', 'backing.wav']
    assert list(result) in (names + ['manifest.json'], names + ['processing.json', 'manifest.json'])
    manifest = json.loads(result['manifest.json'])
    assert manifest['files'] == [dict(name=n, bytes=len(b), sha256=hashlib.sha256(b).hexdigest())
                                 for n, b in result.items() if n != 'manifest.json']
    return result


class ArchiveOracleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.original = project()
        self.rows = members(self.original)
        for name, data in self.rows[:-1]:
            (self.source / name).write_bytes(data)
        self.source_fd = os.open(self.source, os.O_RDONLY | os.O_DIRECTORY)
        self.cancel = threading.Event()
        self.serial = 0

    def tearDown(self):
        os.close(self.source_fd)
        self.temp.cleanup()

    def restore(self, raw: bytes, fresh_id: str = NEW_ID):
        self.serial += 1
        work = self.root / f'work-{self.serial}'
        work.mkdir()
        (work / 'input.karaoke.zip').write_bytes(raw)
        fd = os.open(work, os.O_RDONLY | os.O_DIRECTORY)
        try:
            result = import_archive(fd, fresh_id, self.cancel, lambda _: None)
            os.fstat(fd)  # Caller ownership survived the engine.
            return result, work / 'completed'
        finally:
            os.close(fd)

    def export(self):
        self.serial += 1
        work = self.root / f'export-{self.serial}'
        work.mkdir()
        fd = os.open(work, os.O_RDONLY | os.O_DIRECTORY)
        try:
            result = export_archive(self.original, self.source_fd, fd, self.cancel, lambda _: None)
            os.fstat(fd)
            os.fstat(self.source_fd)
            return result, work / 'export.karaoke.zip'
        finally:
            os.close(fd)

    def test_hand_authored_archive_restores_exact_saved_facts_samples_and_fresh_id(self):
        raw = stored_zip(self.rows)
        result, target = self.restore(raw)
        expected = dict(self.original, id=NEW_ID)
        self.assertEqual(result.project, expected)
        self.assertEqual(json.loads((target / 'project.json').read_bytes()), expected)
        self.assertEqual((result.frames, result.origin, result.has_processing), (44100, 'imported-declared', False))
        self.assertEqual(result.archive_sha256, hashlib.sha256(raw).hexdigest())
        info = target.stat()
        self.assertEqual(result.output_identity, (info.st_dev, info.st_ino))
        self.assertEqual(set(p.name for p in target.iterdir()),
                         {'project.json', 'source.wav', 'vocals.wav', 'backing.wav', 'archive-origin.json'})
        for name, data in self.rows[1:4]:
            self.assertEqual((target / name).read_bytes(), data)
            self.assertEqual(struct.unpack_from('<hh', data, 44),
                             [(-32768, 32767), (-17, 29), (0, 0)][self.rows[1:4].index((name, data))])
        fd = os.open(target, os.O_RDONLY | os.O_DIRECTORY)
        try:
            self.assertEqual(read_archive_origin(fd), dict(schemaVersion=1, sourceProjectId=OLD_ID,
                sourceRevision=7, archiveSha256=hashlib.sha256(raw).hexdigest(), declaredOrigin='local-library'))
        finally:
            os.close(fd)

    def test_export_matches_independent_fixed_binary_layout_without_changing_sources(self):
        before = {p.name: p.read_bytes() for p in self.source.iterdir()}
        snapshot = copy.deepcopy(self.original)
        result, output = self.export()
        raw = output.read_bytes()
        restored = inspect_zip(raw)
        self.assertEqual(json.loads(restored['project.json']), snapshot)
        self.assertEqual(json.loads(restored['manifest.json'])['origin'], 'local-library')
        for name, data in self.rows[1:4]:
            self.assertEqual(restored[name], data)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.source.iterdir()})
        self.assertEqual(self.original, snapshot)
        self.assertEqual(result.archive_sha256, hashlib.sha256(raw).hexdigest())
        self.assertEqual(result.output_identity, (output.stat().st_dev, output.stat().st_ino))
        result.project['cues'][0]['text'] = 'detached'
        self.assertEqual(self.original, snapshot)

    def test_cache_metadata_reader_keeps_stream_open_and_returns_detached_saved_record(self):
        stream = io.BytesIO(stored_zip(self.rows))
        result = read_archive_project(stream)
        self.assertFalse(stream.closed)
        self.assertEqual(result, self.original)
        result['cues'][0]['text'] = 'changed'
        self.assertEqual(read_archive_project(stream), self.original)

    def test_imported_processing_is_byte_exact_and_reexport_stays_unverified(self):
        processing = b'{ "model":"spleeter:2stems", "frameCount":44100, "duration":1, "stemGain":0.5 }\n'
        raw = stored_zip(members(processing=processing, origin='imported-declared'))
        result, target = self.restore(raw)
        self.assertTrue(result.has_processing)
        self.assertEqual((target / 'processing.json').read_bytes(), processing)
        fd = os.open(target, os.O_RDONLY | os.O_DIRECTORY)
        out = self.root / 'second-export'
        out.mkdir()
        out_fd = os.open(out, os.O_RDONLY | os.O_DIRECTORY)
        try:
            # Re-open descriptors to model restart, with no in-memory provenance.
            exported = export_archive(result.project, fd, out_fd, self.cancel, lambda _: None)
            self.assertEqual(exported.origin, 'imported-declared')
            data = inspect_zip((out / 'export.karaoke.zip').read_bytes())
            self.assertEqual(data['processing.json'], processing)
            self.assertEqual(json.loads(data['manifest.json'])['origin'], 'imported-declared')
            for name in ('source.wav', 'vocals.wav', 'backing.wav'):
                self.assertEqual(data[name], (target / name).read_bytes())
        finally:
            os.close(fd)
            os.close(out_fd)

    def test_no_origin_is_distinct_from_malformed_or_symlinked_origin(self):
        self.assertIsNone(read_archive_origin(self.source_fd))
        sidecar = self.source / 'archive-origin.json'
        for raw in [b'{}', b'{"schemaVersion":1}', b'x' * 4097]:
            sidecar.write_bytes(raw)
            with self.assertRaises(ArchiveError):
                read_archive_origin(self.source_fd)
        sidecar.unlink()
        sidecar.symlink_to(self.source / 'project.json')
        with self.assertRaises(ArchiveError):
            read_archive_origin(self.source_fd)

    def test_exact_duration_and_all_three_frame_counts_are_verified_not_trusted(self):
        self.restore(stored_zip(self.rows))
        variants = [members(dict(self.original, duration=1 + 1 / 44100)),
                    members(wavs=[pcm(), pcm(44101), pcm()]),
                    members(wavs=[pcm(44099)] * 3),
                    members(dict(self.original, duration=True))]
        for rows in variants:
            with self.subTest(kind=len(rows[2][1])), self.assertRaises(ArchiveError):
                self.restore(stored_zip(rows))

    def test_noncanonical_riff_headers_chunks_truncation_and_trailing_bytes_are_rejected(self):
        self.restore(stored_zip(self.rows))
        valid = pcm()
        bad = [valid[:-1], valid + b'\0', valid[:36] + b'JUNK' + valid[40:],
               b'RF64' + valid[4:]]
        for offset, fmt, value in [(4, '<I', len(valid)), (16, '<I', 18), (20, '<H', 3),
                                   (22, '<H', 1), (24, '<I', 48000), (28, '<I', 176401),
                                   (32, '<H', 2), (34, '<H', 32), (40, '<I', 176399)]:
            changed = bytearray(valid)
            struct.pack_into(fmt, changed, offset, value)
            bad.append(bytes(changed))
        for wav in bad:
            with self.subTest(header=wav[:44].hex()), self.assertRaises(ArchiveError):
                self.restore(stored_zip(members(wavs=[wav, valid, valid])))

    def test_strict_project_json_rejects_duplicate_keys_unknown_keys_and_scalar_coercions(self):
        self.restore(stored_zip(self.rows))
        cases = [b'\xef\xbb\xbf' + encoded(self.original),
                 encoded(self.original).replace(b'"revision":7', b'"revision":7,"revision":7'),
                 encoded(dict(self.original, privatePath='/private/not-to-echo')),
                 encoded(dict(self.original, revision=True)),
                 encoded(dict(self.original, revision=2147483648)),
                 encoded(dict(self.original, duration=float('nan'))),
                 encoded(dict(self.original, cues=[dict(self.original['cues'][0], extra=1)])),
                 encoded(self.original).replace('café'.encode(), b'caf\xff'),
                 encoded(self.original).replace(b'"revision":7', b'"revision":0007'),
                 encoded(self.original).replace(b'"revision":7', b'"revision":' + b'1' * 33),
                 encoded(self.original).replace(b'"revision":7', b'"revision":' + b'[' * 17 + b'0' + b']' * 17),
                 encoded(self.original).replace(b'"revision":7', b'"revision":null')]
        for data in cases:
            rows = members()
            rows[0] = ('project.json', data)
            manifest = json.loads(rows[-1][1])
            manifest['files'][0].update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
            rows[-1] = ('manifest.json', encoded(manifest))
            with self.subTest(data=data[:35]), self.assertRaises(ArchiveError):
                self.restore(stored_zip(rows))

    def test_manifest_is_exact_and_cannot_lie_about_hash_size_format_or_frames(self):
        self.restore(stored_zip(self.rows))
        base = json.loads(self.rows[-1][1])
        variants = [dict(base, unknown=1), dict(base, origin='trusted'),
                    dict(base, audio=dict(base['audio'], frames=True)),
                    dict(base, audio=dict(base['audio'], frames=44101)),
                    dict(base, audio=dict(base['audio'], sampleRate=48000))]
        for key, value in [('bytes', True), ('bytes', 999), ('sha256', 'A' * 64),
                           ('sha256', '0' * 64), ('name', '../source.wav')]:
            manifest = copy.deepcopy(base)
            manifest['files'][1][key] = value
            variants.append(manifest)
        manifest = copy.deepcopy(base)
        manifest['files'].reverse()
        variants.append(manifest)
        for manifest in variants:
            with self.subTest(manifest=manifest), self.assertRaises(ArchiveError):
                self.restore(stored_zip(self.rows[:-1] + [('manifest.json', encoded(manifest))]))

    def test_processing_is_known_typed_and_bounded_not_private_or_authenticated(self):
        self.restore(stored_zip(members(processing=b'{}')))
        for claim in [dict(privatePath='/private/not-to-echo'), dict(model='other'),
                      dict(stemGain=1.1), dict(offlineNetworkAttempts=True),
                      dict(frameCount=44099), dict(windowCount=12),
                      dict(windowRanges=[dict(start=0, frames=44101)]),
                      dict(windowRanges=[dict(start=1, frames=1), dict(start=0, frames=1)]),
                      dict(spleeterVersion='version with spaces')]:
            with self.subTest(claim=claim), self.assertRaises(ArchiveError):
                self.restore(stored_zip(members(processing=encoded(claim))))
        with self.assertRaises(ArchiveError):
            self.restore(stored_zip(members(processing=b' ' * 16385)))

    def test_zip_structure_admission_rejects_hidden_bytes_flags_links_and_size_mismatches(self):
        self.restore(stored_zip(self.rows))
        raw = stored_zip(self.rows)
        central = struct.unpack_from('<I', raw, len(raw) - 6)[0]
        bad = [b'prefix' + raw, raw + b'trailing', raw[:-1]]
        for where, fmt, value in [(6, '<H', 8), (8, '<H', 8), (10, '<H', 1),
                                  (12, '<H', 34), (18, '<I', 1), (28, '<H', 1),
                                  (central + 8, '<H', 1), (central + 38, '<I', (stat.S_IFLNK | 0o600) << 16),
                                  (central + 42, '<I', 1), (len(raw) - 18, '<H', 1),
                                  (len(raw) - 14, '<H', 65535), (len(raw) - 12, '<H', 65535),
                                  (len(raw) - 10, '<I', 4097), (len(raw) - 2, '<H', 1)]:
            changed = bytearray(raw)
            struct.pack_into(fmt, changed, where, value)
            bad.append(bytes(changed))
        for changed in bad:
            with self.subTest(length=len(changed)), self.assertRaises(ArchiveError):
                self.restore(changed)
        for rows in [self.rows + [('unexpected.txt', b'x')],
                     [('project.json', b'x')] + self.rows,
                     [self.rows[0], self.rows[2], self.rows[1], *self.rows[3:]],
                     [('../project.json', self.rows[0][1])] + self.rows[1:]]:
            with self.assertRaises(ArchiveError):
                self.restore(stored_zip(rows))

    def test_raw_payload_crc_corruption_is_rejected_even_when_layout_is_valid(self):
        self.restore(stored_zip(self.rows))
        raw = bytearray(stored_zip(self.rows))
        where = raw.find(b'RIFF') + 44
        raw[where] ^= 1
        with self.assertRaises(ArchiveError):
            self.restore(bytes(raw))

    def test_export_rejects_invalid_audio_and_nonportable_revision_without_source_mutation(self):
        self.export()
        self.original['revision'] = 2147483648
        before = (self.source / 'source.wav').read_bytes()
        with self.assertRaises(ArchiveError):
            self.export()
        self.original['revision'] = 7
        (self.source / 'source.wav').write_bytes(before + b'x')
        with self.assertRaises(ArchiveError):
            self.export()
        self.assertEqual((self.source / 'source.wav').read_bytes(), before + b'x')

    def test_pre_cancelled_operations_never_produce_a_completed_receipt(self):
        self.export()
        self.cancel.set()
        with self.assertRaises((ArchiveError, RuntimeError)):
            self.export()
        with self.assertRaises((ArchiveError, RuntimeError)):
            self.restore(stored_zip(self.rows))

    def test_fresh_id_validation_does_not_use_original_identity_as_destination(self):
        self.restore(stored_zip(self.rows))
        for bad_id in [OLD_ID.upper(), '../' + NEW_ID, '', 'b' * 31, True]:
            with self.subTest(identity=bad_id), self.assertRaises((ArchiveError, ValueError)):
                self.restore(stored_zip(self.rows), bad_id)


if __name__ == '__main__':
    unittest.main()
