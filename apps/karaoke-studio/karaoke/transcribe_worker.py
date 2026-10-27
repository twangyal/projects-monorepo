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
import unicodedata
import wave

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from karaoke.limits import (  # noqa: E402
    MAX_DURATION, MAX_WAV_BYTES, SAMPLE_RATE, WORKER_CPU_HARD, WORKER_CPU_SOFT,
)
from karaoke.lyrics_auto import _token, lyric_words  # noqa: E402
from karaoke.transcription import (  # noqa: E402
    CHOICES, DETECTION_WORDS, EAST_ASIAN, EAST_ASIAN_CHOICES, ENGLISH, MAX_WORDS, MULTILINGUAL, VAD_FILE, WHISPER, AsrModel,
    installed_models, selected_models, sounds_east_asian, sounds_english,
)
from karaoke.word_alignment import align  # noqa: E402

RATE = 16000
# The East Asian model also listens when the multilingual model's first words average below this confidence.
# On sung Chinese, Japanese and Korean the multilingual model averaged 0.45-0.54; on 20 JamendoLyrics songs
# 0.56-0.94, and 0.65 or more on every song the East Asian model alone misheard as East Asian.
EAST_ASIAN_CONFIDENCE = 0.6
# Languages the East Asian model can be told to hear; a fixed one improved sung Japanese from 45% to 34% character error.
EAST_ASIAN_LANGUAGES = ('zh', 'ja', 'ko', 'yue')
# Whisper tells a song's language from up to three stretches of about WINDOW seconds of singing (from the start and
# a third and two thirds of the way through); its phrase-by-phrase guesses wander. It told all 20 JamendoLyrics songs
# (English, French, German and Spanish) right this way.
WINDOW = 28
# Whisper does not read English songs (no better than the English model) or East Asian ones (worse than SenseVoice).
WHISPER_SKIPS = frozenset({'en', *EAST_ASIAN_LANGUAGES})
# A Whisper word the multilingual model did not hear the same way gets this confidence, below the review threshold: on
# French, German and Spanish songs 60-74% of them were right, against 87-98% of the words both models heard the same. A line is
# flagged when more than about two thirds of its words are unconfirmed.
UNCONFIRMED = 0.6
# More Whisper words than this per second of phrase (plus three) is a repetition loop, not singing.
MAX_WORDS_PER_SECOND = 8
# Token lengths when a model reports none: up to the next token, at most MAX_HELD; LAST_HELD for a phrase's last.
MAX_HELD = 2.0
LAST_HELD = 0.3
# Voice activity on separated vocals: phrases of at most 20 s, split at pauses of 0.4 s.
VAD = dict(threshold=0.4, min_silence_duration=0.4, min_speech_duration=0.25, max_speech_duration=20.0)


def load(model_root: Path, model: AsrModel, threads: int = 3, language: str = ''):
    import sherpa_onnx
    directory = Path(model_root) / model.directory
    if model is WHISPER:
        # Without a language Whisper detects one per input; with one it writes that language.
        return sherpa_onnx.OfflineRecognizer.from_whisper(
            str(directory / 'turbo-encoder.int8.onnx'), str(directory / 'turbo-decoder.int8.onnx'), str(directory / 'turbo-tokens.txt'),
            language=language, task='transcribe', num_threads=threads)
    if model is EAST_ASIAN:
        # Without inverse text normalization, sung numbers stay words ("ten thousand"), as lyrics write them.
        return sherpa_onnx.OfflineRecognizer.from_sense_voice(
            str(directory / 'model.int8.onnx'), str(directory / 'tokens.txt'), num_threads=threads, use_itn=False, language=language)
    # Greedy decoding: modified beam search (4 paths) was slower and worse on JamendoLyrics clips (41% against 38%
    # word error in English, 44% against 43% in French).
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


class SongLanguage:
    """The East Asian model told the song's language (`fixed`), and left to choose (`auto`) for phrases it hears as
    English: songs that are mostly Korean or Japanese often sing a line in English."""

    def __init__(self, auto, fixed):
        self.auto, self.fixed = auto, fixed


