"""Supplied lyrics placed on the singing by forced alignment.

A small speech model (Meta's wav2vec 2.0 base, fine-tuned on read English; Apache-2.0, as the int8 ONNX export
published for transformers.js) gives, for every 20 ms of the separated vocals, how likely each letter is. Those
probabilities are measured once, when a clip is transcribed, and kept beside its transcript. Supplied lyrics are then
laid on them letter by letter, in order, along the most likely path (CTC forced alignment), so every line gets a time
even where recognition heard none of its words. Accents are folded (é is e), which serves French, Spanish and German
lyrics too, and Korean is read in its Latin spelling (Revised Romanization, syllable by syllable). Chinese characters
are read in pinyin when the song was recognized as Mandarin: the characters alone do not say whether a song is sung in
Mandarin or Cantonese, whose readings differ, so Cantonese and Japanese lyrics are left to recognized words.

On the first two minutes of five JamendoLyrics songs in each of English, French, Spanish and German (431 lines), 93%
of line starts landed within a second of the singing, against 82% when lines were matched to recognized words, with
a median error of 0.03-0.05 s against 0.1-0.2 s. On 20 sung Korean phrases (GTSinger), the romanized lyrics put 62%
of breath-separated lines and 64% of words within 0.3 s of their sung start, against 34% and 41% from matching them
to the words SenseVoice recognized; on 20 sung Mandarin phrases, pinyin put 95% of lines within 0.3 s against 75%,
and 77% of characters within 0.15 s against 63%.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import math
from pathlib import Path
import re
import struct
import unicodedata

ALIGNER_REVISION = 'a19f851b3d42865797e410752b4c570c871e4825'
ALIGNER_SOURCE = f'https://huggingface.co/Xenova/wav2vec2-base-960h/resolve/{ALIGNER_REVISION}/'


@dataclass(frozen=True)
class AlignerModel:
    name: str
    directory: str
    # Published path (under ALIGNER_SOURCE) -> (installed name, bytes, SHA-256).
    files: dict[str, tuple[str, int, str]]


ALIGNER = AlignerModel('wav2vec2-base-960h-int8', 'lyrics-aligner', {
    'onnx/model_quantized.onnx': ('model.int8.onnx', 95286046, 'cd5040c147381580ed73258143dd8e0c28e800a09e74ee42ee2b3e8cb4d760a3'),
    'vocab.json': ('vocab.json', 358, '4178db26b3c7570f6a47f14ac6a1c7b32950b8c2800fb097287e53776934f1c5'),
})

# The model's letters (its vocab.json): 0 is the CTC blank, 4 the word boundary.
LETTERS = {"'": 27, 'A': 7, 'B': 24, 'C': 19, 'D': 14, 'E': 5, 'F': 20, 'G': 21, 'H': 11, 'I': 10, 'J': 29, 'K': 26,
           'L': 15, 'M': 17, 'N': 9, 'O': 8, 'P': 23, 'Q': 30, 'R': 13, 'S': 12, 'T': 6, 'U': 16, 'V': 25, 'W': 18,
           'X': 28, 'Y': 22, 'Z': 31}
BLANK, SPACE, CLASSES = 0, 4, 32
FRAME = 0.02  # seconds per output frame (320 samples at 16 kHz)
RATE = 16000
ALIGNMENT_FILE = 'alignment.bin'
_MAGIC = b'KARALN1\n'
_HEADER = struct.Struct('<8sIB3x')
# Bounds the work of one alignment, frames times path states (about 5 s): a four-minute song with 3,000 letters of
# lyrics needs about 72 million.
MAX_CELLS = 250_000_000
# Letters that do not decompose into a Latin letter and accents.
_SPELLED = {'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i'}
# A Hangul syllable's initial consonant, vowel and final consonant in Revised Romanization (finals as pronounced at the
# end of a syllable). Sound changes between syllables are left out: they move letters little.
_INITIALS = ('g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h')
_VOWELS = ('a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu',
           'ui', 'i')
_FINALS = ('', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't',
           't', 'k', 't', 'p', 't')
_HANGUL, _SYLLABLES = 0xAC00, 11172
# Runs of Chinese characters (the unified ideographs and their extensions), read in pinyin together so that a character
# with several readings takes the one its phrase gives it.
_HAN = re.compile('[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0003134f]+')
MANDARIN = 'zh'


_verified: dict[str, tuple] = {}


def aligner_ready(model_root: Path) -> bool:
    """The aligner's pinned files are all present with matching sizes and SHA-256 (re-hashed only when they change)."""
    directory = Path(model_root) / ALIGNER.directory
    try:
        stats = [(directory / name).stat(follow_symlinks=False) for name, _, _ in ALIGNER.files.values()]
        signature = tuple((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) for info in stats)
    except OSError:
        return False
    if _verified.get(str(directory)) == signature:
        return True
    try:
        for name, size, expected in ALIGNER.files.values():
            path = directory / name
            if path.is_symlink() or not path.is_file() or path.stat().st_size != size:
                return False
            digest = hashlib.sha256()
            with path.open('rb') as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(chunk)
            if digest.hexdigest() != expected:
                return False
    except OSError:
        return False
    _verified[str(directory)] = signature
    return True


