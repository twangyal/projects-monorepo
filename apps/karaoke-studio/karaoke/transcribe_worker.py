"""Offline lyric recognition worker; sherpa-onnx stays inside this killable process."""
from __future__ import annotations

import argparse
import collections
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
from karaoke.lyrics_auto import lyric_words  # noqa: E402
from karaoke.transcription import (  # noqa: E402
    CHOICES, DETECTION_WORDS, EAST_ASIAN, ENGLISH, MAX_WORDS, MULTILINGUAL, VAD_FILE, AsrModel, installed_models,
    selected_models, sounds_east_asian, sounds_english,
)

RATE = 16000
# The East Asian model also listens when the multilingual model's first words average below this confidence.
# On sung Chinese, Japanese and Korean the multilingual model averaged 0.45-0.54; on 20 JamendoLyrics songs
# 0.56-0.94, and 0.65 or more on every song the East Asian model alone misheard as East Asian.
EAST_ASIAN_CONFIDENCE = 0.6
# Languages the East Asian model can be told to hear; a fixed one improved sung Japanese from 45% to 34% character error.
EAST_ASIAN_LANGUAGES = ('zh', 'ja', 'ko', 'yue')
# Token lengths when a model reports none: up to the next token, at most MAX_HELD; LAST_HELD for a phrase's last.
MAX_HELD = 2.0
LAST_HELD = 0.3
# Voice activity on separated vocals: phrases of at most 20 s, split at pauses of 0.4 s.
VAD = dict(threshold=0.4, min_silence_duration=0.4, min_speech_duration=0.25, max_speech_duration=20.0)


def load(model_root: Path, model: AsrModel, threads: int = 3, language: str = ''):
    import sherpa_onnx
    directory = Path(model_root) / model.directory
    if model is EAST_ASIAN:
        # Without inverse text normalization, sung numbers stay words ("ten thousand"), as lyrics write them.
        return sherpa_onnx.OfflineRecognizer.from_sense_voice(
            str(directory / 'model.int8.onnx'), str(directory / 'tokens.txt'), num_threads=threads, use_itn=False, language=language)
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
    """Subword or character tokens to words: a token beginning with a space, or following a space
    token, starts a new word. Words of scripts written without spaces are then split into lyric
    words (``lyric_words``), each timed by its own tokens.

    A word's confidence is the geometric mean of its tokens' probabilities (1.0 when the model
    reports none).
    """
    import math
    words: list[dict] = []
    # Per word: [sum of log probabilities, token count, [(character offset, start, end) per token]].
    sums: list[list] = []
    boundary = False
    for index, (token, at) in enumerate(zip(tokens, timestamps)):
        if index < len(durations) and durations[index] > 0:
            length = durations[index]
        else:
            # Without reported durations, a sung token lasts until the next one starts (held notes), within reason.
            following = next((float(t) for t in timestamps[index + 1:] if float(t) > float(at)), None)
            length = min(following - float(at), MAX_HELD) if following is not None else LAST_HELD
        piece = token.replace('▁', ' ')
        text = piece.strip()
        if not text:
            boundary = boundary or bool(piece)
            continue
        start, end = round(offset + float(at), 3), round(offset + float(at) + float(length), 3)
        log_prob = float(log_probs[index]) if index < len(log_probs) and math.isfinite(log_probs[index]) else 0.0
        if piece.startswith(' ') or boundary or not words:
            words.append(dict(text=text, start=start, end=end))
            sums.append([min(log_prob, 0.0), 1, [(0, start, end)]])
        else:
            sums[-1][2].append((len(words[-1]['text']), start, end))
            words[-1]['text'] += text
            words[-1]['end'] = max(words[-1]['end'], end)
            sums[-1][0] += min(log_prob, 0.0)
            sums[-1][1] += 1
        boundary = False
    result = []
    for word, (total, count, spans) in zip(words, sums):
        confidence = round(math.exp(total / count), 3)
        offset_at = 0
        for part in lyric_words(word['text']):
            covering = [span for span in spans if offset_at <= span[0] < offset_at + len(part)] or \
                [max((span for span in spans if span[0] <= offset_at), key=lambda span: span[0])]
            result.append(dict(text=part, start=covering[0][1], end=max(span[2] for span in covering), confidence=confidence))
            offset_at += len(part)
    return [word for word in result if len(word['text']) <= 60]


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


