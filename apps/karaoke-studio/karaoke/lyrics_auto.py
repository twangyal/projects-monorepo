"""Turn recognized, timed words into karaoke lyric lines, and time supplied lyrics against them.

Pure functions without ML dependencies. A *word* is ``{'text', 'start', 'end'}`` in seconds, as
produced by the transcription worker from the separated vocals. Recognition of sung words is
imperfect, so every produced line carries a ``matched`` share that the interface uses to point
people at passages worth checking.
"""
from __future__ import annotations

import math
import re
import unicodedata

from .limits import MAX_CUES, MAX_LYRIC_CHARS
from .word_alignment import AlignmentBudget, align as _align

MAX_CUE_CHARS = 240
# Line breaking: a pause this long always starts a new line; shorter pauses break long lines.
# Chosen on 20 JamendoLyrics songs (scripts/evaluate_lyrics.py): line-start F1 0.714 (0.700 leave-one-out).
BREAK_PAUSE = 0.6
SOFT_PAUSE = 0.4
SOFT_CHARS = 20
HARD_CHARS = 40
# Recognized words below this confidence were right only 29% of the time on the evaluation songs
# (84% at or above it), so lines averaging below it are worth a listen.
UNSURE = 0.7
LEAD_IN = 0.15
HOLD = 0.35

# Scripts written without spaces between words. Each Chinese, Japanese, Thai, Lao, Myanmar or Khmer
# character is its own lyric word for timing and highlighting; Tibetan words end at a syllable mark.
# word-timing.ts splits words with the same rule.
_EACH = ((0x0E00, 0x0EFF), (0x1000, 0x109F), (0x1780, 0x17FF), (0x2E80, 0x2FDF), (0x3005, 0x3007),
         (0x3021, 0x3029), (0x3038, 0x303B), (0x3040, 0x30FF), (0x31F0, 0x31FF), (0x3400, 0x4DBF),
         (0x4E00, 0x9FFF), (0xF900, 0xFAFF), (0xFF66, 0xFF9F), (0x20000, 0x3134F))
_TIBETAN = (0x0F00, 0x0FFF)
_SYLLABLE_ENDS = frozenset('\u0f0b\u0f0c\u0f0d\u0f0e')


def _kind(character: str) -> str:
    code = ord(character)
    if any(low <= code <= high for low, high in _EACH):
        return 'each'
    return 'tibetan' if _TIBETAN[0] <= code <= _TIBETAN[1] else 'other'


def lyric_words(text: str) -> list[str]:
    """A lyric line's words: whitespace-separated, with spaceless scripts split as described above.

    Combining marks and punctuation stay with the word before them; opening punctuation joins the next.
    """
    words: list[str] = []
    for part in text.split():
        pieces: list[str] = []
        for character in part:
            category = unicodedata.category(character)
            if pieces:
                last = pieces[-1][-1]
                opening = all(unicodedata.category(c) in ('Ps', 'Pi') for c in pieces[-1])
                kind, previous = _kind(character), _kind(last)
                if (opening or category[0] == 'M' or (category[0] == 'P' and category not in ('Ps', 'Pi'))
                        or (kind == previous == 'tibetan' and last not in _SYLLABLE_ENDS)
                        or (kind == previous == 'other')):
                    pieces[-1] += character
                    continue
            pieces.append(character)
        words.extend(pieces)
    return words


def _edge(word: str, last: bool) -> str:
    """The script kind of a word's first (or last) letter, passing over punctuation and marks."""
    for character in reversed(word) if last else word:
        if unicodedata.category(character)[0] not in 'PM':
            return _kind(character)
    return 'other'


def needs_space(left: str, right: str) -> bool:
    """Whether two adjacent lyric words are written with a space between them."""
    return not _edge(left, True) == _edge(right, False) != 'other'


def join_words(words: list[str]) -> str:
    """Words back into a line: no space between two words of the same spaceless script."""
    text = ''
    for word in words:
        text += (' ' if text and needs_space(text, word) else '') + word
    return text


def _width(text: str) -> int:
    """Line length in Latin-letter widths; a character of a spaceless script counts twice."""
    return sum(2 if _kind(character) == 'each' else 1 for character in text)


def _clean(word: object) -> dict | None:
    if not isinstance(word, dict):
        return None
    text, start, end = word.get('text'), word.get('start'), word.get('end')
    if (not isinstance(text, str) or not text.strip() or type(start) not in (int, float) or type(end) not in (int, float)
            or not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < start):
        return None
    confidence = word.get('confidence', 1.0)
    if type(confidence) not in (int, float) or not 0 <= confidence <= 1:
        confidence = 1.0
    return dict(text=' '.join(text.split()), start=float(start), end=float(end), confidence=float(confidence))


def clean_words(words: list, duration: float) -> list[dict]:
    """Valid words in time order, clipped to the clip."""
    result = []
    for raw in words if isinstance(words, list) else []:
        word = _clean(raw)
        if word is None or word['start'] >= duration:
            continue
        word['end'] = min(max(word['end'], word['start'] + 0.05), duration)
        result.append(word)
    result.sort(key=lambda w: (w['start'], w['end']))
    return result


