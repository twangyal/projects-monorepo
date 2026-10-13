"""Measure vocal/backing separation quality against reference stems.

Uses the MUSDB18 7-second sample set (https://zenodo.org/records/3270814, MUSDB18-7-STEMS.zip:
7-second excerpts of the 150 MUSDB18 tracks; audio is never committed). Each test track's mixture
(stream 0) is separated and compared with its reference vocals (stream 4); the reference backing is
the mixture minus the vocals.

Separators:
- ``spleeter``: the production Spleeter 2-stems model, as the worker runs it;
- ``uvr:PATH``: a UVR MDX-Net ONNX model through sherpa-onnx (stem 0 vocals, stem 1 backing).

Metric: signal-to-distortion ratio per track, 10 log10(sum s^2 / sum (s - estimate)^2), the
"global SDR" of the Music Demixing challenges, in dB, higher is better. Vocals SDR is reported only
for tracks whose reference vocals are louder than -40 dBFS RMS (silent references make it undefined).

Usage (Python 3.11 environment with requirements-ml.lock.txt):
    python scripts/evaluate_separation.py --dataset MUSDB18-7 --model-dir MODELS \
        --separator spleeter --separator uvr:UVR-MDX-NET-Voc_FT.onnx --json OUT
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess
import time

import numpy as np

RATE = 44100
SILENT_RMS = 10 ** (-40 / 20)


def decode(path: Path, stream: int) -> np.ndarray:
    raw = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(path), '-map', f'0:{stream}', '-ac', '2', '-ar', str(RATE),
                          '-f', 'f32le', '-'], check=True, capture_output=True).stdout
    return np.frombuffer(raw, '<f4').reshape(-1, 2).astype(np.float64)


def sdr(reference: np.ndarray, estimate: np.ndarray) -> float:
    error = ((reference - estimate) ** 2).sum()
    return float(10 * np.log10(((reference ** 2).sum() + 1e-8) / (error + 1e-8)))


def checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def spleeter_separator(model_dir: Path, threads: int):
    os.environ.update({'MODEL_PATH': str(model_dir.resolve()), 'CUDA_VISIBLE_DEVICES': '-1', 'TF_CPP_MIN_LOG_LEVEL': '2'})
    import tensorflow as tf
    from spleeter.separator import Separator
    tf.config.threading.set_intra_op_parallelism_threads(threads)
    tf.config.threading.set_inter_op_parallelism_threads(1)
    separator = Separator('spleeter:2stems', multiprocess=False)

    def separate(mixture: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        stems = separator.separate(mixture.astype(np.float32))
        return stems['vocals'], stems['accompaniment']
    return separate, {'model': 'spleeter:2stems', 'modelRelease': 'v1.4.0'}


def uvr_separator(model: Path, threads: int):
    import sherpa_onnx
    config = sherpa_onnx.OfflineSourceSeparationConfig(model=sherpa_onnx.OfflineSourceSeparationModelConfig(
        uvr=sherpa_onnx.OfflineSourceSeparationUvrModelConfig(model=str(model)), num_threads=threads))
    separator = sherpa_onnx.OfflineSourceSeparation(config)

    def separate(mixture: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        output = separator.process(sample_rate=RATE, samples=np.ascontiguousarray(mixture.T, dtype=np.float32))
        if output.sample_rate != RATE or len(output.stems) != 2:
            raise RuntimeError('Unexpected UVR output layout.')
        return tuple(np.asarray(stem.data).T[:len(mixture)] for stem in output.stems)
    return separate, {'model': model.name, 'modelSha256': checksum(model), 'sherpaOnnxVersion': sherpa_onnx.__version__}


def summary(values: list[float]) -> dict:
    return {'median': round(statistics.median(values), 2), 'mean': round(statistics.fmean(values), 2), 'count': len(values)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset', type=Path, required=True, help='Unpacked MUSDB18-7-STEMS directory (with test/)')
    parser.add_argument('--model-dir', type=Path, help='Studio model directory (for spleeter)')
    parser.add_argument('--separator', action='append', required=True, help='spleeter or uvr:PATH (repeatable)')
    parser.add_argument('--threads', type=int, default=3)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--json', type=Path)
    args = parser.parse_args()
    tracks = sorted((args.dataset / 'test').glob('*.stem.mp4'))[:args.limit]
    references = []
    for track in tracks:
        mixture, vocals = decode(track, 0), decode(track, 4)
        frames = min(len(mixture), len(vocals))
        references.append((track.name.removesuffix('.stem.mp4'), mixture[:frames], vocals[:frames]))
    results = {}
    for spec in args.separator:
        if spec == 'spleeter':
            separate, details = spleeter_separator(args.model_dir, args.threads)
        elif spec.startswith('uvr:'):
            separate, details = uvr_separator(Path(spec[4:]), args.threads)
        else:
            raise SystemExit(f'Unknown separator {spec}')
        separate(references[0][1][:RATE])  # warm-up outside the timing
        rows, seconds, audio = [], 0.0, 0.0
        for name, mixture, vocals in references:
            started = time.perf_counter()
            estimate_vocals, estimate_backing = separate(mixture)
            seconds += time.perf_counter() - started
            audio += len(mixture) / RATE
            voiced = float(np.sqrt((vocals ** 2).mean())) > SILENT_RMS
            row = {'track': name, 'voiced': voiced, 'backingSdr': round(sdr(mixture - vocals, estimate_backing), 2)}
            if voiced:
                row['vocalsSdr'] = round(sdr(vocals, estimate_vocals), 2)
            rows.append(row)
            print(json.dumps({'separator': details['model'], **row}), flush=True)
        results[details['model']] = {**details, 'threads': args.threads, 'vocalsSdr': summary([row['vocalsSdr'] for row in rows if 'vocalsSdr' in row]),
                                     'backingSdr': summary([row['backingSdr'] for row in rows]), 'seconds': round(seconds, 1),
                                     'audioSeconds': round(audio, 1), 'realTimeFactor': round(seconds / audio, 3), 'tracks': rows}
        print(json.dumps({key: value for key, value in results[details['model']].items() if key != 'tracks'}), flush=True)
    if args.json:
        args.json.write_text(json.dumps({'dataset': 'MUSDB18-7 test (50 tracks)', 'separators': results}, indent=2) + '\n')


if __name__ == '__main__':
    main()
