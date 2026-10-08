"""Read immutable private library state and rebuild trusted SQLite."""
from contextlib import contextmanager
import hashlib
import os
import re
import sqlite3
import stat
import sys
from threading import Event

from . import domain
from .archive_common import (
    ArchiveError, BLOCK_BYTES, DATABASE_NAME, ImageFile, ImageRecord, LibraryRecords,
    MAX_CHALLENGES, MAX_DATABASE_BYTES, MAX_IMAGES, MAX_IMAGES_PER_CHALLENGE,
    MAX_IMAGE_TOTAL_BYTES, MAX_RECORD_BYTES, RecordSource, check_archive, parse_json,
)
from .archive_media import _admit_image, _identity, _read_image, validate_image
from .store import _CHALLENGES_SQL, _IMAGES_SQL


@contextmanager
def _database(fd: int, cancel: Event, deadline: float):
    check_archive(cancel, deadline)
    if type(fd) is not int or fd < 0:
        raise ArchiveError('input', 'Supply an open regular database file descriptor.')
    connection = None
    before = None
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or not 1 <= before.st_size <= MAX_DATABASE_BYTES:
            raise ArchiveError('limit', 'Source database must be a bounded regular file; preserve it without repair.')
        connection = sqlite3.connect(f'file:/proc/self/fd/{fd}?mode=ro&immutable=1', uri=True)
        connection.execute('PRAGMA trusted_schema=OFF')
        connection.execute('PRAGMA query_only=ON')
        connection.set_progress_handler(lambda: int(cancel.is_set()) or _progress(cancel, deadline), 500)
        yield connection
        check_archive(cancel, deadline)
        if _identity(os.fstat(fd)) != _identity(before):
            raise ArchiveError('storage', 'Source database changed during validation; stop the service and retry.')
    except (OSError, sqlite3.Error):
        check_archive(cancel, deadline)
        raise ArchiveError('storage', 'Database could not be read safely; preserve the source without repair.') from None
    finally:
        if connection is not None:
            connection.close()


def _progress(cancel, deadline):
    # sqlite3 hides callback exceptions; the enclosing error handler rechecks the real cause.
    check_archive(cancel, deadline)
    return 0


def _normalized_sql(value):
    if type(value) is not str:
        return value
    quoted = None
    result = []
    for character in value:
        if quoted:
            result.append(character)
            if character == quoted:
                quoted = None
        elif character in ("'", '"'):
            quoted = character
            result.append(character)
        elif not character.isspace():
            result.append(character)
    return ''.join(result)


def _schema(connection, cancel, deadline):
    check_archive(cancel, deadline)
    version = connection.execute('PRAGMA user_version').fetchone()[0]
    if type(version) is not int or version not in (1, 2):
        raise ArchiveError('metadata', 'Source database schema is unsupported; preserve it without migration.')
    expected = {
        'challenges': ('table', 'challenges', _CHALLENGES_SQL),
        'sqlite_autoindex_challenges_1': ('index', 'challenges', None),
    }
    if version == 2:
        expected.update({
            'evidence_images': ('table', 'evidence_images', _IMAGES_SQL),
            'sqlite_autoindex_evidence_images_1': ('index', 'evidence_images', None),
        })
    if connection.execute('SELECT count(*) FROM sqlite_master').fetchone()[0] != len(expected):
        raise ArchiveError('metadata', 'Source database contains unsupported schema objects.')
    # Never allocate hostile schema names/SQL until their individual bounds have been checked.
    rows = connection.execute(
        "SELECT CASE WHEN typeof(name)='text' AND length(CAST(name AS BLOB))<=128 THEN name END,"
        "CASE WHEN typeof(type)='text' AND length(type)<=16 THEN type END,"
        "CASE WHEN typeof(tbl_name)='text' AND length(CAST(tbl_name AS BLOB))<=128 THEN tbl_name END,"
        "CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=4096 THEN sql END FROM sqlite_master"
    ).fetchall()
    seen = set()
    for name, kind, table, sql in rows:
        trusted = expected.get(name)
        if trusted is None or name in seen or (kind, table) != trusted[:2] or _normalized_sql(sql) != _normalized_sql(trusted[2]):
            raise ArchiveError('metadata', 'Source database schema differs from the trusted tables and indexes.')
        seen.add(name)
    check_archive(cancel, deadline)
    return version


