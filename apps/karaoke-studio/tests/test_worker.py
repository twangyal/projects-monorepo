from __future__ import annotations

import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import wave

from karaoke import worker
from karaoke.limits import WORKER_CPU_HARD, WORKER_CPU_SOFT, WORKER_FILE_BYTES


def source_wav(path: Path, frames: int):
    with wave.open(str(path), 'wb') as audio:
        audio.setnchannels(2)
        audio.setsampwidth(2)
        audio.setframerate(44100)
        block = struct.pack('<hh', 1000, -1000)
        for start in range(0, frames, 16384):
            audio.writeframesraw(block * min(16384, frames - start))


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source = self.root / 'source.wav'

    def tearDown(self):
        self.temporary.cleanup()

    def test_sequential_windows_report_actual_completion_and_late_peak_scales_complete_stems(self):
        frames = 30 * 44100 + 1
        source_wav(self.source, frames)
        calls = []
        progress = []

        def predict(raw, count):
            self.assertEqual(len(raw), count * 4)
            self.assertEqual(raw[:4], struct.pack('<hh', 1000, -1000))
            calls.append(count)
            value = 0.25 if len(calls) == 1 else 2.0
            backing = 0.5 if len(calls) == 1 else -0.75
            return struct.pack('<ff', value, -value) * count, struct.pack('<ff', backing, -backing) * count

        metadata = worker.separate_windows(self.source, self.root, predict, progress.append)
        self.assertEqual(calls, [1323000, 88201])
        self.assertEqual(progress, [{'type': 'progress', 'completedWindows': count, 'windowCount': 2} for count in [0, 1, 2]])
        self.assertEqual(metadata['frameCount'], frames)
        self.assertEqual(metadata['windowRanges'], [{'start': 0, 'frames': 1323000}, {'start': 1234800, 'frames': 88201}])
        self.assertEqual(metadata['stemPeak'], 2)
        self.assertEqual(metadata['stemGain'], 0.5)
        for name, first, last in [('vocals.wav', (4096, -4096), (32767, -32768)), ('backing.wav', (8192, -8192), (-12288, 12288))]:
            with wave.open(str(self.root / name), 'rb') as audio:
                self.assertEqual(audio.getnframes(), frames)
                self.assertEqual(struct.unpack('<hh', audio.readframes(1)), first)
                audio.setpos(frames - 1)
                self.assertEqual(struct.unpack('<hh', audio.readframes(1)), last)
        self.assertTrue(self.source.exists())
        self.assertEqual(sorted(path.name for path in self.root.iterdir()), ['backing.wav', 'source.wav', 'vocals.wav'])

    def test_bad_prediction_shape_or_nonfinite_samples_cleans_scratch_and_preserves_source(self):
        source_wav(self.source, 44100)
        original = self.source.read_bytes()
        for mode in ['shape', 'missing', 'nonfinite']:
            def predict(_raw, frames):
                if mode == 'missing':
                    return (b'0',)
                vocal = struct.pack('<ff', 0, 0) * frames
                if mode == 'shape':
                    return vocal[:-8], vocal
                return struct.pack('<f', float('nan')) + vocal[4:], vocal

            with self.assertRaises((ValueError, RuntimeError)):
                worker.separate_windows(self.source, self.root, predict)
            self.assertEqual(self.source.read_bytes(), original)
            self.assertEqual([path.name for path in self.root.iterdir()], ['source.wav'])

    def test_existing_fixed_outputs_and_partials_are_never_removed(self):
        source_wav(self.source, 44100)
        for name in ['vocals.f32', 'backing.f32.part', 'vocals.wav.part', 'processing.json']:
            marker = self.root / name
            marker.write_bytes(b'previous')
            with self.assertRaises(ValueError):
                worker.separate_windows(self.source, self.root, lambda _raw, _frames: self.fail('prediction started'))
            self.assertEqual(marker.read_bytes(), b'previous')
            marker.unlink()

    def test_invalid_or_truncated_canonical_source_never_reaches_prediction(self):
        source_wav(self.source, 44100)
        self.source.write_bytes(self.source.read_bytes()[:-4])
        with self.assertRaises(ValueError):
            worker.separate_windows(self.source, self.root, lambda _raw, _frames: self.fail('prediction started'))
        self.assertEqual([path.name for path in self.root.iterdir()], ['source.wav'])
        source_wav(self.source, 44099)
        with self.assertRaises(ValueError):
            worker.separate_windows(self.source, self.root, lambda _raw, _frames: self.fail('prediction started'))

    def test_runtime_configuration_uses_agreed_limits_and_bounded_threads(self):
        with patch.object(worker.resource, 'setrlimit') as limits, patch.dict(os.environ):
            worker.configure_runtime(self.root)
            self.assertEqual(limits.call_args_list[0].args, (worker.resource.RLIMIT_CPU, (WORKER_CPU_SOFT, WORKER_CPU_HARD)))
            self.assertEqual(limits.call_args_list[1].args, (worker.resource.RLIMIT_FSIZE, (WORKER_FILE_BYTES, WORKER_FILE_BYTES)))
            self.assertEqual(os.environ['TF_NUM_INTRAOP_THREADS'], '3')
            self.assertEqual(os.environ['TF_NUM_INTEROP_THREADS'], '1')
            self.assertEqual(os.environ['OPENBLAS_NUM_THREADS'], '1')
            self.assertEqual(os.environ['CUDA_VISIBLE_DEVICES'], '-1')


if __name__ == '__main__':
    unittest.main()
