"""MDX-Net segmenting and spectrogram plumbing, with stand-in models (no ONNX Runtime needed)."""
from __future__ import annotations

import unittest

import numpy as np

from karaoke import mdx


def tones(frames: int) -> np.ndarray:
    moment = np.arange(frames) / mdx.SAMPLE_RATE
    return np.stack([0.5 * np.sin(2 * np.pi * 440 * moment), 0.3 * np.sin(2 * np.pi * 1250 * moment + 1)], 1).astype(np.float32)


class SpectrogramTests(unittest.TestCase):
    def test_stft_matches_the_model_frame_count_and_inverts_exactly(self):
        signal = np.random.default_rng(1).standard_normal(mdx.SEGMENT)
        spectrum = mdx.stft(signal)
        self.assertEqual(spectrum.shape, (mdx.DIM_T, mdx.N_FFT // 2 + 1))
        self.assertLess(np.abs(mdx.istft(spectrum, len(signal)) - signal).max(), 1e-9)


class SeparateVocalsTests(unittest.TestCase):
    def test_identity_model_returns_the_input_as_vocals_across_segment_joins(self):
        mixture = tones(2 * mdx.STEP + 12345)
        calls = []

        def identity(features):
            calls.append(features.shape)
            self.assertEqual(features.dtype, np.float32)
            return features
        vocals, backing = mdx.separate_vocals(mixture, identity)
        self.assertEqual(calls, [(1, 4, mdx.DIM_F, mdx.DIM_T)] * 3)
        self.assertEqual(vocals.shape, mixture.shape)
        self.assertEqual(backing.dtype, np.float32)
        self.assertLess(np.abs(vocals - mixture).max(), 1e-3)
        self.assertLess(np.abs(backing).max(), 1e-3)

    def test_silent_vocals_leave_the_whole_mixture_as_backing(self):
        mixture = tones(mdx.STEP + 1)
        vocals, backing = mdx.separate_vocals(mixture, np.zeros_like)
        self.assertEqual(np.abs(vocals).max(), 0)
        np.testing.assert_array_equal(backing, mixture)

    def test_channels_keep_their_own_real_and_imaginary_planes(self):
        mixture = tones(mdx.STEP)

        def left_only(features):
            output = features.copy()
            output[:, 2:] = 0
            return output
        vocals, backing = mdx.separate_vocals(mixture, left_only)
        self.assertLess(np.abs(vocals[:, 0] - mixture[:, 0]).max(), 1e-3)
        self.assertLess(np.abs(vocals[:, 1]).max(), 1e-6)
        self.assertLess(np.abs(backing[:, 1] - mixture[:, 1]).max(), 1e-6)

    def test_short_and_boundary_lengths_keep_their_length(self):
        for frames in (1, 100, mdx.STEP - 1, mdx.STEP, mdx.STEP + 1):
            with self.subTest(frames=frames):
                vocals, backing = mdx.separate_vocals(tones(frames), lambda features: features)
                self.assertEqual(vocals.shape, (frames, 2))
                self.assertEqual(backing.shape, (frames, 2))

    def test_invalid_audio_or_model_output_is_refused(self):
        for audio in (np.zeros((0, 2), np.float32), np.zeros((10, 1), np.float32), np.zeros(10, np.float32)):
            with self.subTest(shape=audio.shape), self.assertRaises(ValueError):
                mdx.separate_vocals(audio, lambda features: features)
        for model in (lambda features: features[:, :2], lambda features: np.full_like(features, np.nan)):
            with self.assertRaisesRegex(RuntimeError, 'invalid spectrogram'):
                mdx.separate_vocals(tones(100), model)


if __name__ == '__main__':
    unittest.main()
