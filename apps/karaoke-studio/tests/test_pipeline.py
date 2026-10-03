from __future__ import annotations

import array
import hashlib
import os
from pathlib import Path
import struct
import shutil
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import wave

from karaoke import pipeline


def fixture_wav(path: Path, duration: float, sample_rate: int = 44100) -> None:
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(b'\0\0\0\0' * round(duration * sample_rate))


class PipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_model_ready_verifies_all_actual_files_and_rejects_corruption_or_symlinks(self) -> None:
        model = self.root / 'models' / '2stems'
        model.mkdir(parents=True)
        manifest = {name: hashlib.sha256(name.encode()).hexdigest() for name in pipeline.MODEL_FILES}
        for name in manifest:
            (model / name).write_bytes(name.encode())
        with patch.object(pipeline, 'MODEL_FILES', manifest):
            self.assertTrue(pipeline.model_ready(model.parent))
            (model / 'model.index').write_bytes(b'broken')
            self.assertFalse(pipeline.model_ready(model.parent))
            (model / 'model.index').unlink()
            target = self.root / 'index'
            target.write_bytes(b'model.index')
            (model / 'model.index').symlink_to(target)
            self.assertFalse(pipeline.model_ready(model.parent))
        self.assertFalse(pipeline.model_ready(self.root / 'missing'))

    def test_supported_magic_is_independent_of_upload_filename(self) -> None:
        signatures = [(b'RIFF\0\0\0\0WAVE', 'wav'), (b'ID3\0\0\0\0', 'mp3'), (b'\xff\xfb\x90\0', 'mp3'), (b'fLaC\0\0\0\0', 'flac'), (b'OggS\0\0\0\0', 'ogg')]
        source = self.root / 'input.audio'
        for signature, expected in signatures:
            source.write_bytes(signature)
            self.assertEqual(pipeline._input_format(source), expected)
        for signature in [b'#EXTM3U\nhttp://example.com', b'<!DOCTYPE html>', b'\xff\xf1\0\0', b'RIFF\0\0\0\0AVI ', b'']:
            source.write_bytes(signature)
            with self.assertRaisesRegex(ValueError, 'WAV|MP3|FLAC|Ogg'):
                pipeline._input_format(source)

    def test_oversized_input_is_rejected_before_reading_media_or_starting_tools(self) -> None:
        source = self.root / 'large.wav'
        with source.open('wb') as output:
            output.seek(pipeline.MAX_INPUT_BYTES)
            output.write(b'0')
        with patch.object(pipeline, '_run') as run:
            with self.assertRaisesRegex(ValueError, '20 MiB'):
                pipeline.separate_clip(source, self.root / 'out', self.root / 'models', threading.Event(), lambda _: None)
            run.assert_not_called()

    def test_pcm_source_preserves_channels_and_bounds_high_float_samples_without_wrapping(self) -> None:
        values = array.array('f', [0, 0.5, -1, 1, -2, 2])
        output = self.root / 'source.wav'
        metadata = pipeline._write_source(values, output)
        self.assertEqual(metadata['sourceGain'], 0.5)
        with wave.open(str(output), 'rb') as result:
            self.assertEqual((result.getnchannels(), result.getsampwidth(), result.getframerate()), (2, 2, 44100))
            pcm = struct.unpack('<6h', result.readframes(3))
        self.assertEqual(pcm, (0, 8192, -16384, 16384, -32768, 32767))
        for bad in [float('nan'), float('inf'), -float('inf')]:
            with self.assertRaisesRegex(ValueError, 'finite'):
                pipeline._write_source(array.array('f', [0, bad]), output)

    def test_real_ffprobe_rejects_clips_outside_duration_bounds_without_silent_truncation(self) -> None:
        for duration in [0.8, 30.1]:
            source = self.root / 'input.audio'
            fixture_wav(source, duration)
            with self.assertRaisesRegex(ValueError, '1.*30|30.*seconds'):
                pipeline.separate_clip(source, self.root / 'out', self.root / 'models', threading.Event(), lambda _: None)
        self.assertFalse((self.root / 'out' / 'source.wav').exists())

    def test_missing_model_fails_clearly_before_decoding_or_worker_start(self) -> None:
        source = self.root / 'input.audio'
        fixture_wav(source, 1)
        with self.assertRaisesRegex(RuntimeError, 'model|setup'):
            pipeline.separate_clip(source, self.root / 'out', self.root / 'models', threading.Event(), lambda _: None)
        self.assertFalse((self.root / 'out' / 'source.wav').exists())

    def test_already_cancelled_job_never_starts_a_subprocess(self) -> None:
        cancel = threading.Event()
        cancel.set()
        with patch.object(pipeline, '_run') as run:
            with self.assertRaisesRegex(RuntimeError, 'cancel'):
                pipeline.separate_clip(self.root / 'missing', self.root / 'out', self.root / 'models', cancel, lambda _: None)
            run.assert_not_called()

    def test_subprocess_stdout_and_stderr_are_bounded(self) -> None:
        for stream in ['stdout', 'stderr']:
            command = [sys.executable, '-c', f'import sys; sys.{stream}.buffer.write(b"x" * 100000); sys.{stream}.flush()']
            with self.assertRaisesRegex(RuntimeError, 'output limit'):
                pipeline._run(command, threading.Event(), timeout=2, stdout_limit=1000, stderr_limit=1000)

    def test_subprocess_timeout_kills_and_reaps_the_process(self) -> None:
        pid_file = self.root / 'pid'
        code = f'import os,time; from pathlib import Path; Path({str(pid_file)!r}).write_text(str(os.getpid())); time.sleep(20)'
        started = time.monotonic()
        with self.assertRaisesRegex(RuntimeError, 'timed out'):
            pipeline._run([sys.executable, '-c', code], threading.Event(), timeout=0.2)
        self.assertLess(time.monotonic() - started, 3)
        with self.assertRaises(ProcessLookupError):
            os.kill(int(pid_file.read_text()), 0)

    def test_subprocess_cancellation_kills_and_reaps_its_process_group(self) -> None:
        pid_file = self.root / 'pid'
        child_file = self.root / 'child'
        code = f'import os,time,subprocess,sys; from pathlib import Path; child=subprocess.Popen([sys.executable,"-c","import time; time.sleep(20)"]); Path({str(pid_file)!r}).write_text(str(os.getpid())); Path({str(child_file)!r}).write_text(str(child.pid)); time.sleep(20)'
        cancel = threading.Event()
        timer = threading.Timer(0.2, cancel.set)
        timer.start()
        try:
            with self.assertRaisesRegex(RuntimeError, 'cancel'):
                pipeline._run([sys.executable, '-c', code], cancel, timeout=5)
        finally:
            timer.cancel()
        with self.assertRaises(ProcessLookupError):
            os.kill(int(pid_file.read_text()), 0)
        child_status = Path(f'/proc/{child_file.read_text()}/stat')
        if child_status.exists():
            self.assertEqual(child_status.read_text().split()[2], 'Z')

    def test_false_duration_metadata_cannot_hide_oversized_decoded_audio(self) -> None:
        source = self.root / 'input.audio'
        fixture_wav(source, 1)
        with patch.object(pipeline, 'model_ready', return_value=True), patch.object(pipeline, '_probe', return_value=1), patch.object(pipeline, '_run', return_value=(b'\0' * (pipeline.MAX_DECODE_BYTES + 8), b'')):
            with self.assertRaisesRegex(ValueError, '30|duration'):
                pipeline.separate_clip(source, self.root / 'out', self.root / 'models', threading.Event(), lambda _: None)

    def test_cancellation_during_worker_removes_partial_outputs_and_preserves_uploaded_source(self) -> None:
        source = self.root / 'input.audio'
        fixture_wav(source, 1)
        original = source.read_bytes()
        actual_run = pipeline._run
        output_dir = self.root / 'out'

        def run(command, cancel, **options):
            if command[0] == sys.executable:
                (output_dir / 'vocals.wav.part').write_bytes(b'partial')
                cancel.set()
                raise RuntimeError('Media processing cancelled.')
            return actual_run(command, cancel, **options)

        with patch.object(pipeline, 'model_ready', return_value=True), patch.object(pipeline, '_run', side_effect=run):
            with self.assertRaisesRegex(RuntimeError, 'cancel'):
                pipeline.separate_clip(source, output_dir, self.root / 'models', threading.Event(), lambda _: None)
        self.assertEqual(source.read_bytes(), original)
        self.assertEqual(list(output_dir.iterdir()), [])

    def test_complete_decode_resamples_mono_48khz_to_exact_matching_canonical_outputs(self) -> None:
        source = self.root / 'input.audio'
        with wave.open(str(source), 'wb') as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(48000)
            audio.writeframes(struct.pack('<h', 8000) * 48000)
        actual_run = pipeline._run
        output_dir = self.root / 'out'

        def run(command, cancel, **options):
            if command[0] == sys.executable:
                for name in ['vocals.wav', 'backing.wav']:
                    shutil.copyfile(output_dir / 'source.wav', output_dir / name)
                (output_dir / 'processing.json').write_text('{}')
                return b'', b''
            return actual_run(command, cancel, **options)

        with patch.object(pipeline, 'model_ready', return_value=True), patch.object(pipeline, '_run', side_effect=run):
            duration = pipeline.separate_clip(source, output_dir, self.root / 'models', threading.Event(), lambda _: None)
        self.assertEqual(duration, 1)
        for name in ['source.wav', 'vocals.wav', 'backing.wav']:
            with wave.open(str(output_dir / name), 'rb') as audio:
                self.assertEqual((audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getnframes()), (2, 2, 44100, 44100))

    def test_nonfinite_float_wav_is_rejected_before_canonical_conversion_or_ai(self) -> None:
        source = self.root / 'input.audio'
        payload = struct.pack('<f', float('nan')) * 88200
        fmt = struct.pack('<HHIIHH', 3, 2, 44100, 44100 * 8, 8, 32)
        source.write_bytes(b'RIFF' + struct.pack('<I', 36 + len(payload)) + b'WAVEfmt ' + struct.pack('<I', len(fmt)) + fmt + b'data' + struct.pack('<I', len(payload)) + payload)
        with patch.object(pipeline, 'model_ready', return_value=True):
            with self.assertRaisesRegex(ValueError, 'finite'):
                pipeline.separate_clip(source, self.root / 'out', self.root / 'models', threading.Event(), lambda _: None)
        self.assertFalse((self.root / 'out' / 'source.wav').exists())

    def test_input_symlink_is_rejected_before_resolving_a_local_path(self) -> None:
        source = self.root / 'input.audio'
        target = self.root / 'actual.wav'
        fixture_wav(target, 1)
        source.symlink_to(target)
        with self.assertRaisesRegex(ValueError, 'local'):
            pipeline.separate_clip(source, self.root / 'out', self.root / 'models', threading.Event(), lambda _: None)

    @unittest.skipUnless(Path('/proc/self/status').exists(), 'Linux RSS enforcement')
    def test_subprocess_rss_limit_is_enforced(self) -> None:
        with self.assertRaisesRegex(RuntimeError, 'memory limit'):
            pipeline._run([sys.executable, '-c', 'import time; data=bytearray(10000000); time.sleep(10)'], threading.Event(), timeout=2, rss_limit_kib=1)

    def test_explicit_model_setup_rejects_corrupt_archive_without_publishing_files(self) -> None:
        from scripts.setup_model import setup_model
        archive = self.root / 'wrong.tar.gz'
        archive.write_bytes(b'corrupt archive')
        model_root = self.root / 'model-cache'
        with self.assertRaisesRegex(RuntimeError, 'SHA256|pinned'):
            setup_model(model_root, archive)
        self.assertEqual(list(model_root.iterdir()), [])

    def test_exact_thirty_second_compressed_clips_allow_encoder_padding_in_probe_metadata(self) -> None:
        original = self.root / 'original.wav'
        fixture_wav(original, 30)
        for format_name, codec in [('mp3', 'libmp3lame'), ('ogg', 'libopus')]:
            compressed = self.root / f'input.{format_name}'
            pipeline._run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', str(original), '-c:a', codec, str(compressed)], threading.Event(), timeout=10)
            self.assertGreaterEqual(pipeline._probe(compressed, format_name, threading.Event()), 30)


if __name__ == '__main__':
    unittest.main()
