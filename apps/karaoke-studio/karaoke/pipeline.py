"""Bounded audio decoding and killable offline inference; no ML imports here."""
from __future__ import annotations

import array
from collections.abc import Callable
import hashlib
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
import wave

from .media_io import media_handles

MODEL_FILES = {
    'checkpoint': '011c96b970c1f56137037924fe1a0f0851369b0ee6692e120aea798615326f48',
    'model.data-00000-of-00001': '7747f9fd2c782306dbec1504360fbb645a097a48446f23486c3ff9c89bc11788',
    'model.index': '55661a09f79c86071fc7077b44b4cf1f01b6d82bbbb83ed94cb68a2f9944e378',
    'model.meta': '6e1f6d86a22bb452a58cb20e3de87b416f8a79e626ca223e20f763ab2d21ec95',
}
SAMPLE_RATE = 44100
MAX_INPUT_BYTES = 20 * 1024 * 1024
MAX_DECODE_BYTES = 30 * SAMPLE_RATE * 2 * 4
MAX_WORKER_RSS_KIB = 3 * 1024 * 1024
MODEL_SHA256 = 'f3a90b39dd2874269e8b05a48a86745df897b848c61f3958efc80a39152bd692'


def model_ready(model_root: Path) -> bool:
    directory = Path(model_root) / '2stems'
    try:
        for name, expected in MODEL_FILES.items():
            path = directory / name
            if path.is_symlink() or not path.is_file() or path.stat().st_size > 80000000:
                return False
            digest = hashlib.sha256()
            with path.open('rb') as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(chunk)
            if digest.hexdigest() != expected:
                return False
        return True
    except OSError:
        return False


def _check_cancel(cancel: threading.Event) -> None:
    if cancel.is_set():
        raise RuntimeError('Media processing cancelled.')


def _terminate(process: subprocess.Popen) -> None:
    try:
        if os.name == 'posix':
            os.killpg(process.pid, signal.SIGKILL)
        elif process.poll() is None:
            process.kill()
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def _rss_kib(pid: int) -> int:
    try:
        for line in Path(f'/proc/{pid}/status').read_text().splitlines():
            if line.startswith('VmRSS:'):
                return int(line.split()[1])
    except (OSError, ValueError):
        pass
    return 0


def _run(command: list[str], cancel: threading.Event, *, timeout: float = 10,
         stdout_limit: int = 65536, stderr_limit: int = 65536,
         rss_limit_kib: int | None = 512 * 1024) -> tuple[bytes, bytes]:
    _check_cancel(cancel)
    try:
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, start_new_session=os.name == 'posix',
                                   pass_fds=media_handles())
    except FileNotFoundError as error:
        raise RuntimeError(f'Required executable {command[0]} is unavailable. Install FFmpeg and the documented Python environment.') from error
    buffers = [bytearray(), bytearray()]
    overflow = threading.Event()

    def collect(stream, index: int, limit: int) -> None:
        try:
            while chunk := stream.read(8192):
                if len(buffers[index]) + len(chunk) > limit:
                    overflow.set()
                    return
                buffers[index].extend(chunk)
        finally:
            stream.close()

    readers = [threading.Thread(target=collect, args=(process.stdout, 0, stdout_limit), daemon=True),
               threading.Thread(target=collect, args=(process.stderr, 1, stderr_limit), daemon=True)]
    for reader in readers:
        reader.start()
    started = time.monotonic()
    completed = False
    try:
        while process.poll() is None:
            _check_cancel(cancel)
            if overflow.is_set():
                raise RuntimeError('Media subprocess exceeded its output limit.')
            if time.monotonic() - started > timeout:
                raise RuntimeError('Media subprocess timed out.')
            if rss_limit_kib is not None and _rss_kib(process.pid) > rss_limit_kib:
                raise RuntimeError('AI separation exceeded its memory limit.')
            cancel.wait(0.02)
        for reader in readers:
            reader.join(timeout=0.5)
        if any(reader.is_alive() for reader in readers):
            _terminate(process)
            for reader in readers:
                reader.join(timeout=1)
        _check_cancel(cancel)
        if overflow.is_set():
            raise RuntimeError('Media subprocess exceeded its output limit.')
        if process.returncode != 0:
            detail = bytes(buffers[1]).decode('utf-8', errors='replace').strip()[-1200:]
            raise RuntimeError(f'Media processing failed. {detail or "The subprocess exited unsuccessfully."}')
        completed = True
        return bytes(buffers[0]), bytes(buffers[1])
    finally:
        if not completed or process.poll() is None:
            _terminate(process)
        for reader in readers:
            reader.join(timeout=1)


