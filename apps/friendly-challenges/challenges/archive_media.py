"""Validate exact retained JPEGs, without normalizing or re-encoding."""
import hashlib
import os
import re
import stat
from threading import Event

from . import images
from .domain import DomainError
from .archive_common import (
    ArchiveError, BLOCK_BYTES, ImageRecord, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, check_archive,
)


def _admit_image(expected: ImageRecord) -> None:
    if (type(expected) is not ImageRecord
            or type(expected.challenge_id) is not str
            or re.fullmatch('[0-9a-f]{32}', expected.challenge_id) is None
            or type(expected.evidence_id) is not str
            or re.fullmatch('[0-9a-f]{32}', expected.evidence_id) is None
            or type(expected.size) is not int or not 1 <= expected.size <= MAX_IMAGE_BYTES
            or type(expected.width) is not int or not 1 <= expected.width <= MAX_IMAGE_SIDE
            or type(expected.height) is not int or not 1 <= expected.height <= MAX_IMAGE_SIDE
            or type(expected.sha256) is not str or re.fullmatch('[0-9a-f]{64}', expected.sha256) is None):
        raise ArchiveError('media', 'Image descriptor is invalid or exceeds supported limits.')


def _identity(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def _read_image(fd: int, expected: ImageRecord, cancel: Event, deadline: float) -> bytes:
    check_archive(cancel, deadline)
    _admit_image(expected)
    if type(fd) is not int or fd < 0:
        raise ArchiveError('input', 'Supply an open regular image file descriptor.')
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size != expected.size:
            raise ArchiveError('media', 'Image bytes do not match the retained descriptor.')
        chunks = []
        offset = 0
        digest = hashlib.sha256()
        while offset < expected.size:
            check_archive(cancel, deadline)
            part = os.pread(fd, min(BLOCK_BYTES, expected.size - offset), offset)
            if not part:
                raise ArchiveError('media', 'Image file ended before its declared size.')
            chunks.append(part)
            digest.update(part)
            offset += len(part)
        if os.pread(fd, 1, offset) or _identity(os.fstat(fd)) != _identity(before):
            raise ArchiveError('media', 'Image file changed during validation.')
        if digest.hexdigest() != expected.sha256:
            raise ArchiveError('media', 'Image hash does not match its retained descriptor.')
        check_archive(cancel, deadline)
        return b''.join(chunks)
    except OSError:
        raise ArchiveError('media', 'Image file could not be read safely.') from None


def validate_image(fd: int, expected: ImageRecord, *, cancel: Event, deadline: float) -> None:
    raw = _read_image(fd, expected, cancel, deadline)
    check_archive(cancel, deadline)
    try:
        actual = images.validate_jpeg(raw)
    except (DomainError, ValueError, OSError):
        raise ArchiveError('media', 'Retained image is not a complete supported normalized JPEG.') from None
    check_archive(cancel, deadline)
    descriptor = dict(mime='image/jpeg', bytes=expected.size, width=expected.width,
                      height=expected.height, sha256=expected.sha256)
    if actual != descriptor:
        raise ArchiveError('media', 'Decoded JPEG does not match its retained descriptor.')
