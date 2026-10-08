"""Original legacy/mixed-version archives and literal maximum metadata bounds."""
import copy
from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import struct
import subprocess
import tempfile
from threading import Event
import time
import unittest
import zlib

from duet import archive_common as common, archive_format as fmt, archive_state as state
from duet.backup import create_archive, inspect_archive, restore_archive


ROOM = '1' * 32
TRACK = '2' * 32
MISSING = 'f' * 32


def encoded(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                      separators=(',', ':')).encode()


def room(version=1, room_id=ROOM):
    result = {'schemaVersion': 1, 'id': room_id, 'title': '  Original café 🌒\troom ',
              'createdAt': 1000, 'profiles': {'host': {'name': 'Host Ω'}, 'guest': None},
              'capabilities': {'host': 'a' * 64, 'guest': None}, 'inviteHash': 'b' * 64,
              'tracks': [{'id': TRACK, 'title': '  Song \u0001 🌒', 'artist': '\tArtist ',
                          'duration': 1.0, 'uploadedBy': 'host', 'createdAt': 1001}],
              'ratings': {TRACK: {'host': 1, 'guest': 0}}, 'playlist': [TRACK],
              'playlistRevision': 17,
              'playback': {'trackId': TRACK, 'playing': True, 'position': .375,
                           'revision': 23, 'updatedAt': 1002},
              'memories': [{'id': '3' * 32, 'trackId': MISSING, 'trackTitle': 'Deleted original',
                            'date': '2025-02-28', 'text': 'Keep\n  literal \u0001 memory 🌒',
                            'author': 'host', 'createdAt': 1003}]}
    if version == 2:
        result.update(schemaVersion=2, savedMixesRevision=7, savedMixes=[{
            'id': '4' * 32, 'name': '  Date night 🌒 ', 'entries': [
                {'trackId': MISSING, 'title': 'Unavailable original', 'artist': ''},
                {'trackId': TRACK, 'title': 'Captured title, not live title', 'artist': 'Captured artist'}]}])
    return result


def envelope(rooms, version=2):
    return encoded({'schemaVersion': version, 'kind': 'duet-library-records', 'rooms': rooms})


def literal_archive(rooms, media=(), manifest_version=1, envelope_version=1):
    records = envelope(rooms, envelope_version)
    parts = [('rooms.json', records), *sorted(media)]
    manifest = encoded({'schemaVersion': manifest_version, 'kind': 'duet-library',
                        'createdAtMs': 12345.25, 'playbackPolicy': 'saved-anchor-paused',
                        'members': [{'name': name, 'bytes': len(data),
                                     'sha256': hashlib.sha256(data).hexdigest()}
                                    for name, data in parts]})
    body, directory = bytearray(), bytearray()
    for name, data in [('manifest.json', manifest), *parts]:
        name = name.encode('ascii')
        crc, offset = zlib.crc32(data), len(body)
        body += struct.pack('<IHHHHHIIIHH', 0x04034b50, 20, 0, 0, 0, 33,
                            crc, len(data), len(data), len(name), 0) + name + data
        directory += struct.pack('<IHHHHHHIIIHHHHHII', 0x02014b50, 788, 20, 0, 0, 0, 33,
                                 crc, len(data), len(data), len(name), 0, 0, 0, 0,
                                 (stat.S_IFREG | 0o600) << 16, offset) + name
    count = len(parts) + 1
    return bytes(body + directory + struct.pack('<IHHHHIIH', 0x06054b50, 0, 0, count, count,
                                                len(directory), len(body), 0))