def validate_records(records: tuple[RecordSource, ...], source_schema_version: int,
                     *, cancel: Event, deadline: float) -> LibraryRecords:
    check_archive(cancel, deadline)
    if type(source_schema_version) is not int or source_schema_version not in (1, 2):
        raise ArchiveError('metadata', 'Only source library schemas 1 and 2 are supported.')
    if type(records) is not tuple or len(records) > MAX_CHALLENGES:
        raise ArchiveError('limit', 'A library may contain at most twenty bounded challenge records.')
    seen = set()
    media = []
    evidence_count = claimed_seats = pending_invites = 0
    for item in records:
        check_archive(cancel, deadline)
        if (type(item) is not RecordSource or type(item.challenge_id) is not str
                or re.fullmatch('[0-9a-f]{32}', item.challenge_id) is None or item.challenge_id in seen):
            raise ArchiveError('metadata', 'Challenge member IDs must be unique exact lowercase identifiers.')
        seen.add(item.challenge_id)
        value = parse_json(item.raw, MAX_RECORD_BYTES, cancel=cancel, deadline=deadline)
        try:
            admitted = domain.validate_record(value)
        except domain.DomainError:
            raise ArchiveError('metadata', 'A private challenge record fails historical audit validation.') from None
        if admitted['state']['id'] != item.challenge_id:
            raise ArchiveError('metadata', 'Challenge record ID does not match its member ID.')
        if source_schema_version == 1 and admitted['schemaVersion'] != 1:
            raise ArchiveError('metadata', 'Source schema 1 requires every private record to remain schema 1.')
        state = admitted['state']
        evidence_count += len(state['evidence'])
        claimed_seats += sum(profile is not None for profile in state['profiles'].values())
        pending_invites += sum(admitted['hashes'][key] is not None for key in ('opponentInvite', 'arbiterInvite'))
        per_challenge = 0
        for entry in state['evidence']:
            if 'image' in entry:
                image = entry['image']
                media.append(ImageRecord(item.challenge_id, entry['id'], image['bytes'], image['width'],
                                         image['height'], image['sha256']))
                per_challenge += 1
        if per_challenge > MAX_IMAGES_PER_CHALLENGE:
            raise ArchiveError('limit', 'A challenge may retain at most eight images.')
        check_archive(cancel, deadline)
    if len(media) > MAX_IMAGES or sum(image.size for image in media) > MAX_IMAGE_TOTAL_BYTES:
        raise ArchiveError('limit', 'Retained images exceed the complete library limits.')
    return LibraryRecords(source_schema_version, tuple(sorted(records, key=lambda value: value.challenge_id)),
                          tuple(sorted(media, key=lambda value: (value.challenge_id, value.evidence_id))),
                          evidence_count, claimed_seats, pending_invites)


def read_library(database_fd: int, *, cancel: Event, deadline: float) -> LibraryRecords:
    with _database(database_fd, cancel, deadline) as connection:
        version = _schema(connection, cancel, deadline)
        count = connection.execute('SELECT count(*) FROM challenges').fetchone()[0]
        if count > MAX_CHALLENGES:
            raise ArchiveError('limit', 'Source library exceeds twenty challenges.')
        rows = connection.execute(
            "SELECT CASE WHEN typeof(id)='text' AND length(CAST(id AS BLOB))=32 THEN id END,"
            "CASE WHEN typeof(record)='text' AND length(CAST(record AS BLOB)) BETWEEN 1 AND ? "
            "THEN CAST(record AS BLOB) END FROM challenges ORDER BY id", (MAX_RECORD_BYTES,)
        ).fetchall()
        records = tuple(RecordSource(cid, raw) for cid, raw in rows)
        library = validate_records(records, version, cancel=cancel, deadline=deadline)
        if version == 2:
            if connection.execute('SELECT count(*) FROM evidence_images').fetchone()[0] > MAX_IMAGES:
                raise ArchiveError('limit', 'Source library exceeds the retained image limit.')
            rows = connection.execute(
                "SELECT CASE WHEN typeof(challenge_id)='text' AND length(CAST(challenge_id AS BLOB))=32 THEN challenge_id END,"
                "CASE WHEN typeof(evidence_id)='text' AND length(CAST(evidence_id AS BLOB))=32 THEN evidence_id END,"
                "typeof(data),length(data) FROM evidence_images ORDER BY challenge_id,evidence_id"
            ).fetchall()
            actual = [(cid, eid, kind, size) for cid, eid, kind, size in rows]
            expected = [(image.challenge_id, image.evidence_id, 'blob', image.size) for image in library.images]
            if actual != expected:
                raise ArchiveError('metadata', 'Image BLOB membership and sizes must exactly match retained evidence.')
        check_archive(cancel, deadline)
        return library


def _write(fd, raw, cancel, deadline):
    offset = 0
    while offset < len(raw):
        check_archive(cancel, deadline)
        count = os.write(fd, memoryview(raw)[offset:offset + BLOCK_BYTES])
        if count <= 0:
            raise ArchiveError('storage', 'Output file could not be written completely.')
        offset += count


