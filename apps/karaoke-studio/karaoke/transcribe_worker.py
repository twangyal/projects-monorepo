"""Offline lyric recognition worker; sherpa-onnx stays inside this killable process."""
from __future__ import annotations

import argparse
from collections.abc import Callable
import gc
import json
import os
from pathlib import Path
import resource
import socket
import sys
import time
import wave

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from karaoke.limits import (  # noqa: E402
    MAX_DURATION, MAX_WAV_BYTES, SAMPLE_RATE, WORKER_CPU_HARD, WORKER_CPU_SOFT,
)
from karaoke.transcription import (  # noqa: E402
    DETECTION_WORDS, ENGLISH, MAX_WORDS, MULTILINGUAL, VAD_FILE, AsrModel, installed_models, selected_models, sounds_english,
)

RATE = 16000
# Voice activity on separated vocals: phrases of at most 20 s, split at pauses of 0.4 s.
VAD = dict(threshold=0.4, min_silence_duration=0.4, min_speech_duration=0.25, max_speech_duration=20.0)


def load(model_root: Path, model: AsrModel, threads: int = 3):
    import sherpa_onnx
    directory = Path(model_root) / model.directory
    return sherpa_onnx.OfflineRecognizer.from_transducer(
        str(directory / 'encoder.int8.onnx'), str(directory / 'decoder.int8.onnx'), str(directory / 'joiner.int8.onnx'),
        str(directory / 'tokens.txt'), num_threads=threads, model_type='nemo_transducer')


def vad_settings(model_root: Path, model: AsrModel):
    import sherpa_onnx
    config = sherpa_onnx.VadModelConfig()
    config.silero_vad.model = str(Path(model_root) / model.directory / VAD_FILE)
    for name, value in VAD.items():
        setattr(config.silero_vad, name, value)
    config.sample_rate = RATE
    config.num_threads = 1
    return config


def to_16k_mono(raw: bytes, frames: int):
    """Canonical stereo PCM16 at 44.1 kHz to peak-normalized float32 mono at 16 kHz."""
    import numpy as np
    from scipy.signal import resample_poly
    stereo = np.frombuffer(raw, dtype='<i2').reshape(frames, 2).astype(np.float32) / 32768
    mono = resample_poly(stereo.mean(axis=1), 160, 441).astype(np.float32)
    peak = float(np.abs(mono).max()) if len(mono) else 0.0
    return mono * (0.9 / peak) if peak > 1e-4 else mono


def words_from(tokens, timestamps, durations, offset: float, log_probs=()) -> list[dict]:
    """Subword tokens to words: a token beginning with a space starts a new word.

    A word's confidence is the geometric mean of its tokens' probabilities (1.0 when the model
    reports none).
    """
    import math
    words: list[dict] = []
    sums: list[list[float]] = []
    for index, (token, at) in enumerate(zip(tokens, timestamps)):
        length = durations[index] if index < len(durations) and durations[index] > 0 else 0.08
        piece = token.replace('▁', ' ')
        text = piece.strip()
        if not text:
            continue
        start, end = round(offset + float(at), 3), round(offset + float(at) + float(length), 3)
        log_prob = float(log_probs[index]) if index < len(log_probs) and math.isfinite(log_probs[index]) else 0.0
        if piece.startswith(' ') or not words:
            words.append(dict(text=text, start=start, end=end))
            sums.append([min(log_prob, 0.0), 1])
        else:
            words[-1]['text'] += text
            words[-1]['end'] = max(words[-1]['end'], end)
            sums[-1][0] += min(log_prob, 0.0)
            sums[-1][1] += 1
    for word, (total, count) in zip(words, sums):
        word['confidence'] = round(math.exp(total / count), 3)
    return [word for word in words if len(word['text']) <= 60]


def phrases_of(samples, vad_config) -> list[tuple[int, object]]:
    """Sung phrases as (start sample, samples) at 16 kHz."""
    import numpy as np
    import sherpa_onnx
    detector = sherpa_onnx.VoiceActivityDetector(vad_config, buffer_size_in_seconds=MAX_DURATION + 30)
    window = vad_config.silero_vad.window_size
    phrases = []

    def drain():
        while not detector.empty():
            phrases.append((detector.front.start, np.array(detector.front.samples, dtype=np.float32)))
            detector.pop()

    for index in range(0, len(samples), window):
        detector.accept_waveform(samples[index:index + window])
        drain()
    detector.flush()
    drain()
    return phrases


