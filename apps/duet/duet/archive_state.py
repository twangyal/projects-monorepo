"""Pinned read-only private records and trusted restore database reconstruction."""
from dataclasses import dataclass
import math
import os
import re
import sqlite3
import stat
from threading import Event

from .archive_common import (
    ACCEPTED_SCHEMA_VERSIONS, ArchiveError, BLOCK_BYTES, DATABASE_NAME, MAX_DATABASE_BYTES,
    MAX_LEGACY_ROOM_BYTES, MAX_LEGACY_ROOMS_JSON_BYTES, MAX_REVISION,
    MAX_ROOM_BYTES, MAX_ROOMS, MAX_ROOMS_JSON_BYTES, RECORDS_KIND, SCHEMA_VERSION,
    canonical_json, check_archive, parse_json,
)
from .store import DomainError, _validate_record


@dataclass(frozen=True)
class TrackRecord:
    room_id: str
    track_id: str
    duration: float


@dataclass(frozen=True)
class LibraryRecords:
    rooms_json: bytes
    room_ids: tuple[str, ...]
    tracks: tuple[TrackRecord, ...]
    memory_count: int
    paired_rooms: int
    pending_invites: int
    schema_version: int = SCHEMA_VERSION


_METADATA = 'Library metadata is invalid. Preserve the original library and recover a valid backup.'
_SCHEMA = 'Library database schema is incompatible. Preserve it and recover an original Duet library.'
_CREATE_TABLE = 'CREATE TABLE rooms (id TEXT PRIMARY KEY, document TEXT NOT NULL)'


def _finite(value, maximum):
    try:
        return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= maximum
    except OverflowError:
        return False


