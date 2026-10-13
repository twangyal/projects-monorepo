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
    for index, group in enumerate(groups):
        if len(cues) >= MAX_CUES:
            break
        text = ' '.join(word['text'] for word in group)[:MAX_CUE_CHARS].strip()
        if not text or total + len(text) > MAX_LYRIC_CHARS:
            break
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
            length = sum(len(w['text']) + 1 for w in line)
            if not (gap >= BREAK_PAUSE or (gap >= SOFT_PAUSE and length >= SOFT_CHARS) or length + len(word['text']) > HARD_CHARS):
                line.append(word)
                continue
        groups.append([word])
    if not confidence:
        return _finish(groups, duration)
    return _finish(groups, duration, [sum(w['confidence'] for w in group) / len(group) for group in groups], 'confidence')


def _token(text: str) -> str:
    text = unicodedata.normalize('NFKD', text.casefold())
    text = ''.join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^\w]|_", '', text.replace("'", '').replace('’', ''))


def _similar(a: str, b: str) -> bool:
    if a == b:
        return True
    if min(len(a), len(b)) < 3:
        return False
    # Sung words are often recognized with a letter or two wrong ("gonna"/"gona").
    if a[:3] != b[:3] and a[-2:] != b[-2:]:
        return False
    common = sum(1 for x, y in zip(a, b) if x == y)
    return common / max(len(a), len(b)) >= 0.6


def _align(reference: list[str], heard: list[str]) -> list[int | None]:
    """For each reference token, the index of the heard token it matches (global alignment)."""
    n, m = len(reference), len(heard)
    # Banded edit distance would be faster; songs are bounded (≤ ~3,000 x ~1,500 tokens).
    previous = list(range(m + 1))
    moves = []
    for i in range(1, n + 1):
        current = [i] + [0] * m
        row = bytearray(m + 1)
        row[0] = 1
        ref = reference[i - 1]
        for j in range(1, m + 1):
            match = previous[j - 1] + (0 if _similar(ref, heard[j - 1]) else 1)
            skip_ref = previous[j] + 1
            skip_heard = current[j - 1] + 1
            if match <= skip_ref and match <= skip_heard:
                current[j], row[j] = match, 0
            elif skip_ref <= skip_heard:
                current[j], row[j] = skip_ref, 1
            else:
                current[j], row[j] = skip_heard, 2
        moves.append(row)
        previous = current
    result: list[int | None] = [None] * n
    i, j = n, m
    while i > 0 and j > 0:
        move = moves[i - 1][j]
        if move == 0:
            if _similar(reference[i - 1], heard[j - 1]):
                result[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif move == 1:
            i -= 1
        else:
            j -= 1
    return result


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
        for part in line.split():
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
        if span is not None and shares[index] < 0.34 and len(lines[index].split()) >= 3:
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
