"""Strict, streamed saved-project archives. The service alone publishes outputs.

The small ZIP dialect is parsed directly; no general ZIP reader, decompressor,
member path extraction, or archive-sized allocation is involved.
"""
from dataclasses import dataclass
import hashlib
import io
import json
import math
import os
import re
import stat
import struct
import threading
import time
from typing import BinaryIO, Callable
import zlib

from .limits import MAX_JSON_BYTES, MAX_WAV_BYTES, MAX_DURATION, MAX_CUES, SAMPLE_RATE
from .model import ValidationError, validate_project

MAX_ARCHIVE_BYTES = 160 * 1024**2
MAX_MANIFEST_BYTES = 8 * 1024
MAX_PROCESSING_BYTES = 16 * 1024
MAX_ARCHIVE_CENTRAL_BYTES = 4096
MAX_ARCHIVE_ENTRIES = 6
MAX_PORTABLE_REVISION = 2147483647
ARCHIVE_TIMEOUT = 180
_BLOCK = 65536
_LOCAL = struct.Struct('<4s5H3I2H')
_CENTRAL = struct.Struct('<4s6H3I5H2I')
_END = struct.Struct('<4s4H2IH')
_WAV = struct.Struct('<4sI4s4sIHHIIHH4sI')
_MODE = (stat.S_IFREG | 0o600) << 16
_BASE_NAMES = ('project.json', 'source.wav', 'vocals.wav', 'backing.wav')
_LIMITS = {'project.json': MAX_JSON_BYTES, 'source.wav': MAX_WAV_BYTES,
           'vocals.wav': MAX_WAV_BYTES, 'backing.wav': MAX_WAV_BYTES,
           'processing.json': MAX_PROCESSING_BYTES, 'manifest.json': MAX_MANIFEST_BYTES}


class ArchiveError(ValueError):
    """A bounded actionable error, never supplied content or filesystem paths."""


@dataclass(frozen=True)
class ArchiveResult:
    project: dict
    frames: int
    origin: str
    has_processing: bool
    archive_sha256: str
    output_identity: tuple[int, int]


@dataclass(frozen=True)
class _Entry:
    name: str
    offset: int
    size: int
    crc: int


class _Budget:
    def __init__(self, cancel: threading.Event | None = None):
        self.cancel = cancel
        self.end = time.monotonic() + ARCHIVE_TIMEOUT

    def check(self):
        if self.cancel is not None and self.cancel.is_set():
            raise ArchiveError('Archive operation cancelled.')
        if time.monotonic() >= self.end:
            raise ArchiveError('Archive operation timed out.')

    def stage(self, callback: Callable[[str], None], message: str):
        self.check()
        callback(message)
        self.check()


def _fail(message='Archive format or metadata is invalid.'):
    raise ArchiveError(message)


def _keys(value, names):
    if type(value) is not dict or set(value) != set(names):
        _fail()


