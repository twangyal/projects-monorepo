"""Word-timed LRC lyrics: the synced-lyrics format music players and karaoke apps load.

Each saved line carries a timestamp with two or three fractional digits. The words
carry enhanced LRC tags based on the same highlighting times as the preview and video. A line that ends before the next one starts is
followed by an empty timed line, so players clear it on time.
"""
from __future__ import annotations

import re
from decimal import Decimal, ROUND_HALF_UP

from .lyrics_auto import needs_space, word_timings
from .model import ValidationError, validate_project

# LRC has no escaping: tag brackets inside lyrics or the title would read as timestamps.
_TAG_CHARACTERS = str.maketrans({'[': '(', ']': ')', '<': '(', '>': ')'})


def _stamp(seconds: float) -> str:
    centiseconds = max(0, round(seconds * 100))
    return _stamp_ms(centiseconds * 10)


def _stamp_ms(milliseconds: int) -> str:
    minutes, rest = divmod(milliseconds, 60000)
    seconds, fraction = divmod(rest, 1000)
    # Keep the familiar two-digit form when it represents the same instant.
    tail = f'{fraction:03}' if fraction % 10 else f'{fraction // 10:02}'
    return f'{minutes:02}:{seconds:02}.{tail}'


def _line_ms(seconds: float) -> int:
    # Round decimal ties consistently; binary products can fall on either side of a half millisecond.
    return int((Decimal(str(seconds)) * 1000).to_integral_value(rounding=ROUND_HALF_UP))


def _plain(text: str) -> str:
    return re.sub(r'\s+', ' ', text.translate(_TAG_CHARACTERS)).strip()


def render_lrc(project: dict, words: list | None = None, letters=None) -> str:
    """The project's saved lyrics as enhanced LRC; ``words`` are recognized words (may be empty) and ``letters`` the
    letters measured in the vocals, when there are any (see ``alignment``)."""
    project = validate_project(project)
    cues = project['cues']
    duration = project['duration']
    last_ms = round(duration * 1000)
    if last_ms / 1000 > duration:
        last_ms -= 1
    boundaries = [(min(_line_ms(cue['start']), last_ms), min(_line_ms(cue['end']), last_ms))
                  for cue in cues]
    for index, (start_ms, end_ms) in enumerate(boundaries):
        if start_ms >= end_ms:
            raise ValidationError(f'Lyric line {index + 1} collapses at LRC millisecond precision. '
                                  'Lengthen its interval and save before exporting.')
    timings = word_timings(cues, words or [], duration, letters)
    lines = [f'[ti:{_plain(project["title"])}]', f'[length:{_stamp(project["duration"])[:5]}]', '[re:Karaoke Studio]']
    for index, (start_ms, end_ms) in enumerate(boundaries):
        sung, previous = '', ''
        for word in timings[index]:
            text = _plain(word['text'])
            if text:
                # Word tags keep the usual centisecond rounding, bounded by the exported cue.
                word_ms = min(end_ms - 1, max(start_ms, round(word['start'] * 100) * 10))
                sung += f'{" " if previous and needs_space(previous, text) else ""}<{_stamp_ms(word_ms)}>{text}'
                previous = text
        lines.append(f'[{_stamp_ms(start_ms)}]{sung}')
        following = boundaries[index + 1][0] if index + 1 < len(boundaries) else None
        if following is None or following > end_ms:
            lines.append(f'[{_stamp_ms(end_ms)}]')
    return '\n'.join(lines) + '\n'
