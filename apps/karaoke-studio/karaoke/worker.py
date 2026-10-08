"""Offline CPU Spleeter worker; TensorFlow stays inside this killable process."""
from __future__ import annotations

import argparse
from collections.abc import Callable
import importlib.metadata
import json
import os
from pathlib import Path
import resource
import socket
import sys
import time
import wave

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from karaoke.chunks import (  # noqa: E402
    FloatStemAssembler, normalization_gain, scan_float_peak, write_pcm16_wav,
)
from karaoke.limits import (  # noqa: E402
    HOP_FRAMES, MAX_DURATION, MAX_WAV_BYTES, OVERLAP_FRAMES, SAMPLE_RATE,
    WINDOW_FRAMES, WORKER_CPU_HARD, WORKER_CPU_SOFT, WORKER_FILE_BYTES,
)
from karaoke.pipeline import MODEL_SHA256, model_ready  # noqa: E402

# All destinations are preflighted together before either mutation or cleanup.
_OUTPUT_NAMES = ('vocals.f32', 'backing.f32', 'vocals.wav', 'backing.wav', 'processing.json')
_DESTINATIONS = _OUTPUT_NAMES + tuple(name + '.part' for name in _OUTPUT_NAMES)


def configure_runtime(model_root: Path) -> None:
    resource.setrlimit(resource.RLIMIT_CPU, (WORKER_CPU_SOFT, WORKER_CPU_HARD))
    resource.setrlimit(resource.RLIMIT_FSIZE, (WORKER_FILE_BYTES, WORKER_FILE_BYTES))
    os.environ.update({
        'MODEL_PATH': str(model_root.resolve()), 'CUDA_VISIBLE_DEVICES': '-1',
        'TF_NUM_INTRAOP_THREADS': '3', 'TF_NUM_INTEROP_THREADS': '1',
        'OMP_NUM_THREADS': '3', 'OPENBLAS_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1',
        'TF_CPP_MIN_LOG_LEVEL': '2', 'TF_ENABLE_ONEDNN_OPTS': '0',
    })


def _preflight(output_dir: Path) -> None:
    if not output_dir.is_dir():
        raise ValueError('Worker output directory is missing.')
    if any((output_dir / name).exists() or (output_dir / name).is_symlink()
           for name in _DESTINATIONS):
        raise ValueError('Worker destinations must be empty before separation.')


def _cleanup(output_dir: Path, names: tuple[str, ...]) -> None:
    for name in names:
        (output_dir / name).unlink(missing_ok=True)


