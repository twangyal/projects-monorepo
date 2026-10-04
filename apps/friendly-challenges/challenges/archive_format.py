"""Strict physical stored-only Friendly library archive; no extraction or replay."""
import hashlib
import os
import re
import stat
import struct
import zlib
from threading import Event

from .archive_common import (
    ARCHIVE_KIND, ARCHIVE_VERSION, BLOCK_BYTES, MANIFEST_NAME, MAX_ARCHIVE_BYTES,
    MAX_CENTRAL_BYTES, MAX_MANIFEST_BYTES, MAX_MEMBERS, MAX_RECORD_BYTES,
    MAX_IMAGE_BYTES, MAX_CHALLENGES, MAX_IMAGES, MAX_IMAGES_PER_CHALLENGE,
    MAX_IMAGE_TOTAL_BYTES, ArchiveError, ArchiveMember, ArchiveEntry, ArchiveIndex,
    ArchiveSource, RecordSource, canonical_json, check_archive, parse_json,
)

_LOCAL = struct.Struct('<IHHHHHIIIHH')
_CENTRAL = struct.Struct('<IHHHHHHIIIHHHHHII')
_END = struct.Struct('<IHHHHIIH')
_RECORD_NAME = re.compile(r'records/([0-9a-f]{32})\.json', re.ASCII)
_IMAGE_NAME = re.compile(r'images/([0-9a-f]{32})/([0-9a-f]{32})\.jpg', re.ASCII)
_ID = re.compile(r'[0-9a-f]{32}', re.ASCII)
_SHA = re.compile(r'[0-9a-f]{64}', re.ASCII)


def _reject(code='format'):
    messages = {
        'format': 'Archive must use the complete fixed Friendly stored-file format.',
        'metadata': 'Archive manifest is invalid or inconsistent with its members.',
        'limit': 'Archive exceeds a supported byte or member limit.',
        'input': 'Archive inputs must use valid owned regular file descriptors and bounded metadata.',
        'storage': 'Archive file access failed; check available space and file permissions.',
    }
    raise ArchiveError(code, messages[code])


def _integer(value, minimum, maximum):
    return type(value) is int and minimum <= value <= maximum


def _timestamp(value):
    return _integer(value, 0, 2**53 - 1)


def _version(value):
    return type(value) is int and value in (1, 2)


def _regular(fd, maximum=None):
    if not _integer(fd, 0, 2**31 - 1):
        _reject('input')
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode):
        _reject('input')
    if maximum is not None and info.st_size > maximum:
        _reject('limit')
    return info


