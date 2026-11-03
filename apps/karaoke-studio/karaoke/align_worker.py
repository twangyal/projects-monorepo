"""Offline lyric alignment worker: how likely each letter is in every 20 ms of the separated vocals.

ONNX Runtime stays inside this killable process. The result is written with ``alignment.write_emissions``.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import resource
import socket
import sys
import wave

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from karaoke.alignment import ALIGNER, CLASSES, RATE, aligner_ready, write_emissions  # noqa: E402
from karaoke.limits import MAX_DURATION, MAX_WAV_BYTES, SAMPLE_RATE, WORKER_CPU_HARD, WORKER_CPU_SOFT  # noqa: E402
from karaoke.transcribe_worker import to_16k_mono  # noqa: E402

# The model sees 20 s at a time with 2 s of context either side; only each window's own frames are kept.
WINDOW = 20
CONTEXT = 2
HOP = 320


def letter_probabilities(session, samples, progress=lambda completed, total: None):
    import numpy as np
    step, context, rows = WINDOW * RATE, CONTEXT * RATE, []
    total = max(1, -(-len(samples) // step))
    for index, start in enumerate(range(0, len(samples), step)):
        low, high = max(0, start - context), min(len(samples), start + step + context)
        chunk = samples[low:high]
        chunk = (chunk - chunk.mean()) / (chunk.std() + 1e-7)
        logits = session.run(None, {'input_values': chunk[None, :].astype(np.float32)})[0][0]
        if logits.ndim != 2 or logits.shape[1] != CLASSES:
            raise RuntimeError('The alignment model returned an unexpected shape.')
        logits = logits - logits.max(axis=1, keepdims=True)
        log_probs = logits - np.log(np.exp(logits).sum(axis=1, keepdims=True))
        first, count = (start - low) // HOP, min(step, len(samples) - start) // HOP
        rows.append(log_probs[first:first + count])
        progress(index + 1, total)
    return np.concatenate(rows) if rows else np.zeros((0, CLASSES), dtype=np.float32)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--vocals', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--model-root', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.output.is_symlink():
        raise ValueError('The alignment destination already exists.')
    if not aligner_ready(args.model_root):
        raise RuntimeError('Verified lyric alignment model files are missing or corrupt; run explicit model setup.')
    resource.setrlimit(resource.RLIMIT_CPU, (WORKER_CPU_SOFT, WORKER_CPU_HARD))
    os.environ.update({'OMP_NUM_THREADS': '3', 'OPENBLAS_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1'})

    def deny_network(*_args, **_kwargs):
        raise OSError('Network access is disabled during local lyric alignment.')

    socket.socket.connect = deny_network
    socket.socket.connect_ex = deny_network
    socket.socket.sendto = deny_network
    socket.create_connection = deny_network
    socket.getaddrinfo = deny_network
    source = args.vocals
    if source.is_symlink() or not source.is_file() or source.stat().st_size > MAX_WAV_BYTES:
        raise ValueError('Alignment input must be a bounded regular WAV file.')
    with wave.open(str(source), 'rb') as audio:
        frames = audio.getnframes()
        if ((audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype())
                != (2, 2, SAMPLE_RATE, 'NONE') or not 0 < frames <= MAX_DURATION * SAMPLE_RATE):
            raise ValueError('Alignment input must be bounded canonical stereo PCM16 WAV.')
        raw = audio.readframes(frames)
    samples = to_16k_mono(raw, frames)
    del raw
    import onnxruntime
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = 3
    options.inter_op_num_threads = 1
    session = onnxruntime.InferenceSession(str(args.model_root / ALIGNER.directory / ALIGNER.files['onnx/model_quantized.onnx'][0]),
                                           options, providers=['CPUExecutionProvider'])

    def progress(completed: int, total: int) -> None:
        print(json.dumps({'type': 'progress', 'completed': completed, 'total': total}), flush=True)

    write_emissions(args.output, letter_probabilities(session, samples, progress))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Local lyric alignment failed: {error}', file=sys.stderr, flush=True)
        raise SystemExit(1) from error
