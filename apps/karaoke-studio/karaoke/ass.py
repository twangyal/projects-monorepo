"""Karaoke subtitles in Advanced SubStation Alpha (ASS), the format karaoke players and subtitle editors (mpv, VLC,
Aegisub) read.

Each saved line is one Dialogue event in the Classic lyric colours: words start in the main colour and fill with the
accent colour as they are sung, through ``\\kf`` tags. Each word starts filling when the preview and the exported video
highlight it and fills until the next word starts, the last until the line ends; the wait before the first word is an
empty ``\\k`` tag.
"""
from __future__ import annotations

import re

from .lyrics_auto import needs_space, word_timings
from .model import validate_project
from .video import ACCENT, BACKGROUND, MAIN

# Override blocks start with "{" and escapes with "\": lyrics must not open either.
_OVERRIDE_CHARACTERS = str.maketrans({'{': '(', '}': ')', '\\': '/'})


def _time(seconds: float) -> str:
    centiseconds = max(0, round(seconds * 100))
    hours, rest = divmod(centiseconds, 360000)
    minutes, rest = divmod(rest, 6000)
    return f'{hours}:{minutes:02}:{rest // 100:02}.{rest % 100:02}'


def _colour(hex_colour: str, alpha: int = 0) -> str:
    """``#rrggbb`` as ASS ``&HAABBGGRR``."""
    red, green, blue = hex_colour[1:3], hex_colour[3:5], hex_colour[5:7]
    return f'&H{alpha:02X}{blue}{green}{red}'.upper()


def _plain(text: str) -> str:
    return re.sub(r'\s+', ' ', text.translate(_OVERRIDE_CHARACTERS)).strip()


def render_ass(project: dict, words: list | None = None, letters=None) -> str:
    """The project's saved lyrics as karaoke ASS subtitles; ``words`` are recognized words (may be empty) and
    ``letters`` the letters measured in the vocals, when there are any (see ``alignment``)."""
    project = validate_project(project)
    cues = project['cues']
    timings = word_timings(cues, words or [], project['duration'], letters)
    style = ','.join(['Karaoke', 'Arial', '54', _colour(ACCENT), _colour(MAIN), _colour(BACKGROUND), _colour(BACKGROUND, 0x80),
                      '-1', '0', '0', '0', '100', '100', '0', '0', '1', '3', '0', '2', '60', '60', '60', '1'])
    lines = ['[Script Info]', f'Title: {_plain(project["title"])}', 'ScriptType: v4.00+', 'PlayResX: 1280', 'PlayResY: 720',
             'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
             '[V4+ Styles]',
             'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, '
             'StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
             f'Style: {style}', '',
             '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
    for index, cue in enumerate(cues):
        sung, previous, at = '', '', round(cue['start'] * 100)
        sung_words = [(text, round(word['start'] * 100)) for word in timings[index] if (text := _plain(word['text']))]
        if sung_words and sung_words[0][1] > at:
            sung += f'{{\\k{sung_words[0][1] - at}}}'
            at = sung_words[0][1]
        for number, (text, _start) in enumerate(sung_words):
            until = sung_words[number + 1][1] if number + 1 < len(sung_words) else round(cue['end'] * 100)
            sung += f'{" " if previous and needs_space(previous, text) else ""}{{\\kf{max(1, until - at)}}}{text}'
            at, previous = max(until, at + 1), text
        lines.append(f'Dialogue: 0,{_time(cue["start"])},{_time(cue["end"])},Karaoke,,0,0,0,,{sung}')
    return '\n'.join(lines) + '\n'
