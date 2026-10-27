"""Word-timed LRC lyrics: the synced-lyrics format music players and karaoke apps load.

Each saved line is written as ``[mm:ss.xx]`` followed by its words, each preceded by an
``<mm:ss.xx>`` tag (the widely supported "enhanced LRC" extension), timed exactly as the
preview and the exported video highlight them. A line that ends before the next one starts is
followed by an empty timed line, so players clear it on time.
"""
from __future__ import annotations

import re

from .lyrics_auto import needs_space, word_timings
from .model import validate_project

# LRC has no escaping: tag brackets inside lyrics or the title would read as timestamps.
_TAG_CHARACTERS = str.maketrans({'[': '(', ']': ')', '<': '(', '>': ')'})


def _stamp(seconds: float) -> str:
    centiseconds = max(0, round(seconds * 100))
    minutes, rest = divmod(centiseconds, 6000)
    return f'{minutes:02}:{rest // 100:02}.{rest % 100:02}'


def _plain(text: str) -> str:
    return re.sub(r'\s+', ' ', text.translate(_TAG_CHARACTERS)).strip()


def render_lrc(project: dict, words: list | None = None) -> str:
    """The project's saved lyrics as enhanced LRC; ``words`` are recognized words (may be empty)."""
    project = validate_project(project)
    cues = project['cues']
    timings = word_timings(cues, words or [], project['duration'])
    lines = [f'[ti:{_plain(project["title"])}]', f'[length:{_stamp(project["duration"])[:5]}]', '[re:Karaoke Studio]']
    for index, cue in enumerate(cues):
        sung, previous = '', ''
        for word in timings[index]:
            text = _plain(word['text'])
            if text:
                sung += f'{" " if previous and needs_space(previous, text) else ""}<{_stamp(word["start"])}>{text}'
                previous = text
        lines.append(f'[{_stamp(cue["start"])}]{sung}')
        following = cues[index + 1]['start'] if index + 1 < len(cues) else None
        if following is None or following - cue['end'] >= 0.01:
            lines.append(f'[{_stamp(cue["end"])}]')
    return '\n'.join(lines) + '\n'
