"""Original generated audio and independently corrupted physical Ogg pages."""
import hashlib
import math
import os
from pathlib import Path
import struct
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import wave

from duet.archive_common import ArchiveError, MAX_AUDIO_BYTES
from duet.archive_media import validate_audio
from duet import media


def crc(page):
    """Independent bit-at-a-time Ogg polynomial, deliberately not a lookup table."""
    value = 0
    for byte in page:
        value ^= byte << 24
        for _ in range(8):
            value = ((value << 1) ^ (0x04c11db7 if value & 0x80000000 else 0)) & 0xffffffff
    return value


def repair(page):
    page = bytearray(page)
    page[22:26] = b'\0' * 4
    page[22:26] = struct.pack('<I', crc(page))
    return bytes(page)


def pages(data):
    result = []
    offset = 0
    while offset < len(data):
        segments = data[offset + 26]
        size = 27 + segments + sum(data[offset + 27:offset + 27 + segments])
        result.append(data[offset:offset + size])
        offset += size
    return result


class ArchiveMediaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.library = tempfile.TemporaryDirectory()
        root = Path(cls.library.name)
        source = root / 'original.wav'
        with wave.open(str(source), 'wb') as wav:
            wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b''.join(struct.pack('<h', round(12000 * math.sin(2 * math.pi * 440 * i / 16000)))
                                     for i in range(33968)))
        output = root / 'normalized.ogg'
        cls.duration = media.normalize_audio(source, output, threading.Event(), lambda _: None)
        cls.original = output.read_bytes()

    @classmethod
    def tearDownClass(cls):
        cls.library.cleanup()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'audio.ogg'
        self.path.write_bytes(self.original)
        self.cancel = threading.Event()

    def validate(self, duration=None):
        with self.path.open('rb') as stream:
            return validate_audio(stream.fileno(), self.duration if duration is None else duration,
                                  cancel=self.cancel, deadline=time.monotonic() + 10)

    def test_actual_opus_exact_frames_padding_and_source_immutability(self):
        before = hashlib.sha256(self.path.read_bytes()).digest()
        with self.path.open('rb') as stream:
            stream.seek(7)
            count = validate_audio(stream.fileno(), self.duration, cancel=self.cancel,
                                   deadline=time.monotonic() + 10)
            self.assertEqual(stream.tell(), 7)
        self.assertEqual(count, 101904)
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).digest(), before)

    def test_one_frame_tolerance_is_exact_and_two_frames_reject(self):
        self.assertEqual(self.validate(self.duration + 1 / 48000), 101904)
        self.assertEqual(self.validate(self.duration - 1 / 48000), 101904)
        with self.assertRaises(ArchiveError) as caught:
            self.validate(self.duration + 2 / 48000)
        self.assertEqual(caught.exception.code, 'media')

    def test_corrupt_container_rejects_before_decoder(self):
        original = pages(self.original)
        variants = []
        for page_index, byte_index, value in [(0, 4, 1), (0, 5, 3), (0, 5, 0),
                                             (0, 5, 0x82), (1, 5, 1),
                                             (1, 18, 50), (1, 14, 50)]:
            modified = bytearray(original[page_index])
            modified[byte_index] = value
            copy = list(original)
            copy[page_index] = repair(modified)
            variants.append(b''.join(copy))
        last = bytearray(original[-1])
        last[5] &= ~4
        variants.extend([self.original + b'junk', self.original[:-1], self.original[:20],
                         b''.join(original[:-1]) + repair(last),
                         self.original + self.original, self.original[:30] + b'\0' + self.original[31:]])
        for index, data in enumerate(variants):
            with self.subTest(index=index):
                self.path.write_bytes(data)
                with patch('duet.archive_media.media._probe') as probe:
                    with self.assertRaises(ArchiveError) as caught:
                        self.validate()
                    self.assertEqual(caught.exception.code, 'media')
                    probe.assert_not_called()

    def test_unfinished_packet_at_eos_rejects(self):
        original = pages(self.original)
        last = bytearray(original[-1])
        lace = 27 + last[26] - 1
        additional = 255 - last[lace]
        last[lace] = 255
        last.extend(b'x' * additional)
        self.path.write_bytes(b''.join(original[:-1]) + repair(last))
        with self.assertRaises(ArchiveError):
            self.validate()

    def test_nonopus_and_wrong_channels_are_not_archivable(self):
        import subprocess
        for codec, channels in [('libvorbis', 2), ('libopus', 1)]:
            with self.subTest(codec=codec, channels=channels):
                self.path.unlink()
                subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
                                'sine=frequency=440:sample_rate=48000:duration=2',
                                '-threads', '1', '-ac', str(channels), '-c:a', codec,
                                '-f', 'ogg', str(self.path)], check=True, capture_output=True, timeout=10)
                with self.assertRaises(ArchiveError) as caught:
                    self.validate(2)
                self.assertEqual(caught.exception.code, 'media')

    def test_invalid_duration_fd_and_nonregular_source_fail_bounded(self):
        for duration in [True, '2', 0.99, 300.01, float('nan'), float('inf'), 10 ** 400]:
            with self.subTest(duration=duration), self.assertRaises(ArchiveError):
                self.validate(duration)
        for fd in [True, -1, '1', 10 ** 20]:
            with self.subTest(fd=fd), self.assertRaises(ArchiveError):
                validate_audio(fd, 2, cancel=self.cancel, deadline=time.monotonic() + 10)
        descriptor = os.open(self.directory.name, os.O_RDONLY | os.O_DIRECTORY)
        try:
            with self.assertRaises(ArchiveError):
                validate_audio(descriptor, 2, cancel=self.cancel, deadline=time.monotonic() + 10)
        finally:
            os.close(descriptor)

    def test_size_bound_rejects_before_child_and_preserves_source(self):
        with self.path.open('r+b') as stream:
            stream.truncate(MAX_AUDIO_BYTES + 1)
        with patch('duet.archive_media.media._probe') as probe, self.assertRaises(ArchiveError) as caught:
            self.validate()
        self.assertEqual(caught.exception.code, 'limit')
        probe.assert_not_called()
        self.assertEqual(self.path.stat().st_size, MAX_AUDIO_BYTES + 1)

    def test_cancel_and_deadline_win_before_decoder(self):
        self.cancel.set()
        with self.assertRaises(ArchiveError) as caught:
            self.validate()
        self.assertEqual(caught.exception.code, 'cancelled')
        self.cancel.clear()
        with self.path.open('rb') as stream, self.assertRaises(ArchiveError) as caught:
            validate_audio(stream.fileno(), self.duration, cancel=self.cancel, deadline=time.monotonic() - 1)
        self.assertEqual(caught.exception.code, 'timeout')

    def test_pinned_fd_reads_original_after_text_path_replacement(self):
        with self.path.open('rb') as stream:
            self.path.rename(self.path.with_suffix('.moved'))
            self.path.write_bytes(b'bad replacement')
            self.assertEqual(validate_audio(stream.fileno(), self.duration, cancel=self.cancel,
                                            deadline=time.monotonic() + 10), 101904)
        self.assertEqual(self.path.read_bytes(), b'bad replacement')

    def test_short_regular_reads_are_accumulated_without_false_truncation(self):
        original = os.pread

        def short_read(fd, size, offset):
            return original(fd, min(size, 3), offset)

        with patch('duet.archive_media.os.pread', side_effect=short_read):
            self.assertEqual(self.validate(), 101904)

    def test_decoder_counts_pcm_without_retaining_or_reencoding_and_remaining_deadline(self):
        from duet import archive_media
        original = archive_media.media._run
        calls = []
        def capture(command, *args, **kwargs):
            calls.append((command, kwargs))
            return original(command, *args, **kwargs)
        with patch.object(archive_media.media, '_run', side_effect=capture):
            self.assertEqual(self.validate(), 101904)
        decode = [(command, kwargs) for command, kwargs in calls if command[0] == 'ffmpeg']
        self.assertEqual(len(decode), 1)
        command, options = decode[0]
        self.assertNotIn('libopus', command)
        self.assertIn('pipe:1', command)
        self.assertIn('-protocol_whitelist', command)
        self.assertEqual(options['stdout_limit'], 300 * 48000 * 4)
        self.assertIs(options['count_stdout'], True)
        self.assertIn('deadline', options)


if __name__ == '__main__':
    unittest.main()
