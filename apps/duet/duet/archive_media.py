"""Complete bounded validation of pinned normalized Ogg/Opus audio.

Physical Ogg validation retains one page; FFmpeg PCM is counted, not buffered.
Caller descriptors remain open at their original position. Nothing is encoded.
"""
import math
import os
from pathlib import Path
import stat
import struct
from threading import Event

from . import media
from .archive_common import (
    ArchiveError, BLOCK_BYTES, MAX_AUDIO_BYTES, MAX_DURATION, MAX_OGG_PAGE_BYTES,
    MAX_OGG_PAGES, MAX_PCM_BYTES, MIN_DURATION, SAMPLE_RATE, check_archive,
)


def _crc_table():
    result = []
    for byte in range(256):
        value = byte << 24
        for _ in range(8):
            value = ((value << 1) ^ (0x04c11db7 if value & 0x80000000 else 0)) & 0xffffffff
        result.append(value)
    return tuple(result)


_CRC_TABLE = _crc_table()


def _invalid():
    return ArchiveError('media', 'Stored audio must contain a complete valid single-stream Ogg container.')


def _read(fd, offset, size, cancel, deadline):
    data = bytearray()
    while len(data) < size:
        check_archive(cancel, deadline)
        part = os.pread(fd, size - len(data), offset + len(data))
        if not part:
            raise _invalid()
        data.extend(part)
    check_archive(cancel, deadline)
    return bytes(data)


def _body(fd, page, start, offset, cancel, deadline):
    while start < len(page):
        check_archive(cancel, deadline)
        view = memoryview(page)[start:min(len(page), start + BLOCK_BYTES)]
        try:
            count = os.preadv(fd, [view], offset)
        finally:
            view.release()
        if not count:
            raise _invalid()
        start += count
        offset += count


def _ogg(fd, size, cancel, deadline):
    offset = 0
    serial = None
    sequence = 0
    pending = False
    eos = False
    while offset < size:
        check_archive(cancel, deadline)
        if eos or sequence >= MAX_OGG_PAGES or size - offset < 27:
            raise _invalid()
        header = _read(fd, offset, 27, cancel, deadline)
        if header[:4] != b'OggS' or header[4] != 0 or header[5] & ~7:
            raise _invalid()
        flags = header[5]
        current_serial, current_sequence, checksum = struct.unpack_from('<III', header, 14)
        if current_sequence != sequence:
            raise _invalid()
        if sequence == 0:
            if not flags & 2 or flags & 1:
                raise _invalid()
            serial = current_serial
        elif flags & 2 or serial != current_serial:
            raise _invalid()
        if bool(flags & 1) != pending:
            raise _invalid()
        lacing = _read(fd, offset + 27, header[26], cancel, deadline)
        length = 27 + len(lacing) + sum(lacing)
        if length > MAX_OGG_PAGE_BYTES or length > size - offset:
            raise _invalid()
        page = bytearray(length)
        page[:27] = header
        page[27:27 + len(lacing)] = lacing
        _body(fd, page, 27 + len(lacing), offset + 27 + len(lacing), cancel, deadline)
        page[22:26] = b'\0' * 4
        actual = 0
        for byte in page:
            actual = ((actual << 8) & 0xffffffff) ^ _CRC_TABLE[((actual >> 24) ^ byte) & 255]
        if checksum != actual:
            raise _invalid()
        # Empty pages do not finish a continued packet.
        if lacing:
            pending = lacing[-1] == 255
        eos = bool(flags & 4)
        if eos and (pending or offset + length != size):
            raise _invalid()
        offset += length
        sequence += 1
    if not eos or pending or sequence == 0:
        raise _invalid()
    check_archive(cancel, deadline)


def _identity(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def validate_audio(fd: int, expected_duration: float, *, cancel: Event,
                   deadline: float) -> int:
    """Admit the entire physical container and complete decoded frame count."""
    check_archive(cancel, deadline)
    if type(fd) is not int or fd < 0:
        raise ArchiveError('input', 'Audio validation requires an open regular-file descriptor.')
    try:
        valid_duration = (type(expected_duration) in (int, float)
                          and math.isfinite(expected_duration)
                          and MIN_DURATION <= expected_duration <= MAX_DURATION)
    except OverflowError:
        valid_duration = False
    if not valid_duration:
        raise ArchiveError('input', 'Stored audio duration must be finite and within 1–300 seconds.')
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise ArchiveError('input', 'Audio validation requires an open regular-file descriptor.')
        if not 0 < info.st_size <= MAX_AUDIO_BYTES:
            raise ArchiveError('limit', 'Stored audio must be nonempty and at most 8 MiB.')
        _ogg(fd, info.st_size, cancel, deadline)
        check_archive(cancel, deadline)
        # Child opens its own description of this parent's pinned inode. Do
        # not resolve this spelling to a pathname that can be replaced.
        source = Path(f'/proc/{os.getpid()}/fd/{fd}')
        media._probe(source, 'ogg', cancel, deadline, canonical=True)
        check_archive(cancel, deadline)
        count, _ = media._run(media._decode_args(source, 'ogg') + media._pcm_args(),
                              cancel, deadline=deadline, stdout_limit=MAX_PCM_BYTES,
                              count_stdout=True)
        check_archive(cancel, deadline)
        duration = media._duration(count)
        frames = count // 4
        if (abs(frames - round(expected_duration * SAMPLE_RATE)) > 1
                or not MIN_DURATION <= duration <= MAX_DURATION):
            raise ArchiveError('media', 'Stored audio decoded duration does not match its room metadata.')
        if _identity(os.fstat(fd)) != _identity(info):
            raise ArchiveError('storage', 'Stored audio changed during validation; preserve the library and retry safely.')
        check_archive(cancel, deadline)
        return frames
    except ArchiveError:
        raise
    except (OSError, OverflowError):
        raise ArchiveError('storage', 'Stored audio could not be read from its pinned descriptor.') from None
    except (ValueError, RuntimeError) as error:
        # Aggregate cancellation/deadline takes precedence over decoder errors.
        check_archive(cancel, deadline)
        if 'timed out' in str(error):
            raise ArchiveError('timeout', 'Stored audio validation exceeded its bounded time limit.') from None
        raise ArchiveError('media', 'Stored audio must decode completely as stereo 48 kHz Opus, lasting 1–300 seconds.') from None