def _integer(value, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        _fail()
    return value


def _number(value, minimum, maximum):
    if type(value) not in (int, float):
        _fail()
    try:
        finite = math.isfinite(value)
    except (OverflowError, ValueError):
        _fail()
    if not finite or not minimum <= value <= maximum:
        _fail()
    return value


def _hex(value, length):
    if type(value) is not str or re.fullmatch('[0-9a-f]{' + str(length) + '}', value) is None:
        _fail()
    return value


def _strict_json(raw: bytes):
    # Bound depth and numeric tokens before json.loads allocates containers or
    # invokes number conversion. Strings are scanned without interpreting data.
    if raw.startswith(b'\xef\xbb\xbf'):
        _fail('Archive JSON must be strict UTF-8 without a BOM.')
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        _fail('Archive JSON must contain valid UTF-8.')
    depth = 0
    in_string = False
    escaped = False
    index = 0
    while index < len(text):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char in '[{':
            depth += 1
            if depth > 16:
                _fail('Archive JSON nesting exceeds its limit.')
        elif char in ']}':
            depth -= 1
        elif char in '-0123456789':
            end = index + 1
            while end < len(text) and text[end] in '0123456789eE+-.':
                end += 1
            if end - index > 32:
                _fail('Archive JSON numeric literal exceeds its limit.')
            index = end - 1
        index += 1

    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                _fail('Archive JSON contains duplicate keys.')
            value[key] = item
        return value

    def invalid_constant(_):
        _fail('Archive JSON numbers must be finite.')

    try:
        value = json.loads(text, object_pairs_hook=pairs, parse_constant=invalid_constant)
    except (ValueError, RecursionError, OverflowError):
        _fail('Archive JSON is invalid.')

    def unicode_check(item):
        if type(item) is str:
            if '\x00' in item:
                _fail('Archive JSON must not contain NUL.')
            try:
                item.encode('utf-8')
            except UnicodeEncodeError:
                _fail('Archive JSON must contain valid Unicode.')
        elif type(item) is dict:
            for key, child in item.items():
                unicode_check(key)
                unicode_check(child)
        elif type(item) is list:
            for child in item:
                unicode_check(child)
        elif type(item) is float and not math.isfinite(item):
            _fail('Archive JSON numbers must be finite.')
    unicode_check(value)
    return value


def _json_bytes(value):
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False,
                          separators=(',', ':')).encode('utf-8')
    except (ValueError, TypeError, UnicodeEncodeError, RecursionError):
        _fail('Archive metadata cannot be represented safely.')


def _project(value):
    _keys(value, ('schemaVersion', 'id', 'title', 'duration', 'revision', 'cues'))
    if type(value['revision']) is not int or not 0 <= value['revision'] <= MAX_PORTABLE_REVISION:
        _fail('Saved revision must be an integer between 0 and 2147483647 for portable archives.')
    if type(value['cues']) is not list or len(value['cues']) > MAX_CUES:
        _fail()
    for cue in value['cues']:
        _keys(cue, ('start', 'end', 'text'))
    try:
        return validate_project(value)
    except ValidationError:
        _fail('Saved project fields or cue intervals are invalid for an archive.')


def _processing(raw, frames):
    value = _strict_json(raw)
    if type(value) is not dict:
        _fail('Processing metadata must be an approved object.')
    exact = {'model': 'spleeter:2stems', 'modelRelease': 'v1.4.0',
             'chunkScheme': 'linear-sample-center-overlap'}
    integers = {'offlineNetworkAttempts': (0, 1000000), 'peakRssKiB': (0, 1000000000),
                'windowFrames': (1, 1323000), 'overlapFrames': (0, 88200),
                'hopFrames': (1, 1323000), 'windowCount': (1, 11),
                'frameCount': (frames, frames), 'sampleRate': (SAMPLE_RATE, SAMPLE_RATE)}
    numbers = {'workerSeconds': (0, 1000000), 'inferenceSeconds': (0, 1000000),
               'sourcePeak': (0, 1000000), 'stemPeak': (0, 1000000),
               'sourceGain': (0, 1), 'stemGain': (0, 1),
               'duration': (frames / SAMPLE_RATE, frames / SAMPLE_RATE)}
    allowed = set(exact) | set(integers) | set(numbers) | {
        'modelArchiveSha256', 'spleeterVersion', 'tensorflowVersion', 'windowRanges'}
    if not set(value) <= allowed:
        _fail('Processing metadata contains unsupported or private fields.')
    for key, item in value.items():
        if key in exact:
            if type(item) is not str or item != exact[key]:
                _fail()
        elif key in integers:
            _integer(item, *integers[key])
        elif key in numbers:
            _number(item, *numbers[key])
        elif key == 'modelArchiveSha256':
            _hex(item, 64)
        elif key in ('spleeterVersion', 'tensorflowVersion'):
            if type(item) is not str or re.fullmatch(r'[A-Za-z0-9.+_-]{1,64}', item) is None:
                _fail()
        elif key == 'windowRanges':
            if type(item) is not list or len(item) > 11:
                _fail()
            previous = -1
            for window in item:
                _keys(window, ('start', 'frames'))
                start = _integer(window['start'], 0, frames - 1)
                count = _integer(window['frames'], 1, frames)
                if start <= previous or start + count > frames:
                    _fail()
                previous = start
            if 'windowCount' in value and len(item) != value['windowCount']:
                _fail()
    return value


