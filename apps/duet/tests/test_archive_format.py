"""Literal portable ZIP fixtures independent of the format implementation."""
from dataclasses import FrozenInstanceError, replace
import hashlib
import json
import os
import stat
import struct
import tempfile
from threading import Event
import time
import unittest
from unittest.mock import patch
import zlib

from duet.archive_common import ArchiveError
from duet import archive_format as fmt

ROOMS = b'{"kind":"duet-library-records","rooms":[],"schemaVersion":1}'
AUDIO_NAME = 'media/' + '1' * 32 + '/' + '2' * 32 + '.ogg'
AUDIO = b'Opaque format-only fixture bytes; not a playable-media claim.'
LOCAL = struct.Struct('<IHHHHHIIIHH')
CENTRAL = struct.Struct('<IHHHHHHIIIHHHHHII')
END = struct.Struct('<IHHHHIIH')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                      separators=(',', ':')).encode()


def literal_zip(entries):
    body, directory = bytearray(), bytearray()
    positions = []
    for name, data in entries:
        name = name.encode('ascii')
        crc = zlib.crc32(data)
        offset = len(body)
        positions.append({'local': offset, 'payload': offset + 30 + len(name),
                          'central_relative': len(directory)})
        body += LOCAL.pack(0x04034b50, 20, 0, 0, 0, 33, crc, len(data), len(data), len(name), 0)
        body += name + data
        directory += CENTRAL.pack(0x02014b50, 788, 20, 0, 0, 0, 33, crc, len(data), len(data),
                                  len(name), 0, 0, 0, 0, (stat.S_IFREG | 0o600) << 16, offset)
        directory += name
    central_start = len(body)
    for position in positions:
        position['central'] = central_start + position['central_relative']
    result = bytes(body + directory + END.pack(0x06054b50, 0, 0, len(entries), len(entries),
                                               len(directory), central_start, 0))
    return result, positions


def archive(rooms=ROOMS, audio=((AUDIO_NAME, AUDIO),), manifest=None):
    members = [{'name': name, 'bytes': len(data), 'sha256': digest(data)}
               for name, data in [('rooms.json', rooms), *audio]]
    declared = {'schemaVersion': 1, 'kind': 'duet-library', 'createdAtMs': 1234.5,
                'playbackPolicy': 'saved-anchor-paused', 'members': members}
    if manifest is not None:
        declared = manifest(declared) if callable(manifest) else manifest
    manifest_bytes = declared if type(declared) is bytes else encoded(declared)
    return literal_zip([('manifest.json', manifest_bytes), ('rooms.json', rooms), *audio])


def changed(data, offset, kind, value):
    result = bytearray(data)
    struct.pack_into(kind, result, offset, value)
    return bytes(result)


