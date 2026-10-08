from __future__ import annotations

import io
from pathlib import Path
import struct
import tempfile
import unittest
import wave

from karaoke.chunks import (
    FloatStemAssembler, normalization_gain, plan_windows,
    scan_float_peak, write_pcm16_wav,
)


def floats(values: list[float]) -> bytes:
    return struct.pack('<' + 'f' * len(values), *values)


class ChunkTests(unittest.TestCase):
    def test_default_integer_plans_cover_exact_limits_and_tiny_extension(self):
        for seconds, starts, last in [(30, [0], 30), (58, [0, 28], 30), (300, list(range(0, 281, 28)), 20)]:
            windows = plan_windows(seconds * 44100)
            self.assertEqual([item.start for item in windows], [second * 44100 for second in starts])
            self.assertEqual(windows[-1].frames, last * 44100)
            self.assertEqual(windows[-1].start + windows[-1].frames, seconds * 44100)
        windows = plan_windows(30 * 44100 + 1)
        self.assertEqual([(item.start, item.frames) for item in windows], [(0, 1323000), (1234800, 88201)])
        for count in [0, -1, True, 1.5, 300 * 44100 + 1]:
            with self.assertRaises(ValueError):
                plan_windows(count)
        for window, overlap in [(0, 1), (8, 0), (8, 5), (8, True)]:
            with self.assertRaises(ValueError):
                plan_windows(10, window_frames=window, overlap_frames=overlap)

    def test_identity_ramps_impulses_and_channel_positions_survive_stitching(self):
        frames = 23
        original = [(index - 11) / 16 for index in range(frames * 2)]
        original[12] = 2
        original[27] = -3
        vocals, backing = io.BytesIO(), io.BytesIO()
        assembly = FloatStemAssembler(frames, vocals, backing, window_frames=8, overlap_frames=2)
        for index, item in enumerate(assembly.windows):
            chunk = original[item.start * 2:(item.start + item.frames) * 2]
            assembly.append(index, floats(chunk), floats([-value for value in chunk]))
        self.assertEqual(assembly.finish(), frames)
        self.assertEqual(vocals.getvalue(), floats(original))
        self.assertEqual(backing.getvalue(), floats([-value for value in original]))
        self.assertEqual(assembly.finish(), frames)
        with self.assertRaises(ValueError):
            assembly.append(0, b'', b'')

    def test_sample_center_blend_is_complementary_and_shared_between_stems_and_channels(self):
        vocals, backing = io.BytesIO(), io.BytesIO()
        assembly = FloatStemAssembler(9, vocals, backing, window_frames=8, overlap_frames=2)
        assembly.append(0, floats([0, 4] * 8), floats([8, -4] * 8))
        assembly.append(1, floats([4, 0] * 3), floats([0, 4] * 3))
        assembly.finish()
        self.assertEqual(struct.unpack('<18f', vocals.getvalue()), tuple([0, 4] * 6 + [1, 3, 3, 1, 4, 0]))
        self.assertEqual(struct.unpack('<18f', backing.getvalue()), tuple([8, -4] * 6 + [6, -2, 2, 2, 0, 4]))

    def test_invalid_shape_order_and_nonfinite_stems_fail_before_mutation(self):
        for bad in [float('nan'), float('inf'), -float('inf')]:
            vocals, backing = io.BytesIO(), io.BytesIO()
            assembly = FloatStemAssembler(9, vocals, backing, window_frames=8, overlap_frames=2)
            with self.assertRaises(ValueError):
                assembly.append(0, floats([0] * 16), floats([bad] + [0] * 15))
            self.assertEqual(vocals.getvalue(), b'')
            self.assertEqual(backing.getvalue(), b'')
        assembly = FloatStemAssembler(9, io.BytesIO(), io.BytesIO(), window_frames=8, overlap_frames=2)
        with self.assertRaises(ValueError):
            assembly.append(1, floats([0] * 6), floats([0] * 6))
        with self.assertRaises(ValueError):
            assembly.append(0, floats([0] * 15), floats([0] * 16))
        with self.assertRaises(ValueError):
            assembly.finish()

    def test_late_peak_gives_one_global_gain_and_exact_nearest_even_pcm_for_both_stems(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            vocal = root / 'vocals.f32'
            backing = root / 'backing.f32'
            values = [0.5, -0.5, 1 / 65536, 3 / 65536, 5 / 65536, -5 / 65536, 2, -2]
            vocal.write_bytes(floats(values))
            backing.write_bytes(floats([-value / 2 for value in values]))
            peak = scan_float_peak([vocal, backing], 4)
            self.assertEqual(peak, 2)
            self.assertEqual(normalization_gain(peak), 0.5)
            for source in [vocal, backing]:
                output = source.with_suffix('.wav')
                write_pcm16_wav(source, output, 4, 0.5)
                with wave.open(str(output), 'rb') as audio:
                    self.assertEqual((audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getnframes()), (2, 2, 44100, 4))
                    actual = struct.unpack('<8h', audio.readframes(4))
                raw = struct.unpack('<8f', source.read_bytes())
                expected = tuple(max(-32768, min(32767, round(value * 0.5 * 32768))) for value in raw)
                self.assertEqual(actual, expected)
            ties = root / 'ties.f32'
            ties.write_bytes(floats([0.5 / 32768, 1.5 / 32768, 2.5 / 32768, -0.5 / 32768, -1.5 / 32768, -2.5 / 32768]))
            output = root / 'ties.wav'
            write_pcm16_wav(ties, output, 3, 1)
            with wave.open(str(output), 'rb') as audio:
                self.assertEqual(struct.unpack('<6h', audio.readframes(3)), (0, 2, 2, 0, -2, -2))

    def test_peak_scan_is_exact_bounded_finite_and_cancellation_preserves_old_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.f32'
            source.write_bytes(floats([0, 1]))
            self.assertEqual(scan_float_peak([source], 1), 1)
            for value in [0, 0.5, 1]:
                self.assertEqual(normalization_gain(value), 1)
            for value in [-1, float('nan'), float('inf'), True]:
                with self.assertRaises(ValueError):
                    normalization_gain(value)
            source.write_bytes(floats([0, float('nan')]))
            with self.assertRaises(ValueError):
                scan_float_peak([source], 1)
            source.write_bytes(floats([0, 1]) + b'0')
            with self.assertRaises(ValueError):
                scan_float_peak([source], 1)
            source.write_bytes(floats([0, 1]))
            output = root / 'source.wav'
            output.write_bytes(b'previous-output')

            def cancelled():
                raise RuntimeError('cancelled')

            with self.assertRaisesRegex(RuntimeError, 'cancelled'):
                write_pcm16_wav(source, output, 1, 1, cancelled)
            self.assertEqual(output.read_bytes(), b'previous-output')
            self.assertFalse(output.with_suffix('.wav.part').exists())
            with self.assertRaisesRegex(RuntimeError, 'cancelled'):
                scan_float_peak([source], 1, cancelled)
            with self.assertRaisesRegex(RuntimeError, 'cancelled'):
                FloatStemAssembler(1, io.BytesIO(), io.BytesIO(), check=cancelled)

    def test_assembly_and_conversion_use_bounded_blocks_and_check_during_loops(self):
        calls = []
        vocals, backing = io.BytesIO(), io.BytesIO()
        assembly = FloatStemAssembler(40000, vocals, backing, check=lambda: calls.append(1))
        assembly.append(0, floats([0] * 80000), floats([0] * 80000))
        assembly.finish()
        self.assertGreater(len(calls), 4)
        self.assertEqual(len(vocals.getvalue()), 40000 * 8)


class PlannerBudgetTests(unittest.TestCase):
    def test_custom_tiny_windows_cannot_allocate_millions_of_ranges(self):
        with self.assertRaises(ValueError):
            plan_windows(100000, window_frames=8, overlap_frames=2)


if __name__ == '__main__':
    unittest.main()