def _finish(groups: list[list[dict]], duration: float, scores: list[float] | None = None, key: str = 'matched') -> list[dict]:
    """Interval rules shared by both modes: ordered, non-overlapping, inside the clip, bounded text."""
    cues = []
    total = 0
    if len(groups) > MAX_CUES:
        raise ValueError('The complete lyrics exceed the line limit; shorten or regroup them.')
    for index, group in enumerate(groups):
        text = join_words([word['text'] for word in group]).strip()
        if len(text) > MAX_CUE_CHARS or total + len(text) > MAX_LYRIC_CHARS:
            raise ValueError('The complete lyrics exceed the text limit; shorten or regroup them.')
        if not text:
            continue
        previous_end = cues[-1]['end'] if cues else 0.0
        next_start = max(groups[index + 1][0]['start'] - LEAD_IN, 0.0) if index + 1 < len(groups) else duration
        start = max(previous_end, group[0]['start'] - LEAD_IN, 0.0)
        end = min(max(group[-1]['end'] + HOLD, start + 0.5), next_start, duration)
        if end - start < 0.05:
            # Words recognized on top of each other: borrow time from the following gap if any.
            end = min(start + 0.3, duration)
            if end <= start:
                break
        cue = dict(start=round(start, 3), end=round(end, 3), text=text)
        if cues and cue['start'] < cues[-1]['end']:
            cue['start'] = cues[-1]['end']
        if cue['end'] <= cue['start']:
            continue
        if scores is not None:
            cue[key] = round(scores[index], 3)
        cues.append(cue)
        total += len(text)
    return cues


def words_to_cues(words: list, duration: float, confidence: bool = False) -> list[dict]:
    """Group recognized words into singable lines using pauses and line length.

    With ``confidence``, each line also reports the mean confidence of its words.
    """
    words = clean_words(words, duration)
    groups: list[list[dict]] = []
    for word in words:
        if groups:
            line = groups[-1]
            gap = word['start'] - line[-1]['end']
            length = sum(_width(w['text']) + 1 for w in line)
            if not (gap >= BREAK_PAUSE or (gap >= SOFT_PAUSE and length >= SOFT_CHARS) or length + _width(word['text']) > HARD_CHARS):
                line.append(word)
                continue
        groups.append([word])
    if len(groups) > MAX_CUES:
        # Longer songs retain every word by using fewer, longer contiguous lines.
        # Never silently publish only the beginning of a transcript.
        target_chars = max(HARD_CHARS, math.ceil(sum(len(w['text']) + 1 for w in words) / MAX_CUES))
        groups = []
        length = 0
        for word in words:
            if not groups or length >= target_chars or length + len(word['text']) > MAX_CUE_CHARS:
                groups.append([])
                length = 0
            groups[-1].append(word)
            length += len(word['text']) + 1
    if not confidence:
        return _finish(groups, duration)
    return _finish(groups, duration, [sum(w['confidence'] for w in group) / len(group) for group in groups], 'confidence')


def _token(text: str) -> str:
    text = unicodedata.normalize('NFKD', text.casefold())
    text = ''.join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^\w]|_", '', text.replace("'", '').replace('’', ''))