def _spelled(ch: str) -> str:
    code = ord(ch) - _HANGUL
    if 0 <= code < _SYLLABLES:
        return _INITIALS[code // 588] + _VOWELS[code % 588 // 28] + _FINALS[code % 28]
    return _SPELLED.get(ch.lower(), ch)


def _letters(spelled: str) -> str:
    text = unicodedata.normalize('NFKD', spelled.replace('’', "'"))
    return ''.join(ch for ch in text.upper() if ch in LETTERS)


def fold(text: str) -> str:
    """Upper-case Latin letters and apostrophes of ``text``, accents removed and Korean romanized; others are dropped."""
    return _letters(''.join(_spelled(ch) for ch in text))


def readings(text: str, language: str | None = None) -> list[str]:
    """Each character of ``text`` as the aligner spells it: ``fold``'s spelling, and in a song recognized as Mandarin
    (``language`` 'zh') each Chinese character's pinyin without tones. Without the pinyin package they stay unread."""
    spelled = [_spelled(ch) for ch in text]
    if language == MANDARIN and _HAN.search(text):
        try:
            from pypinyin import lazy_pinyin
        except ImportError:
            return spelled
        for run in _HAN.finditer(text):
            read = lazy_pinyin(run.group())
            if len(read) == len(run.group()):
                spelled[run.start():run.end()] = read
    return spelled


def word_letters(line: str, language: str | None = None) -> list[str]:
    """The aligner's letters for each lyric word of ``line`` (see ``lyrics_auto.lyric_words``), possibly empty."""
    from .lyrics_auto import lyric_words
    spelled, at, result = readings(line, language), 0, []
    for word in lyric_words(line):
        # Lyric words are the line's own characters, in order.
        at = line.index(word, at)
        result.append(_letters(''.join(spelled[at:at + len(word)])))
        at += len(word)
    return result


def alignable(lines: list[str], language: str | None = None) -> bool:
    """Whether the lyrics are written in letters the aligner knows (at least nine in ten of them): Latin, Korean, or
    Chinese in a song recognized as Mandarin."""
    known = total = 0
    for line in lines:
        spelled = readings(line, language)
        for ch, reading in zip(line, spelled, strict=True):
            if unicodedata.category(ch).startswith('L'):
                total += 1
                known += bool(_letters(reading))
    return bool(total) and known >= 0.9 * total


def write_emissions(path: Path, log_probs) -> None:
    """Store per-frame letter log-probabilities (frames x 32) as float16, written atomically."""
    import numpy as np
    values = np.ascontiguousarray(log_probs, dtype='<f2')
    if values.ndim != 2 or values.shape[1] != CLASSES:
        raise ValueError('Alignment output must have one row of letter scores per frame.')
    temporary = path.with_name(path.name + '.part')
    with temporary.open('xb') as stream:
        stream.write(_HEADER.pack(_MAGIC, values.shape[0], CLASSES))
        stream.write(values.tobytes())
    temporary.replace(path)


def max_bytes(duration: float) -> int:
    return _HEADER.size + (math.ceil(duration / FRAME) + 2) * CLASSES * 2


def read_emissions(raw: bytes, duration: float):
    """The stored log-probabilities for a clip of ``duration`` seconds, checked against it."""
    import numpy as np
    if len(raw) < _HEADER.size:
        raise ValueError('The stored alignment data is truncated.')
    magic, frames, classes = _HEADER.unpack_from(raw)
    if magic != _MAGIC or classes != CLASSES or abs(frames - duration / FRAME) > 2 or len(raw) != _HEADER.size + frames * CLASSES * 2:
        raise ValueError('The stored alignment data does not belong to this clip.')
    values = np.frombuffer(raw, dtype='<f2', offset=_HEADER.size).reshape(frames, CLASSES).astype(np.float32)
    if not np.isfinite(values).all() or (values > 1e-3).any():
        raise ValueError('The stored alignment data is invalid.')
    return values


def _path(log_probs, tokens: list[int]):
    """The most likely CTC path through ``tokens``: each token's first frame and the peak probability it reached.

    States alternate blank, token, blank, ... and a step may skip a blank between two different tokens. The score
    vectors are kept every ``span`` frames and each stretch is recomputed while tracing back, so memory grows with the
    square root of the length rather than with frames times states.
    """
    import numpy as np
    frames, states = log_probs.shape[0], 2 * len(tokens) + 1
    labels = np.full(states, BLANK, dtype=np.int64)
    labels[1::2] = tokens
    skip = np.zeros(states, dtype=bool)
    if len(tokens) > 1:
        skip[3::2] = np.asarray(tokens[1:]) != np.asarray(tokens[:-1])
    floor = np.float32(-1e30)
    span = max(1, int(math.sqrt(frames)))

    def advance(score, t, back=None):
        step1 = np.empty_like(score)
        step1[0] = floor
        step1[1:] = score[:-1]
        step2 = np.full_like(score, floor)
        step2[2:] = np.where(skip[2:], score[:-2], floor)
        best = np.maximum(score, np.maximum(step1, step2))
        if back is not None:
            back[:] = np.where(best == score, 0, np.where(best == step1, 1, 2))
        return best + log_probs[t, labels]

    score = np.full(states, floor, dtype=np.float32)
    score[0] = log_probs[0, BLANK]
    if states > 1:
        score[1] = log_probs[0, labels[1]]
    checkpoints = {0: score.copy()}
    for t in range(1, frames):
        score = advance(score, t)
        if t % span == 0:
            checkpoints[t] = score.copy()
    final = states - 1 if score[states - 1] >= score[states - 2] else states - 2
    if score[final] <= floor / 2:
        return None
    first = np.full(len(tokens), -1, dtype=np.int64)
    peak = np.zeros(len(tokens), dtype=np.float32)

    def visit(t: int, state: int) -> None:
        if state % 2 == 1:
            first[state // 2] = t
            peak[state // 2] = max(peak[state // 2], math.exp(float(log_probs[t, labels[state]])))

    state, last = final, frames - 1
    visit(last, state)
    for begin in sorted(checkpoints, reverse=True):
        if begin >= last:
            continue
        # Recompute this stretch's choices, then follow them back from its last frame to its checkpoint.
        backs = np.zeros((last - begin, states), dtype=np.int8)
        score = checkpoints[begin].copy()
        for t in range(begin + 1, last + 1):
            score = advance(score, t, backs[t - begin - 1])
        for t in range(last, begin, -1):
            state -= int(backs[t - begin - 1][state])
            visit(t - 1, state)
        last = begin
    return first, peak


def force_align(lines: list[str], log_probs, duration: float, language: str | None = None) -> list[dict] | None:
    """Cues for supplied ``lines`` placed on the singing: start, end, text and ``matched`` (how surely each was found).

    ``language`` is the song's recognized language (see ``readings``). Returns None when the lyrics cannot be laid on
    these frames (none of their letters are known, or there are more letters than frames), so the caller can fall back
    to matching recognized words.
    """
    from .lyrics_auto import HOLD, _finish
    lines = [line.strip() for line in lines if isinstance(line, str) and line.strip()]
    if not lines or log_probs is None or not len(log_probs):
        return None
    tokens: list[int] = []
    owned: list[list[tuple[int, int]]] = []  # per line: (first token, letter count) of each word with letters
    for line in lines:
        words = []
        for letters in word_letters(line, language):
            if not letters:
                continue
            if tokens:
                tokens.append(SPACE)
            words.append((len(tokens), len(letters)))
            tokens += [LETTERS[ch] for ch in letters]
        owned.append(words)
    frames = log_probs.shape[0]
    if not tokens or len(tokens) * 2 >= frames or frames * (2 * len(tokens) + 1) > MAX_CELLS:
        return None
    found = _path(log_probs, tokens)
    if found is None:
        return None
    first, peak = found
    spans: list[tuple[float, float] | None] = []
    clarity: list[float | None] = []
    for words in owned:
        if not words:
            spans.append(None)
            clarity.append(None)
            continue
        begin, (last, count) = words[0][0], words[-1]
        letters = [k for at, n in words for k in range(at, at + n)]
        spans.append((int(first[begin]) * FRAME, (int(first[last + count - 1]) + 1) * FRAME))
        clarity.append(float(peak[letters].mean()))
    # How clearly each line's letters were heard, against the song's typical line: one heard less than half as clearly
    # is reported unsure. (On the benchmark that flagged 6% of lines, a third of them misplaced; a fixed bar flagged a
    # quarter, mostly in French, where the English-trained model is less sure of every line.)
    heard = sorted(value for value in clarity if value is not None)
    typical = heard[len(heard) // 2] if heard else 0.0
    scores = [0.0 if value is None or typical <= 0 else min(1.0, value / typical) for value in clarity]
    # A line without letters (numbers or symbols only) sits between its neighbours.
    for index, span in enumerate(spans):
        if span is None:
            before = next((spans[k][1] for k in range(index - 1, -1, -1) if spans[k]), 0.0)
            after = next((spans[k][0] for k in range(index + 1, len(spans)) if spans[k]), duration)
            spans[index] = (before, max(before, min(after, before + 1.0)))
    groups = [[dict(text=line, start=start, end=max(end - HOLD, start))] for line, (start, end) in zip(lines, spans, strict=True)]
    return _finish(groups, duration, scores)


def force_words(text: str, log_probs, start: float, end: float, margin: float = 0.25, language: str | None = None) -> list[float] | None:
    """When each lyric word of a line sung from ``start`` to ``end`` starts, from the letters measured there.

    Words without letters the aligner knows (numbers, symbols) start between their neighbours. Returns None when the
    line cannot be laid on these frames: no letters it knows, or too few frames for its letters.
    """
    tokens: list[int] = []
    firsts: list[int | None] = []
    for letters in word_letters(text, language):
        if not letters:
            firsts.append(None)
            continue
        if tokens:
            tokens.append(SPACE)
        firsts.append(len(tokens))
        tokens += [LETTERS[ch] for ch in letters]
    if not tokens or log_probs is None:
        return None
    low, high = max(0, int((start - margin) / FRAME)), min(len(log_probs), math.ceil((end + margin) / FRAME))
    if high - low < len(tokens) + 10:
        return None
    found = _path(log_probs[low:high], tokens)
    if found is None:
        return None
    first = found[0]
    times: list[float | None] = [None if at is None else (low + int(first[at])) * FRAME for at in firsts]
    known = [k for k, value in enumerate(times) if value is not None]
    for k, value in enumerate(times):
        if value is None:
            before = max((j for j in known if j < k), default=None)
            after = min((j for j in known if j > k), default=None)
            times[k] = times[before] if before is not None else times[after] if after is not None else start
    return [float(value) for value in times]
