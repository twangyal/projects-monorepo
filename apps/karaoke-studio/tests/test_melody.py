import io
import unittest
import wave

import numpy as np

from karaoke.melody import MAX_NOTES, melody, midi_track, read_vocals, validate_notes, RATE


def sung(parts, rate=44100):
    """Stereo PCM16 WAV bytes of `parts`: (seconds, MIDI note or None for silence), each note a voice-like tone with
    harmonics and a little vibrato."""
    samples = []
    for seconds, note in parts:
        t = np.arange(int(seconds * rate)) / rate
        if note is None:
            samples.append(np.zeros_like(t))
            continue
        f0 = 440 * 2 ** ((note - 69) / 12) * (1 + 0.004 * np.sin(2 * np.pi * 5.5 * t))
        phase = 2 * np.pi * np.cumsum(f0) / rate
        tone = sum(np.sin(k * phase) / k for k in range(1, 6))
        ramp = np.minimum(1, np.minimum(t, t[-1] - t) / 0.02)
        samples.append(0.2 * tone * ramp)
    mono = np.concatenate(samples)
    out = io.BytesIO()
    with wave.open(out, 'wb') as writer:
        writer.setnchannels(2)
        writer.setsampwidth(2)
        writer.setframerate(rate)
        writer.writeframes((np.repeat(mono[:, None], 2, axis=1) * 32767).astype('<i2').tobytes())
    out.seek(0)
    return out


class MelodyTests(unittest.TestCase):
    def test_sung_notes_are_found_with_their_pitch_and_times(self):
        notes = melody(sung([(0.5, None), (1.0, 57), (0.3, None), (0.8, 60), (0.8, 64), (0.4, None), (1.2, 69), (0.5, None)]))
        self.assertEqual([note[2] for note in notes], [57, 60, 64, 69])
        expected = [(0.5, 1.5), (1.8, 2.6), (2.6, 3.4), (3.8, 5.0)]
        for (start, end, _), (want_start, want_end) in zip(notes, expected):
            self.assertAlmostEqual(start, want_start, delta=0.06)
            self.assertAlmostEqual(end, want_end, delta=0.06)

    def test_silence_and_noise_have_no_notes(self):
        self.assertEqual(melody(sung([(2.0, None)])), [])
        rng = np.random.default_rng(3)
        out = io.BytesIO()
        with wave.open(out, 'wb') as writer:
            writer.setnchannels(2)
            writer.setsampwidth(2)
            writer.setframerate(44100)
            writer.writeframes((rng.normal(0, 0.1, (44100 * 2, 2)) * 32767).astype('<i2').tobytes())
        out.seek(0)
        self.assertEqual(melody(out), [])

    def test_a_slip_an_octave_up_is_folded_back_into_the_note(self):
        signal = read_vocals(sung([(0.3, None), (1.0, 60), (0.06, 72), (1.0, 60), (0.3, None)]))
        track = midi_track(signal)
        voiced = track[~np.isnan(track)]
        self.assertTrue(np.all(np.abs(voiced - 60) < 1.5), voiced[np.abs(voiced - 60) >= 1.5])

    def test_decimation_keeps_the_pitch_and_the_length(self):
        signal = read_vocals(sung([(2.0, 69)]))
        self.assertEqual(len(signal), round(2.0 * RATE))
        track = midi_track(signal)
        self.assertAlmostEqual(float(np.nanmedian(track)), 69, delta=0.15)

    def test_only_the_studios_vocals_format_is_read(self):
        out = io.BytesIO()
        with wave.open(out, 'wb') as writer:
            writer.setnchannels(1)
            writer.setsampwidth(2)
            writer.setframerate(44100)
            writer.writeframes(b'\0\0' * 4410)
        out.seek(0)
        with self.assertRaises(ValueError):
            melody(out)

    def test_notes_are_validated_for_the_video(self):
        self.assertEqual(validate_notes([[0, 1, 60], [1.0, 2.5, 62]], 3), [[0.0, 1.0, 60], [1.0, 2.5, 62]])
        for notes in ([[1, 0.5, 60]], [[0, 1, 60], [0.5, 2, 62]], [[0, 1, 120]], [[0, 1, 60.5]], [[0, 4, 60]], [[0, 1]], 'x',
                      [[float('nan'), 1, 60]], [[0, 0.1, 60]] * (MAX_NOTES + 1)):
            with self.assertRaises(ValueError, msg=str(notes)[:60]):
                validate_notes(notes, 3)


if __name__ == '__main__':
    unittest.main()