def retime(texts: list[str], timed: list[dict], begin: float, end: float) -> list[dict]:
    """Whisper's words for a phrase sung from `begin` to `end`, timed from the multilingual model's words for it.

    A word that model heard alike (similar spelling, in order) takes its time, and its confidence if heard exactly the
    same. Between two such words, as many words as it heard there differently take their times one for one; otherwise
    they share the time those words were sung in (or the time between their neighbours) in proportion to their length.
    Words not heard the same have UNCONFIRMED confidence. A phrase Whisper wrote nothing for, or a repetition loop,
    keeps the multilingual model's words.
    """
    texts = [text for text in texts if _token(text) and len(text) <= 60]
    if not texts or len(texts) > MAX_WORDS_PER_SECOND * (end - begin) + 3:
        return timed
    reference = [_token(text) for text in texts]
    matches = align(reference, [_token(word['text']) for word in timed]) if timed else [None] * len(texts)
    anchors: list[int | None] = [None] * len(texts)
    last = -1
    for index, match in enumerate(matches):
        if match is not None and match > last:
            anchors[index], last = match, match
    first, final = (timed[0]['start'], timed[-1]['end']) if timed else (begin, end)
    result: list[dict] = []
    index = 0
    while index < len(texts):
        anchor = anchors[index]
        if anchor is not None:
            word = timed[anchor]
            same = _token(word['text']) == reference[index]
            result.append(dict(text=texts[index], start=word['start'], end=word['end'], confidence=word['confidence'] if same else UNCONFIRMED))
            index += 1
            continue
        run_end = index
        while run_end < len(texts) and anchors[run_end] is None:
            run_end += 1
        # The multilingual model's words between the neighbouring anchors.
        between = timed[(anchors[index - 1] + 1 if index else 0):(anchors[run_end] if run_end < len(texts) else len(timed))]
        if len(between) == run_end - index:
            for k, word in zip(range(index, run_end), between, strict=True):
                result.append(dict(text=texts[k], start=word['start'], end=word['end'], confidence=UNCONFIRMED))
            index = run_end
            continue
        right = timed[anchors[run_end]]['start'] if run_end < len(texts) else final
        left = min(result[-1]['end'], right) if result else min(first, right)
        if between:
            left, right = max(left, min(between[0]['start'], right)), max(left, min(between[-1]['end'], right))
        weights = [len(texts[k]) + 1 for k in range(index, run_end)]
        cursor, total = left, sum(weights)
        for k, weight in zip(range(index, run_end), weights, strict=True):
            step = (right - left) * weight / total
            result.append(dict(text=texts[k], start=round(cursor, 3), end=round(cursor + step, 3), confidence=UNCONFIRMED))
            cursor += step
        index = run_end
    return result


def song_language(phrases, recognizer) -> str:
    """The language Whisper (told none) hears most in up to three WINDOW-second stretches of singing."""
    import numpy as np
    votes: collections.Counter = collections.Counter()
    for begin in sorted({0, len(phrases) // 3, 2 * len(phrases) // 3}):
        window, total = [], 0
        for _start, phrase in phrases[begin:]:
            if window and total + len(phrase) > WINDOW * RATE:
                break
            window.append(phrase[:WINDOW * RATE])
            total += len(window[-1])
        if window:
            language = _decode(recognizer, np.concatenate(window)).lang
            if language:
                votes[language] += 1
    return votes.most_common(1)[0][0] if votes else ''


def _decode(recognizer, phrase):
    stream = recognizer.create_stream()
    stream.accept_waveform(RATE, phrase)
    recognizer.decode_stream(stream)
    return stream.result


def agreement(first: str, second: str) -> float:
    """How alike two readings of a phrase are: 1 minus the character edit distance (letters and digits only) over
    the longer reading's length."""
    a, b = ([c for c in unicodedata.normalize('NFKC', text).casefold() if c.isalnum()] for text in (first, second))
    if not a and not b:
        return 1.0
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x != y)))
        previous = current
    return 1 - previous[-1] / max(len(a), len(b))


def recognize_phrase(recognizer, start: int, phrase) -> list[dict]:
    confidence = None
    if isinstance(recognizer, SongLanguage):
        result = _decode(recognizer.auto, phrase)
        # A phrase heard as English keeps that reading only if it is written in Latin letters.
        letters = [c for c in result.text if c.isalpha()]
        latin = sum(1 for c in letters if 'LATIN' in unicodedata.name(c, '')) >= 0.8 * len(letters)
        if getattr(result, 'lang', '').strip('<|>') != 'en' or not latin:
            auto_text = result.text
            result = _decode(recognizer.fixed, phrase)
            # The East Asian model reports no probabilities, but where its readings with and without the song's
            # language disagree it is usually wrong; cubed, about 90% agreement meets the review threshold.
            confidence = round(agreement(auto_text, result.text) ** 3, 3)
    else:
        result = _decode(recognizer, phrase)
    if getattr(result, 'lang', ''):
        heard_languages[result.lang.strip('<|>')] += 1
    words = words_from(list(result.tokens), list(result.timestamps), list(getattr(result, 'durations', []) or []), start / RATE,
                       list(getattr(result, 'ys_log_probs', []) or []))
    if confidence is not None:
        for word in words:
            word['confidence'] = confidence
    return words