def _input_format(source: Path) -> str:
    if not source.is_file() or source.is_symlink():
        raise ValueError('Choose a local WAV, MP3, FLAC, or Ogg audio clip.')
    if source.stat().st_size > MAX_INPUT_BYTES:
        raise ValueError('Audio uploads must be at most 20 MiB.')
    with source.open('rb') as stream:
        header = stream.read(12)
    if header[:4] == b'RIFF' and header[8:12] == b'WAVE':
        return 'wav'
    if header.startswith(b'ID3') or (len(header) >= 2 and header[0] == 0xff and header[1] & 0xe0 == 0xe0 and (header[1] >> 1) & 3 == 1 and (header[1] >> 3) & 3 != 1):
        return 'mp3'
    if header.startswith(b'fLaC'):
        return 'flac'
    if header.startswith(b'OggS'):
        return 'ogg'
    raise ValueError('Choose a supported WAV, MP3, FLAC, or Ogg audio clip; playlists and remote URLs are unsupported.')


def _probe(source: Path, input_format: str, cancel: threading.Event) -> float:
    output, _ = _run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file',
                      '-format_whitelist', 'wav,mp3,flac,ogg', '-show_entries',
                      'format=format_name,duration:stream=codec_type,codec_name,duration,sample_rate,channels:stream_disposition=attached_pic',
                      '-of', 'json', str(source)], cancel, timeout=10)
    try:
        probe = json.loads(output)
        if probe['format']['format_name'] != input_format:
            raise ValueError('The audio container does not match its supported signature.')
        streams = probe['streams']
        audio = [stream for stream in streams if stream.get('codec_type') == 'audio']
        if not audio or len(streams) > 8:
            raise ValueError('The clip must contain an audio stream and at most eight streams.')
        if any(stream.get('codec_type') != 'audio' and not stream.get('disposition', {}).get('attached_pic') for stream in streams):
            raise ValueError('Import an audio-only clip in WAV, MP3, FLAC, or Ogg format.')
        selected = audio[0]
        rate = int(selected.get('sample_rate', 0))
        channels = int(selected.get('channels', 0))
        if not 8000 <= rate <= 192000 or not 1 <= channels <= 8:
            raise ValueError('Audio must use 8–192 kHz sampling and one to eight channels.')
        duration = float(selected.get('duration', probe['format'].get('duration', 'nan')))
    except (KeyError, TypeError, json.JSONDecodeError) as error:
        raise ValueError('The audio header is invalid or its duration could not be read.') from error
    # MP3/Opus container lengths include encoder delay/padding. Decoded frames
    # remain strictly capped at 30 seconds; this never truncates actual audio.
    maximum_probe_duration = 30.2 if input_format in {'mp3', 'ogg'} else 30
    if not math.isfinite(duration) or not 1 <= duration <= maximum_probe_duration:
        raise ValueError('Choose an audio clip lasting 1–30 seconds. Longer clips are not silently trimmed.')
    return duration


def _write_source(samples: array.array, output: Path) -> dict:
    if any(not math.isfinite(sample) for sample in samples):
        raise ValueError('Decoded audio must contain only finite samples.')
    peak = max((abs(sample) for sample in samples), default=0)
    gain = 1 / peak if peak > 1 else 1
    pcm = array.array('h', (max(-32768, min(32767, round(sample * gain * 32768))) for sample in samples))
    if sys.byteorder != 'little':
        pcm.byteswap()
    temporary = output.with_suffix(output.suffix + '.part')
    with wave.open(str(temporary), 'wb') as result:
        result.setnchannels(2)
        result.setsampwidth(2)
        result.setframerate(SAMPLE_RATE)
        result.writeframes(pcm.tobytes())
    temporary.replace(output)
    return {'sourcePeak': peak, 'sourceGain': gain}