def _origin(value):
    _keys(value, ('schemaVersion', 'sourceProjectId', 'sourceRevision',
                  'archiveSha256', 'declaredOrigin'))
    _integer(value['schemaVersion'], 1, 1)
    _hex(value['sourceProjectId'], 32)
    _integer(value['sourceRevision'], 0, MAX_PORTABLE_REVISION)
    _hex(value['archiveSha256'], 64)
    if type(value['declaredOrigin']) is not str or value['declaredOrigin'] not in (
            'local-library', 'imported-declared'):
        _fail()
    return value


def _open_file(directory, name, maximum, optional=False):
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    except FileNotFoundError:
        if optional:
            return None
        _fail('An archive input file is missing.')
    except OSError:
        _fail('An archive input file cannot be opened safely.')
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= maximum:
            _fail('An archive input file has an invalid type or size.')
        return os.fdopen(fd, 'rb'), info.st_size
    except BaseException:
        os.close(fd)
        raise


def _read_exact(source, length):
    if not 0 <= length <= _BLOCK:
        _fail()
    result = source.read(length)
    if len(result) != length:
        _fail('Archive input ended unexpectedly.')
    return result


def _layout(source, budget):
    budget.check()
    source.seek(0, os.SEEK_END)
    size = source.tell()
    if not 22 <= size <= MAX_ARCHIVE_BYTES:
        _fail('Archive file exceeds its size limit or is incomplete.')
    source.seek(size - 22)
    end = _END.unpack(_read_exact(source, 22))
    signature, disk, central_disk, disk_count, count, central_size, central_offset, comment = end
    if (signature != b'PK\x05\x06' or disk or central_disk or comment or
            count not in (5, 6) or disk_count != count or
            not 0 < central_size <= MAX_ARCHIVE_CENTRAL_BYTES or
            central_offset + central_size != size - 22):
        _fail('Archive central directory is invalid or exceeds its limit.')
    source.seek(central_offset)
    central = _read_exact(source, central_size)
    position = 0
    entries = []
    expected_names = _BASE_NAMES + (('processing.json',) if count == 6 else ()) + ('manifest.json',)
    local_end = 0
    total = 0
    for expected in expected_names:
        budget.check()
        if position + _CENTRAL.size > len(central):
            _fail()
        fields = _CENTRAL.unpack_from(central, position)
        (sig, made, needed, flags, method, clock, date, crc, compressed, unpacked,
         name_length, extra, member_comment, start_disk, internal, external, offset) = fields
        position += _CENTRAL.size
        name = expected.encode('ascii')
        if (sig != b'PK\x01\x02' or made >> 8 != 3 or needed not in (10, 20) or
                flags or method or clock or date != 33 or extra or member_comment or
                start_disk or internal or external != _MODE or name_length != len(name) or
                central[position:position + name_length] != name or compressed != unpacked or
                not 0 < unpacked <= _LIMITS[expected] or offset != local_end):
            _fail('Archive entries must use the fixed stored-file format.')
        position += name_length
        source.seek(offset)
        local = _LOCAL.unpack(_read_exact(source, _LOCAL.size))
        if local != (b'PK\x03\x04', needed, flags, method, clock, date, crc,
                     compressed, unpacked, name_length, 0):
            _fail('Archive local and central headers disagree.')
        if _read_exact(source, name_length) != name:
            _fail()
        data_offset = offset + _LOCAL.size + name_length
        local_end = data_offset + unpacked
        if local_end > central_offset:
            _fail('Archive entries overlap or exceed their bounds.')
        total += unpacked
        if total > MAX_ARCHIVE_BYTES:
            _fail('Expanded archive exceeds its size limit.')
        entries.append(_Entry(expected, data_offset, unpacked, crc))
    if position != len(central) or local_end != central_offset:
        _fail('Archive contains hidden, prefixed or trailing data.')
    return tuple(entries)