# Languages the East Asian model reports for the phrases it hears (it tags each one).
heard_languages: collections.Counter = collections.Counter()


def recognize_phrase(recognizer, start: int, phrase) -> list[dict]:
    stream = recognizer.create_stream()
    stream.accept_waveform(RATE, phrase)
    recognizer.decode_stream(stream)
    result = stream.result
    if getattr(result, 'lang', ''):
        heard_languages[result.lang.strip('<|>')] += 1
    return words_from(list(result.tokens), list(result.timestamps), list(getattr(result, 'durations', []) or []), start / RATE,
                      list(getattr(result, 'ys_log_probs', []) or []))


def recognize(phrases, load_model: Callable[..., object], models: tuple[AsrModel, ...],
              progress: Callable[[int, int], None] | None = None, *, model_choice: str = 'auto') -> tuple[AsrModel, list[dict]]:
    """Recognize every phrase with the model that suits the song's language.

    With one model installed it hears everything. With several, one model listens first: it hears phrases
    until it has ``DETECTION_WORDS`` words (or the song ends), and the song may then move to another model,
    which hears it again from the start. The multilingual model listens first when installed; English songs
    go to the English model. When the multilingual model is unsure of what it heard, the East Asian model
    listens too and keeps the song if it hears Chinese, Japanese or Korean. It then hears the song again in
    the language it reported for most of those phrases, since its phrase-by-phrase guesses wander.
    """
    models = selected_models(models, model_choice)
    total = len(phrases)
    report = progress or (lambda _completed, _total: None)
    first = MULTILINGUAL if MULTILINGUAL in models else EAST_ASIAN if EAST_ASIAN in models else ENGLISH
    model = models[0] if len(models) == 1 else first
    recognizer = load_model(model)
    words: list[dict] = []
    report(0, total)
    done = 0
    heard_languages.clear()

    def listen() -> list[str]:
        nonlocal done
        while done < total and len(words) < DETECTION_WORDS:
            words.extend(recognize_phrase(recognizer, *phrases[done]))
            done += 1
            report(done, total)
        return [word['text'] for word in words]

    def switch(following: AsrModel, language: str = '') -> None:
        nonlocal model, recognizer, words, done
        recognizer = None  # free one model before loading the next
        gc.collect()
        model, recognizer, words, done = following, load_model(following, language=language) if language else load_model(following), [], 0
        report(0, total)
        heard_languages.clear()

    if len(models) > 1:
        heard = listen()
        unsure = sum(word['confidence'] for word in words) / max(len(words), 1) < EAST_ASIAN_CONFIDENCE
        if ENGLISH in models and model is not ENGLISH and sounds_english(heard):
            switch(ENGLISH)
        elif model is MULTILINGUAL and EAST_ASIAN in models and unsure:
            switch(EAST_ASIAN)
            if not sounds_east_asian(listen()):
                switch(MULTILINGUAL)
        elif model is EAST_ASIAN and not sounds_east_asian(heard):
            switch(ENGLISH)
    if model is EAST_ASIAN:
        listen()
        language = max(EAST_ASIAN_LANGUAGES, key=lambda code: heard_languages[code])
        if heard_languages[language]:
            switch(EAST_ASIAN, language)
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
    parser.add_argument('--model-choice', choices=CHOICES, default='auto')
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

    model, words = recognize(phrases_of(samples, vad_config), lambda chosen, language='': load(args.model_root, chosen, language=language),
                             models, progress, model_choice=args.model_choice)
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