def _validate_output(path: Path, frame_count: int) -> None:
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 30 * SAMPLE_RATE * 4 + 4096:
        raise RuntimeError('AI separation did not produce bounded audio files.')
    with wave.open(str(path), 'rb') as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getnframes()) != (2, 2, SAMPLE_RATE, frame_count):
            raise RuntimeError('AI separation did not preserve the decoded audio duration or format.')
        if len(audio.readframes(frame_count)) != frame_count * 4:
            raise RuntimeError('AI separation produced truncated audio.')


def separate_clip(source: Path, output_dir: Path, model_root: Path, cancel: threading.Event,
                  stage: Callable[[str], None]) -> float:
    _check_cancel(cancel)
    source = Path(source)
    output_dir = Path(output_dir)
    model_root = Path(model_root).resolve()
    input_format = _input_format(source)
    # Keep a caller's owned-directory handle path intact across subprocesses.
    source = source.absolute()
    stage('Checking audio format and duration')
    _probe(source, input_format, cancel)
    if not model_ready(model_root):
        raise RuntimeError('The verified Spleeter two-stem model is unavailable. Run scripts/setup_model.py before starting a separation job.')
    output_dir.mkdir(parents=True, exist_ok=True)
    outputs = [output_dir / name for name in ['source.wav', 'vocals.wav', 'backing.wav', 'processing.json']]
    if any(path.exists() for path in outputs):
        raise ValueError('The generated output directory already contains media; existing audio will not be overwritten.')
    try:
        stage('Decoding the complete audio clip')
        decoded, _ = _run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error',
                           '-protocol_whitelist', 'file', '-format_whitelist', 'wav,mp3,flac,ogg',
                           '-i', str(source), '-map', '0:a:0', '-vn', '-sn', '-dn',
                           '-ar', str(SAMPLE_RATE), '-ac', '2', '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'],
                          cancel, timeout=30, stdout_limit=MAX_DECODE_BYTES + 8)
        if not decoded or len(decoded) % 8 or len(decoded) > MAX_DECODE_BYTES:
            raise ValueError('Decoded audio must last 1–30 seconds and contain complete stereo frames.')
        samples = array.array('f')
        samples.frombytes(decoded)
        if sys.byteorder != 'little':
            samples.byteswap()
        frame_count = len(samples) // 2
        duration = frame_count / SAMPLE_RATE
        if not 1 <= duration <= 30:
            raise ValueError('Decoded audio must last 1–30 seconds. Longer clips are not silently trimmed.')
        _check_cancel(cancel)
        source_metadata = _write_source(samples, outputs[0])
        del samples, decoded
        stage('Estimating vocals and backing locally with Spleeter AI')
        _run([sys.executable, str(Path(__file__).with_name('worker.py')), '--source', str(outputs[0]),
              '--output-dir', str(output_dir), '--model-root', str(model_root)],
             cancel, timeout=120, stderr_limit=256 * 1024, rss_limit_kib=MAX_WORKER_RSS_KIB)
        stage('Checking matching stem durations and WAV exports')
        _check_cancel(cancel)
        for path in outputs[:3]:
            _validate_output(path, frame_count)
        metadata = json.loads(outputs[3].read_text())
        metadata.update(source_metadata)
        temporary = outputs[3].with_suffix('.json.part')
        temporary.write_text(json.dumps(metadata, indent=2) + '\n')
        temporary.replace(outputs[3])
        return duration
    except BaseException:
        for path in outputs:
            path.unlink(missing_ok=True)
            path.with_suffix(path.suffix + '.part').unlink(missing_ok=True)
        raise