def _copy_entry(source, entry, budget, destination=None):
    source.seek(entry.offset)
    remaining = entry.size
    digest = hashlib.sha256()
    crc = 0
    while remaining:
        budget.check()
        block = _read_exact(source, min(_BLOCK, remaining))
        digest.update(block)
        crc = zlib.crc32(block, crc)
        if destination is not None:
            destination.write(block)
        remaining -= len(block)
    budget.check()
    if crc != entry.crc:
        _fail('Archive member checksum is invalid.')
    return digest.hexdigest()


def _metadata(source, entry, budget):
    output = io.BytesIO()
    digest = _copy_entry(source, entry, budget, output)
    return output.getvalue(), digest


def _wav_header(header, size):
    if len(header) != 44:
        _fail('Audio must use canonical 44.1 kHz stereo PCM16 WAV.')
    fields = _WAV.unpack(header)
    data = size - 44
    if (fields != (b'RIFF', size - 8, b'WAVE', b'fmt ', 16, 1, 2,
                   SAMPLE_RATE, SAMPLE_RATE * 4, 4, 16, b'data', data) or
            data % 4 or not SAMPLE_RATE <= data // 4 <= MAX_DURATION * SAMPLE_RATE):
        _fail('Audio must use canonical 44.1 kHz stereo PCM16 WAV with exact lengths.')
    return data // 4


def _manifest(raw, entries):
    value = _strict_json(raw)
    _keys(value, ('schemaVersion', 'kind', 'origin', 'audio', 'files'))
    _integer(value['schemaVersion'], 1, 1)
    if value['kind'] != 'karaoke-studio-project' or value['origin'] not in (
            'local-library', 'imported-declared'):
        _fail()
    _keys(value['audio'], ('sampleRate', 'channels', 'sampleWidth', 'frames'))
    for key, exact in (('sampleRate', SAMPLE_RATE), ('channels', 2), ('sampleWidth', 2)):
        _integer(value['audio'][key], exact, exact)
    _integer(value['audio']['frames'], SAMPLE_RATE, MAX_DURATION * SAMPLE_RATE)
    files = value['files']
    if type(files) is not list or len(files) != len(entries) - 1:
        _fail()
    for item, entry in zip(files, entries[:-1]):
        _keys(item, ('name', 'bytes', 'sha256'))
        if item['name'] != entry.name:
            _fail()
        _integer(item['bytes'], entry.size, entry.size)
        _hex(item['sha256'], 64)
    return value


def _admit_metadata(source, entries, budget):
    raw, _ = _metadata(source, entries[-1], budget)
    manifest = _manifest(raw, entries)
    raw, digest = _metadata(source, entries[0], budget)
    if digest != manifest['files'][0]['sha256']:
        _fail('Saved project checksum is invalid.')
    project = _project(_strict_json(raw))
    frames = manifest['audio']['frames']
    if project['duration'] != frames / SAMPLE_RATE:
        _fail('Saved duration does not match exact audio frame count.')
    processing = None
    if len(entries) == 6:
        processing, digest = _metadata(source, entries[-2], budget)
        if digest != manifest['files'][-1]['sha256']:
            _fail('Processing checksum is invalid.')
        _processing(processing, frames)
    return project, manifest, processing


def _hash_file(source, budget):
    source.seek(0)
    digest = hashlib.sha256()
    size = 0
    while True:
        budget.check()
        block = source.read(_BLOCK)
        if not block:
            break
        size += len(block)
        if size > MAX_ARCHIVE_BYTES:
            _fail('Archive file exceeds its size limit.')
        digest.update(block)
    return digest.hexdigest()


def _create_file(directory, name):
    try:
        fd = os.open(name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=directory)
        return os.fdopen(fd, 'w+b')
    except OSError:
        _fail('Archive output cannot be created safely.')


def _write_file(directory, name, data, budget):
    with _create_file(directory, name) as output:
        for offset in range(0, len(data), _BLOCK):
            budget.check()
            output.write(data[offset:offset + _BLOCK])
        output.flush()
        os.fsync(output.fileno())


class _Writer:
    def __init__(self, output, budget):
        self.output = output
        self.budget = budget
        self.records = []
        self.files = []

    def entry(self, name, source, size):
        self.budget.check()
        if not 0 < size <= _LIMITS[name]:
            _fail('Archive member exceeds its size limit.')
        encoded = name.encode('ascii')
        offset = self.output.tell()
        if offset + 30 + len(encoded) + size > MAX_ARCHIVE_BYTES:
            _fail('Archive exceeds its size limit.')
        self.output.write(_LOCAL.pack(b'PK\x03\x04', 20, 0, 0, 0, 33, 0,
                                      size, size, len(encoded), 0))
        self.output.write(encoded)
        crc = 0
        digest = hashlib.sha256()
        remaining = size
        while remaining:
            self.budget.check()
            block = _read_exact(source, min(remaining, _BLOCK))
            self.output.write(block)
            crc = zlib.crc32(block, crc)
            digest.update(block)
            remaining -= len(block)
        if source.read(1):
            _fail('Archive source file changed size during copying.')
        end = self.output.tell()
        self.output.seek(offset + 14)
        self.output.write(struct.pack('<I', crc))
        self.output.seek(end)
        record = _CENTRAL.pack(b'PK\x01\x02', (3 << 8) | 20, 20, 0, 0, 0, 33,
                               crc, size, size, len(encoded), 0, 0, 0, 0, _MODE, offset) + encoded
        self.records.append(record)
        self.files.append(dict(name=name, bytes=size, sha256=digest.hexdigest()))

    def finish(self):
        self.budget.check()
        central = b''.join(self.records)
        offset = self.output.tell()
        if len(central) > MAX_ARCHIVE_CENTRAL_BYTES or offset + len(central) + 22 > MAX_ARCHIVE_BYTES:
            _fail('Archive exceeds its size limit.')
        self.output.write(central)
        self.output.write(_END.pack(b'PK\x05\x06', 0, 0, len(self.records), len(self.records),
                                   len(central), offset, 0))
        self.output.flush()
        os.fsync(self.output.fileno())


def read_archive_origin(project_fd: int) -> dict | None:
    try:
        opened = _open_file(project_fd, 'archive-origin.json', 4096, optional=True)
        if opened is None:
            return None
        source, size = opened
        with source:
            raw = _read_exact(source, size)
            if source.read(1):
                _fail('Archive provenance changed while reading.')
        return _origin(_strict_json(raw))
    except OSError:
        _fail('Archive provenance cannot be read safely.')


def read_archive_project(source: BinaryIO) -> dict:
    try:
        budget = _Budget()
        entries = _layout(source, budget)
        project, _, _ = _admit_metadata(source, entries, budget)
        return project
    except (OSError, ValueError, TypeError, struct.error) as exc:
        if isinstance(exc, ArchiveError):
            raise
        _fail('Archive metadata cannot be read safely.')


def export_archive(project: dict, project_fd: int, work_fd: int,
                   cancel: threading.Event, stage: Callable[[str], None]) -> ArchiveResult:
    sources = []
    try:
        budget = _Budget(cancel)
        budget.stage(stage, 'Validating saved archive data')
        # Admit exact bounded fields before allocating serialized caller data.
        saved = _project(project)
        raw = _json_bytes(saved)
        if len(raw) > MAX_JSON_BYTES:
            _fail('Saved project metadata exceeds its size limit.')
        saved = _project(_strict_json(raw))
        origin = 'imported-declared' if read_archive_origin(project_fd) is not None else 'local-library'
        frames = None
        for name in _BASE_NAMES[1:]:
            source, size = _open_file(project_fd, name, MAX_WAV_BYTES)
            sources.append((name, source, size))
            current = _wav_header(_read_exact(source, 44), size)
            source.seek(0)
            if frames is not None and current != frames:
                _fail('The three audio files must have identical frame counts.')
            frames = current
        if saved['duration'] != frames / SAMPLE_RATE:
            _fail('Saved duration does not match exact audio frame count.')
        processing = None
        opened = _open_file(project_fd, 'processing.json', MAX_PROCESSING_BYTES, optional=True)
        if opened is not None:
            source, size = opened
            with source:
                processing = _read_exact(source, size)
                if source.read(1):
                    _fail('Processing metadata changed while reading.')
            _processing(processing, frames)
        budget.stage(stage, 'Copying saved archive audio')
        with _create_file(work_fd, 'export.karaoke.zip') as output:
            writer = _Writer(output, budget)
            writer.entry('project.json', io.BytesIO(raw), len(raw))
            for name, source, size in sources:
                writer.entry(name, source, size)
            if processing is not None:
                writer.entry('processing.json', io.BytesIO(processing), len(processing))
            manifest = dict(schemaVersion=1, kind='karaoke-studio-project', origin=origin,
                            audio=dict(sampleRate=SAMPLE_RATE, channels=2, sampleWidth=2, frames=frames),
                            files=list(writer.files))
            metadata = _json_bytes(manifest)
            writer.entry('manifest.json', io.BytesIO(metadata), len(metadata))
            writer.finish()
            budget.stage(stage, 'Verifying saved archive')
            entries = _layout(output, budget)
            _admit_metadata(output, entries, budget)
            for entry, item in zip(entries[1:4], manifest['files'][1:4]):
                output.seek(entry.offset)
                if _wav_header(_read_exact(output, 44), entry.size) != frames:
                    _fail()
                if _copy_entry(output, entry, budget) != item['sha256']:
                    _fail('Archive audio checksum is invalid.')
            archive_hash = _hash_file(output, budget)
            info = os.fstat(output.fileno())
            budget.check()
            return ArchiveResult(saved, frames, origin, processing is not None,
                                 archive_hash, (info.st_dev, info.st_ino))
    except (OSError, ValueError, TypeError, struct.error) as exc:
        if isinstance(exc, ArchiveError):
            raise
        _fail('Archive export could not complete safely.')
    finally:
        for _, source, _ in sources:
            source.close()


def import_archive(work_fd: int, project_id: str, cancel: threading.Event,
                   stage: Callable[[str], None]) -> ArchiveResult:
    completed = None
    try:
        budget = _Budget(cancel)
        budget.stage(stage, 'Validating project archive')
        _hex(project_id, 32)
        source, _ = _open_file(work_fd, 'input.karaoke.zip', MAX_ARCHIVE_BYTES)
        with source:
            entries = _layout(source, budget)
            saved, manifest, processing = _admit_metadata(source, entries, budget)
            frames = manifest['audio']['frames']
            for entry in entries[1:4]:
                source.seek(entry.offset)
                if _wav_header(_read_exact(source, 44), entry.size) != frames:
                    _fail('Archive audio frame counts disagree.')
            archive_hash = _hash_file(source, budget)
            budget.stage(stage, 'Restoring archive audio')
            os.mkdir('completed', 0o700, dir_fd=work_fd)
            completed = os.open('completed', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                dir_fd=work_fd)
            restored = {**saved, 'id': project_id}
            _write_file(completed, 'project.json', _json_bytes(restored), budget)
            for entry, item in zip(entries[1:4], manifest['files'][1:4]):
                budget.check()
                with _create_file(completed, entry.name) as output:
                    if _copy_entry(source, entry, budget, output) != item['sha256']:
                        _fail('Archive audio checksum is invalid.')
                    output.flush()
                    os.fsync(output.fileno())
            if processing is not None:
                budget.check()
                _write_file(completed, 'processing.json', processing, budget)
            sidecar = dict(schemaVersion=1, sourceProjectId=saved['id'],
                           sourceRevision=saved['revision'], archiveSha256=archive_hash,
                           declaredOrigin=manifest['origin'])
            budget.check()
            _write_file(completed, 'archive-origin.json', _json_bytes(sidecar), budget)
            os.fsync(completed)
            info = os.fstat(completed)
            budget.check()
            return ArchiveResult(restored, frames, 'imported-declared', processing is not None,
                                 archive_hash, (info.st_dev, info.st_ino))
    except (OSError, ValueError, TypeError, struct.error) as exc:
        if isinstance(exc, ArchiveError):
            raise
        _fail('Archive restore could not complete safely.')
    finally:
        if completed is not None:
            os.close(completed)