def copy_library_image(database_fd: int, image: ImageRecord, output_fd: int,
                       *, cancel: Event, deadline: float) -> None:
    check_archive(cancel, deadline)
    _admit_image(image)
    if type(output_fd) is not int or output_fd < 0:
        raise ArchiveError('input', 'Supply an owned image output file descriptor.')
    with _database(database_fd, cancel, deadline) as connection:
        if _schema(connection, cancel, deadline) != 2:
            raise ArchiveError('metadata', 'Schema 1 libraries have no retained images.')
        row = connection.execute(
            "SELECT CASE WHEN typeof(data)='blob' AND length(data)=? THEN data END "
            'FROM evidence_images WHERE challenge_id=? AND evidence_id=?',
            (image.size, image.challenge_id, image.evidence_id)
        ).fetchone()
        if row is None or type(row[0]) is not bytes or len(row[0]) != image.size or hashlib.sha256(row[0]).hexdigest() != image.sha256:
            raise ArchiveError('media', 'Source JPEG bytes do not match the retained descriptor.')
        try:
            _write(output_fd, row[0], cancel, deadline)
        except OSError:
            raise ArchiveError('storage', 'Retained image could not be copied completely.') from None
        check_archive(cancel, deadline)


def write_database(directory_fd: int, records: LibraryRecords, images: tuple[ImageFile, ...],
                   *, cancel: Event, deadline: float) -> None:
    check_archive(cancel, deadline)
    if type(records) is not LibraryRecords:
        raise ArchiveError('metadata', 'Supply an admitted complete library record set.')
    if (type(records.images) is not tuple
            or any(type(count) is not int or count < 0 for count in
                   (records.evidence_count, records.claimed_seats, records.pending_invites))):
        raise ArchiveError('metadata', 'Library counts and image descriptors must be exact admitted values.')
    for image in records.images:
        _admit_image(image)
    admitted = validate_records(records.records, records.source_schema_version, cancel=cancel, deadline=deadline)
    if admitted != records:
        raise ArchiveError('metadata', 'Library summary and descriptors do not match its exact records.')
    if type(images) is not tuple or len(images) != len(records.images) or any(type(item) is not ImageFile for item in images):
        raise ArchiveError('metadata', 'Supply exactly one original file per retained image.')
    for item in images:
        _admit_image(item.record)
    files = {(item.record.challenge_id, item.record.evidence_id): item for item in images}
    if len(files) != len(images) or set(files) != {(image.challenge_id, image.evidence_id) for image in records.images}:
        raise ArchiveError('metadata', 'Image files must match every retained image exactly once.')
    connection = None
    output = None
    receipt = None
    try:
        if type(directory_fd) is not int or not stat.S_ISDIR(os.fstat(directory_fd).st_mode):
            raise ArchiveError('input', 'Supply an acquired database destination directory.')
        connection = sqlite3.connect(':memory:')
        connection.execute('PRAGMA foreign_keys=ON')
        connection.set_progress_handler(lambda: int(cancel.is_set()) or _progress(cancel, deadline), 500)
        connection.execute(_CHALLENGES_SQL)
        connection.execute(_IMAGES_SQL)
        connection.execute('PRAGMA user_version=2')
        for record in records.records:
            check_archive(cancel, deadline)
            connection.execute('INSERT INTO challenges(id,record) VALUES (?,?)', (record.challenge_id, record.raw.decode('utf-8')))
        for image in records.images:
            item = files[(image.challenge_id, image.evidence_id)]
            if item.record != image:
                raise ArchiveError('metadata', 'Image file descriptor differs from retained evidence.')
            validate_image(item.fd, image, cancel=cancel, deadline=deadline)
            raw = _read_image(item.fd, image, cancel, deadline)
            connection.execute('INSERT INTO evidence_images(challenge_id,evidence_id,data) VALUES (?,?,?)',
                               (image.challenge_id, image.evidence_id, raw))
        connection.commit()
        check_archive(cancel, deadline)
        if not hasattr(connection, 'serialize'):
            raise ArchiveError('storage', 'This Python SQLite build cannot serialize a trusted restored database.')
        raw_database = connection.serialize()
        if not 1 <= len(raw_database) <= MAX_DATABASE_BYTES:
            raise ArchiveError('limit', 'Rebuilt database exceeds the supported byte limit.')
        check_archive(cancel, deadline)
        try:
            output = os.open(DATABASE_NAME, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory_fd)
        except FileExistsError:
            raise ArchiveError('destination', 'Destination database already exists; it was not overwritten.') from None
        receipt = os.fstat(output)
        _write(output, raw_database, cancel, deadline)
        os.fsync(output)
        check_archive(cancel, deadline)
    except (OSError, sqlite3.Error):
        check_archive(cancel, deadline)
        raise ArchiveError('storage', 'Trusted database reconstruction failed; existing data was preserved.') from None
    finally:
        # Success transfers the complete file to the caller. Failure removes only this inode.
        failed = sys.exc_info()[0] is not None
        if output is not None:
            os.close(output)
        if failed and receipt is not None:
            try:
                current = os.stat(DATABASE_NAME, dir_fd=directory_fd, follow_symlinks=False)
                if (current.st_dev, current.st_ino) == (receipt.st_dev, receipt.st_ino):
                    os.unlink(DATABASE_NAME, dir_fd=directory_fd)
            except FileNotFoundError:
                pass
        if connection is not None:
            connection.close()
