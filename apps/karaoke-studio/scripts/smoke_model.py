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


def synthetic(path: Path, seconds: float) -> None:
    samples = array.array('h')
    phase = 0.0
    for index in range(round(seconds * SAMPLE_RATE)):
        moment = index / SAMPLE_RATE
        hz = 220 + 24 * math.sin(2 * math.pi * 0.3 * moment)
        phase += 2 * math.pi * hz / SAMPLE_RATE
        envelope = max(0, math.sin(2 * math.pi * 1.4 * moment)) ** 2
        voice = envelope * (0.21 * math.sin(phase) + 0.08 * math.sin(phase * 2) + 0.035 * math.sin(phase * 3))
        backing = 0.12 * math.sin(2 * math.pi * 110 * moment) + sum(0.045 * math.sin(2 * math.pi * frequency * moment) for frequency in [261.6256, 329.6276, 391.9954])
        samples.extend([round((voice + backing) * 32768), round((voice + 0.85 * backing) * 32768)])
    if sys.byteorder != 'little':
        samples.byteswap()
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(samples.tobytes())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-dir', type=Path, required=True)
    parser.add_argument('--work-dir', type=Path, required=True, help='Generated smoke media/reports directory outside Git')
    parser.add_argument('--seconds', type=float, default=10)
    parser.add_argument('--licensed-sample', type=Path, help='Optional local official CC BY 3.0 audio_example.mp3')
    args = parser.parse_args()
    if not math.isfinite(args.seconds) or not 1 <= args.seconds <= 30:
        parser.error('--seconds must be 1–30')
    directory = args.work_dir / uuid.uuid4().hex
    directory.mkdir(parents=True)
    source = directory / 'input.wav'
    if args.licensed_sample:
        _run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file',
              '-format_whitelist', 'mp3', '-i', str(args.licensed_sample.resolve()), '-t', str(args.seconds),
              '-ar', str(SAMPLE_RATE), '-ac', '2', '-c:a', 'pcm_s16le', str(source)], threading.Event(), timeout=30)
    else:
        synthetic(source, args.seconds)
    started = time.perf_counter()
    duration = separate_clip(source, directory, args.model_dir, threading.Event(), lambda stage: print(stage, flush=True))
    arrays = {}
    for name in ['source', 'vocals', 'backing']:
        with wave.open(str(directory / f'{name}.wav'), 'rb') as audio:
            assert (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) == (2, 2, SAMPLE_RATE)
            assert audio.getnframes() == round(duration * SAMPLE_RATE)
            samples = array.array('h')
            samples.frombytes(audio.readframes(audio.getnframes()))
        if sys.byteorder != 'little':
            samples.byteswap()
        assert len(samples) == round(duration * SAMPLE_RATE) * 2
        assert any(samples), f'{name} unexpectedly silent'
        arrays[name] = samples
    assert arrays['vocals'] != arrays['backing']
    metadata = json.loads((directory / 'processing.json').read_text())
    assert metadata['offlineNetworkAttempts'] == 0
    report = {
        'source': 'official CC BY 3.0 singing example' if args.licensed_sample else 'original synthetic waveform',
        'licensedAttribution': __doc__ if args.licensed_sample else None,
        'python': sys.version.split()[0],
        'versions': {name: importlib.metadata.version(name) for name in ['spleeter', 'tensorflow', 'numpy', 'scipy']},
        'pipelineSeconds': time.perf_counter() - started, 'outputDirectory': str(directory),
        'duration': duration, 'pcmPeaks': {name: max(abs(value) for value in samples) for name, samples in arrays.items()},
        'processing': metadata,
    }
    (directory / 'smoke-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
