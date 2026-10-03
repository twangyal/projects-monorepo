"""Offline CPU Spleeter worker; TensorFlow stays inside this killable process."""
from __future__ import annotations

import argparse
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
from karaoke.pipeline import MODEL_SHA256, SAMPLE_RATE, model_ready  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--model-root', type=Path, required=True)
    args = parser.parse_args()
    if not model_ready(args.model_root):
        raise RuntimeError('Verified model files are missing or corrupt; run explicit model setup.')
    resource.setrlimit(resource.RLIMIT_CPU, (120, 125))
    resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024 * 1024, 8 * 1024 * 1024))
    os.environ.update({
        'MODEL_PATH': str(args.model_root.resolve()), 'CUDA_VISIBLE_DEVICES': '-1',
        'TF_NUM_INTRAOP_THREADS': '3', 'TF_NUM_INTEROP_THREADS': '1',
        'OMP_NUM_THREADS': '3', 'OPENBLAS_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1',
        'TF_CPP_MIN_LOG_LEVEL': '2', 'TF_ENABLE_ONEDNN_OPTS': '0',
    })
    network_attempts = []

    def deny_network(*_args, **_kwargs):
        network_attempts.append(True)
        raise OSError('Network access is disabled during local separation.')

    socket.socket.connect = deny_network
    socket.socket.connect_ex = deny_network
    socket.socket.sendto = deny_network
    socket.create_connection = deny_network
    socket.getaddrinfo = deny_network
    started = time.perf_counter()
    try:
        import numpy as np
        import tensorflow as tf
        from spleeter.separator import Separator
    except ModuleNotFoundError as error:
        raise RuntimeError('Install requirements-ml.lock.txt into the documented Python 3.11 environment.') from error
    tf.config.threading.set_intra_op_parallelism_threads(3)
    tf.config.threading.set_inter_op_parallelism_threads(1)
    tf.config.set_visible_devices([], 'GPU')
    with wave.open(str(args.source), 'rb') as source:
        frames = source.getnframes()
        if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (2, 2, SAMPLE_RATE) or not SAMPLE_RATE <= frames <= 30 * SAMPLE_RATE:
            raise ValueError('Worker input must be bounded canonical stereo PCM16 WAV.')
        raw = source.readframes(frames)
        if len(raw) != frames * 4:
            raise ValueError('Worker input is truncated.')
    waveform = np.frombuffer(raw, dtype='<i2').reshape(-1, 2).astype(np.float32) / 32768
    prediction_started = time.perf_counter()
    separator = Separator('spleeter:2stems', multiprocess=False)
    predictions = separator.separate(waveform)
    inference_seconds = time.perf_counter() - prediction_started
    if set(predictions) != {'vocals', 'accompaniment'}:
        raise RuntimeError('The model did not return both expected stems.')
    for samples in predictions.values():
        if samples.shape != waveform.shape or not np.isfinite(samples).all():
            raise RuntimeError('The model returned invalid or mismatched audio samples.')
    peak = max(float(np.max(np.abs(samples))) for samples in predictions.values())
    gain = 1 / peak if peak > 1 else 1
    for source_name, filename in [('vocals', 'vocals.wav'), ('accompaniment', 'backing.wav')]:
        samples = predictions[source_name]
        pcm = np.clip(np.rint(samples.astype(np.float64) * gain * 32768), -32768, 32767).astype('<i2')
        output = args.output_dir / filename
        temporary = output.with_suffix('.wav.part')
        with wave.open(str(temporary), 'wb') as audio:
            audio.setnchannels(2)
            audio.setsampwidth(2)
            audio.setframerate(SAMPLE_RATE)
            audio.writeframes(pcm.tobytes())
        temporary.replace(output)
    if network_attempts:
        raise RuntimeError('The model attempted a network connection despite its local cache.')
    metadata = {
        'model': 'spleeter:2stems', 'modelRelease': 'v1.4.0', 'modelArchiveSha256': MODEL_SHA256,
        'spleeterVersion': importlib.metadata.version('spleeter'), 'tensorflowVersion': tf.__version__,
        'stemPeak': peak, 'stemGain': gain, 'sampleRate': SAMPLE_RATE,
        'duration': frames / SAMPLE_RATE, 'offlineNetworkAttempts': 0,
        'inferenceSeconds': inference_seconds, 'workerSeconds': time.perf_counter() - started,
        'peakRssKiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    }
    output = args.output_dir / 'processing.json'
    temporary = output.with_suffix('.json.part')
    temporary.write_text(json.dumps(metadata, indent=2) + '\n')
    temporary.replace(output)
    print(json.dumps(metadata), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Local AI separation failed: {error}', file=sys.stderr, flush=True)
        raise SystemExit(1) from error
