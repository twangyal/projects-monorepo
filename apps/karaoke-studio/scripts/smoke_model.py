"""Real-model smoke, distinct from fast tests with fake service callbacks.

Synthetic audio is original mathematical audio. Optional official singing
example: https://raw.githubusercontent.com/deezer/spleeter/master/audio_example.mp3
Slow Motion Dream by Steven M Bryant (2011), Ft CSoul/Alex Beroza/Robert Siekawitch,
CC BY 3.0, http://dig.ccmixter.org/files/stevieb357/34740 . The smoke excerpt and
estimated stems are adaptations; preserve attribution if redistributed.
"""
from __future__ import annotations

import argparse
import array
import importlib.metadata
import json
import math
from pathlib import Path
import sys
import threading
import time
import uuid
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from karaoke.pipeline import SAMPLE_RATE, _run, separate_clip  # noqa: E402
from karaoke.limits import MAX_DURATION, MAX_WORKER_RSS_KIB  # noqa: E402


def synthetic(path: Path, seconds: float) -> None:
    if not math.isfinite(seconds) or not 1 <= seconds <= MAX_DURATION:
        raise ValueError('Synthetic audio must last 1–300 seconds.')
    phase = 0.0
    frames = round(seconds * SAMPLE_RATE)
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        for start in range(0, frames, 16384):
            samples = array.array('h')
            for index in range(start, min(start + 16384, frames)):
                moment = index / SAMPLE_RATE
                hz = 220 + 24 * math.sin(2 * math.pi * 0.3 * moment)
                phase += 2 * math.pi * hz / SAMPLE_RATE
                envelope = max(0, math.sin(2 * math.pi * 1.4 * moment)) ** 2
                voice = envelope * (0.21 * math.sin(phase) + 0.08 * math.sin(phase * 2) + 0.035 * math.sin(phase * 3))
                backing = 0.12 * math.sin(2 * math.pi * 110 * moment) + sum(0.045 * math.sin(2 * math.pi * frequency * moment) for frequency in [261.6256, 329.6276, 391.9954])
                samples.extend([round((voice + backing) * 32768), round((voice + 0.85 * backing) * 32768)])
            if sys.byteorder != 'little':
                samples.byteswap()
            output.writeframes(samples.tobytes())


def check_outputs(directory: Path, frames: int) -> dict[str, int]:
    """Check actual published PCM in bounded blocks, including stem difference."""
    peaks = {}
    for name in ['source', 'vocals', 'backing']:
        peak = 0
        with wave.open(str(directory / f'{name}.wav'), 'rb') as audio:
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getnframes()) != (2, 2, SAMPLE_RATE, frames):
                raise RuntimeError(f'{name} has mismatched PCM duration or format.')
            remaining = frames
            while remaining:
                count = min(remaining, 16384)
                raw = audio.readframes(count)
                if len(raw) != count * 4:
                    raise RuntimeError(f'{name} has truncated PCM.')
                samples = array.array('h')
                samples.frombytes(raw)
                if sys.byteorder != 'little':
                    samples.byteswap()
                peak = max(peak, max(abs(value) for value in samples))
                remaining -= count
        if not peak:
            raise RuntimeError(f'{name} unexpectedly silent.')
        peaks[name] = peak
    different = False
    with wave.open(str(directory / 'vocals.wav'), 'rb') as vocals, wave.open(str(directory / 'backing.wav'), 'rb') as backing:
        for _start in range(0, frames, 16384):
            different |= vocals.readframes(16384) != backing.readframes(16384)
    if not different:
        raise RuntimeError('Estimated vocals and backing are identical.')
    return peaks