def align_lines(lines: list[str], words: list, duration: float) -> list[dict]:
    """Time supplied lyric lines from recognized words.

    Each line's words are matched to the recognized sequence; a line takes the time of its matched
    words. Lines nobody was heard singing are placed proportionally between their neighbours, and
    ``matched`` reports the share of the line's words that were found.
    """
    words = clean_words(words, duration)
    # Supplied text is kept exactly (outer whitespace aside); only its timing is computed.
    lines = [line.strip() for line in lines if isinstance(line, str) and line.strip()]
    if not lines:
        return []
    heard = [_token(word['text']) for word in words]
    reference, owner = [], []
    for index, line in enumerate(lines):
        for part in lyric_words(line):
            token = _token(part)
            if token:
                reference.append(token)
                owner.append(index)
    matches = _align(reference, heard) if reference and heard else [None] * len(reference)
    spans: list[tuple[float, float] | None] = []
    shares = []
    for index in range(len(lines)):
        found = [matches[k] for k in range(len(reference)) if owner[k] == index and matches[k] is not None]
        tokens = sum(1 for k in owner if k == index)
        shares.append(len(found) / tokens if tokens else 0.0)
        spans.append((words[min(found)]['start'], words[max(found)]['end']) if found else None)
    # A single stray match in a mostly unmatched line is unreliable; treat it as unknown.
    for index, span in enumerate(spans):
        if span is not None and shares[index] < 0.34 and len(lyric_words(lines[index])) >= 3:
            spans[index] = None
    # Enforce order: drop anchors that would run backwards.
    last = -1.0
    for index, span in enumerate(spans):
        if span is None:
            continue
        if span[0] < last:
            spans[index] = None
        else:
            last = span[1]
    # Fill unknown lines between anchors in proportion to their length.
    filled: list[tuple[float, float]] = []
    index = 0
    while index < len(lines):
        if spans[index] is not None:
            filled.append(spans[index])
            index += 1
            continue
        run_end = index
        while run_end < len(lines) and spans[run_end] is None:
            run_end += 1
        # Unheard lines begin after the previous line's hold, not on its last sung word.
        left = filled[-1][1] + HOLD if filled else (words[0]['start'] if words else 0.0)
        right = spans[run_end][0] if run_end < len(lines) else (max(words[-1]['end'], left) if words else duration)
        # Singing that was heard but not matched marks where these lines most likely are;
        # instrumental stretches inside the gap are skipped.
        sung = [word for word in words if left <= word['start'] and word['end'] <= right]
        if sung:
            left, right = max(left, sung[0]['start']), min(right, max(sung[-1]['end'], sung[0]['start'] + 0.3 * (run_end - index)))
        if right - left < 0.3 * (run_end - index):
            right = min(duration, left + 2.5 * (run_end - index))
        weights = [max(len(lines[k]), 1) for k in range(index, run_end)]
        cursor, total = left, sum(weights)
        for k, weight in zip(range(index, run_end), weights, strict=True):
            step = (right - left) * weight / total
            filled.append((cursor, cursor + step))
            cursor += step
        index = run_end
    groups = [[dict(text=lines[k], start=filled[k][0], end=max(filled[k][1] - HOLD, filled[k][0]))] for k in range(len(lines))]
    return _finish(groups, duration, shares)


# Word-by-word highlighting: each saved line is split into lyric words and every word gets the time it
# starts being sung. A line highlights in at most this many steps, which bounds video cards.
MAX_STEPS = 16
NEARBY = 0.25


def word_timings(cues: list[dict], words: list, duration: float) -> list[list[dict]]:
    """For each cue, its words with the time each starts being sung and whether it was heard.

    Words are matched to recognized words sung during the cue (spelling-tolerant global alignment).
    Unheard words are placed between their heard neighbours in proportion to their length, and a
    line with no recognized words is spread across its interval, so corrected and supplied lyrics
    highlight too. Starts never decrease within a line and stay inside the cue.
    """
    words = clean_words(words, duration)
    result = []
    budget = AlignmentBudget()
    for cue in cues:
        start, end = float(cue['start']), float(cue['end'])
        tokens = lyric_words(cue['text'])
        if not tokens:
            result.append([])
            continue
        # A timed line starts when its singing starts (marked, imported or aligned); recognized words
        # refine that, and automatic lines' short lead-in is covered by their recognized first word.
        span = end - start
        sing_start = start
        sing_end = max(end - min(HOLD, span * 0.2), sing_start)
        nearby = [w for w in words if w['end'] > start - NEARBY and w['start'] < end + NEARBY]
        reference = [_token(token) for token in tokens]
        matches = _align(reference, [_token(w['text']) for w in nearby], budget) if nearby else [None] * len(tokens)
        anchors: list[float | None] = [None] * len(tokens)
        last = -math.inf
        for index, match in enumerate(matches):
            if match is None or not reference[index]:
                continue
            at = min(max(nearby[match]['start'], start), sing_end)
            if at >= last:  # an anchor that runs backwards is a stray match
                anchors[index], last = at, at
        weights = [len(token) + 1 for token in tokens]
        starts = list(anchors)
        index = 0
        while index < len(tokens):
            if starts[index] is not None:
                index += 1
                continue
            run_end = index
            while run_end < len(tokens) and anchors[run_end] is None:
                run_end += 1
            # The run shares the time from the previous heard word (or the start of singing) to the
            # next heard word (or the end of singing), in proportion to word length.
            first = index - 1 if index > 0 else index
            left = starts[index - 1] if index > 0 else sing_start
            right = anchors[run_end] if run_end < len(tokens) else sing_end
            right = max(right, left)
            total = sum(weights[first:run_end])
            for k in range(index, run_end):
                starts[k] = left + (right - left) * sum(weights[first:k]) / total
            index = run_end
        if len(tokens) > MAX_STEPS:
            # Group words into at most MAX_STEPS highlight steps; each group starts with its first word.
            group = [k * len(tokens) // MAX_STEPS for k in range(MAX_STEPS)]
            for k, begin in enumerate(group):
                stop = group[k + 1] if k + 1 < MAX_STEPS else len(tokens)
                for j in range(begin, stop):
                    starts[j] = starts[begin]
        result.append([dict(text=token, start=min(max(round(at, 3), start), end), heard=anchors[k] is not None)
                       for k, (token, at) in enumerate(zip(tokens, starts, strict=True))])
    return result


def sung_count(timings: list[dict], position: float) -> int:
    """How many of a line's words have started by ``position``."""
    return sum(1 for word in timings if word['start'] <= position)
