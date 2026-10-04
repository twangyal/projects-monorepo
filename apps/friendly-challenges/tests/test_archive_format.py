"""Literal physical ZIP tests. Test image bytes are not JPEG-decode claims."""
import hashlib
import io
import json
import os
import stat
import struct
import tempfile
import time
import unittest
import zipfile
from dataclasses import replace
from threading import Event
from unittest.mock import patch

from challenges.archive_common import ArchiveError, ArchiveSource, RecordSource
from challenges.archive_format import copy_member, read_index, read_records, write_archive

CHALLENGE = '1' * 32
OTHER = '2' * 32
EVIDENCE = 'a' * 32
RECORD = f'records/{CHALLENGE}.json'
IMAGE = f'images/{CHALLENGE}/{EVIDENCE}.jpg'
RAW = b'{ "format_test_only": "literal record", "space": 1 }\n'
JPEG = b'\xff\xd8test-only-not-a-decodable-image\xff\xd9'


def literal_zip(items=None, manifest_patch=None, manifest_raw=None):
    items = [(RECORD, RAW), (IMAGE, JPEG)] if items is None else items
    manifest = {'schemaVersion': 1, 'kind': 'friendly-challenges-library', 'createdAtMs': 42,
                'sourceSchemaVersion': 2, 'members': [
                    {'name': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                    for name, data in items]}
    if manifest_patch:
        manifest_patch(manifest)
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as archive:
        encoded = manifest_raw if manifest_raw is not None else json.dumps(manifest, separators=(',', ':'), sort_keys=True).encode()
        for name, data in [('manifest.json', encoded), *items]:
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.create_version = info.extract_version = 20
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            archive.writestr(info, data)
    return output.getvalue()


class ArchiveFormatTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.cancel = Event()
        self.deadline = time.monotonic() + 60

    def fd(self, data=b''):
        fd, path = tempfile.mkstemp(dir=self.directory.name)
        self.addCleanup(os.close, fd)
        with open(path, 'wb') as stream:
            stream.write(data)
        return fd

    def options(self):
        return {'cancel': self.cancel, 'deadline': self.deadline}

    def test_literal_container_index_raw_records_and_exact_image_copy(self):
        fd = self.fd(literal_zip())
        index = read_index(fd, **self.options())
        self.assertEqual(index.created_at_ms, 42)
        self.assertEqual(index.source_schema_version, 2)
        self.assertEqual([entry.name for entry in index.entries], ['manifest.json', RECORD, IMAGE])
        self.assertEqual(read_records(fd, index, **self.options()), (RecordSource(CHALLENGE, RAW),))
        output = self.fd()
        copy_member(fd, index, IMAGE, output, **self.options())
        self.assertEqual(os.pread(output, len(JPEG) + 1, 0), JPEG)

    def test_empty_library_is_one_manifest_member(self):
        fd = self.fd(literal_zip([]))
        index = read_index(fd, **self.options())
        self.assertEqual(len(index.entries), 1)
        self.assertEqual(index.members, ())
        self.assertEqual(read_records(fd, index, **self.options()), ())

    def test_writer_matches_independent_literal_dialect_and_preserves_record_bytes(self):
        source = ArchiveSource(IMAGE, self.fd(JPEG), len(JPEG), hashlib.sha256(JPEG).hexdigest())
        output = self.fd()
        write_archive(output, 42, 2, (RecordSource(CHALLENGE, RAW),), (source,), **self.options())
        self.assertEqual(os.pread(output, os.fstat(output).st_size, 0), literal_zip())

    def test_container_prefix_trailing_comment_and_all_truncations_refuse(self):
        original = literal_zip()
        for payload in [b'x' + original, original + b'x', original + original, *[original[:i] for i in range(len(original))]]:
            with self.subTest(size=len(payload)), self.assertRaises(ArchiveError):
                read_index(self.fd(payload), **self.options())

    def test_both_headers_enforce_fixed_attributes_flags_method_and_extents(self):
        original = literal_zip()
        central = original.index(b'PK\x01\x02')
        corruptions = [(6, '<H', 8), (8, '<H', 8), (10, '<H', 1),
                       (central + 4, '<H', 20), (central + 8, '<H', 2048),
                       (central + 10, '<H', 8), (central + 38, '<I', (stat.S_IFLNK | 0o777) << 16),
                       (central + 42, '<I', 1), (len(original) - 10, '<I', 65537)]
        for offset, fmt, value in corruptions:
            changed = bytearray(original)
            struct.pack_into(fmt, changed, offset, value)
            with self.subTest(offset=offset), self.assertRaises(ArchiveError):
                read_index(self.fd(changed), **self.options())

    def test_sha_crc_and_manifest_disagreement_fail_during_index_admission(self):
        for changed in [literal_zip(manifest_patch=lambda item: item['members'][0].update(sha256='0' * 64)),
                        literal_zip(manifest_patch=lambda item: item.update(createdAtMs=True)),
                        literal_zip(manifest_patch=lambda item: item.update(sourceSchemaVersion=3))]:
            with self.assertRaises(ArchiveError):
                read_index(self.fd(changed), **self.options())
        changed = bytearray(literal_zip())
        changed[changed.index(JPEG) + 3] ^= 1
        with self.assertRaises(ArchiveError):
            read_index(self.fd(changed), **self.options())

    def test_names_order_duplicates_and_member_sizes_refuse(self):
        cases = [[(IMAGE, JPEG), (RECORD, RAW)], [(RECORD, RAW), (RECORD, RAW)],
                 [(f'records/{CHALLENGE.upper().replace("1", "A")}.json', RAW)],
                 [('../outside.json', RAW)], [(RECORD, b'')],
                 [(f'records/{OTHER}.json', RAW), (RECORD, RAW)],
                 [(RECORD, b'x' * (1024 * 1024 + 1))], [(RECORD, RAW), (IMAGE, b'x' * (512 * 1024 + 1))]]
        for items in cases:
            with self.subTest(names=[name for name, _ in items]), self.assertRaises(ArchiveError):
                read_index(self.fd(literal_zip(items)), **self.options())

    def test_forged_index_changed_archive_and_nonempty_output_cannot_copy(self):
        fd = self.fd(literal_zip())
        index = read_index(fd, **self.options())
        forged = replace(index, members=(replace(index.members[0], sha256='0' * 64), *index.members[1:]))
        with self.assertRaises(ArchiveError):
            read_records(fd, forged, **self.options())
        with self.assertRaises(ArchiveError):
            copy_member(fd, index, IMAGE, self.fd(b'untouched'), **self.options())
        os.pwrite(fd, b'X', index.entries[-1].offset)
        with self.assertRaises(ArchiveError):
            copy_member(fd, index, IMAGE, self.fd(), **self.options())

    def test_writer_metadata_and_source_preflight_leave_output_empty(self):
        bad = ArchiveSource(IMAGE, self.fd(JPEG), len(JPEG), '0' * 64)
        for timestamp, version, records, media in [(True, 2, (), ()), (42, True, (), ()),
            (42, 2, (RecordSource('../wrong', RAW),), ()),
            (42, 2, (RecordSource(CHALLENGE, RAW),), (bad,))]:
            output = self.fd()
            with self.assertRaises(ArchiveError):
                write_archive(output, timestamp, version, records, media, **self.options())
            self.assertEqual(os.fstat(output).st_size, 0)

    def test_cancellation_and_short_writes_are_bounded(self):
        self.cancel.set()
        with self.assertRaises(ArchiveError) as caught:
            read_index(self.fd(literal_zip()), **self.options())
        self.assertEqual(caught.exception.code, 'cancelled')
        self.cancel.clear()
        output = self.fd()
        with patch('os.write', return_value=0), self.assertRaises(ArchiveError):
            write_archive(output, 42, 2, (), (), **self.options())

    def test_manifest_strict_json_and_safe_metadata_are_admitted_before_records(self):
        invalid = [b'\xff', b'\xef\xbb\xbf{}', b'{"kind":1,"kind":2}', b'{"x":NaN}',
                   b'[' * 33 + b'0' + b']' * 33, b'{"x":"\\ud800"}', b'{"x":"\\u0000"}']
        for raw in invalid:
            with self.subTest(raw=raw), self.assertRaises(ArchiveError):
                read_index(self.fd(literal_zip([], manifest_raw=raw)), **self.options())
        for patch_value in [2**53, -1, 1.5, float('inf')]:
            with self.assertRaises(ArchiveError):
                read_index(self.fd(literal_zip([], manifest_patch=lambda item: item.update(createdAtMs=patch_value))), **self.options())
        raw = b'{ "members": [], "sourceSchemaVersion": 1, "createdAtMs": 0, "kind": "friendly-challenges-library", "schemaVersion": 1 }\n'
        self.assertEqual(read_index(self.fd(literal_zip([], manifest_raw=raw)), **self.options()).source_schema_version, 1)

    def test_exact_record_and_image_byte_limits_and_maximum_member_topology(self):
        raw, image = b'x' * (1024 * 1024), b'y' * (512 * 1024)
        fd = self.fd(literal_zip([(RECORD, raw), (IMAGE, image)]))
        index = read_index(fd, **self.options())
        self.assertEqual(read_records(fd, index, **self.options())[0].raw, raw)
        output = self.fd()
        copy_member(fd, index, IMAGE, output, **self.options())
        self.assertEqual(os.pread(output, len(image), 0), image)
        records = [(f'records/{i:032x}.json', RAW) for i in range(20)]
        images = [(f'images/{i:032x}/{j:032x}.jpg', JPEG) for i in range(20) for j in range(8)]
        maximum = read_index(self.fd(literal_zip(records + images)), **self.options())
        self.assertEqual(len(maximum.entries), 181)
        for items in [records + [(f'records/{20:032x}.json', RAW)],
                      records + images + [(f'images/{19:032x}/{8:032x}.jpg', JPEG)]]:
            with self.assertRaises(ArchiveError):
                read_index(self.fd(literal_zip(items)), **self.options())

    def test_native_short_io_preserves_exact_canonical_archive(self):
        original_write, original_read = os.write, os.pread
        source = ArchiveSource(IMAGE, self.fd(JPEG), len(JPEG), hashlib.sha256(JPEG).hexdigest())
        output = self.fd()
        with patch('os.write', side_effect=lambda fd, data: original_write(fd, data[:7])):
            write_archive(output, 42, 2, (RecordSource(CHALLENGE, RAW),), (source,), **self.options())
        self.assertEqual(os.pread(output, os.fstat(output).st_size, 0), literal_zip())
        with patch('os.pread', side_effect=lambda fd, size, offset: original_read(fd, min(size, 7), offset)):
            self.assertEqual(read_records(output, read_index(output, **self.options()), **self.options()), (RecordSource(CHALLENGE, RAW),))

    def test_source_changed_after_first_scan_is_not_published_as_complete_archive(self):
        source_fd = self.fd(JPEG)
        source = ArchiveSource(IMAGE, source_fd, len(JPEG), hashlib.sha256(JPEG).hexdigest())
        output, native_write, changed = self.fd(), os.write, []

        def write(fd, data):
            result = native_write(fd, data)
            if fd == output and not changed:
                changed.append(True)
                os.pwrite(source_fd, b'X', 3)
            return result

        with patch('os.write', side_effect=write), self.assertRaises(ArchiveError):
            write_archive(output, 42, 2, (RecordSource(CHALLENGE, RAW),), (source,), **self.options())
        self.assertTrue(changed)
        self.assertNotIn(b'PK\x05\x06', os.pread(output, os.fstat(output).st_size, 0))

    def test_cancellation_during_payload_scan_leaves_native_file_bytes_unchanged(self):
        data = literal_zip([(RECORD, b'x' * (1024 * 1024))])
        fd, native_read, calls = self.fd(data), os.pread, []

        def read(fd, size, offset):
            result = native_read(fd, size, offset)
            if size == 65536:
                calls.append(True)
                self.cancel.set()
            return result

        with patch('os.pread', side_effect=read), self.assertRaises(ArchiveError) as caught:
            read_index(fd, **self.options())
        self.assertEqual(caught.exception.code, 'cancelled')
        self.assertTrue(calls)
        self.assertEqual(native_read(fd, len(data), 0), data)

    def test_raw_record_writer_integrity_checks_use_bounded_blocks_before_output(self):
        record = RecordSource(CHALLENGE, b'x' * (1024 * 1024))
        original_crc = __import__('zlib').crc32
        lengths = []

        def checksum(data, value=0):
            lengths.append(len(data))
            self.assertLessEqual(len(data), 65536)
            return original_crc(data, value)

        with patch('challenges.archive_format.zlib.crc32', side_effect=checksum):
            write_archive(self.fd(), 42, 2, (record,), (), **self.options())
        self.assertGreaterEqual(lengths.count(65536), 16)


if __name__ == '__main__':
    unittest.main()