class ArchiveFormatTests(unittest.TestCase):
    def setUp(self):
        self.cancel = Event()
        self.deadline = time.monotonic() + 30
        self.kw = {'cancel': self.cancel, 'deadline': self.deadline}

    def file(self, data=b''):
        handle = tempfile.TemporaryFile()
        self.addCleanup(handle.close)
        handle.write(data)
        handle.flush()
        return handle

    def index(self, data):
        source = self.file(data)
        return source, fmt.read_index(source.fileno(), **self.kw)

    def test_literal_index_rooms_and_streamed_copy_preserve_offsets(self):
        data, locations = archive()
        source = self.file(data)
        source.seek(7)
        index = fmt.read_index(source.fileno(), **self.kw)
        self.assertEqual(source.tell(), 7)
        self.assertEqual(index.created_at_ms, 1234.5)
        self.assertEqual(tuple(item.name for item in index.entries),
                         ('manifest.json', 'rooms.json', AUDIO_NAME))
        self.assertEqual(tuple(item.offset for item in index.entries),
                         tuple(item['payload'] for item in locations))
        self.assertEqual(tuple(item.name for item in index.members), ('rooms.json', AUDIO_NAME))
        self.assertEqual(fmt.read_rooms(source.fileno(), index, **self.kw), ROOMS)
        output = self.file()
        fmt.copy_member(source.fileno(), index, AUDIO_NAME, output.fileno(), **self.kw)
        output.seek(0)
        self.assertEqual(output.read(), AUDIO)
        self.assertEqual(source.tell(), 7)
        with self.assertRaises(FrozenInstanceError):
            index.created_at_ms = 0

    def test_zero_track_archive_and_reader_whitespace(self):
        data, _ = archive(audio=(), manifest=lambda item: json.dumps(item, indent=2).encode())
        source, index = self.index(data)
        self.assertEqual(len(index.entries), 2)
        self.assertEqual(fmt.read_rooms(source.fileno(), index, **self.kw), ROOMS)

    def test_footer_admission_precedes_central_or_payload_reads(self):
        data, _ = archive()
        variants = [changed(data, len(data) - 22 + 8, '<H', 63),
                    changed(data, len(data) - 22 + 12, '<I', 65537),
                    changed(data, len(data) - 22 + 16, '<I', 1)]
        for bad in variants:
            source = self.file(bad)
            original = os.pread
            reads = []
            def guarded(fd, size, offset):
                reads.append((size, offset))
                return original(fd, size, offset)
            with self.subTest(footer=bad[-22:]), patch.object(fmt.os, 'pread', side_effect=guarded):
                with self.assertRaises(ArchiveError):
                    fmt.read_index(source.fileno(), **self.kw)
            self.assertEqual(reads, [(22, len(bad) - 22)])

    def test_physical_fixed_header_footer_and_local_crosschecks(self):
        data, pos = archive()
        end = len(data) - 22
        corruptions = {
            'local-version': (pos[0]['local'] + 4, '<H', 21),
            'local-flags': (pos[0]['local'] + 6, '<H', 8),
            'local-compression': (pos[0]['local'] + 8, '<H', 8),
            'local-time': (pos[0]['local'] + 10, '<H', 1),
            'local-date': (pos[0]['local'] + 12, '<H', 34),
            'local-extra': (pos[0]['local'] + 28, '<H', 1),
            'central-creator': (pos[0]['central'] + 4, '<H', 20),
            'central-needed': (pos[0]['central'] + 6, '<H', 45),
            'central-flags': (pos[0]['central'] + 8, '<H', 1),
            'central-compression': (pos[0]['central'] + 10, '<H', 8),
            'central-extra': (pos[0]['central'] + 30, '<H', 1),
            'central-comment': (pos[0]['central'] + 32, '<H', 1),
            'central-disk': (pos[0]['central'] + 34, '<H', 1),
            'central-internal-attrs': (pos[0]['central'] + 36, '<H', 1),
            'central-mode': (pos[0]['central'] + 38, '<I', (stat.S_IFLNK | 0o600) << 16),
            'central-overlap': (pos[1]['central'] + 42, '<I', 0),
            'central-crc-mismatch': (pos[0]['central'] + 16, '<I', 0),
            'central-size-mismatch': (pos[0]['central'] + 20, '<I', 1),
            'zip64': (pos[0]['central'] + 24, '<I', 0xffffffff),
            'end-disk': (end + 4, '<H', 1),
            'end-count-mismatch': (end + 10, '<H', 2),
            'end-comment': (end + 20, '<H', 1),
        }
        for name, (offset, kind, value) in corruptions.items():
            with self.subTest(name=name), self.assertRaises(ArchiveError):
                self.index(changed(data, offset, kind, value))
        for bad in (data + b'trailing', b'prefix' + data, data[:-1], data[:21]):
            with self.subTest(size=len(bad)), self.assertRaises(ArchiveError):
                self.index(bad)

    def test_exact_member_names_order_duplicates_and_zero_audio(self):
        good, _ = archive()
        source, index = self.index(good)
        manifest = os.pread(source.fileno(), index.entries[0].size, index.entries[0].offset)
        variants = [
            [('rooms.json', ROOMS), ('manifest.json', manifest), (AUDIO_NAME, AUDIO)],
            [('manifest.json', manifest), ('rooms.json', ROOMS), ('rooms.json', ROOMS)],
            [('manifest.json', manifest), ('rooms.json', ROOMS), ('../private', AUDIO)],
            [('manifest.json', manifest), ('rooms.json', ROOMS), (AUDIO_NAME.upper(), AUDIO)],
            [('manifest.json', manifest), ('rooms.json', ROOMS), ('media/' + '1' * 32 + '/', AUDIO)],
        ]
        for entries in variants:
            with self.subTest(names=[item[0] for item in entries]), self.assertRaises(ArchiveError):
                self.index(literal_zip(entries)[0])
        with self.assertRaises(ArchiveError):
            self.index(archive(audio=((AUDIO_NAME, b''),))[0])

    def test_manifest_strict_schema_scalars_duplicate_keys_depth_and_secrets(self):
        variants = [
            lambda item: {**item, 'schemaVersion': True},
            lambda item: {**item, 'createdAtMs': True},
            lambda item: {**item, 'createdAtMs': 1e15 + 1},
            lambda item: {**item, 'unknown': 'SECRET_PERSON_AND_PATH'},
            lambda item: {**item, 'playbackPolicy': 'elapsed-time'},
            lambda item: {**item, 'members': item['members'][::-1]},
            lambda item: {**item, 'members': [{**item['members'][0], 'bytes': True}, item['members'][1]]},
            lambda item: {**item, 'members': [{**item['members'][0], 'sha256': 'F' * 64}, item['members'][1]]},
            b'{"schemaVersion":1,"schemaVersion":1}',
            b'{"createdAtMs":NaN}',
            b'\xef\xbb\xbf{}',
            b'[' * 33 + b'0' + b']' * 33,
            b'{"private":"\xff"}',
        ]
        for declaration in variants:
            with self.subTest(declaration=str(declaration)[:30]):
                with self.assertRaises(ArchiveError) as raised:
                    self.index(archive(manifest=declaration)[0])
                self.assertNotIn('SECRET_PERSON_AND_PATH', str(raised.exception))
                self.assertLess(len(str(raised.exception)), 250)

    def test_member_crc_and_sha_verified_when_reading_or_copying(self):
        data, positions = archive()
        source, index = self.index(data)
        for name, method in [('rooms.json', 'rooms'), (AUDIO_NAME, 'audio')]:
            entry = next(item for item in index.entries if item.name == name)
            os.pwrite(source.fileno(), b'X', entry.offset)
            with self.assertRaises(ArchiveError):
                if method == 'rooms':
                    fmt.read_rooms(source.fileno(), index, **self.kw)
                else:
                    fmt.copy_member(source.fileno(), index, name, self.file().fileno(), **self.kw)
            os.pwrite(source.fileno(), data[entry.offset:entry.offset + 1], entry.offset)
        def wrong_hash(item):
            item['members'][0]['sha256'] = '0' * 64
            return item
        source, index = self.index(archive(manifest=wrong_hash)[0])
        with self.assertRaises(ArchiveError):
            fmt.read_rooms(source.fileno(), index, **self.kw)
        bad = bytearray(data)
        bad[positions[0]['payload']] ^= 1
        with self.assertRaises(ArchiveError):
            self.index(bytes(bad))

    def test_manifest_rooms_and_archive_limits_before_allocation(self):
        with self.assertRaises(ArchiveError):
            self.index(archive(manifest=b' ' * (32768 + 1))[0])
        data, _ = archive()
        source = self.file(data)
        source.truncate(512 * 1024 * 1024 + 1)  # sparse; no huge fixture allocation
        with patch.object(fmt.os, 'pread', side_effect=AssertionError('read before size admission')):
            with self.assertRaises(ArchiveError):
                fmt.read_index(source.fileno(), **self.kw)
        source, index = self.index(data)
        oversized = replace(index, members=(replace(index.members[0], size=5 * 256 * 1024 + 1025),
                                            *index.members[1:]))
        with patch.object(fmt.os, 'pread', side_effect=AssertionError('payload read before admission')):
            with self.assertRaises(ArchiveError):
                fmt.read_rooms(source.fileno(), oversized, **self.kw)

    def test_writer_exact_literal_dialect_and_empty_library(self):
        for media in ((), ((AUDIO_NAME, AUDIO),)):
            sources = tuple(fmt.ArchiveSource(name, self.file(data).fileno(), len(data), digest(data))
                            for name, data in media)
            output = self.file()
            fmt.write_archive(output.fileno(), 1234.5, ROOMS, sources, **self.kw)
            output.seek(0)
            self.assertEqual(output.read(), archive(audio=media)[0])

    def test_writer_rejects_declared_source_changes_and_bad_inputs_before_output(self):
        original = self.file(AUDIO)
        valid = fmt.ArchiveSource(AUDIO_NAME, original.fileno(), len(AUDIO), digest(AUDIO))
        variants = [(replace(valid, sha256='0' * 64),), (replace(valid, size=True),),
                    (replace(valid, name='../SECRET_PERSON_AND_PATH'),), (valid, valid), [valid]]
        for sources in variants:
            output = self.file()
            with self.subTest(sources=sources), self.assertRaises(ArchiveError):
                fmt.write_archive(output.fileno(), 1234.5, ROOMS, sources, **self.kw)
            self.assertEqual(os.fstat(output.fileno()).st_size, 0)
        output = self.file()
        with self.assertRaises(ArchiveError):
            fmt.write_archive(output.fileno(), True, ROOMS, (), **self.kw)
        self.assertEqual(os.fstat(output.fileno()).st_size, 0)

    def test_block_bounded_streams_and_cancel_between_blocks(self):
        payload = b'original' * 20000
        source, index = self.index(archive(audio=((AUDIO_NAME, payload),))[0])
        output = self.file()
        original = os.pread
        reads = []
        def bounded(fd, size, offset):
            self.assertLessEqual(size, 65536)
            reads.append(size)
            return original(fd, size, offset)
        with patch.object(fmt.os, 'pread', side_effect=bounded):
            fmt.copy_member(source.fileno(), index, AUDIO_NAME, output.fileno(), **self.kw)
        self.assertGreater(len(reads), 1)
        output = self.file()
        calls = 0
        def cancelling(fd, size, offset):
            nonlocal calls
            calls += 1
            data = original(fd, size, offset)
            self.cancel.set()
            return data
        with patch.object(fmt.os, 'pread', side_effect=cancelling):
            with self.assertRaises(ArchiveError) as raised:
                fmt.copy_member(source.fileno(), index, AUDIO_NAME, output.fileno(), **self.kw)
        self.assertEqual(raised.exception.code, 'cancelled')
        self.assertEqual(calls, 1)

    def test_writer_detects_change_between_hash_and_copy_passes(self):
        audio = self.file(AUDIO)
        output = self.file()
        source = fmt.ArchiveSource(AUDIO_NAME, audio.fileno(), len(AUDIO), digest(AUDIO))
        original = os.pread
        calls = 0
        def changing(fd, size, offset):
            nonlocal calls
            if fd == audio.fileno():
                calls += 1
                if calls == 2:
                    os.pwrite(fd, b'X', 0)
            return original(fd, size, offset)
        with patch.object(fmt.os, 'pread', side_effect=changing):
            with self.assertRaises(ArchiveError):
                fmt.write_archive(output.fileno(), 1234.5, ROOMS, (source,), **self.kw)
        self.assertEqual(calls, 2)

    def test_writer_cancellation_after_last_write_is_not_success(self):
        output = self.file()
        original = os.write
        def cancelling(fd, data):
            count = original(fd, data)
            if bytes(data).startswith(b'PK\x05\x06'):
                self.cancel.set()
            return count
        with patch.object(fmt.os, 'write', side_effect=cancelling):
            with self.assertRaises(ArchiveError) as raised:
                fmt.write_archive(output.fileno(), 1234.5, ROOMS, (), **self.kw)
        self.assertEqual(raised.exception.code, 'cancelled')

    def test_literal_byte_caps_are_inclusive_and_admit_before_output(self):
        data, _ = archive()
        with patch.object(fmt, 'MAX_ARCHIVE_BYTES', len(data)):
            self.index(data)
        with patch.object(fmt, 'MAX_ARCHIVE_BYTES', len(data) - 1):
            with self.assertRaises(ArchiveError):
                self.index(data)
        media = (fmt.ArchiveSource(AUDIO_NAME, self.file(AUDIO).fileno(), len(AUDIO), digest(AUDIO)),)
        output = self.file()
        with patch.object(fmt, 'MAX_ARCHIVE_BYTES', len(data)):
            fmt.write_archive(output.fileno(), 1234.5, ROOMS, media, **self.kw)
        self.assertEqual(os.fstat(output.fileno()).st_size, len(data))
        output = self.file()
        with patch.object(fmt, 'MAX_ARCHIVE_BYTES', len(data) - 1):
            with self.assertRaises(ArchiveError):
                fmt.write_archive(output.fileno(), 1234.5, ROOMS, media, **self.kw)
        self.assertEqual(os.fstat(output.fileno()).st_size, 0)
        with patch.object(fmt, 'MAX_AUDIO_BYTES', len(AUDIO)):
            self.index(data)
        with patch.object(fmt, 'MAX_AUDIO_BYTES', len(AUDIO) - 1):
            with self.assertRaises(ArchiveError):
                self.index(data)

    def test_actual_eight_mib_audio_bound_is_streamed_without_audio_allocation(self):
        audio = self.file()
        block = b'B' * 65536
        expected_hash = hashlib.sha256()
        for _ in range(128):
            audio.write(block)
            expected_hash.update(block)
        audio.flush()
        size = 8 * 1024 * 1024
        media = (fmt.ArchiveSource(AUDIO_NAME, audio.fileno(), size, expected_hash.hexdigest()),)
        output = self.file()
        original = os.pread
        read_sizes = []
        def bounded(fd, count, offset):
            self.assertLessEqual(count, 65536)
            read_sizes.append(count)
            return original(fd, count, offset)
        with patch.object(fmt.os, 'pread', side_effect=bounded):
            fmt.write_archive(output.fileno(), 1234.5, ROOMS, media, **self.kw)
            index = fmt.read_index(output.fileno(), **self.kw)
            destination = self.file()
            fmt.copy_member(output.fileno(), index, AUDIO_NAME, destination.fileno(), **self.kw)
        self.assertEqual(index.members[1].size, size)
        self.assertEqual(os.fstat(destination.fileno()).st_size, size)
        self.assertGreaterEqual(read_sizes.count(65536), 3 * 128)
        actual_hash = hashlib.sha256()
        destination.seek(0)
        while part := destination.read(65536):
            actual_hash.update(part)
        self.assertEqual(actual_hash.hexdigest(), expected_hash.hexdigest())
        audio.truncate(size + 1)
        excess = replace(media[0], size=size + 1)
        output = self.file()
        with self.assertRaises(ArchiveError):
            fmt.write_archive(output.fileno(), 1234.5, ROOMS, (excess,), **self.kw)
        self.assertEqual(os.fstat(output.fileno()).st_size, 0)

    def test_actual_manifest_and_rooms_caps_are_inclusive(self):
        def maximum_manifest(item):
            payload = encoded(item)
            return payload + b' ' * (32768 - len(payload))
        source, index = self.index(archive(manifest=maximum_manifest)[0])
        self.assertEqual(index.entries[0].size, 32768)
        self.assertEqual(fmt.read_rooms(source.fileno(), index, **self.kw), ROOMS)
        maximum_rooms = ROOMS + b' ' * (5 * 256 * 1024 + 1024 - len(ROOMS))
        source, index = self.index(archive(rooms=maximum_rooms)[0])
        self.assertEqual(fmt.read_rooms(source.fileno(), index, **self.kw), maximum_rooms)
        with self.assertRaises(ArchiveError):
            self.index(archive(rooms=maximum_rooms + b' ')[0])

    def test_direct_forged_index_and_nonregular_inputs_reject(self):
        source, index = self.index(archive()[0])
        variants = [replace(index, entries=list(index.entries)),
                    replace(index, created_at_ms=True),
                    replace(index, entries=(replace(index.entries[0], offset=True), *index.entries[1:])),
                    replace(index, entries=(replace(index.entries[0], crc32=True), *index.entries[1:])),
                    replace(index, members=(replace(index.members[0], sha256='private\n'), *index.members[1:]))]
        for forged in variants:
            with self.subTest(index=forged), self.assertRaises(ArchiveError):
                fmt.read_rooms(source.fileno(), forged, **self.kw)
        for fd in (True, -1, 1.5):
            with self.subTest(fd=fd), self.assertRaises(ArchiveError):
                fmt.read_index(fd, **self.kw)
        read_fd, write_fd = os.pipe()
        self.addCleanup(os.close, read_fd)
        self.addCleanup(os.close, write_fd)
        with self.assertRaises(ArchiveError):
            fmt.read_index(read_fd, **self.kw)
        with self.assertRaises(ArchiveError):
            fmt.copy_member(source.fileno(), index, AUDIO_NAME, source.fileno(), **self.kw)

    def test_cancellation_and_deadline_at_public_entrypoints(self):
        source, index = self.index(archive()[0])
        for mode in ('cancelled', 'timeout'):
            kw = {'cancel': Event(), 'deadline': time.monotonic() + 30}
            if mode == 'cancelled':
                kw['cancel'].set()
            else:
                kw['deadline'] = time.monotonic() - 1
            calls = [lambda: fmt.read_index(source.fileno(), **kw),
                     lambda: fmt.read_rooms(source.fileno(), index, **kw),
                     lambda: fmt.copy_member(source.fileno(), index, AUDIO_NAME, self.file().fileno(), **kw),
                     lambda: fmt.write_archive(self.file().fileno(), 1, ROOMS, (), **kw)]
            for call in calls:
                with self.subTest(mode=mode), self.assertRaises(ArchiveError) as raised:
                    call()
                self.assertEqual(raised.exception.code, mode)


if __name__ == '__main__':
    unittest.main()
