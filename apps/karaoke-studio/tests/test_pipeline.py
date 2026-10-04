from __future__ import annotations

import array
import hashlib
import io
import json
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
            with self.assertRaisesRegex(ValueError, '64 MiB'):
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
        for duration in [0.8, 300.1]:
            source = self.root / 'input.audio'
            fixture_wav(source, duration)
            with self.assertRaisesRegex(ValueError, '1.*300|300.*seconds'):
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
        def run(command, cancel, **options):
            if command[0] == 'ffmpeg':
                options['stdout_sink'].truncate(pipeline.MAX_DECODE_BYTES + 8)
            return b'', b''
        with patch.object(pipeline, 'model_ready', return_value=True), patch.object(pipeline, '_probe', return_value=1), patch.object(pipeline, '_run', side_effect=run):
            with self.assertRaisesRegex(ValueError, '300|duration'):
                pipeline.separate_clip(source, self.root / 'out', self.root / 'models', threading.Event(), lambda _: None)
        self.assertEqual(list((self.root / 'out').iterdir()), [])

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

    def test_shared_full_song_limits_are_exact_and_probe_padding_never_changes_decode_bound(self) -> None:
        self.assertEqual(pipeline.MAX_INPUT_BYTES, 64 * 1024 * 1024)
        self.assertEqual(pipeline.MAX_DECODE_BYTES, 300 * 44100 * 8)
        value = {'format': {'format_name': 'mp3', 'duration': '300.15'}, 'streams': [
            {'codec_type': 'audio', 'sample_rate': '44100', 'channels': 2}]}
        with patch.object(pipeline, '_run', side_effect=lambda *_args, **_options: (json.dumps(value).encode(), b'')):
            self.assertEqual(pipeline._probe(self.root / 'source.mp3', 'mp3', threading.Event()), 300.15)
            value['format']['duration'] = '300.201'
            with self.assertRaisesRegex(ValueError, '300'):
                pipeline._probe(self.root / 'source.mp3', 'mp3', threading.Event())

    def test_subprocess_stream_sink_does_not_duplicate_stdout_and_honors_byte_bound(self) -> None:
        code = 'import sys; sys.stdout.buffer.write(b"x"*100000); sys.stdout.flush()'
        with io.BytesIO() as sink:
            output, _ = pipeline._run([sys.executable, '-c', code], threading.Event(),
                                      stdout_sink=sink, stdout_limit=100000)
            self.assertEqual(output, b'')
            self.assertEqual(sink.getvalue(), b'x' * 100000)
        with io.BytesIO() as sink:
            with self.assertRaisesRegex(RuntimeError, 'output limit'):
                pipeline._run([sys.executable, '-c', code], threading.Event(),
                              stdout_sink=sink, stdout_limit=99999)
            self.assertLessEqual(len(sink.getvalue()), 99999)

    def test_bounded_stdout_records_arrive_during_process_and_callback_failure_reaps_it(self) -> None:
        lines = []
        code = 'import sys,time; print("first",flush=True);time.sleep(.1);print("second",flush=True)'
        pipeline._run([sys.executable, '-c', code], threading.Event(), stdout_line_callback=lines.append)
        self.assertEqual(lines, [b'first', b'second'])
        def invalid(_line):
            raise ValueError('Private fixture detail')
        started = time.monotonic()
        with self.assertRaisesRegex(RuntimeError, 'progress') as failure:
            pipeline._run([sys.executable, '-c', 'import time;print("bad",flush=True);time.sleep(10)'],
                          threading.Event(), stdout_line_callback=invalid)
        self.assertLess(time.monotonic() - started, 2)
        self.assertNotIn('Private fixture', str(failure.exception))

    def test_cancelled_source_conversion_preserves_previous_output(self) -> None:
        output = self.root / 'source.wav'
        fixture_wav(output, 1)
        previous = output.read_bytes()
        cancel = threading.Event()
        cancel.set()
        with self.assertRaisesRegex(RuntimeError, 'cancel'):
            pipeline._write_source(array.array('f', [0, .25]), output, cancel)
        self.assertEqual(output.read_bytes(), previous)
        self.assertFalse(output.with_suffix('.wav.part').exists())

    def test_five_minute_complete_decode_is_streamed_and_exact_frames_survive_fake_inference(self) -> None:
        source = self.root / 'input.audio'
        fixture_wav(source, 300)
        output_dir = self.root / 'out'
        actual = pipeline._run
        observed = {}
        def run(command, cancel, **options):
            if command[0] == sys.executable:
                observed.update(options)
                self.assertFalse((output_dir / 'decoded.f32').exists())
                for name in ['vocals.wav', 'backing.wav']:
                    shutil.copyfile(output_dir / 'source.wav', output_dir / name)
                (output_dir / 'processing.json').write_text('{}')
                return b'', b''
            if command[0] == 'ffmpeg':
                self.assertIn('stdout_sink', options)
                self.assertEqual(options['timeout'], 60)
            return actual(command, cancel, **options)
        with patch.object(pipeline, 'model_ready', return_value=True), patch.object(pipeline, '_run', side_effect=run):
            duration = pipeline.separate_clip(source, output_dir, self.root / 'models', threading.Event(), lambda _: None)
        self.assertEqual(duration, 300)
        self.assertEqual(observed['timeout'], 600)
        self.assertEqual(observed['rss_limit_kib'], 3 * 1024 * 1024)
        for name in ['source.wav', 'vocals.wav', 'backing.wav']:
            with wave.open(str(output_dir / name), 'rb') as audio:
                self.assertEqual(audio.getnframes(), 13_230_000)

    def test_reported_transient_rss_peak_and_oversized_metadata_cannot_publish_and_clean_scratch(self) -> None:
        source = self.root / 'input.audio'
        fixture_wav(source, 1)
        output_dir = self.root / 'out'
        actual = pipeline._run
        for metadata in [json.dumps({'peakRssKiB': 3 * 1024 * 1024 + 1}), 'x' * 65537,
                         '{"stemPeak":NaN}', '{"stemPeak":1e999}']:
            def run(command, cancel, **options):
                if command[0] == sys.executable:
                    for name in ['vocals.wav', 'backing.wav']:
                        shutil.copyfile(output_dir / 'source.wav', output_dir / name)
                    for name in ['vocals.f32', 'backing.f32.part']:
                        (output_dir / name).write_bytes(b'partial')
                    (output_dir / 'processing.json').write_text(metadata)
                    return b'', b''
                return actual(command, cancel, **options)
            with patch.object(pipeline, 'model_ready', return_value=True), patch.object(pipeline, '_run', side_effect=run):
                with self.assertRaisesRegex(RuntimeError, 'memory|metadata|provenance'):
                    pipeline.separate_clip(source, output_dir, self.root / 'models', threading.Event(), lambda _: None)
            self.assertEqual(list(output_dir.iterdir()), [])

    def test_existing_scratch_or_dangling_partial_symlink_is_rejected_without_removal(self) -> None:
        source = self.root / 'input.audio'
        fixture_wav(source, 1)
        output_dir = self.root / 'out'
        output_dir.mkdir()
        scratch = output_dir / 'decoded.f32'
        scratch.write_bytes(b'Existing content')
        with patch.object(pipeline, 'model_ready', return_value=True):
            with self.assertRaisesRegex(ValueError, 'already contains'):
                pipeline.separate_clip(source, output_dir, self.root / 'models', threading.Event(), lambda _: None)
        self.assertEqual(scratch.read_bytes(), b'Existing content')
        scratch.unlink()
        partial = output_dir / 'backing.f32.part'
        partial.symlink_to(self.root / 'missing-target')
        with patch.object(pipeline, 'model_ready', return_value=True):
            with self.assertRaisesRegex(ValueError, 'already contains'):
                pipeline.separate_clip(source, output_dir, self.root / 'models', threading.Event(), lambda _: None)
        self.assertTrue(partial.is_symlink())

    def test_window_progress_is_sequential_bounded_and_later_window_cancellation_cleans_everything(self) -> None:
        source = self.root / 'input.audio'
        fixture_wav(source, 31)
        output_dir = self.root / 'out'
        actual = pipeline._run
        for records, cancel_after in [([0, 1, 2], None), ([0, 2], None), ([0, 1, 2], 1)]:
            cancel = threading.Event()
            stages = []
            def stage(value):
                stages.append(value)
                if cancel_after is not None and f'window {cancel_after} of' in value:
                    cancel.set()
            def run(command, event, **options):
                if command[0] == sys.executable:
                    for name in ['vocals.wav', 'backing.wav']:
                        shutil.copyfile(output_dir / 'source.wav', output_dir / name)
                    (output_dir / 'processing.json').write_text('{}')
                    for value in records:
                        options['stdout_line_callback'](json.dumps({'type': 'progress', 'completedWindows': value, 'windowCount': 2}).encode())
                    return b'', b''
                return actual(command, event, **options)
            with patch.object(pipeline, 'model_ready', return_value=True), patch.object(pipeline, '_run', side_effect=run):
                if records == [0, 1, 2] and cancel_after is None:
                    self.assertEqual(pipeline.separate_clip(source, output_dir, self.root / 'models', cancel, stage), 31)
                    self.assertTrue(any('window 2 of 2' in value for value in stages))
                    for path in output_dir.iterdir():
                        path.unlink()
                else:
                    with self.assertRaisesRegex((ValueError, RuntimeError), 'progress|cancel'):
                        pipeline.separate_clip(source, output_dir, self.root / 'models', cancel, stage)
                    self.assertEqual(list(output_dir.iterdir()), [])

    @unittest.skipUnless(Path('/proc/self/fd').exists(), 'Linux retained descriptors')
    def test_output_directory_rebinding_cannot_redirect_decode_or_cleanup(self) -> None:
        source = self.root / 'input.audio'
        fixture_wav(source, 1)
        output_dir = self.root / 'out'
        held = self.root / 'held'
        unrelated = self.root / 'unrelated'
        unrelated.mkdir()
        sentinel = unrelated / 'decoded.f32'
        sentinel.write_bytes(b'Leave existing unrelated data intact')
        actual = pipeline._run
        def run(command, event, **options):
            if command[0] == 'ffmpeg':
                output_dir.rename(held)
                output_dir.symlink_to(unrelated, target_is_directory=True)
            if command[0] == sys.executable:
                target = Path(command[command.index('--output-dir') + 1])
                (target / 'vocals.f32').write_bytes(b'partial')
                raise RuntimeError('Controlled worker failure')
            return actual(command, event, **options)
        with patch.object(pipeline, 'model_ready', return_value=True), patch.object(pipeline, '_run', side_effect=run):
            with self.assertRaisesRegex(RuntimeError, 'Controlled'):
                pipeline.separate_clip(source, output_dir, self.root / 'models', threading.Event(), lambda _: None)
        self.assertEqual(list(held.iterdir()), [])
        self.assertEqual(sentinel.read_bytes(), b'Leave existing unrelated data intact')

    def test_smoke_synthetic_is_original_exact_length_and_writes_bounded_blocks(self) -> None:
        from scripts.smoke_model import synthetic
        output = self.root / 'synthetic.wav'
        writes = []
        original = wave.Wave_write.writeframes
        def write(audio, data):
            writes.append(len(data))
            return original(audio, data)
        with patch.object(wave.Wave_write, 'writeframes', write):
            synthetic(output, 1 + 1 / 44100)
        self.assertLessEqual(max(writes), 65536)
        with wave.open(str(output), 'rb') as audio:
            self.assertEqual(audio.getnframes(), 44101)
            self.assertTrue(any(audio.readframes(1000)))


if __name__ == '__main__':
    unittest.main()