def _identity(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def _read(fd, size, offset, cancel, deadline):
    if not _integer(size, 0, BLOCK_BYTES) or not _integer(offset, 0, MAX_ARCHIVE_BYTES):
        _reject('limit')
    result = bytearray()
    while len(result) < size:
        check_archive(cancel, deadline)
        part = os.pread(fd, size - len(result), offset + len(result))
        if not part:
            _reject()
        result.extend(part)
        check_archive(cancel, deadline)
    return bytes(result)


def _names(names):
    if not 1 <= len(names) <= MAX_MEMBERS or names[0] != MANIFEST_NAME:
        _reject('limit')
    records, images, seen_images = [], [], False
    for name in names[1:]:
        if _RECORD_NAME.fullmatch(name) is not None and not seen_images:
            records.append(name)
        elif _IMAGE_NAME.fullmatch(name) is not None:
            seen_images = True
            images.append(name)
        else:
            _reject()
    if (records != sorted(set(records)) or images != sorted(set(images))
            or len(records) > MAX_CHALLENGES or len(images) > MAX_IMAGES):
        _reject()
    per_challenge = {}
    for name in images:
        challenge = _IMAGE_NAME.fullmatch(name).group(1)
        per_challenge[challenge] = per_challenge.get(challenge, 0) + 1
        if per_challenge[challenge] > MAX_IMAGES_PER_CHALLENGE:
            _reject('limit')


def _size(name, size):
    if name == MANIFEST_NAME:
        maximum = MAX_MANIFEST_BYTES
    elif _RECORD_NAME.fullmatch(name):
        maximum = MAX_RECORD_BYTES
    elif _IMAGE_NAME.fullmatch(name):
        maximum = MAX_IMAGE_BYTES
    else:
        _reject()
    if not _integer(size, 1, maximum):
        _reject('limit')


def _payload(fd, entry, expected_hash, cancel, deadline, output_fd=None, allocate=False):
    remaining, offset = entry.size, entry.offset
    checksum, digest = 0, hashlib.sha256()
    parts = [] if allocate else None
    while remaining:
        check_archive(cancel, deadline)
        part = _read(fd, min(remaining, BLOCK_BYTES), offset, cancel, deadline)
        checksum = zlib.crc32(part, checksum)
        digest.update(part)
        if allocate:
            parts.append(part)
        if output_fd is not None:
            _write(output_fd, part, cancel, deadline)
        remaining -= len(part)
        offset += len(part)
    check_archive(cancel, deadline)
    if checksum != entry.crc32 or expected_hash is not None and digest.hexdigest() != expected_hash:
        _reject()
    return b''.join(parts) if allocate else None


def _admit_index(fd, index, cancel, deadline):
    check_archive(cancel, deadline)
    info = _regular(fd, MAX_ARCHIVE_BYTES)
    if (type(index) is not ArchiveIndex or not _timestamp(index.created_at_ms)
            or not _version(index.source_schema_version)
            or type(index.entries) is not tuple or type(index.members) is not tuple
            or not 1 <= len(index.entries) <= MAX_MEMBERS
            or len(index.members) != len(index.entries) - 1):
        _reject('input')
    names = []
    cursor = 0
    for entry in index.entries:
        check_archive(cancel, deadline)
        if type(entry) is not ArchiveEntry or type(entry.name) is not str:
            _reject('input')
        names.append(entry.name)
        _size(entry.name, entry.size)
        if (not _integer(entry.offset, 0, info.st_size)
                or not _integer(entry.crc32, 0, 0xffffffff)
                or entry.offset != cursor + _LOCAL.size + len(entry.name)
                or entry.size > info.st_size - entry.offset):
            _reject('input')
        cursor = entry.offset + entry.size
    _names(names)
    for member, entry in zip(index.members, index.entries[1:]):
        if (type(member) is not ArchiveMember or type(member.name) is not str
                or member.name != entry.name or type(member.size) is not int
                or member.size != entry.size or type(member.sha256) is not str
                or _SHA.fullmatch(member.sha256) is None):
            _reject('input')
    actual = _read_index(fd, cancel=cancel, deadline=deadline, verify_payloads=False)
    if actual != index:
        _reject('input')
    return info


def _read_index(fd: int, *, cancel: Event, deadline: float, verify_payloads=True) -> ArchiveIndex:
    """Admit the physical container before reading its bounded manifest."""
    try:
        check_archive(cancel, deadline)
        before = _regular(fd, MAX_ARCHIVE_BYTES)
        size = before.st_size
        if size < _END.size:
            _reject()
        end = _END.unpack(_read(fd, _END.size, size - _END.size, cancel, deadline))
        signature, disk, start_disk, disk_count, count, central_bytes, central_start, comment = end
        if (signature != 0x06054b50 or disk != 0 or start_disk != 0 or comment != 0
                or disk_count != count or not 1 <= count <= MAX_MEMBERS
                or not count * _CENTRAL.size <= central_bytes <= MAX_CENTRAL_BYTES
                or central_start + central_bytes + _END.size != size):
            _reject()
        directory = _read(fd, central_bytes, central_start, cancel, deadline)
        cursor, expected_local = 0, 0
        entries, names = [], []
        for _ in range(count):
            check_archive(cancel, deadline)
            if cursor + _CENTRAL.size > len(directory):
                _reject()
            values = _CENTRAL.unpack_from(directory, cursor)
            (signature, creator, needed, flags, method, dos_time, dos_date, crc, compressed,
             uncompressed, name_bytes, extra, comment, disk, internal, external, local) = values
            if (signature != 0x02014b50 or creator != 788 or needed != 20 or flags != 0
                    or method != 0 or dos_time != 0 or dos_date != 33 or extra != 0
                    or comment != 0 or disk != 0 or internal != 0
                    or external != (stat.S_IFREG | 0o600) << 16
                    or compressed != uncompressed or not 1 <= name_bytes <= 76
                    or cursor + _CENTRAL.size + name_bytes > len(directory)
                    or local != expected_local):
                _reject()
            raw_name = directory[cursor + _CENTRAL.size:cursor + _CENTRAL.size + name_bytes]
            try:
                name = raw_name.decode('ascii')
            except UnicodeError:
                _reject()
            _size(name, uncompressed)
            if local + _LOCAL.size + name_bytes + uncompressed > central_start:
                _reject()
            header = _LOCAL.unpack(_read(fd, _LOCAL.size, local, cancel, deadline))
            if header != (0x04034b50, 20, 0, 0, 0, 33, crc, compressed, uncompressed, name_bytes, 0):
                _reject()
            if _read(fd, name_bytes, local + _LOCAL.size, cancel, deadline) != raw_name:
                _reject()
            payload = local + _LOCAL.size + name_bytes
            entries.append(ArchiveEntry(name, payload, uncompressed, crc))
            names.append(name)
            expected_local = payload + uncompressed
            cursor += _CENTRAL.size + name_bytes
        if cursor != len(directory) or expected_local != central_start:
            _reject()
        _names(names)
        manifest_bytes = _payload(fd, entries[0], None, cancel, deadline, allocate=True)
        manifest = parse_json(manifest_bytes, MAX_MANIFEST_BYTES, cancel=cancel, deadline=deadline)
        if (type(manifest) is not dict
                or set(manifest) != {'schemaVersion', 'kind', 'createdAtMs', 'sourceSchemaVersion', 'members'}
                or type(manifest['schemaVersion']) is not int or manifest['schemaVersion'] != ARCHIVE_VERSION
                or manifest['kind'] != ARCHIVE_KIND or not _version(manifest['sourceSchemaVersion'])
                or not _timestamp(manifest['createdAtMs']) or type(manifest['members']) is not list
                or len(manifest['members']) != len(entries) - 1):
            _reject('metadata')
        members = []
        for declared, entry in zip(manifest['members'], entries[1:]):
            check_archive(cancel, deadline)
            if (type(declared) is not dict or set(declared) != {'name', 'bytes', 'sha256'}
                    or type(declared['name']) is not str or declared['name'] != entry.name
                    or type(declared['bytes']) is not int or declared['bytes'] != entry.size
                    or type(declared['sha256']) is not str or _SHA.fullmatch(declared['sha256']) is None):
                _reject('metadata')
            members.append(ArchiveMember(entry.name, entry.size, declared['sha256']))
        if sum(entry.size for entry in entries if _IMAGE_NAME.fullmatch(entry.name)) > MAX_IMAGE_TOTAL_BYTES:
            _reject('limit')
        if verify_payloads:
            for entry, member in zip(entries[1:], members):
                _payload(fd, entry, member.sha256, cancel, deadline)
        check_archive(cancel, deadline)
        if _identity(os.fstat(fd)) != _identity(before):
            _reject()
        return ArchiveIndex(manifest['createdAtMs'], manifest['sourceSchemaVersion'], tuple(entries), tuple(members))
    except OSError:
        _reject('storage')


def read_index(fd: int, *, cancel: Event, deadline: float) -> ArchiveIndex:
    """Admit exact physical layout and stream all payload CRC/SHA integrity."""
    return _read_index(fd, cancel=cancel, deadline=deadline)


def read_records(fd: int, index: ArchiveIndex, *, cancel: Event, deadline: float) -> tuple[RecordSource, ...]:
    """Preserve bounded raw record bytes; state owns historical replay validation."""
    try:
        before = _admit_index(fd, index, cancel, deadline)
        records = []
        for entry, member in zip(index.entries[1:], index.members):
            match = _RECORD_NAME.fullmatch(entry.name)
            if match:
                raw = _payload(fd, entry, member.sha256, cancel, deadline, allocate=True)
                records.append(RecordSource(match.group(1), raw))
        if _identity(os.fstat(fd)) != _identity(before):
            _reject()
        check_archive(cancel, deadline)
        return tuple(records)
    except OSError:
        _reject('storage')


def _output(fd, source_info=None):
    info = _regular(fd)
    if (info.st_size != 0 or os.lseek(fd, 0, os.SEEK_CUR) != 0
            or source_info is not None and (info.st_dev, info.st_ino) == (source_info.st_dev, source_info.st_ino)):
        _reject('input')
    return info


def copy_member(fd: int, index: ArchiveIndex, name: str, output_fd: int,
                *, cancel: Event, deadline: float) -> None:
    """Copy only a declared member through bounded CRC/SHA-checked blocks."""
    try:
        before = _admit_index(fd, index, cancel, deadline)
        if type(name) is not str:
            _reject('input')
        pairs = [(entry, member) for entry, member in zip(index.entries[1:], index.members)
                 if entry.name == name]
        if len(pairs) != 1:
            _reject('input')
        _output(output_fd, before)
        entry, member = pairs[0]
        _payload(fd, entry, member.sha256, cancel, deadline, output_fd=output_fd)
        if _identity(os.fstat(fd)) != _identity(before):
            _reject()
        check_archive(cancel, deadline)
    except OSError:
        _reject('storage')


def _write(fd, data, cancel, deadline):
    view = memoryview(data)
    while view:
        check_archive(cancel, deadline)
        written = os.write(fd, view[:BLOCK_BYTES])
        if written <= 0:
            _reject('storage')
        view = view[written:]
        check_archive(cancel, deadline)


def _scan(source, cancel, deadline, output_fd=None):
    before = _regular(source.fd, MAX_IMAGE_BYTES)
    if before.st_size != source.size:
        _reject()
    remaining, offset = source.size, 0
    checksum, digest = 0, hashlib.sha256()
    while remaining:
        check_archive(cancel, deadline)
        part = _read(source.fd, min(remaining, BLOCK_BYTES), offset, cancel, deadline)
        checksum = zlib.crc32(part, checksum)
        digest.update(part)
        if output_fd is not None:
            _write(output_fd, part, cancel, deadline)
        offset += len(part)
        remaining -= len(part)
    check_archive(cancel, deadline)
    if digest.hexdigest() != source.sha256 or _identity(os.fstat(source.fd)) != _identity(before):
        _reject()
    return checksum


def _raw_integrity(raw, cancel, deadline):
    checksum, digest = 0, hashlib.sha256()
    view = memoryview(raw)
    for offset in range(0, len(view), BLOCK_BYTES):
        check_archive(cancel, deadline)
        part = view[offset:offset + BLOCK_BYTES]
        checksum = zlib.crc32(part, checksum)
        digest.update(part)
        check_archive(cancel, deadline)
    return checksum, digest.hexdigest()


def write_archive(output_fd: int, created_at_ms: int, source_schema_version: int,
                  records: tuple[RecordSource, ...], media: tuple[ArchiveSource, ...],
                  *, cancel: Event, deadline: float) -> None:
    """Write exact dialect, rechecking original source extents/hash in both passes."""
    try:
        check_archive(cancel, deadline)
        output_info = _output(output_fd)
        if (not _timestamp(created_at_ms) or not _version(source_schema_version)
                or type(records) is not tuple or len(records) > MAX_CHALLENGES
                or type(media) is not tuple or len(media) > MAX_IMAGES):
            _reject('input')
        names, raw_records, identities = [MANIFEST_NAME], [], []
        for record in records:
            check_archive(cancel, deadline)
            if (type(record) is not RecordSource or type(record.challenge_id) is not str
                    or _ID.fullmatch(record.challenge_id) is None or type(record.raw) is not bytes
                    or not 1 <= len(record.raw) <= MAX_RECORD_BYTES):
                _reject('input')
            names.append(f'records/{record.challenge_id}.json')
            raw_records.append(record.raw)
        for item in media:
            check_archive(cancel, deadline)
            if (type(item) is not ArchiveSource or type(item.name) is not str
                    or _IMAGE_NAME.fullmatch(item.name) is None
                    or not _integer(item.size, 1, MAX_IMAGE_BYTES)
                    or type(item.sha256) is not str or _SHA.fullmatch(item.sha256) is None):
                _reject('input')
            info = _regular(item.fd, MAX_IMAGE_BYTES)
            if ((info.st_dev, info.st_ino) == (output_info.st_dev, output_info.st_ino)
                    or info.st_size != item.size):
                _reject('input')
            identities.append(_identity(info))
            names.append(item.name)
        _names(names)
        if sum(item.size for item in media) > MAX_IMAGE_TOTAL_BYTES:
            _reject('limit')
        record_integrities = [_raw_integrity(raw, cancel, deadline) for raw in raw_records]
        members = [{'name': name, 'bytes': len(raw), 'sha256': integrity[1]}
                   for name, raw, integrity in zip(names[1:1+len(records)], raw_records, record_integrities)]
        members.extend({'name': item.name, 'bytes': item.size, 'sha256': item.sha256} for item in media)
        manifest = canonical_json({'schemaVersion': ARCHIVE_VERSION, 'kind': ARCHIVE_KIND,
                                   'createdAtMs': created_at_ms, 'sourceSchemaVersion': source_schema_version,
                                   'members': members})
        if len(manifest) > MAX_MANIFEST_BYTES:
            _reject('limit')
        sizes = [len(manifest), *(len(raw) for raw in raw_records), *(item.size for item in media)]
        central_bytes = sum(_CENTRAL.size + len(name) for name in names)
        archive_bytes = sum(_LOCAL.size + len(name) + size for name, size in zip(names, sizes)) + central_bytes + _END.size
        if central_bytes > MAX_CENTRAL_BYTES or archive_bytes > MAX_ARCHIVE_BYTES:
            _reject('limit')
        crc_values = [_scan(item, cancel, deadline) for item in media]
        checksums = [zlib.crc32(manifest), *(integrity[0] for integrity in record_integrities), *crc_values]
        central, offset = bytearray(), 0
        for position, (name, size, crc) in enumerate(zip(names, sizes, checksums)):
            check_archive(cancel, deadline)
            raw_name = name.encode('ascii')
            _write(output_fd, _LOCAL.pack(0x04034b50, 20, 0, 0, 0, 33, crc, size, size, len(raw_name), 0), cancel, deadline)
            _write(output_fd, raw_name, cancel, deadline)
            if position == 0:
                _write(output_fd, manifest, cancel, deadline)
            elif position <= len(raw_records):
                _write(output_fd, raw_records[position-1], cancel, deadline)
            else:
                media_index = position - len(raw_records) - 1
                item = media[media_index]
                if _identity(os.fstat(item.fd)) != identities[media_index]:
                    _reject()
                if _scan(item, cancel, deadline, output_fd) != crc:
                    _reject()
            central.extend(_CENTRAL.pack(0x02014b50, 788, 20, 0, 0, 0, 33, crc, size, size,
                                         len(raw_name), 0, 0, 0, 0, (stat.S_IFREG | 0o600) << 16, offset))
            central.extend(raw_name)
            offset += _LOCAL.size + len(raw_name) + size
        _write(output_fd, central, cancel, deadline)
        _write(output_fd, _END.pack(0x06054b50, 0, 0, len(names), len(names), len(central), offset, 0), cancel, deadline)
        check_archive(cancel, deadline)
        if os.fstat(output_fd).st_size != archive_bytes:
            _reject('storage')
    except OSError:
        _reject('storage')