def recognize(phrases, load_model: Callable[..., object], models: tuple[AsrModel, ...],
              progress: Callable[[int, int], None] | None = None, *, model_choice: str = 'auto') -> tuple[AsrModel, list[dict]]:
    """Recognize every phrase with the model that suits the song's language.

    When Whisper is installed it first tells the song's language, and reads songs in languages other than English,
    Chinese, Japanese and Korean itself, timed by the multilingual model (see retime); the other models hear the rest. With one of them
    installed it hears everything. With several, one model listens first: it hears phrases
    until it has ``DETECTION_WORDS`` words (or the song ends), and the song may then move to another model,
    which hears it again from the start. The multilingual model listens first when installed. When it is unsure
    of what it heard, the East Asian model listens too and keeps the song if it hears Chinese, Japanese or
    Korean; otherwise English songs go to the English model. It then hears the song again in
    the language it reported for most of those phrases, since its phrase-by-phrase guesses wander, except for
    phrases it hears as English.
    """
    models = selected_models(models, model_choice)
    total = len(phrases)
    report = progress or (lambda _completed, _total: None)
    if model_choice in EAST_ASIAN_CHOICES:
        # A deliberate language retry must not probe, switch languages or fall back to English.
        recognizer = load_model(EAST_ASIAN, language=EAST_ASIAN_CHOICES[model_choice])
        heard_languages.clear()
        words = []
        report(0, total)
        for done, (start, phrase) in enumerate(phrases, 1):
            heard = recognize_phrase(recognizer, start, phrase)
            # SenseVoice has no probabilities; a forced pass has no auto/fixed agreement estimate either.
            for word in heard:
                word['confidence'] = UNCONFIRMED
            words.extend(heard)
            report(done, total)
        words.sort(key=lambda word: (word['start'], word['end']))
        return EAST_ASIAN, words[:MAX_WORDS]
    if WHISPER in models:
        # Whisper reads songs in languages other than English, Chinese, Japanese and Korean (and any song when chosen).
        listener = load_model(WHISPER)
        language = song_language(phrases, listener)
        listener = None
        gc.collect()
        if model_choice == 'whisper' or language not in WHISPER_SKIPS:
            # Whisper writes every phrase's words, then the multilingual model times them: the two models together
            # would exceed the worker's memory limit.
            reader = load_model(WHISPER, language=language) if language else load_model(WHISPER)
            report(0, 2 * total)
            texts = []
            for done, (_start, phrase) in enumerate(phrases, 1):
                texts.append(lyric_words(_decode(reader, phrase).text))
                report(done, 2 * total)
            reader = None
            gc.collect()
            timing = load_model(MULTILINGUAL)
            words = []
            for done, ((start, phrase), text) in enumerate(zip(phrases, texts, strict=True), total + 1):
                words.extend(retime(text, recognize_phrase(timing, start, phrase), start / RATE, (start + len(phrase)) / RATE))
                report(done, 2 * total)
            words.sort(key=lambda word: (word['start'], word['end']))
            return WHISPER, words[:MAX_WORDS]
        models = tuple(model for model in models if model is not WHISPER)
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
        english = ENGLISH in models and model is not ENGLISH and sounds_english(heard)
        # Uncertainty is checked first: misheard Korean or Japanese is full of English-looking words ("the", "and").
        if model is MULTILINGUAL and EAST_ASIAN in models and unsure:
            switch(EAST_ASIAN)
            if not sounds_east_asian(listen()):
                switch(ENGLISH if english else MULTILINGUAL)
        elif english:
            switch(ENGLISH)
        elif model is EAST_ASIAN and not sounds_east_asian(heard):
            switch(ENGLISH)
    if model is EAST_ASIAN:
        listen()
        language = max(EAST_ASIAN_LANGUAGES, key=lambda code: heard_languages[code])
        if heard_languages[language]:
            auto = recognizer
            switch(EAST_ASIAN, language)
            recognizer = SongLanguage(auto, recognizer) if auto is not None else recognizer
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