def _identity(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def _records(rooms, *, cancel, deadline, schema_version=SCHEMA_VERSION):
    if type(schema_version) is not int or schema_version not in ACCEPTED_SCHEMA_VERSIONS:
        raise ArchiveError('metadata', _METADATA)
    if type(rooms) is not list or len(rooms) > MAX_ROOMS:
        raise ArchiveError('metadata', _METADATA)
    ids = set()
    tracks = []
    memories = paired = pending = 0
    for room in rooms:
        check_archive(cancel, deadline)
        try:
            if type(room) is not dict:
                raise ValueError()
            _validate_record(room, room.get('id'))
            if schema_version == 1 and room['schemaVersion'] != 1:
                raise ValueError()
            if room['id'] in ids or room['playlistRevision'] > MAX_REVISION:
                raise ValueError()
            playback = room['playback']
            if playback['revision'] > MAX_REVISION or (playback['playing'] and playback['revision'] == MAX_REVISION):
                raise ValueError()
        except (DomainError, ValueError, KeyError, TypeError, RecursionError):
            raise ArchiveError('metadata', _METADATA) from None
        maximum = MAX_LEGACY_ROOM_BYTES if room['schemaVersion'] == 1 else MAX_ROOM_BYTES
        if len(canonical_json(room)) > maximum:
            raise ArchiveError('limit', 'A private room document exceeds its versioned byte limit.')
        ids.add(room['id'])
        tracks.extend(TrackRecord(room['id'], track['id'], float(track['duration']))
                      for track in room['tracks'])
        memories += len(room['memories'])
        paired += room['profiles']['guest'] is not None
        pending += room['inviteHash'] is not None
    encoded = canonical_json({'schemaVersion': schema_version, 'kind': RECORDS_KIND,
                              'rooms': sorted(rooms, key=lambda room: room['id'])})
    maximum = MAX_LEGACY_ROOMS_JSON_BYTES if schema_version == 1 else MAX_ROOMS_JSON_BYTES
    if len(encoded) > maximum:
        raise ArchiveError('limit', 'Library room records exceed the archive metadata limit.')
    check_archive(cancel, deadline)
    return LibraryRecords(encoded, tuple(sorted(ids)),
                          tuple(sorted(tracks, key=lambda track: (track.room_id, track.track_id))),
                          memories, paired, pending, schema_version)


def validate_rooms(data: bytes, *, cancel: Event, deadline: float) -> LibraryRecords:
    value = parse_json(data, MAX_ROOMS_JSON_BYTES, cancel=cancel, deadline=deadline)
    if (type(value) is not dict or set(value) != {'schemaVersion', 'kind', 'rooms'}
            or type(value['schemaVersion']) is not int
            or value['schemaVersion'] not in ACCEPTED_SCHEMA_VERSIONS
            or value['kind'] != RECORDS_KIND):
        raise ArchiveError('metadata', _METADATA)
    if value['schemaVersion'] == 1 and len(data) > MAX_LEGACY_ROOMS_JSON_BYTES:
        raise ArchiveError('limit', 'Legacy library room records exceed their byte limit.')
    return _records(value['rooms'], cancel=cancel, deadline=deadline,
                    schema_version=value['schemaVersion'])


def _admit_schema(database, cancel, deadline):
    check_archive(cancel, deadline)
    if database.execute('SELECT count(*) FROM sqlite_schema').fetchone()[0] != 2:
        raise ArchiveError('metadata', _SCHEMA)
    rows = database.execute(
        'SELECT type, CASE WHEN length(name)<=128 THEN name END, '
        'CASE WHEN length(tbl_name)<=128 THEN tbl_name END, '
        'CASE WHEN length(CAST(sql AS BLOB))<=4096 THEN sql END '
        'FROM sqlite_schema ORDER BY type').fetchall()
    index, table = rows
    if index != ('index', 'sqlite_autoindex_rooms_1', 'rooms', None):
        raise ArchiveError('metadata', _SCHEMA)
    if (table[:3] != ('table', 'rooms', 'rooms') or type(table[3]) is not str
            or not re.fullmatch(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?rooms\s*'
                                r'\(\s*id\s+TEXT\s+PRIMARY\s+KEY\s*,\s*document\s+TEXT\s+NOT\s+NULL\s*\)',
                                table[3], flags=re.IGNORECASE)):
        raise ArchiveError('metadata', _SCHEMA)
    columns = database.execute('PRAGMA table_xinfo(rooms)').fetchall()
    if columns != [(0, 'id', 'TEXT', 0, None, 1, 0),
                   (1, 'document', 'TEXT', 1, None, 0, 0)]:
        raise ArchiveError('metadata', _SCHEMA)
    if database.execute('PRAGMA index_list(rooms)').fetchall() != [(0, 'sqlite_autoindex_rooms_1', 1, 'pk', 0)]:
        raise ArchiveError('metadata', _SCHEMA)
    if database.execute('PRAGMA index_xinfo(sqlite_autoindex_rooms_1)').fetchall() != [
            (0, 0, 'id', 0, 'BINARY', 1), (1, -1, None, 0, 'BINARY', 0)]:
        raise ArchiveError('metadata', _SCHEMA)
    check_archive(cancel, deadline)


def _progress(database, cancel, deadline):
    interrupted = []

    def progress():
        try:
            check_archive(cancel, deadline)
        except ArchiveError as error:
            interrupted.append(error)
            return 1
        return 0

    database.set_progress_handler(progress, 500)
    return interrupted


def read_library(database_fd: int, *, cancel: Event, deadline: float) -> LibraryRecords:
    check_archive(cancel, deadline)
    database = None
    interrupted = []
    try:
        if type(database_fd) is not int or database_fd < 0:
            raise ArchiveError('input', 'Library input must be an open regular database file.')
        before = os.fstat(database_fd)
        if not stat.S_ISREG(before.st_mode):
            raise ArchiveError('input', 'Library input must be an open regular database file.')
        if before.st_size > MAX_DATABASE_BYTES:
            raise ArchiveError('limit', 'Library database exceeds the 16 MiB limit.')
        database = sqlite3.connect(f'file:/proc/self/fd/{database_fd}?mode=ro&immutable=1',
                                   uri=True, timeout=0, isolation_level=None)
        database.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, MAX_ROOM_BYTES + 4096)
        database.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 8192)
        database.execute('PRAGMA trusted_schema=OFF')
        database.execute('PRAGMA query_only=ON')
        interrupted = _progress(database, cancel, deadline)
        _admit_schema(database, cancel, deadline)
        count = database.execute('SELECT count(*) FROM rooms').fetchone()[0]
        if count > MAX_ROOMS:
            raise ArchiveError('limit', 'Library exceeds the five-room limit.')
        rows = database.execute(
            'SELECT CASE WHEN typeof(id)=\'text\' AND length(CAST(id AS BLOB))=32 THEN id END, '
            'CASE WHEN typeof(document)=\'text\' AND length(CAST(document AS BLOB))<=? '
            'THEN document END FROM rooms LIMIT ?', (MAX_ROOM_BYTES, MAX_ROOMS)).fetchall()
        rooms = []
        for room_id, document in rows:
            check_archive(cancel, deadline)
            if type(room_id) is not str or type(document) is not str:
                raise ArchiveError('metadata', _METADATA)
            room = parse_json(document.encode('utf-8'), MAX_ROOM_BYTES, cancel=cancel, deadline=deadline)
            if (type(room) is not dict or room.get('id') != room_id
                    or room.get('schemaVersion') == 1
                    and len(document.encode('utf-8')) > MAX_LEGACY_ROOM_BYTES):
                raise ArchiveError('metadata', _METADATA)
            rooms.append(room)
        result = _records(rooms, cancel=cancel, deadline=deadline)
        if _identity(os.fstat(database_fd)) != _identity(before):
            raise ArchiveError('storage', 'Library database changed during the read. Stop Duet and retry.')
        check_archive(cancel, deadline)
        return result
    except ArchiveError:
        raise
    except (OSError, sqlite3.Error, UnicodeError, ValueError):
        if interrupted:
            raise interrupted[0] from None
        check_archive(cancel, deadline)
        raise ArchiveError('storage', 'Library database could not be read safely. Preserve it and recover a valid backup.') from None
    finally:
        if database is not None:
            database.close()


