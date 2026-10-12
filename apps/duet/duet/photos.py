"""Identify memory photos by their file signatures and header dimensions (standard library only).

Only passive raster formats are accepted: JPEG, PNG, WebP and GIF. SVG, HTML or anything else is
refused regardless of its claimed name or type, and dimensions must be present and bounded.
"""

import struct

MAX_PHOTO_BYTES = 5 * 1024 * 1024
MAX_SIDE = 12000
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
        return int.from_bytes(data[24:27], 'little') + 1, int.from_bytes(data[27:30], 'little') + 1
    raise PhotoError('This WebP image is damaged or unsupported.')


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
    return mime, width, height
