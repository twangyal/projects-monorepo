"""Independent scalar signal acceptance; no ML, NumPy, or production math oracle."""
import io
from pathlib import Path
import struct
import tempfile
import unittest
import wave

from karaoke.chunks import (
    FloatStemAssembler,
    normalization_gain,
    plan_windows,
    scan_float_peak,
    write_pcm16_wav,
)


def floats(frames):
    return b''.join(struct.pack('<ff', left, right) for left, right in frames)


def decoded(payload):
    return list(struct.iter_unpack('<ff', payload))


class IndependentChunkTests(unittest.TestCase):
    def assert_signal(self, actual, expected):
        self.assertEqual(len(actual), len(expected))
        for frame, (received, wanted) in enumerate(zip(actual, expected)):
            for channel in range(2):
                with self.subTest(frame=frame, channel=channel):
                    self.assertAlmostEqual(received[channel], wanted[channel], delta=2e-7)

    def assemble(self, count, predictions, window=8, overlap=2):
        vocals, backing = io.BytesIO(), io.BytesIO()
        assembly = FloatStemAssembler(count, vocals, backing,
                                      window_frames=window, overlap_frames=overlap)
        for index, (voice, music) in enumerate(predictions):
            assembly.append(index, floats(voice), floats(music))
        self.assertEqual(assembly.finish(), count)
        self.assertEqual(len(vocals.getvalue()), count * 8)
        self.assertEqual(len(backing.getvalue()), count * 8)
        return decoded(vocals.getvalue()), decoded(backing.getvalue())

    def test_exact_real_duration_ranges_and_one_frame_extension(self):
        cases = {
            30 * 44100: [(0, 1323000)],
            58 * 44100: [(0, 1323000), (1234800, 1323000)],
            300 * 44100: [(index * 1234800, 1323000) for index in range(10)]
            + [(12348000, 882000)],
            1323001: [(0, 1323000), (1234800, 88201)],
        }
        for count, expected in cases.items():
            with self.subTest(count=count):
                actual = [(item.start, item.frames) for item in plan_windows(count)]
                self.assertEqual(actual, expected)
                self.assertEqual(actual[-1][0] + actual[-1][1], count)
                self.assertLessEqual(len(actual), 11)

    def test_single_window_stays_in_original_positions_with_independent_channels(self):
        voice = [(0, 0), (0.25, -0.5), (1, -1), (0, 0), (-0.75, 0.125)]
        music = [(right, left) for left, right in voice]
        actual_voice, actual_music = self.assemble(5, [(voice, music)])
        self.assert_signal(actual_voice, voice)
        self.assert_signal(actual_music, music)

    def test_identity_predictions_preserve_ramps_and_impulses_across_two_boundaries(self):
        source = [(frame / 32, -frame / 64) for frame in range(15)]
        source[6] = (1, -0.75)
        source[7] = (-0.5, 0.875)
        source[12] = (0.9375, -1)
        ranges = [(0, 8), (6, 8), (12, 3)]
        predictions = [(source[start:start + size],
                        [(right, -left) for left, right in source[start:start + size]])
                       for start, size in ranges]
        voice, music = self.assemble(15, predictions)
        self.assert_signal(voice, source)
        self.assert_signal(music, [(right, -left) for left, right in source])

    def test_sample_center_overlap_weights_are_complementary_for_each_channel(self):
        # L=2 gives incoming weights 1/4 and 3/4, independently calculated.
        old_voice = [(0.25, -0.5)] * 8
        new_voice = [(0.75, 0.5)] * 3
        old_music = [(-0.75, 0.5)] * 8
        new_music = [(0.25, -0.5)] * 3
        voice, music = self.assemble(9, [(old_voice, old_music), (new_voice, new_music)])
        self.assert_signal(voice, [(0.25, -0.5)] * 6
                           + [(0.375, -0.25), (0.625, 0.25), (0.75, 0.5)])
        self.assert_signal(music, [(-0.75, 0.5)] * 6
                           + [(-0.5, 0.25), (0, -0.25), (0.25, -0.5)])

    def test_four_frame_overlap_and_tiny_final_extension_have_no_loss_or_reordering(self):
        # Window8/overlap4 is the largest non-triple-overlap geometry.
        voice, music = self.assemble(9, [([(0, 1)] * 8, [(1, 0)] * 8),
                                         ([(1, 0)] * 5, [(0, 1)] * 5)], overlap=4)
        self.assert_signal(voice, [(0, 1)] * 4
                           + [(0.125, 0.875), (0.375, 0.625), (0.625, 0.375),
                              (0.875, 0.125), (1, 0)])
        self.assert_signal(music, [(1, 0)] * 4
                           + [(0.875, 0.125), (0.625, 0.375), (0.375, 0.625),
                              (0.125, 0.875), (0, 1)])

    def test_late_peak_uses_one_gain_for_earlier_samples_both_stems_and_channels(self):
        voice, music = self.assemble(9, [([(0.5, -0.25)] * 8, [(0.25, -0.5)] * 8),
                                         ([(0.5, -0.25)] * 2 + [(2, -1)],
                                          [(0.25, -0.5)] * 2 + [(0.75, -0.25)])])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = [root / 'voice.f32', root / 'music.f32']
            for path, frames in zip(paths, [voice, music]):
                path.write_bytes(floats(frames))
            peak = scan_float_peak(paths, 9)
            self.assertEqual(peak, 2)
            gain = normalization_gain(peak)
            self.assertEqual(gain, 0.5)
            expected = [[(8192, -4096)] * 8 + [(32767, -16384)],
                        [(4096, -8192)] * 8 + [(12288, -4096)]]
            for index, path in enumerate(paths):
                output = root / f'{index}.wav'
                write_pcm16_wav(path, output, 9, gain)
                with wave.open(str(output), 'rb') as wav:
                    self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate(),
                                      wav.getnframes()), (2, 2, 44100, 9))
                    self.assertEqual(list(struct.iter_unpack('<hh', wav.readframes(10))),
                                     expected[index])

    def test_nearest_even_pcm_rounding_and_signed_clipping_are_not_per_chunk_normalized(self):
        values = [(0.5 / 32768, -0.5 / 32768), (1.5 / 32768, -1.5 / 32768),
                  (2.5 / 32768, -2.5 / 32768), (1, -1), (0, 0)]
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / 'input.f32', Path(directory) / 'out.wav'
            source.write_bytes(floats(values))
            write_pcm16_wav(source, output, 5, 1)
            with wave.open(str(output), 'rb') as wav:
                self.assertEqual(list(struct.iter_unpack('<hh', wav.readframes(5))),
                                 [(0, 0), (2, -2), (2, -2), (32767, -32768), (0, 0)])
        for peak in [0, 0.5, 1]:
            self.assertEqual(normalization_gain(peak), 1)

    def test_wrong_shape_nonfinite_and_out_of_order_predictions_fail_instead_of_repairing(self):
        for payload in [b'\0' * 63, b'\0' * 72,
                        floats([(float('nan'), 0)] + [(0, 0)] * 7),
                        floats([(0, float('inf'))] + [(0, 0)] * 7)]:
            with self.subTest(payload_size=len(payload)):
                assembly = FloatStemAssembler(9, io.BytesIO(), io.BytesIO(),
                                              window_frames=8, overlap_frames=2)
                with self.assertRaises((ValueError, RuntimeError)):
                    assembly.append(0, payload, floats([(0, 0)] * 8))
        assembly = FloatStemAssembler(9, io.BytesIO(), io.BytesIO(),
                                      window_frames=8, overlap_frames=2)
        with self.assertRaises((ValueError, RuntimeError)):
            assembly.append(1, floats([(0, 0)] * 3), floats([(0, 0)] * 3))
        with self.assertRaises((ValueError, RuntimeError)):
            assembly.finish()

    def test_invalid_counts_and_triple_overlap_are_rejected(self):
        for count in [True, 0, -1, 1.5, 300 * 44100 + 1]:
            with self.subTest(count=count), self.assertRaises((ValueError, TypeError)):
                plan_windows(count)
        for window, overlap in [(8, 5), (8, 8), (8, -1), (0, 0)]:
            with self.subTest(window=window, overlap=overlap), self.assertRaises((ValueError, TypeError)):
                plan_windows(9, window_frames=window, overlap_frames=overlap)

    def test_peak_and_conversion_validate_complete_frames_and_every_float(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'bad.f32'
            for payload in [b'\0' * 7, b'\0' * 24, floats([(0, float('nan')), (0, 0)]),
                            floats([(0, 0), (float('-inf'), 0)])]:
                source.write_bytes(payload)
                with self.subTest(size=len(payload)):
                    with self.assertRaises((ValueError, RuntimeError)):
                        scan_float_peak([source], 2)
                    with self.assertRaises((ValueError, RuntimeError)):
                        write_pcm16_wav(source, Path(directory) / 'bad.wav', 2, 1)
        for peak in [-1, float('nan'), float('inf')]:
            with self.subTest(peak=peak), self.assertRaises((ValueError, TypeError)):
                normalization_gain(peak)

    def test_callbacks_can_cancel_assembly_scanning_and_conversion(self):
        def cancel():
            raise RuntimeError('Independent cancellation sentinel')

        with self.assertRaisesRegex(RuntimeError, 'sentinel'):
            assembly = FloatStemAssembler(5, io.BytesIO(), io.BytesIO(),
                                          window_frames=8, overlap_frames=2, check=cancel)
            assembly.append(0, floats([(0, 0)] * 5), floats([(0, 0)] * 5))
            assembly.finish()
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'input.f32'
            source.write_bytes(floats([(0.25, -0.5)] * 5))
            with self.assertRaisesRegex(RuntimeError, 'sentinel'):
                scan_float_peak([source], 5, check=cancel)
            with self.assertRaisesRegex(RuntimeError, 'sentinel'):
                write_pcm16_wav(source, Path(directory) / 'out.wav', 5, 1, check=cancel)


if __name__ == '__main__':
    unittest.main()