def separate_windows(
    source: Path, output_dir: Path,
    predict: Callable[[bytes, int], tuple[bytes, bytes]],
    progress: Callable[[dict], None] | None = None,
) -> dict:
    """Bounded assembly orchestration, independently testable without ML packages.

    Production supplies the actual Spleeter predictor below. Job paths remain
    descriptor-anchored: resolving them would discard the parent's owned handle.
    """
    _preflight(output_dir)
    if source.is_symlink() or not source.is_file() or source.stat().st_size > MAX_WAV_BYTES:
        raise ValueError('Worker input must be a bounded regular WAV file.')
    success = False
    inference_seconds = 0.0
    try:
        with wave.open(str(source), 'rb') as audio:
            frames = audio.getnframes()
            if ((audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype())
                    != (2, 2, SAMPLE_RATE, 'NONE')
                    or not SAMPLE_RATE <= frames <= MAX_DURATION * SAMPLE_RATE):
                raise ValueError('Worker input must be bounded canonical stereo PCM16 WAV.')
            with (output_dir / 'vocals.f32').open('xb') as vocals, (output_dir / 'backing.f32').open('xb') as backing:
                assembler = FloatStemAssembler(frames, vocals, backing)
                windows = assembler.windows

                def completed(count: int) -> None:
                    if progress is not None:
                        progress({'type': 'progress', 'completedWindows': count, 'windowCount': len(windows)})

                completed(0)
                for index, window in enumerate(windows):
                    audio.setpos(window.start)
                    raw = audio.readframes(window.frames)
                    if len(raw) != window.frames * 4:
                        raise ValueError('Worker input is truncated.')
                    started = time.perf_counter()
                    predictions = predict(raw, window.frames)
                    inference_seconds += time.perf_counter() - started
                    if not isinstance(predictions, tuple) or len(predictions) != 2:
                        raise ValueError('The model did not return both expected stems.')
                    assembler.append(index, predictions[0], predictions[1])
                    del raw, predictions
                    completed(index + 1)
                assembler.finish()
        floats = [output_dir / 'vocals.f32', output_dir / 'backing.f32']
        peak = scan_float_peak(floats, frames)
        gain = normalization_gain(peak)
        for float_path, name in zip(floats, ('vocals.wav', 'backing.wav'), strict=True):
            write_pcm16_wav(float_path, output_dir / name, frames, gain)
        metadata = {
            'frameCount': frames, 'sampleRate': SAMPLE_RATE, 'duration': frames / SAMPLE_RATE,
            'chunkScheme': 'linear-sample-center-overlap', 'windowFrames': WINDOW_FRAMES,
            'overlapFrames': OVERLAP_FRAMES, 'hopFrames': HOP_FRAMES,
            'windowCount': len(windows),
            'windowRanges': [{'start': window.start, 'frames': window.frames} for window in windows],
            'stemPeak': peak, 'stemGain': gain, 'inferenceSeconds': inference_seconds,
        }
        success = True
        return metadata
    finally:
        _cleanup(output_dir, ('vocals.f32', 'backing.f32', 'vocals.f32.part', 'backing.f32.part'))
        if not success:
            _cleanup(output_dir, ('vocals.wav', 'backing.wav', 'vocals.wav.part', 'backing.wav.part'))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--model-root', type=Path, required=True)
    args = parser.parse_args()
    _preflight(args.output_dir)
    if not model_ready(args.model_root):
        raise RuntimeError('Verified model files are missing or corrupt; run explicit model setup.')
    configure_runtime(args.model_root)
    network_attempted = False

    def deny_network(*_args, **_kwargs):
        nonlocal network_attempted
        network_attempted = True
        raise OSError('Network access is disabled during local separation.')

    socket.socket.connect = deny_network
    socket.socket.connect_ex = deny_network
    socket.socket.sendto = deny_network
    socket.create_connection = deny_network
    socket.getaddrinfo = deny_network
    started = time.perf_counter()
    success = False
    try:
        try:
            import numpy as np
            import tensorflow as tf
            from spleeter.separator import Separator
        except ModuleNotFoundError as error:
            raise RuntimeError('Install requirements-ml.lock.txt into the documented Python 3.11 environment.') from error
        tf.config.threading.set_intra_op_parallelism_threads(3)
        tf.config.threading.set_inter_op_parallelism_threads(1)
        tf.config.set_visible_devices([], 'GPU')
        separator = Separator('spleeter:2stems', multiprocess=False)

        def predict(raw: bytes, frames: int) -> tuple[bytes, bytes]:
            waveform = np.frombuffer(raw, dtype='<i2').reshape(frames, 2).astype(np.float32) / 32768
            predictions = separator.separate(waveform)
            if not isinstance(predictions, dict) or set(predictions) != {'vocals', 'accompaniment'}:
                raise RuntimeError('The model did not return both expected stems.')
            for samples in predictions.values():
                if samples.shape != (frames, 2) or not np.isfinite(samples).all():
                    raise RuntimeError('The model returned invalid or mismatched audio samples.')
            return tuple(predictions[name].astype('<f4', copy=False).tobytes(order='C')
                         for name in ('vocals', 'accompaniment'))

        def progress(record: dict) -> None:
            print(json.dumps(record, separators=(',', ':')), flush=True)

        metadata = separate_windows(args.source, args.output_dir, predict, progress)
        if network_attempted:
            raise RuntimeError('The model attempted a network connection despite its local cache.')
        metadata.update({
            'model': 'spleeter:2stems', 'modelRelease': 'v1.4.0', 'modelArchiveSha256': MODEL_SHA256,
            'spleeterVersion': importlib.metadata.version('spleeter'), 'tensorflowVersion': tf.__version__,
            'offlineNetworkAttempts': 0, 'workerSeconds': time.perf_counter() - started,
            'peakRssKiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        })
        output = args.output_dir / 'processing.json'
        temporary = output.with_suffix('.json.part')
        with temporary.open('x', encoding='utf-8') as stream:
            stream.write(json.dumps(metadata, indent=2) + '\n')
        temporary.replace(output)
        print(json.dumps(metadata), flush=True)
        success = True
    finally:
        if not success:
            _cleanup(args.output_dir, _DESTINATIONS)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Local AI separation failed: {error}', file=sys.stderr, flush=True)
        raise SystemExit(1) from error
