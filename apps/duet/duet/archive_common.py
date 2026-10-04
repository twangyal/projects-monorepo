"""Shared limits and bounded, identity-free archive admission."""
import json
import math
import time
from threading import Event

SCHEMA_VERSION = 1
ARCHIVE_KIND = 'duet-library'
RECORDS_KIND = 'duet-library-records'
PLAYBACK_POLICY = 'saved-anchor-paused'
DATABASE_NAME = 'rooms.sqlite3'
LOCK_NAME = '.server.lock'
MEDIA_DIRECTORY = 'media'
MANIFEST_NAME = 'manifest.json'
ROOMS_MEMBER = 'rooms.json'
MAX_ROOMS = 5
MAX_TRACKS_PER_ROOM = 12
MAX_MEMORIES_PER_ROOM = 100
MAX_ROOM_BYTES = 256 * 1024
MAX_ROOMS_JSON_BYTES = 5 * MAX_ROOM_BYTES + 1024
MAX_DATABASE_BYTES = 16 * 1024 * 1024
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_MEMBERS = 62
MAX_CENTRAL_BYTES = 64 * 1024
MAX_MANIFEST_BYTES = 32 * 1024
MAX_JSON_DEPTH = 32
MAX_REVISION = 2**53 - 1
SAMPLE_RATE = 48000
MIN_DURATION = 1
MAX_DURATION = 300
MAX_PCM_BYTES = MAX_DURATION * SAMPLE_RATE * 4
BLOCK_BYTES = 65536
MAX_OGG_PAGE_BYTES = 65307
MAX_OGG_PAGES = 65536
OPERATION_SECONDS = 300.0


class ArchiveError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self._code = code

    @property
    def code(self):
        return self._code


def check_archive(cancel: Event, deadline: float) -> None:
    try:
        valid = type(deadline) in (int, float) and math.isfinite(deadline)
    except OverflowError:
        valid = False
    if not valid or not isinstance(cancel, Event):
        raise ArchiveError('input', 'Archive work requires a valid deadline and cancellation event.')
    if cancel.is_set():
        raise ArchiveError('cancelled', 'Archive work was cancelled; no incomplete result was published.')
    if time.monotonic() >= deadline:
        raise ArchiveError('timeout', 'Archive work exceeded its deadline; try again on a faster local disk.')


def parse_json(data: bytes, maximum: int, *, cancel: Event, deadline: float) -> object:
    check_archive(cancel, deadline)
    if type(data) is not bytes or type(maximum) is not int or maximum < 0:
        raise ArchiveError('input', 'Archive JSON requires bytes and a nonnegative byte limit.')
    if len(data) > maximum:
        raise ArchiveError('limit', 'Archive JSON exceeds its permitted byte limit.')
    invalid = 'Archive JSON must be bounded UTF-8 with unique keys and finite values.'
    try:
        if data.startswith(b'\xef\xbb\xbf'):
            raise ValueError()
        text = data.decode('utf-8', errors='strict')
        # Bound nesting before asking the stdlib decoder to allocate containers.
        depth = 0
        quoted = escaped = False
        for index, character in enumerate(text):
            if index % BLOCK_BYTES == 0:
                check_archive(cancel, deadline)
            if quoted:
                if escaped:
                    escaped = False
                elif character == '\\':
                    escaped = True
                elif character == '"':
                    quoted = False
            elif character == '"':
                quoted = True
            elif character in '[{':
                depth += 1
                if depth > MAX_JSON_DEPTH:
                    raise ValueError()
            elif character in ']}':
                depth -= 1
                if depth < 0:
                    raise ValueError()
        if depth or quoted:
            raise ValueError()

        def pairs(items):
            result = {}
            for key, value in items:
                if key in result:
                    raise ValueError()
                result[key] = value
            return result

        def nonfinite(_value):
            raise ValueError()

        value = json.loads(text, object_pairs_hook=pairs, parse_constant=nonfinite)
        pending = [value]
        visited = 0
        while pending:
            current = pending.pop()
            visited += 1
            if visited % 128 == 0:
                check_archive(cancel, deadline)
            if type(current) is dict:
                pending.extend(current.keys())
                pending.extend(current.values())
            elif type(current) is list:
                pending.extend(current)
            elif type(current) is str:
                if '\0' in current:
                    raise ValueError()
                current.encode('utf-8', errors='strict')
            elif type(current) is float and not math.isfinite(current):
                raise ValueError()
        check_archive(cancel, deadline)
        return value
    except ArchiveError:
        raise
    except (ValueError, UnicodeError, RecursionError, OverflowError):
        raise ArchiveError('format', invalid) from None


def canonical_json(value: object) -> bytes:
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                          separators=(',', ':')).encode('utf-8')
    except (ValueError, TypeError, UnicodeError, RecursionError, OverflowError):
        raise ArchiveError('format', 'Archive metadata cannot be encoded as valid bounded JSON.') from None