def paused_rooms(records: LibraryRecords, restored_at_ms: float,
                 *, cancel: Event, deadline: float) -> bytes:
    check_archive(cancel, deadline)
    if type(records) is not LibraryRecords or not _finite(restored_at_ms, 1e15):
        raise ArchiveError('input', 'Restore requires validated library records and a finite bounded timestamp.')
    validated = validate_rooms(records.rooms_json, cancel=cancel, deadline=deadline)
    if records != validated:
        raise ArchiveError('metadata', _METADATA)
    value = parse_json(validated.rooms_json, MAX_ROOMS_JSON_BYTES, cancel=cancel, deadline=deadline)
    for room in value['rooms']:
        check_archive(cancel, deadline)
        anchor = room['playback']
        if anchor['playing']:
            anchor['revision'] += 1
        anchor['playing'] = False
        anchor['updatedAt'] = restored_at_ms
    return _records(value['rooms'], cancel=cancel, deadline=deadline,
                    schema_version=validated.schema_version).rooms_json


def _remove_owned(directory_fd, file_fd):
    try:
        owned = os.fstat(file_fd)
        current = os.stat(DATABASE_NAME, dir_fd=directory_fd, follow_symlinks=False)
        if (current.st_dev, current.st_ino) == (owned.st_dev, owned.st_ino):
            os.unlink(DATABASE_NAME, dir_fd=directory_fd)
    except OSError:
        pass


def write_database(directory_fd: int, rooms_json: bytes,
                   *, cancel: Event, deadline: float) -> None:
    check_archive(cancel, deadline)
    records = validate_rooms(rooms_json, cancel=cancel, deadline=deadline)
    value = parse_json(records.rooms_json, MAX_ROOMS_JSON_BYTES, cancel=cancel, deadline=deadline)
    database = None
    file_fd = None
    interrupted = []
    try:
        if type(directory_fd) is not int or directory_fd < 0 or not stat.S_ISDIR(os.fstat(directory_fd).st_mode):
            raise ArchiveError('input', 'Restore requires an owned open staging directory.')
        # No SQLite filesystem pathname is writable: trusted SQL is built only
        # in memory, then its complete image is streamed through an owned fd.
        database = sqlite3.connect(':memory:', isolation_level=None, timeout=0)
        database.execute('PRAGMA trusted_schema=OFF')
        database.execute('PRAGMA temp_store=MEMORY')
        interrupted = _progress(database, cancel, deadline)
        database.execute('BEGIN')
        database.execute(_CREATE_TABLE)
        for room in value['rooms']:
            check_archive(cancel, deadline)
            database.execute('INSERT INTO rooms (id, document) VALUES (?, ?)',
                             (room['id'], canonical_json(room).decode('utf-8')))
        database.execute('COMMIT')
        check_archive(cancel, deadline)
        pages = database.execute('PRAGMA page_count').fetchone()[0]
        page_size = database.execute('PRAGMA page_size').fetchone()[0]
        if pages * page_size > MAX_DATABASE_BYTES:
            raise ArchiveError('limit', 'Restored database exceeds its byte limit.')
        encoded = database.serialize()
        database.close()
        database = None
        check_archive(cancel, deadline)
        if len(encoded) > MAX_DATABASE_BYTES:
            raise ArchiveError('limit', 'Restored database exceeds its byte limit.')
        file_fd = os.open(DATABASE_NAME, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                          0o600, dir_fd=directory_fd)
        os.fchmod(file_fd, 0o600)
        for start in range(0, len(encoded), BLOCK_BYTES):
            check_archive(cancel, deadline)
            block = memoryview(encoded)[start:start + BLOCK_BYTES]
            while block:
                check_archive(cancel, deadline)
                written = os.write(file_fd, block)
                if written <= 0:
                    raise OSError('Short database write')
                block = block[written:]
        os.fsync(file_fd)
        check_archive(cancel, deadline)
        owned = os.fstat(file_fd)
        current = os.stat(DATABASE_NAME, dir_fd=directory_fd, follow_symlinks=False)
        if (owned.st_dev, owned.st_ino, owned.st_size) != (current.st_dev, current.st_ino, current.st_size) or owned.st_size != len(encoded):
            raise ArchiveError('storage', 'Restored database changed before completion. Retry in a new directory.')
    except (ArchiveError, OSError, sqlite3.Error, AttributeError) as error:
        if file_fd is not None:
            _remove_owned(directory_fd, file_fd)
        if isinstance(error, ArchiveError):
            raise
        if interrupted:
            raise interrupted[0] from None
        check_archive(cancel, deadline)
        raise ArchiveError('storage', 'Could not create the restored database. Keep existing data and retry in a new directory.') from None
    finally:
        if database is not None:
            database.close()
        if file_fd is not None:
            os.close(file_fd)
