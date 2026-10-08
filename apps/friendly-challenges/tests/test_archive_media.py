import hashlib
import io
import os
from pathlib import Path
import tempfile
from threading import Event
import time
import unittest
from unittest.mock import patch

from PIL import Image
from challenges.archive_common import ArchiveError, ImageRecord
from challenges.archive_media import validate_image


def jpeg():
    output = io.BytesIO()
    Image.new('RGB', (4, 3), (23, 81, 149)).save(output, format='JPEG', quality=85)
    return output.getvalue()


def expected(raw):
    return ImageRecord('1' * 32, '2' * 32, len(raw), 4, 3, hashlib.sha256(raw).hexdigest())


class ArchiveMediaTests(unittest.TestCase):
    def validate(self, raw, descriptor=None):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'original.jpg'
            path.write_bytes(raw)
            fd = os.open(path, os.O_RDONLY)
            try:
                validate_image(fd, descriptor or expected(raw), cancel=Event(), deadline=time.monotonic() + 30)
            finally:
                os.close(fd)

    def test_original_jpeg_full_decode_without_reencoding(self):
        raw = jpeg()
        self.validate(raw)
        original = os.pread
        with patch('os.pread', side_effect=lambda fd, count, offset: original(fd, min(count, 7), offset)):
            self.validate(raw)

    def test_hash_dimensions_framing_and_actual_decode_reject(self):
        raw = jpeg()
        descriptors = [ImageRecord('1' * 32, '2' * 32, len(raw), 3, 4, hashlib.sha256(raw).hexdigest()),
                       ImageRecord('1' * 32, '2' * 32, len(raw), 4, 3, '0' * 64),
                       ImageRecord('1' * 32, '2' * 32, len(raw) - 1, 4, 3, hashlib.sha256(raw).hexdigest())]
        for descriptor in descriptors:
            with self.subTest(descriptor=descriptor), self.assertRaises(ArchiveError):
                self.validate(raw, descriptor)
        for invalid in (raw[:-2], raw + b'junk', b'not a JPEG', raw[:20] + b'\x00' * (len(raw) - 20)):
            with self.subTest(size=len(invalid)), self.assertRaises(ArchiveError):
                self.validate(invalid)

    def test_cancel_does_not_decode(self):
        with tempfile.TemporaryFile() as file:
            raw = jpeg()
            file.write(raw)
            file.flush()
            cancel = Event()
            cancel.set()
            with patch('challenges.images.validate_jpeg') as decoder, self.assertRaises(ArchiveError) as caught:
                validate_image(file.fileno(), expected(raw), cancel=cancel, deadline=time.monotonic() + 30)
            self.assertEqual(caught.exception.code, 'cancelled')
            decoder.assert_not_called()
