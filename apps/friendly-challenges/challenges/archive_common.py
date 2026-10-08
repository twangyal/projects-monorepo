"""Bounded immutable contracts for offline private library archives."""
from dataclasses import dataclass
import json
import math
import time
from threading import Event

ARCHIVE_VERSION = 1
ARCHIVE_KIND = 'friendly-challenges-library'
DATABASE_NAME = 'challenges.sqlite3'
LOCK_NAME = '.server.lock'
MANIFEST_NAME = 'manifest.json'
MAX_CHALLENGES = 20
MAX_IMAGES_PER_CHALLENGE = 8
MAX_IMAGES = 160
MAX_RECORD_BYTES = 1024 * 1024
MAX_IMAGE_BYTES = 512 * 1024
MAX_IMAGE_SIDE = 1024
MAX_IMAGE_TOTAL_BYTES = 80 * 1024 * 1024
MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
MAX_DATABASE_BYTES = 128 * 1024 * 1024
MAX_MANIFEST_BYTES = 64 * 1024
MAX_CENTRAL_BYTES = 64 * 1024
MAX_MEMBERS = 181
MAX_JSON_DEPTH = 32
BLOCK_BYTES = 65536
OPERATION_SECONDS = 300.0
ERROR_CODES = frozenset(('input', 'busy', 'format', 'metadata', 'media', 'limit', 'cancelled', 'timeout', 'destination', 'storage'))

class ArchiveError(ValueError):
    def __init__(self, code: str, message: str):
        if code not in ERROR_CODES:
            raise ValueError('Unsupported archive error code.')
        self._code = code
        super().__init__(message)

    @property
    def code(self):
        return self._code

@dataclass(frozen=True)
class RecordSource:
    challenge_id: str
    raw: bytes

@dataclass(frozen=True)
class ImageRecord:
    challenge_id: str
    evidence_id: str
    size: int
    width: int
    height: int
    sha256: str

@dataclass(frozen=True)
class LibraryRecords:
    source_schema_version: int
    records: tuple[RecordSource, ...]
    images: tuple[ImageRecord, ...]
    evidence_count: int
    claimed_seats: int
    pending_invites: int

@dataclass(frozen=True)
class ImageFile:
    record: ImageRecord
    fd: int

@dataclass(frozen=True)
class ArchiveMember:
    name: str
    size: int
    sha256: str

@dataclass(frozen=True)
class ArchiveEntry:
    name: str
    offset: int
    size: int
    crc32: int

@dataclass(frozen=True)
class ArchiveIndex:
    created_at_ms: int
    source_schema_version: int
    entries: tuple[ArchiveEntry, ...]
    members: tuple[ArchiveMember, ...]

@dataclass(frozen=True)
class ArchiveSource:
    name: str
    fd: int
    size: int
    sha256: str

@dataclass(frozen=True)
class ArchiveSummary:
    schema_version: int
    source_schema_version: int
    challenges: int
    evidence: int
    images: int
    claimed_seats: int
    pending_invites: int
    media_bytes: int
    archive_bytes: int

def check_archive(cancel: Event, deadline: float) -> None:
    try:
        finite = type(deadline) in (int, float) and math.isfinite(deadline)
    except OverflowError:
        finite = False
    if not isinstance(cancel, Event) or not finite:
        raise ArchiveError('input', 'Supply a cancellation event and finite monotonic deadline.')
    if cancel.is_set():
        raise ArchiveError('cancelled', 'Archive operation cancelled; existing data was preserved.')
    if time.monotonic() >= deadline:
        raise ArchiveError('timeout', 'Archive operation exceeded its time limit; existing data was preserved.')


def _values(value: object) -> None:
    pending = [(value, 0)]
    while pending:
        current, depth = pending.pop()
        if type(current) in (dict, list):
            if depth >= MAX_JSON_DEPTH:
                raise ArchiveError('metadata', 'JSON nesting exceeds the supported limit.')
            if type(current) is dict:
                for key, item in current.items():
                    if type(key) is not str:
                        raise ArchiveError('metadata', 'JSON object keys must be strings.')
                    pending.append((key, depth + 1))
                    pending.append((item, depth + 1))
            else:
                pending.extend((item, depth + 1) for item in current)
        elif type(current) is str:
            if '\x00' in current or any(0xd800 <= ord(character) <= 0xdfff for character in current):
                raise ArchiveError('metadata', 'JSON contains unsupported Unicode or NUL characters.')
        elif type(current) is int:
            if abs(current) > 2**53 - 1:
                raise ArchiveError('metadata', 'JSON integers must be within the safe integer range.')
        elif type(current) is float:
            if not math.isfinite(current) or (current.is_integer() and abs(current) > 2**53 - 1):
                raise ArchiveError('metadata', 'JSON numbers must be finite and safely represented.')
        elif current is not None and type(current) is not bool:
            raise ArchiveError('metadata', 'Only ordinary JSON values are supported.')


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate key.')
        result[key] = value
    return result


def _constant(_):
    raise ValueError('Nonfinite number.')


def parse_json(data: bytes, maximum: int, *, cancel: Event, deadline: float) -> object:
    check_archive(cancel, deadline)
    if type(data) is not bytes or type(maximum) is not int or maximum <= 0:
        raise ArchiveError('input', 'Supply bounded UTF-8 JSON bytes.')
    if not 1 <= len(data) <= maximum:
        raise ArchiveError('limit', 'JSON bytes exceed the supported limit or are empty.')
    # Scan nesting before invoking the allocating JSON parser; quoted delimiters do not count.
    depth = 0
    quoted = False
    escaped = False
    for offset, byte in enumerate(data):
        if offset % BLOCK_BYTES == 0:
            check_archive(cancel, deadline)
        if quoted:
            if escaped:
                escaped = False
            elif byte == 92:
                escaped = True
            elif byte == 34:
                quoted = False
        elif byte == 34:
            quoted = True
        elif byte in (91, 123):
            depth += 1
            if depth > MAX_JSON_DEPTH:
                raise ArchiveError('metadata', 'JSON nesting exceeds the supported limit.')
        elif byte in (93, 125):
            depth -= 1
    try:
        text = data.decode('utf-8', errors='strict')
        value = json.loads(text, object_pairs_hook=_unique, parse_constant=_constant)
        _values(value)
    except (ValueError, UnicodeError, RecursionError) as error:
        if isinstance(error, ArchiveError):
            raise
        raise ArchiveError('metadata', 'JSON is malformed, duplicated or unsupported.') from None
    check_archive(cancel, deadline)
    return value


def canonical_json(value: object) -> bytes:
    _values(value)
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                          separators=(',', ':')).encode('utf-8')
    except (ValueError, UnicodeError, RecursionError):
        raise ArchiveError('metadata', 'JSON could not be encoded safely.') from None