def disk_bytes(directory: Path) -> int:
    total = 0
    for path in directory.rglob('*'):
        try:
            if path.is_file() and not path.is_symlink():
                total += path.stat().st_size
        except FileNotFoundError:
            pass  # A generated scratch file was atomically replaced/removed.
    return total


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-dir', type=Path, required=True)
    parser.add_argument('--work-dir', type=Path, required=True, help='Generated smoke media/reports directory outside Git')
    parser.add_argument('--seconds', type=float, default=10)
    parser.add_argument('--cancel-after-window', type=int, help='Exercise cancellation after a completed inference window')
    parser.add_argument('--licensed-sample', type=Path, help='Optional local official CC BY 3.0 audio_example.mp3')
    args = parser.parse_args()
    if not math.isfinite(args.seconds) or not 1 <= args.seconds <= MAX_DURATION:
        parser.error('--seconds must be 1–300')
    if args.cancel_after_window is not None and not 1 <= args.cancel_after_window <= 11:
        parser.error('--cancel-after-window must be 1–11')
    directory = args.work_dir / uuid.uuid4().hex
    directory.mkdir(parents=True)
    source = directory / 'input.wav'
    if args.licensed_sample:
        _run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file',
              '-format_whitelist', 'mp3', '-i', str(args.licensed_sample.resolve()), '-t', str(args.seconds),
              '-ar', str(SAMPLE_RATE), '-ac', '2', '-c:a', 'pcm_s16le', str(source)], threading.Event(), timeout=60)
    else:
        synthetic(source, args.seconds)
    started = time.perf_counter()
    cancel = threading.Event()
    sampling_done = threading.Event()
    peak_disk_bytes = disk_bytes(directory)
    stage_times = []

    def sample_disk():
        nonlocal peak_disk_bytes
        while not sampling_done.wait(.01):
            peak_disk_bytes = max(peak_disk_bytes, disk_bytes(directory))

    def stage(value: str):
        nonlocal peak_disk_bytes
        stage_times.append({'stage': value, 'elapsedSeconds': time.perf_counter() - started})
        peak_disk_bytes = max(peak_disk_bytes, disk_bytes(directory))
        print(value, flush=True)
        if args.cancel_after_window is not None and f'window {args.cancel_after_window} of' in value:
            cancel.set()

    sampler = threading.Thread(target=sample_disk, daemon=True)
    sampler.start()
    try:
        duration = separate_clip(source, directory, args.model_dir, cancel, stage)
    except RuntimeError as error:
        if not cancel.is_set() or 'cancel' not in str(error).lower():
            raise
        leftovers = sorted(path.name for path in directory.iterdir() if path != source)
        if leftovers:
            raise RuntimeError('Cancelled smoke left generated media or scratch files.') from error
        report = {'cancelled': True, 'secondsRequested': args.seconds,
                  'cancelAfterWindow': args.cancel_after_window,
                  'elapsedSeconds': time.perf_counter() - started,
                  'sampledPeakDiskBytes': peak_disk_bytes, 'stages': stage_times}
        (directory / 'smoke-report.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report, indent=2), flush=True)
        return
    finally:
        sampling_done.set()
        sampler.join(timeout=2)
    if args.cancel_after_window is not None:
        raise RuntimeError('Requested cancellation window was never reached.')
    pipeline_seconds = time.perf_counter() - started
    peaks = check_outputs(directory, round(duration * SAMPLE_RATE))
    metadata = json.loads((directory / 'processing.json').read_text())
    if metadata['offlineNetworkAttempts'] != 0:
        raise RuntimeError('The model attempted network access.')
    if not 0 < metadata['peakRssKiB'] <= MAX_WORKER_RSS_KIB:
        raise RuntimeError('Worker RSS exceeded the full-song memory contract.')
    for field in ['stemPeak', 'stemGain', 'sourcePeak', 'sourceGain']:
        if not math.isfinite(metadata[field]):
            raise RuntimeError('Processing metadata contains a nonfinite peak or gain.')
    expected_gain = 1 / metadata['stemPeak'] if metadata['stemPeak'] > 1 else 1
    if metadata['stemGain'] != expected_gain:
        raise RuntimeError('Stems were not converted with the common normalization gain.')
    report = {
        'source': 'official CC BY 3.0 singing example' if args.licensed_sample else 'original synthetic waveform',
        'licensedAttribution': __doc__ if args.licensed_sample else None,
        'python': sys.version.split()[0],
        'versions': {name: importlib.metadata.version(name) for name in ['spleeter', 'tensorflow', 'numpy', 'scipy']},
        'pipelineSeconds': pipeline_seconds, 'outputDirectory': str(directory),
        'duration': duration, 'frameCount': round(duration * SAMPLE_RATE), 'pcmPeaks': peaks,
        'sampledPeakDiskBytes': peak_disk_bytes, 'publishedMediaBytes': sum((directory / f'{name}.wav').stat().st_size for name in ['source', 'vocals', 'backing']),
        'stages': stage_times,
        'processing': metadata,
    }
    (directory / 'smoke-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
