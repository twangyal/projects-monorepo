"""Real decoder admission; malformed framing and byte limits are independent fixtures."""
import hashlib
from io import BytesIO
import unittest
from unittest.mock import patch

from PIL import Image, ImageFile

from challenges.domain import DomainError
from challenges.images import validate_jpeg, MAX_IMAGE_BYTES


def jpeg(mode='RGB', size=(19, 13), **options):
    stream = BytesIO()
    Image.new(mode, size, 'white').save(stream, 'JPEG', **options)
    return stream.getvalue()


class ImageTests(unittest.TestCase):
    def rejected(self, data, code='invalid_request'):
        with self.assertRaises(DomainError) as caught:
            validate_jpeg(data)
        self.assertEqual(caught.exception.code, code)
        self.assertNotIn('PIL', str(caught.exception))

    def test_real_baseline_and_progressive_rgb_decode_and_exact_descriptor(self):
        for progressive in (False, True):
            data = jpeg(progressive=progressive)
            self.assertEqual(validate_jpeg(data), {'mime': 'image/jpeg', 'bytes': len(data),
                             'width': 19, 'height': 13, 'sha256': hashlib.sha256(data).hexdigest()})

    def test_exact_byte_limit_with_legal_marker_fill_and_one_byte_over(self):
        original = jpeg()
        exact = original[:-2] + b'\xff' * (MAX_IMAGE_BYTES - len(original)) + original[-2:]
        with Image.open(BytesIO(exact)) as decoded:
            decoded.load()
            self.assertEqual(decoded.size, (19, 13))
        self.assertEqual(validate_jpeg(exact)['bytes'], MAX_IMAGE_BYTES)
        self.rejected(exact[:-2] + b'\xff' + exact[-2:], 'too_large')

    def test_side_limit_full_decode_and_one_pixel_over(self):
        self.assertEqual(validate_jpeg(jpeg(size=(1024, 1024)))['width'], 1024)
        self.rejected(jpeg(size=(1025, 1)))
        self.rejected(jpeg('L'))
        self.rejected(jpeg('CMYK'))

    def test_metadata_trailing_concatenated_and_malformed_segments_rejected(self):
        base = jpeg()
        for extra in (b'\xff\xe1\x00\x08Exif\x00\x00', b'\xff\xfe\x00\x06note',
                      b'\xff\xe2\x00\x06data', b'\xff\xe0\x00\x08JFXX\x00\x10'):
            self.rejected(base[:2] + extra + base[2:])
        for damaged in (base + b'x', base + base, base[:-2], b'\xff\xd8\xff\xd9',
                        base[:2] + b'\xff\xdb\x00\x01' + base[2:],
                        base[:2] + b'\xff\xdb\xff\xff' + base[2:]):
            self.rejected(damaged)

    def test_valid_header_cannot_hide_corrupt_compressed_data(self):
        base = jpeg(size=(256, 256))
        sos = base.index(b'\xff\xda')
        payload = sos + 2 + int.from_bytes(base[sos + 2:sos + 4], 'big')
        self.rejected(base[:payload] + base[-2:])
        with patch.object(ImageFile, 'LOAD_TRUNCATED_IMAGES', True):
            self.rejected(base)

    def test_jfif_thumbnail_and_duplicate_frame_are_rejected(self):
        base = jpeg()
        thumb = bytearray(base)
        thumb[18] = 1
        self.rejected(bytes(thumb))
        start = base.index(b'\xff\xc0')
        end = start + 2 + int.from_bytes(base[start + 2:start + 4], 'big')
        self.rejected(base[:end] + base[start:end] + base[end:])