def recognize_phrase(recognizer, start: int, phrase) -> list[dict]:
    stream = recognizer.create_stream()
    stream.accept_waveform(RATE, phrase)
    recognizer.decode_stream(stream)
    result = stream.result
    return words_from(list(result.tokens), list(result.timestamps), list(getattr(result, 'durations', []) or []), start / RATE,
                      list(getattr(result, 'ys_log_probs', []) or []))


def recognize(phrases, load_model: Callable[[AsrModel], object], models: tuple[AsrModel, ...],
              progress: Callable[[int, int], None] | None = None, *, model_choice: str = 'auto') -> tuple[AsrModel, list[dict]]:
    """Recognize every phrase with the model that suits the song's language.

    With one model installed it hears everything. With both, the multilingual model hears phrases
    until it has ``DETECTION_WORDS`` words (or the song ends); if they read as English, the English
    model hears the whole song again, otherwise the multilingual model carries on.
    """
    models = selected_models(models, model_choice)
    total = len(phrases)
    report = progress or (lambda _completed, _total: None)
    model = models[0] if len(models) == 1 else MULTILINGUAL
    recognizer = load_model(model)
    words: list[dict] = []
    report(0, total)
    done = 0
    if len(models) > 1:
        while done < total and len(words) < DETECTION_WORDS:
            words.extend(recognize_phrase(recognizer, *phrases[done]))
            done += 1
            report(done, total)
        if sounds_english([word['text'] for word in words]):
            del recognizer  # free the multilingual model before loading the English one
            gc.collect()
            model, recognizer, words, done = ENGLISH, load_model(ENGLISH), [], 0
            report(0, total)
    for start, phrase in phrases[done:]:
        words.extend(recognize_phrase(recognizer, start, phrase))
        done += 1
        report(done, total)
    words.sort(key=lambda word: (word['start'], word['end']))
    return model, words[:MAX_WORDS]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--vocals', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--model-root', type=Path, required=True)
    parser.add_argument('--model-choice', choices=('auto', 'english', 'multilingual'), default='auto')
    args = parser.parse_args()
    if args.output.exists() or args.output.is_symlink():
        raise ValueError('The transcript destination already exists.')
    models = installed_models(args.model_root)
    if not models:
        raise RuntimeError('Verified lyric recognition model files are missing or corrupt; run explicit model setup.')
    resource.setrlimit(resource.RLIMIT_CPU, (WORKER_CPU_SOFT, WORKER_CPU_HARD))
    os.environ.update({'OMP_NUM_THREADS': '3', 'OPENBLAS_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1'})

    def deny_network(*_args, **_kwargs):
        raise OSError('Network access is disabled during local lyric recognition.')

    socket.socket.connect = deny_network
    socket.socket.connect_ex = deny_network
    socket.socket.sendto = deny_network
    socket.create_connection = deny_network
    socket.getaddrinfo = deny_network
    source = args.vocals
    if source.is_symlink() or not source.is_file() or source.stat().st_size > MAX_WAV_BYTES:
        raise ValueError('Recognition input must be a bounded regular WAV file.')
    with wave.open(str(source), 'rb') as audio:
        frames = audio.getnframes()
        if ((audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype())
                != (2, 2, SAMPLE_RATE, 'NONE') or not 0 < frames <= MAX_DURATION * SAMPLE_RATE):
            raise ValueError('Recognition input must be bounded canonical stereo PCM16 WAV.')
        raw = audio.readframes(frames)
    started = time.perf_counter()
    try:
        vad_config = vad_settings(args.model_root, models[0])
    except ModuleNotFoundError as error:
        raise RuntimeError('Install requirements-ml.lock.txt (including sherpa-onnx) into the documented Python 3.11 environment.') from error
    samples = to_16k_mono(raw, frames)
    del raw

    def progress(completed: int, total: int) -> None:
        print(json.dumps({'type': 'progress', 'completed': completed, 'total': total}), flush=True)

    model, words = recognize(phrases_of(samples, vad_config), lambda chosen: load(args.model_root, chosen), models, progress, model_choice=args.model_choice)
    temporary = args.output.with_suffix('.json.part')
    with temporary.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps({'model': model.name, 'words': words, 'seconds': round(time.perf_counter() - started, 3)}))
    temporary.replace(args.output)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Local lyric recognition failed: {error}', file=sys.stderr, flush=True)
        raise SystemExit(1) from error