def maximal_core(room_id=ROOM):
    value = room(room_id=room_id)
    value['tracks'] = [{'id': f'{i + 1:032x}', 'title': '\u0001' * 80,
                        'artist': '\u0001' * 80, 'duration': 1.0,
                        'uploadedBy': 'host', 'createdAt': 1001} for i in range(12)]
    value['ratings'] = {track['id']: {'host': 1, 'guest': 0} for track in value['tracks']}
    value['playlist'] = [track['id'] for track in value['tracks']]
    value['playback'].update(trackId=value['playlist'][0], playing=False)
    value['memories'] = [{'id': f'{i + 100:032x}', 'trackId': MISSING,
                          'trackTitle': '\u0001' * 80, 'date': '2025-02-28',
                          'text': 'm', 'author': 'host', 'createdAt': 1003} for i in range(100)]
    remaining = 262144 - len(encoded(value))
    for memory in value['memories']:
        controls = min(499, remaining // 6)
        memory['text'] += '\u0001' * controls
        remaining -= controls * 6
        ascii_count = min(500 - len(memory['text']), remaining)
        memory['text'] += 'x' * ascii_count
        remaining -= ascii_count
    assert remaining == 0 and len(encoded(value)) == 262144
    return value


def maximal_room(room_id=ROOM):
    value = maximal_core(room_id)
    value.update(schemaVersion=2, savedMixesRevision=2**53 - 1,
                 savedMixes=[{'id': f'{i + 500:032x}', 'name': '\u0001' * 80,
                              'entries': [{'trackId': track['id'], 'title': track['title'],
                                           'artist': track['artist']} for track in value['tracks']]}
                             for i in range(8)])
    assert len(encoded(value)) == 365429
    return value


class SavedMixArchiveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'original.ogg'
            subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-f', 'lavfi', '-i',
                            'sine=frequency=277:sample_rate=48000:duration=1', '-ac', '2',
                            '-c:a', 'libopus', '-b:a', '128k', str(path)], check=True,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
            cls.audio = path.read_bytes()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='duet119-archive-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.kw = {'cancel': Event(), 'deadline': time.monotonic() + 45}

    def fd(self, data):
        handle = tempfile.TemporaryFile()
        self.addCleanup(handle.close)
        handle.write(data)
        handle.flush()
        return handle.fileno()

    def archive(self, rooms, outer=1, inner=1):
        media = [(f"media/{value['id']}/{track['id']}.ogg", self.audio)
                 for value in rooms for track in value['tracks']]
        data = literal_archive(rooms, media, outer, inner)
        path = self.root / f'archive-{len(list(self.root.iterdir()))}.zip'
        path.write_bytes(data)
        return path

    def test_frozen_caps_and_exact_original_maximum_core_plus_mix_extension(self):
        self.assertEqual(common.MAX_LEGACY_ROOM_BYTES, 262144)
        self.assertEqual(common.MAX_ROOM_BYTES, 365429)
        self.assertEqual(common.MAX_LEGACY_ROOMS_JSON_BYTES, 1311744)
        self.assertEqual(common.MAX_ROOMS_JSON_BYTES, 1828169)
        self.assertEqual(common.MAX_ARCHIVE_BYTES, 512 * 1024 * 1024)
        maximum = maximal_room()
        admitted = state.validate_rooms(envelope([maximum]), **self.kw)
        self.assertEqual(json.loads(admitted.rooms_json)['rooms'], [maximum])
        self.assertEqual(len(encoded(maximum)), 365429)
        bad = copy.deepcopy(maximum)
        bad['title'] += 'x'  # valid individual text, aggregate/core exactly +1
        with self.assertRaises(common.ArchiveError):
            state.validate_rooms(envelope([bad]), **self.kw)

    def test_literal_old_and_mixed_new_envelopes_preserve_versions_without_promoting_rooms(self):
        old, new = room(), room(2, '5' * 32)
        for version, values in [(1, [old]), (2, [new, old])]:
            original = copy.deepcopy(values)
            records = state.validate_rooms(envelope(values, version), **self.kw)
            self.assertEqual(records.schema_version, version)
            parsed = json.loads(records.rooms_json)
            self.assertEqual(parsed['schemaVersion'], version)
            self.assertEqual(parsed['rooms'], sorted(original, key=lambda value: value['id']))
            self.assertEqual(values, original)
        with self.assertRaises(common.ArchiveError):
            state.validate_rooms(envelope([new], 1), **self.kw)

    def test_independent_manual_zip_old_and_new_manifest_identity(self):
        for outer, values in [(1, [room()]), (2, [room(), room(2, '5' * 32)])]:
            path = self.archive(values, outer, outer)
            fd = self.fd(path.read_bytes())
            index = fmt.read_index(fd, **self.kw)
            self.assertEqual(index.schema_version, outer)
            records = state.validate_rooms(fmt.read_rooms(fd, index, **self.kw), **self.kw)
            self.assertEqual(records.schema_version, outer)
            summary = inspect_archive(path)
            self.assertEqual(summary.schema_version, outer)
            self.assertEqual(summary.tracks, len(values))

    def test_crossed_versions_and_room_two_in_old_container_refuse_before_publication(self):
        for outer, inner, values in [(1, 2, [room()]), (2, 1, [room()]),
                                     (1, 1, [room(2)]), (3, 2, [room()])]:
            path = self.archive(values, outer, inner)
            before = path.read_bytes()
            with self.assertRaises(common.ArchiveError):
                inspect_archive(path)
            target = self.root / f'refused-{outer}-{inner}-{values[0]["schemaVersion"]}'
            with self.assertRaises(common.ArchiveError):
                restore_archive(path, target)
            self.assertFalse(target.exists())
            self.assertEqual(path.read_bytes(), before)

    def test_old_envelope_keeps_its_old_raw_byte_limit(self):
        for version, maximum in [(1, 1311744), (2, 1828169)]:
            raw = envelope([], version)
            admitted = raw + b' ' * (maximum - len(raw))
            self.assertEqual(state.validate_rooms(admitted, **self.kw).schema_version, version)
            with self.assertRaises(common.ArchiveError):
                state.validate_rooms(admitted + b' ', **self.kw)

    def test_source_raw_sql_text_and_audio_unchanged_create_two_without_promoting_legacy(self):
        library = self.root / 'source'
        library.mkdir()
        (library / '.server.lock').touch()
        values = [room(), room(2, '5' * 32)]
        raw = {value['id']: '\n  ' + json.dumps(value, ensure_ascii=False, indent=3) + '\n\t'
               for value in values}
        with sqlite3.connect(library / 'rooms.sqlite3') as db:
            db.execute('CREATE TABLE rooms (id TEXT PRIMARY KEY, document TEXT NOT NULL)')
            db.executemany('INSERT INTO rooms VALUES (?,?)', raw.items())
        for value in values:
            media = library / 'media' / value['id']
            media.mkdir(parents=True)
            (media / f'{TRACK}.ogg').write_bytes(self.audio)
        before = {str(p.relative_to(library)): p.read_bytes() for p in library.rglob('*') if p.is_file()}
        archive = self.root / 'created.zip'
        created = create_archive(library, archive)
        self.assertEqual(created.schema_version, 2)
        self.assertEqual(inspect_archive(archive), created)
        after = {str(p.relative_to(library)): p.read_bytes() for p in library.rglob('*') if p.is_file()}
        self.assertEqual(after, before)
        fd = self.fd(archive.read_bytes())
        index = fmt.read_index(fd, **self.kw)
        self.assertEqual(index.schema_version, 2)
        self.assertEqual(json.loads(fmt.read_rooms(fd, index, **self.kw))['rooms'], values)

    def test_restore_old_and_new_preserves_all_values_seats_labels_and_exact_audio_except_pause(self):
        for version, values in [(1, [room()]), (2, [room(), room(2, '5' * 32)])]:
            path = self.archive(values, version, version)
            target = self.root / f'restored-{version}'
            summary = restore_archive(path, target)
            self.assertEqual(summary.schema_version, version)
            with sqlite3.connect(target / 'rooms.sqlite3') as db:
                actual = [json.loads(text) for (text,) in db.execute('SELECT document FROM rooms ORDER BY id')]
            for original, restored in zip(values, actual):
                expected = copy.deepcopy(original)
                expected['playback'].update(playing=False, revision=24,
                                            updatedAt=restored['playback']['updatedAt'])
                self.assertEqual(restored, expected)
                self.assertEqual((target / 'media' / original['id'] / f'{TRACK}.ogg').read_bytes(), self.audio)
            with self.assertRaises(common.ArchiveError):
                restore_archive(path, target)

    def test_paused_record_outer_version_is_retained_and_forged_version_rejected(self):
        for version in (1, 2):
            value = state.validate_rooms(envelope([room()], version), **self.kw)
            paused = state.paused_rooms(value, 987654.5, **self.kw)
            self.assertEqual(json.loads(paused)['schemaVersion'], version)
            self.assertEqual(json.loads(paused)['rooms'][0]['schemaVersion'], 1)
            with self.assertRaises(common.ArchiveError):
                state.paused_rooms(replace(value, schema_version=3-version), 987654.5, **self.kw)

    def test_five_maximal_rooms_are_only_sixty_media_members_not_480_copied_tracks(self):
        values = [maximal_room(f'{i + 10:032x}') for i in range(5)]
        raw = envelope(values)
        self.assertLessEqual(len(raw), 1828169)
        records = state.validate_rooms(raw, **self.kw)
        self.assertEqual(len(records.tracks), 60)
        self.assertEqual(records.memory_count, 500)
        self.assertEqual(sum(len(m['entries']) for r in values for m in r['savedMixes']), 480)
        self.assertEqual(json.loads(records.rooms_json)['rooms'], values)

    def test_missing_saved_references_are_metadata_and_do_not_require_or_create_media(self):
        value = room(2)
        path = self.archive([value], 2, 2)
        summary = inspect_archive(path)
        self.assertEqual(summary.tracks, 1)
        self.assertEqual(summary.media_bytes, len(self.audio))
        target = self.root / 'missing-reference-restored'
        restore_archive(path, target)
        self.assertEqual([p.name for p in (target / 'media' / ROOM).iterdir()], [f'{TRACK}.ogg'])

    def test_new_writer_does_not_emit_a_crossed_legacy_envelope(self):
        output = self.fd(b'')
        with self.assertRaises(common.ArchiveError):
            fmt.write_archive(output, 1234, envelope([], 1), (), **self.kw)
        self.assertEqual(os.fstat(output).st_size, 0)

    def test_cancellation_preserves_source_and_refuses_any_archive_publication(self):
        path = self.archive([room(2)], 2, 2)
        before = path.read_bytes()
        cancel = Event()
        cancel.set()
        with self.assertRaises(common.ArchiveError):
            restore_archive(path, self.root / 'cancelled', cancel=cancel)
        self.assertFalse((self.root / 'cancelled').exists())
        self.assertEqual(path.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
