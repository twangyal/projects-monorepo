"""Validate memory photos with bounded headers, containers and complete isolated pixel decoding.

Only passive raster formats are accepted: JPEG, PNG, WebP and GIF. SVG, HTML or anything else is
refused regardless of its claimed name or type, and dimensions must be present and bounded.
"""

from pathlib import Path
import struct
import tempfile
import threading
import zlib

from .media import _run

MAX_PHOTO_BYTES = 5 * 1024 * 1024
MAX_SIDE = 12000
MAX_PIXELS = 16_000_000
MAX_DECODED_PIXELS = 32_000_000
PHOTO_SECONDS = 5.0
EXTENSIONS = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif'}


class PhotoError(ValueError):
    pass


def _jpeg(data):
    index = 2
    while index + 9 < len(data):
        if data[index] != 0xFF:
            raise PhotoError('This JPEG is damaged.')
        marker = data[index + 1]
        if marker == 0xFF:
            index += 1
            continue
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            index += 2
            continue
        length = struct.unpack('>H', data[index + 2:index + 4])[0]
        if length < 2:
            raise PhotoError('This JPEG is damaged.')
        # Start-of-frame markers carry the image size (C4, C8 and CC are other segment types).
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            height, width = struct.unpack('>HH', data[index + 5:index + 9])
            return width, height
        index += 2 + length
    raise PhotoError('This JPEG has no image size.')


def _webp(data):
    chunk = data[12:16]
    if chunk == b'VP8 ' and len(data) >= 30 and data[23:26] == b'\x9d\x01\x2a':
        width, height = struct.unpack('<HH', data[26:30])
        return width & 0x3FFF, height & 0x3FFF
    if chunk == b'VP8L' and len(data) >= 25 and data[20] == 0x2F:
        bits = int.from_bytes(data[21:25], 'little')
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if chunk == b'VP8X' and len(data) >= 30:
        if data[20] & 0x02:
            raise PhotoError('Animated WebP photos are unsupported. Choose a still WebP or GIF.')
        return int.from_bytes(data[24:27], 'little') + 1, int.from_bytes(data[27:30], 'little') + 1
    raise PhotoError('This WebP image is damaged or unsupported.')


def _gif_frames(data):
    """Walk every block; tolerant decoders may salvage truncated GIF frames."""
    if len(data) < 13:
        raise PhotoError('This GIF is incomplete.')
    width, height = struct.unpack('<HH', data[6:10])
    offset = 13 + (3 * (2 ** ((data[10] & 7) + 1)) if data[10] & 0x80 else 0)
    frames = 0

    def subblocks(start):
        while start < len(data):
            size = data[start]
            start += 1
            if not size:
                return start
            start += size
            if start > len(data):
                break
        raise PhotoError('This GIF has incomplete image or extension data.')

    while offset < len(data):
        marker = data[offset]
        if marker == 0x3B:
            if not frames or offset + 1 != len(data):
                raise PhotoError('This GIF has an invalid ending.')
            return frames
        if marker == 0x21:
            if offset + 2 >= len(data):
                raise PhotoError('This GIF has an incomplete extension.')
            offset = subblocks(offset + 2)
        elif marker == 0x2C:
            if offset + 10 > len(data):
                raise PhotoError('This GIF has an incomplete frame.')
            left, top, fw, fh = struct.unpack('<HHHH', data[offset + 1:offset + 9])
            if not fw or not fh or left + fw > width or top + fh > height:
                raise PhotoError('This GIF has invalid frame dimensions.')
            packed = data[offset + 9]
            offset += 10 + (3 * (2 ** ((packed & 7) + 1)) if packed & 0x80 else 0)
            if offset >= len(data) or not 2 <= data[offset] <= 8:
                raise PhotoError('This GIF has invalid image data.')
            offset = subblocks(offset + 1)
            frames += 1
            if frames * width * height > MAX_DECODED_PIXELS:
                raise PhotoError('Animated photos can contain at most 32 million total pixels.')
        else:
            raise PhotoError('This GIF has damaged blocks.')
    raise PhotoError('This GIF is incomplete.')


