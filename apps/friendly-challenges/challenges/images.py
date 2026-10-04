"""Admit exact normalized JPEG bytes; this service never repairs submitted evidence."""
import hashlib
from io import BytesIO

from PIL import Image, ImageFile, UnidentifiedImageError

from .domain import DomainError

MAX_IMAGE_BYTES = 512 * 1024
MAX_IMAGE_SIDE = 1024


def _invalid():
    raise DomainError('invalid_request',
                      'Use a complete normalized RGB JPEG without metadata, at most 1024 pixels per side.', 400)


def _frame(data):
    """Bounded JPEG marker/extent admission; Pillow owns the actual image decode."""
    if len(data) < 4 or data[:2] != b'\xff\xd8':
        _invalid()
    offset, frame, scan, entropy, jfif = 2, None, False, False, False
    entropy_bytes = 0
    while offset < len(data):
        if entropy:
            found = data.find(b'\xff', offset)
            entropy_bytes += found - offset
            offset = found
            if offset < 0:
                _invalid()
        elif data[offset] != 255:
            _invalid()
        while offset < len(data) and data[offset] == 255:
            offset += 1
        if offset == len(data):
            _invalid()
        marker = data[offset]
        offset += 1
        if entropy and (marker == 0 or 0xd0 <= marker <= 0xd7):
            if marker == 0:
                entropy_bytes += 1
            continue
        if entropy and entropy_bytes == 0:
            _invalid()
        entropy = False
        if marker == 0xd9:
            if offset != len(data) or not frame or not scan:
                _invalid()
            return frame
        if marker not in (0xc0, 0xc2, 0xc4, 0xdb, 0xdd, 0xda, 0xe0):
            _invalid()
        if offset + 2 > len(data):
            _invalid()
        size = int.from_bytes(data[offset:offset + 2], 'big')
        if size < 2 or offset + size > len(data):
            _invalid()
        payload = data[offset + 2:offset + size]
        offset += size
        if marker in (0xc0, 0xc2):
            if frame or len(payload) != 15 or payload[0] != 8 or payload[5] != 3:
                _invalid()
            height, width = int.from_bytes(payload[1:3], 'big'), int.from_bytes(payload[3:5], 'big')
            if not (1 <= width <= MAX_IMAGE_SIDE and 1 <= height <= MAX_IMAGE_SIDE):
                _invalid()
            frame = width, height
        elif marker == 0xe0:
            if (jfif or scan or len(payload) != 14 or payload[:5] != b'JFIF\0'
                    or payload[5] != 1 or payload[6] > 2 or payload[7] > 2
                    or payload[-2:] != b'\0\0'):
                _invalid()
            jfif = True
        elif marker == 0xda:
            if not frame or len(payload) < 6:
                _invalid()
            scan, entropy = True, True
            entropy_bytes = 0
    _invalid()


def validate_jpeg(data: bytes) -> dict:
    if type(data) is not bytes or not data:
        _invalid()
    if len(data) > MAX_IMAGE_BYTES:
        raise DomainError('too_large', 'Evidence images may contain at most 512 KiB.', 413)
    size = _frame(data)
    # Reject a process configured for permissive truncated decode. No concurrent
    # request changes Pillow's process-global admission policy.
    if ImageFile.LOAD_TRUNCATED_IMAGES:
        _invalid()
    try:
        with Image.open(BytesIO(data), formats=['JPEG']) as decoded:
            if (decoded.format != 'JPEG' or decoded.mode != 'RGB' or decoded.size != size
                    or getattr(decoded, 'n_frames', 1) != 1):
                _invalid()
            decoded.load()
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, Image.DecompressionBombError):
        _invalid()
    return {'mime': 'image/jpeg', 'bytes': len(data), 'width': size[0], 'height': size[1],
            'sha256': hashlib.sha256(data).hexdigest()}