def _complete_container(data, mime):
    if mime == 'image/png':
        offset = 8
        while offset + 12 <= len(data):
            size = int.from_bytes(data[offset:offset + 4], 'big')
            end = offset + size + 12
            if end > len(data):
                raise PhotoError('This PNG is truncated.')
            kind = data[offset + 4:offset + 8]
            if kind in (b'acTL', b'fcTL', b'fdAT'):
                raise PhotoError('Animated PNG photos are unsupported. Choose a still PNG or GIF.')
            expected = int.from_bytes(data[end - 4:end], 'big')
            if zlib.crc32(data[offset + 4:end - 4]) != expected:
                raise PhotoError('This PNG is damaged.')
            if kind == b'IEND':
                if size != 0 or end != len(data):
                    raise PhotoError('This PNG has an invalid ending.')
                return 1
            offset = end
        raise PhotoError('This PNG is incomplete.')
    if mime == 'image/jpeg' and data[-2:] != b'\xff\xd9':
        raise PhotoError('This JPEG is incomplete.')
    if mime == 'image/gif':
        return _gif_frames(data)
    if mime == 'image/webp' and int.from_bytes(data[4:8], 'little') + 8 != len(data):
        raise PhotoError('This WebP is incomplete.')
    return 1


def _decode_photo(data, mime, width, height, frames):
    formats = {'image/jpeg': 'jpeg_pipe', 'image/png': 'png_pipe',
               'image/webp': 'webp_pipe', 'image/gif': 'gif'}
    with tempfile.TemporaryDirectory(prefix='duet-photo-') as directory:
        source = Path(directory) / 'input'
        source.write_bytes(data)
        source.chmod(0o600)
        command = ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror',
                   '-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1',
                   '-protocol_whitelist', 'file,pipe', '-format_whitelist', formats[mime],
                   '-err_detect', 'explode', '-max_pixels', str(MAX_PIXELS),
                   '-f', formats[mime], '-i', str(source), '-map', '0:v:0', '-an', '-sn', '-dn',
                   '-threads', '1', '-fps_mode', 'passthrough', '-pix_fmt', 'rgba',
                   '-c:v', 'rawvideo', '-f', 'rawvideo', 'pipe:1']
        try:
            count, _ = _run(command, threading.Event(), timeout=PHOTO_SECONDS,
                            stdout_limit=MAX_DECODED_PIXELS * 4, count_stdout=True)
        except (RuntimeError, OSError):
            raise PhotoError('This photo could not be fully decoded within the supported limits. Check the file and FFmpeg installation.') from None
    frame = width * height * 4
    if count != frames * frame:
        raise PhotoError('This photo has incomplete or inconsistent pixels.')


def inspect_photo(data):
    """Return (mime type, width, height) or raise PhotoError with a user-safe message."""
    if not isinstance(data, (bytes, bytearray)) or not data:
        raise PhotoError('Choose a nonempty photo.')
    if len(data) > MAX_PHOTO_BYTES:
        raise PhotoError('Photos can be at most 5 MiB.')
    try:
        if data[:3] == b'\xff\xd8\xff':
            mime, (width, height) = 'image/jpeg', _jpeg(data)
        elif data[:8] == b'\x89PNG\r\n\x1a\n' and data[12:16] == b'IHDR':
            mime, (width, height) = 'image/png', struct.unpack('>II', data[16:24])
        elif data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            mime, (width, height) = 'image/webp', _webp(data)
        elif data[:6] in (b'GIF87a', b'GIF89a'):
            mime, (width, height) = 'image/gif', struct.unpack('<HH', data[6:10])
        else:
            raise PhotoError('Use a JPEG, PNG, WebP or GIF photo.')
    except struct.error:
        raise PhotoError('This photo is damaged.') from None
    if not (0 < width <= MAX_SIDE and 0 < height <= MAX_SIDE):
        raise PhotoError('Photos must be between 1 and 12,000 pixels on each side.')
    if width * height > MAX_PIXELS:
        raise PhotoError('Photos can contain at most 16 million pixels.')
    frames = _complete_container(data, mime)
    _decode_photo(data, mime, width, height, frames)
    return mime, width, height
