"""Literal Pillow lyric cards and bounded, local FFmpeg video exports."""
import functools
import math
import os
from pathlib import Path
import selectors
import signal
import subprocess
import tempfile
import threading
import time
import unicodedata
import wave

import base64
import io

from PIL import Image, ImageDraw, ImageFilter, ImageFont, features

from .limits import (COUNT_IN, COUNT_IN_BREAK, MAX_CARD_BYTES, MAX_CARDS, MAX_VIDEO_BYTES, MAX_VIDEO_FRAMES,
                     SAMPLE_RATE, VIDEO_TIMEOUT)
from .model import ValidationError, validate_project
from .media_io import media_handles
from .bidi import lit_words, sung_stretches, word_places
from .lyrics_auto import sung_count, word_timings
from .pronunciation import pronunciation as line_pronunciation, said_line
from .melody import validate_notes

WIDTH, HEIGHT, FPS = 1280, 720, 24
# Video sizes: cards are laid out at 1280x720 (or 720x1280 upright, for phones) and every position and size is scaled to
# the chosen frame.
VIDEO_SIZES = {'720p': (1280, 720), '1080p': (1920, 1080), 'vertical': (1080, 1920)}
# Where a card's parts sit, in its layout's own pixels (the browser preview draws the same, see src/card-layout.ts):
# the title, the line being sung (centre and room, and the same with a pronunciation under it), that pronunciation,
# the count-in dots, the next line, the footer, and how wide a line may run.
LAYOUTS = {
    'landscape': dict(width=1280, height=720, title=80, middle=320, room=300, said_middle=290, said_room=200, said=430, dots=430,
                      next=540, footer=660, wrap=1000),
    'portrait': dict(width=720, height=1280, title=140, middle=500, room=440, said_middle=470, said_room=280, said=670, dots=610,
                     next=860, footer=1180, wrap=600),
}


def layout_of(size: str) -> dict:
    """The card layout for a video size: upright for a frame taller than it is wide."""
    width, height = VIDEO_SIZES[size]
    return LAYOUTS['portrait' if height > width else 'landscape']


# With the melody guide, its lane of pitch bars lies between the title and the line being sung, which moves down and may
# grow less tall (the browser preview draws the same, see src/card-layout.ts). The lane shows GUIDE_SECONDS of notes,
# GUIDE_PAST of them already sung, left of the playhead.
GUIDES = {
    'landscape': dict(lane_top=132, lane_bottom=236, middle=345, room=210, said_middle=320, said_room=150),
    'portrait': dict(lane_top=200, lane_bottom=366, middle=560, room=320, said_middle=530, said_room=220),
}
GUIDE_SECONDS, GUIDE_PAST = 5.0, 1.0


def guide_of(size: str) -> dict:
    """The card layout for a video size with the melody guide's lane."""
    width, height = VIDEO_SIZES[size]
    return {**layout_of(size), **GUIDES['portrait' if height > width else 'landscape']}


def guide_lane(size: str) -> dict:
    """The melody guide's lane in a frame of ``size``, in whole pixels: left, top, width, height and the playhead's
    distance from its left edge, and how many pixels a second of notes takes (``pps``)."""
    place, (width, height) = guide_of(size), VIDEO_SIZES[size]
    k = height / place['height']
    lane = round(place['wrap'] * k)
    return dict(left=(width - lane) // 2, top=round(place['lane_top'] * k), width=lane, height=round((place['lane_bottom'] - place['lane_top']) * k),
                playhead=round(lane * GUIDE_PAST / GUIDE_SECONDS), pps=lane / GUIDE_SECONDS)


def pitch_range(notes: list) -> tuple[int, int]:
    """The semitones the lane spans: most of the song's notes (from its 5th to 95th percentile note) and two either
    side, at least an octave; the browser preview uses the same (see src/melody-guide.ts)."""
    pitches = sorted(note[2] for note in notes) or [60]
    low, high = pitches[math.floor(0.05 * (len(pitches) - 1))] - 2, pitches[math.ceil(0.95 * (len(pitches) - 1))] + 2
    if high - low < 12:
        extra = 12 - (high - low)
        low, high = low - extra // 2, high + extra - extra // 2
    return low, high


def bar_box(pitch: int, low: int, high: int, height: float) -> tuple[float, float]:
    """A note's bar in a lane ``height`` tall: its top and its thickness, higher notes higher."""
    pad = height * 0.08
    step = (height - 2 * pad) / (high - low + 1)
    # Bars thicker than a semitone's step stay readable; a sung melody's notes rarely sound at once.
    thick = max(height * 0.075, step * 0.8)
    centre = pad + (high - min(max(pitch, low), high) + 0.5) * step
    return centre - thick / 2, thick


BACKGROUND = '#14232f'
MUTED = '#9dafbb'
MAIN = '#f7f5ed'
ACCENT = '#e4b77d'
# Lyric styles for exported videos (the browser preview draws the same ones): colours, and the lyric sizes' scale.
# High contrast is white and yellow on black; large print scales the lines being sung and the next one.
STYLES = {
    'classic': dict(background=BACKGROUND, muted=MUTED, main=MAIN, accent=ACCENT, scale=1.0),
    'contrast': dict(background='#000000', muted='#d9d9d9', main='#ffffff', accent='#ffd400', scale=1.0),
    'large': dict(background=BACKGROUND, muted=MUTED, main=MAIN, accent=ACCENT, scale=1.45),
    'light': dict(background='#f7f3ea', muted='#5e6b73', main='#17242d', accent='#9a4a12', scale=1.0),
}


# Duets (see src/parts.ts): the lines each singer sings light up in their own colour, singer 1 in the style's accent,
# and lines both sing in a third; their words still to be sung lean PART_TINT of the way toward it, and the next line
# says whose it is. Singer 2's colour and both singers' in each style:
PART_COLOURS = {
    'classic': ('#8ec5ff', '#c9a7ff'),
    'contrast': ('#00e5ff', '#ff7ae0'),
    'large': ('#8ec5ff', '#c9a7ff'),
    'light': ('#1f5fa8', '#7a3a9a'),
}
PART_TINT = 0.3


def mix(a: str, b: str, t: float) -> str:
    """``a`` moved ``t`` of the way to ``b``, both ``#rrggbb``, rounded as the preview rounds (halves up)."""
    channel = lambda colour, i: int(colour[1 + 2 * i:3 + 2 * i], 16)  # noqa: E731
    return '#' + ''.join(f'{math.floor(channel(a, i) + (channel(b, i) - channel(a, i)) * t + 0.5):02x}' for i in range(3))


def part_look(style: str, singer) -> tuple[str, str]:
    """A line's colours in ``style`` for its ``singer``: its words still to be sung, and those sung."""
    look = STYLES[validate_style(style)]
    if singer is None:
        return look['main'], look['accent']
    accent = look['accent'] if singer == 1 else PART_COLOURS[style][0 if singer == 2 else 1]
    return mix(look['main'], accent, PART_TINT), accent


def next_label(singer) -> str:
    """How the next line is introduced: whose it is, in a duet."""
    return 'Next' if singer is None else 'Next, both' if singer == 'both' else f'Next, singer {singer}'


def validate_size(value) -> str:
    if value not in VIDEO_SIZES:
        raise ValidationError('Choose a video size: 720p (1280x720), 1080p (1920x1080) or vertical (1080x1920).')
    return value


def validate_style(value) -> str:
    if value not in STYLES:
        raise ValidationError('Choose a lyric style: classic, contrast, large or light.')
    return value


# fontconfig is asked once per script: these are short, local queries with plain hex arguments.
_FONTCONFIG_TIMEOUT = 10
_REGULAR = {'regular', 'book', 'normal', 'medium'}


def _ranges(charset: str) -> list[tuple[int, int]]:
    """fontconfig's charset text ("20-7e a0-17f 2010") as inclusive code point ranges."""
    ranges = []
    for item in charset.split():
        low, _, high = item.partition('-')
        try:
            ranges.append((int(low, 16), int(high or low, 16)))
        except ValueError:
            continue
    return ranges


@functools.lru_cache(maxsize=64)
def _coverage(path: str, index: int) -> tuple[tuple[int, int], ...] | None:
    """The code points a font file covers, or None when fontconfig is unavailable."""
    try:
        result = subprocess.run(['fc-query', '--index', str(index), '--format', '%{charset}', path],
                                capture_output=True, text=True, timeout=_FONTCONFIG_TIMEOUT, check=True)
    except (OSError, subprocess.SubprocessError):
        return None
    return tuple(_ranges(result.stdout)) or None


@functools.lru_cache(maxsize=1024)
def _system_fonts(codepoint: int) -> tuple[tuple[str, int], ...]:
    """Installed scalable fonts with a glyph for ``codepoint``, best first: regular Noto sans faces lead."""
    try:
        result = subprocess.run(['fc-list', '--format', '%{file}\t%{index}\t%{family}\t%{style}\n',
                                 f':charset={codepoint:x}:scalable=true'],
                                capture_output=True, text=True, timeout=_FONTCONFIG_TIMEOUT, check=True)
    except (OSError, subprocess.SubprocessError):
        return ()
    candidates = []
    for line in result.stdout.splitlines():
        parts = line.split('\t')
        if len(parts) != 4 or not parts[0].lower().endswith(('.ttf', '.otf', '.ttc', '.otc')):
            continue
        path, index, family, style = parts[0], parts[1], parts[2].split(',')[0], parts[3].split(',')[0].lower()
        try:
            index = int(index)
        except ValueError:
            continue
        # Unifont is a bitmap last resort without OpenType shaping (Tibetan stacks, Devanagari conjuncts).
        candidates.append((('Unifont' in family, not family.startswith('Noto'), 'Sans' not in family, style not in _REGULAR,
                            'Mono' in family, family, path), (path, index)))
    return tuple(font for _, font in sorted(candidates))


@functools.lru_cache(maxsize=256)
def _loadable(path: str, index: int) -> bool:
    """Whether Pillow can draw this font at any size; colour bitmap fonts (emoji) have fixed sizes only."""
    try:
        ImageFont.truetype(path, 24, index=index)
    except OSError:
        return False
    return True


def _system_font(codepoint: int) -> tuple[str, int] | None:
    """The best installed font for ``codepoint`` that Pillow can draw at any size."""
    return next((font for font in _system_fonts(codepoint) if _loadable(*font)), None)


def _covers(ranges: tuple[tuple[int, int], ...], codepoint: int) -> bool:
    return any(low <= codepoint <= high for low, high in ranges)


def text_layout(text: str) -> tuple[str, bool]:
    """Base direction from the first RTL character or letter, and whether there is any strong RTL character.

    Lines with right-to-left text are shaped and ordered as a whole, so joined letters and reading order never depend on
    which words are sung; their sung words are coloured where the ordering put them (see ``bidi``).
    """
    direction = None
    bidi = False
    for char in text:
        if unicodedata.bidirectional(char) in ('R', 'AL'):
            bidi = True
            direction = direction or 'rtl'
        elif unicodedata.category(char).startswith('L'):
            direction = direction or 'ltr'
    return direction or 'ltr', bidi


class _Fonts:
    """The bundled font first, then installed fonts (found with fontconfig) for characters it has no glyph for,
    such as CJK, Tibetan, Devanagari or Arabic lyrics. Without fontconfig everything uses the bundled font."""

    def __init__(self, primary: str):
        self.faces: list[tuple[str, int]] = [(primary, 0)]
        self.coverage = [_coverage(primary, 0)]
        self.chosen: dict[str, int | None] = {}

    def face_for(self, char: str) -> int | None:
        """Index of the face to draw ``char`` with; None for spaces and marks, which follow the previous face."""
        if char not in self.chosen:
            self.chosen[char] = self._choose(char)
        return self.chosen[char]

    def _choose(self, char: str) -> int | None:
        if char.isspace() or unicodedata.category(char) in ('Mn', 'Mc', 'Me', 'Cf'):
            return None
        codepoint = ord(char)
        if self.coverage[0] is None:
            return 0
        for face, ranges in enumerate(self.coverage):
            if ranges is not None and _covers(ranges, codepoint):
                return face
        found = _system_font(codepoint)
        if found is None:
            return 0
        if found not in self.faces:
            self.faces.append(found)
            self.coverage.append(_coverage(*found))
        return self.faces.index(found)

    def runs(self, text: str) -> list[tuple[int, str]]:
        """``text`` split into consecutive runs drawn with one face each."""
        runs: list[tuple[int, str]] = []
        for char in text:
            face = self.face_for(char)
            if runs and (face is None or face == runs[-1][0]):
                runs[-1] = (runs[-1][0], runs[-1][1] + char)
            else:
                runs.append((0 if face is None else face, char))
        return runs

    def whole_face(self, text: str) -> int:
        """Find a verified face covering the entire bidi block, including combining marks."""
        needed = sorted({ord(char) for char in text if not char.isspace() and unicodedata.category(char) not in ('Cf', 'Cc')})
        if not needed:
            return 0
        for face, ranges in enumerate(self.coverage):
            if ranges is not None and all(_covers(ranges, codepoint) for codepoint in needed):
                return face
        # Any complete font must cover this character. Search every installed candidate for it,
        # not only per-character preferred faces: a missing mark may be the only uncovered glyph.
        primary = self.coverage[0]
        probe = next((codepoint for codepoint in needed if primary is None or not _covers(primary, codepoint)), needed[0])
        unknown = any(ranges is None for ranges in self.coverage)
        for path, index in _system_fonts(probe):
            if not _loadable(path, index):
                continue
            ranges = _coverage(path, index)
            if ranges is None:
                unknown = True
            elif all(_covers(ranges, codepoint) for codepoint in needed):
                if (path, index) not in self.faces:
                    self.faces.append((path, index))
                    self.coverage.append(ranges)
                return self.faces.index((path, index))
        if unknown:
            raise ValidationError('Could not verify bidirectional lyric font coverage. '
                                  'Install or repair fontconfig (fc-query and fc-list), then retry.')
        raise ValidationError('Bidirectional lyric export needs one installed font covering the complete line. '
                              'Install fontconfig and a suitable Unicode font, then retry.')

    def font(self, face: int, size: int) -> ImageFont.FreeTypeFont:
        return _font(*self.faces[face], size)

    def length(self, text: str, size: int) -> float:
        return sum(self.font(face, size).getlength(run) for face, run in self.runs(text))


@functools.lru_cache(maxsize=8)
def _fonts(primary: str) -> _Fonts:
    return _Fonts(primary)


def _wrap(text: str, measure, width: int) -> list[str]:
    lines = []
    # Keep explicit lyric line breaks; wrap long tokens too. Pillow only draws
    # these strings, so braces, percent signs, shell syntax and markup are data.
    for paragraph in text.replace('\r\n', '\n').replace('\r', '\n').split('\n'):
        current = ''
        for word in paragraph.split():
            candidate = f'{current} {word}' if current else word
            if measure(candidate) <= width:
                current = candidate
                continue
            if current:
                lines.append(current)
                current = ''
            for char in word:
                if current and measure(current + char) > width:
                    lines.append(current)
                    current = ''
                current += char
        lines.append(current)
    return lines


@functools.lru_cache(maxsize=256)
def _font(font_path: str, index: int, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(font_path, size, index=index)


def _draw_shaped(image: Image.Image, at: tuple[float, float], line: str, font: ImageFont.FreeTypeFont, direction: str,
                 fill: str, sung_fill: str, lit: list[bool]) -> None:
    """Draw ``line`` shaped as a whole (one native call keeps joining, bidi ordering, numbers and punctuation intact),
    anchored at its middle and baseline: the ``lit`` words in ``sung_fill`` wherever the ordering put them, the rest in
    ``fill``. Where the words' places cannot be found, the whole line takes ``sung_fill`` once a word is lit."""
    draw = ImageDraw.Draw(image)
    if not any(lit) or all(lit):
        draw.text(at, line, font=font, fill=sung_fill if any(lit) else fill, direction=direction, anchor='ms')
        return
    advance = font.getlength(line, direction=direction)
    places = word_places(line, direction == 'rtl', lambda piece, side: font.getlength(piece, direction=side), advance)
    if places is None or len(places) != len(lit):
        draw.text(at, line, font=font, fill=sung_fill, direction=direction, anchor='ms')
        return
    # The line's glyphs as a mask, laid over a ground in the two colours: every pixel is the line drawn whole in one
    # colour or the other, exactly as draw.text draws it.
    x, y = at
    left, top, right, bottom = font.getbbox(line, direction=direction, anchor='ms')
    origin = (math.floor(x + left) - 2, math.floor(y + top) - 2)
    box = (math.ceil(x + right) + 2 - origin[0], math.ceil(y + bottom) + 2 - origin[1])
    mask = Image.new('L', box, 0)
    ImageDraw.Draw(mask).text((x - origin[0], y - origin[1]), line, font=font, fill=255, direction=direction, anchor='ms')
    ground = Image.new(image.mode, box, fill)
    paint, start = ImageDraw.Draw(ground), x - advance / 2 - origin[0]
    for low, high in sung_stretches(places, lit):
        low = 0 if low == -math.inf else max(0, round(start + low))
        high = box[0] if high == math.inf else min(box[0], round(start + high))
        if high > low:
            paint.rectangle((low, 0, high - 1, box[1] - 1), fill=sung_fill)
    image.paste(ground, origin, mask)


def _center_text(image: Image.Image, text: str, y: int, font_path: Path,
                 size: int, minimum: int, max_height: int, fill: str,
                 sung_chars: int | None = None, sung_fill: str = ACCENT, width: int = WIDTH, wrap: int = 1000) -> None:
    """Draw a centred, wrapped text block (lines at most ``wrap`` wide) on a frame ``width`` wide. With ``sung_chars``,
    that many leading non-space characters are drawn in ``sung_fill`` for word-by-word karaoke highlighting (in a line
    with right-to-left text, the words they begin, wherever the line shows them). Sizes may be scaled (fractional)."""
    size, minimum, max_height, wrap = int(size), int(minimum), int(max_height), int(wrap)
    draw = ImageDraw.Draw(image)
    fonts = _fonts(str(font_path))
    direction, bidi = text_layout(text)
    face = None
    if bidi:
        if not features.check_feature('raqm'):
            raise ValidationError('Bidirectional lyric export requires Pillow with RAQM shaping. '
                                  'Install the supported Pillow wheel and retry.')
        face = fonts.whole_face(text)
    for chosen in range(size, minimum - 1, -1):
        measure = (functools.partial(fonts.font(face, chosen).getlength, direction=direction) if face is not None
                   else functools.partial(fonts.length, size=chosen))
        lines = _wrap(text, measure, wrap)
        spacing = math.ceil(chosen * 1.25)
        if len(lines) * spacing <= max_height:
            break
    # Very newline-heavy lyrics still retain all words without spilling into
    # adjacent regions: compact blank/newline separators and fit one block.
    if len(lines) * spacing > max_height:
        lines = _wrap(' '.join(text.split()), measure, wrap)
    if len(lines) * spacing > max_height:
        # This is an upcoming-text preview: a visible ellipsis keeps it within
        # its own region. Full active lyrics fit at the main block's minimum.
        lines = lines[:max(1, max_height // spacing)]
        while lines[-1] and measure(lines[-1] + '…') > wrap:
            lines[-1] = lines[-1][:-1]
        lines[-1] += '…'
    total = len(lines) * spacing
    # Every face sits on the bundled font's baseline, centred on the line as that font's text would be.
    ascent, descent = fonts.font(0, chosen).getmetrics()
    remaining = len(text) if sung_chars is None else sung_chars
    colour = sung_fill if sung_chars is not None else fill
    for index, line in enumerate(lines):
        baseline = y - total / 2 + (index + 0.5) * spacing + (ascent - descent) / 2
        if face is not None:
            lit = lit_words(line, remaining) if sung_chars is not None else [False] * len(line.split())
            remaining -= min(remaining, sum(not char.isspace() for char in line))
            _draw_shaped(image, (width / 2, baseline), line, fonts.font(face, chosen), direction, fill, sung_fill, lit)
            continue
        left = width / 2 - measure(line) / 2
        for run_face, run in fonts.runs(line):
            font = fonts.font(run_face, chosen)
            # The sung prefix of this run, then the rest of it after it.
            prefix, count = '', 0
            for char in run:
                if count >= remaining:
                    break
                prefix += char
                count += not char.isspace()
            remaining -= count
            for piece, piece_fill in ((prefix, colour), (run[len(prefix):], fill)):
                if piece:
                    draw.text((left, baseline), piece, font=font, fill=piece_fill, anchor='ls')
                    left += font.getlength(piece)


def count_in(cues: list[dict], position: float) -> int | None:
    """Seconds left (3, 2 or 1) before a line that follows an instrumental break, or None.

    A break is at least COUNT_IN_BREAK seconds without a line; the clip's start counts as the end of a line.
    """
    if any(cue['start'] <= position < cue['end'] for cue in cues):
        return None
    following = next((index for index, cue in enumerate(cues) if cue['start'] > position), None)
    if following is None:
        return None
    previous_end = cues[following - 1]['end'] if following else 0.0
    left = cues[following]['start'] - position
    if cues[following]['start'] - previous_end < COUNT_IN_BREAK or left > COUNT_IN:
        return None
    return math.ceil(left - 1e-9)


BACKGROUNDS = ('cover', 'plain')
# How much of the style's own background colour lies over a cover picture, so the lyrics stay readable on it.
COVER_VEIL = 0.62


def validate_background(value) -> str:
    if value not in BACKGROUNDS:
        raise ValidationError('Choose the cover art or a plain background.')
    return value


@functools.lru_cache(maxsize=4)
def _cover_backdrop(cover: str, colour: str, width: int = WIDTH, height: int = HEIGHT) -> Image.Image:
    """The cover picture filling the frame, softened and veiled with the style's background colour."""
    picture = Image.open(io.BytesIO(base64.b64decode(cover.split(',', 1)[1]))).convert('RGB')
    scale = max(width / picture.width, height / picture.height)
    size = (max(width, round(picture.width * scale)), max(height, round(picture.height * scale)))
    picture = picture.resize(size, Image.Resampling.LANCZOS)
    left, top = (size[0] - width) // 2, (size[1] - height) // 2
    picture = picture.crop((left, top, left + width, top + height)).filter(ImageFilter.GaussianBlur(6 * height / HEIGHT))
    return Image.blend(picture, Image.new('RGB', (width, height), colour), COVER_VEIL)


def render_card(project: dict, active_index: int | None, output: Path, font_path: Path,
                sung: list[str] | None = None, count: int | None = None, style: str = 'classic',
                background: str = 'cover', layer: bool = False, size: str = '720p', said: list[str] | None = None,
                guide: bool = False) -> None:
    """One video card. ``sung`` lists the active line's words already sung; without it the whole
    active line is highlighted. ``said`` is the active line's pronunciation in Latin letters, a piece for each of its
    words (see ``pronunciation``), drawn under it and highlighted with it. During a break, ``count`` dots count singers in to the next line. ``style`` names
    one of STYLES; with the ``cover`` background, a clip's cover picture lies behind the lyrics. A ``layer`` is the
    card's words alone on a transparent ground, to lie over a backdrop drawn once. ``size`` names one of VIDEO_SIZES:
    the card is laid out at 1280x720, or 720x1280 for an upright frame (see ``LAYOUTS``), and scaled to it. With the
    melody ``guide``, the card leaves its lane (see ``GUIDES``), drawn as a faint band with the playhead; the notes
    scroll over it."""
    project = validate_project(project)
    width, height = VIDEO_SIZES[validate_size(size)]
    place = guide_of(size) if guide else layout_of(size)
    k = height / place['height']
    look = STYLES[validate_style(style)]
    fill, muted, main, accent, scale = look['background'], look['muted'], look['main'], look['accent'], look['scale']
    cues = project['cues']
    if active_index is not None and (type(active_index) is not int or not 0 <= active_index < len(cues)):
        raise ValidationError('Active cue index must identify a saved lyric cue.')
    cover = project.get('cover') if validate_background(background) == 'cover' else None
    image = (Image.new('RGBA', (width, height), (0, 0, 0, 0)) if layer
             else _cover_backdrop(cover, fill, width, height).copy() if cover else Image.new('RGB', (width, height), fill))
    draw = ImageDraw.Draw(image)
    if guide:
        lane = guide_lane(size)
        # A faint band, and the playhead a little brighter: lighter than the background on a dark style, darker on a light one.
        band = Image.new('RGBA', image.size, (0, 0, 0, 0))
        marks = ImageDraw.Draw(band)
        tint = _rgb(look['muted'])
        marks.rounded_rectangle((lane['left'], lane['top'], lane['left'] + lane['width'], lane['top'] + lane['height']), radius=round(10 * k), fill=(*tint, 46))
        x = lane['left'] + lane['playhead']
        marks.rectangle((x - max(1, round(k)), lane['top'] + round(4 * k), x + max(1, round(k)), lane['top'] + lane['height'] - round(4 * k)), fill=(*_rgb(look['main']), 150))
        image.alpha_composite(band) if image.mode == 'RGBA' else image.paste(band, (0, 0), band)
        draw = ImageDraw.Draw(image)
    text = functools.partial(_center_text, image, font_path=font_path, width=width, wrap=place['wrap'] * k)
    text(' '.join(project['title'].split()), place['title'] * k, size=32 * k, minimum=22 * k, max_height=100 * k, fill=main)
    active = cues[active_index]['text'] if active_index is not None else 'Instrumental break'
    # With its pronunciation under it, the line being sung moves up to leave it room.
    said = said if active_index is not None and said else None
    middle, room = (place['said_middle'] * k, place['said_room'] * k) if said else (place['middle'] * k, place['room'] * k)
    # A duet's line takes its singer's colours.
    line_main, line_accent = part_look(style, cues[active_index].get('singer')) if active_index is not None else (main, accent)
    if active_index is not None and sung is not None:
        text(active, middle, size=44 * scale * k, minimum=24 * scale * k, max_height=room, fill=line_main,
             sung_chars=sum(len(word) for word in sung), sung_fill=line_accent)
    else:
        text(active, middle, size=44 * scale * k, minimum=24 * scale * k, max_height=room,
             fill=line_accent if active_index is not None else main)
    if said:
        spoken = said_line(said[:len(sung)]) if sung is not None else said_line(said)
        text(said_line(said), place['said'] * k, size=28 * scale * k, minimum=18 * scale * k, max_height=90 * k, fill=muted,
             sung_chars=sum(not ch.isspace() for ch in spoken), sung_fill=line_accent)
    if active_index is None and count:
        # Dots in a row under the break, one fewer each second, in the colour of words not yet sung.
        radius, gap = 12 * k, 44 * k
        left = width / 2 - (count - 1) * gap / 2
        for dot in range(count):
            x = left + dot * gap
            draw.ellipse((x - radius, place['dots'] * k - radius, x + radius, place['dots'] * k + radius), fill=main)
    next_index = active_index + 1 if active_index is not None else 0
    if next_index < len(cues):
        text(f"{next_label(cues[next_index].get('singer'))}: {cues[next_index]['text']}", place['next'] * k, size=26 * scale * k, minimum=18 * scale * k, max_height=80 * min(scale, 1.2) * k, fill=muted)
    text('Karaoke Studio · Backing track', place['footer'] * k, size=20 * k, minimum=20 * k, max_height=40 * k, fill=muted)
    image.save(output, format='PNG')


def _cancelled(cancel: threading.Event) -> None:
    if cancel.is_set():
        raise RuntimeError('Export cancelled.')


def _run_ffmpeg(arguments: list[str], cancel: threading.Event, output: Path,
                timeout: float = VIDEO_TIMEOUT, max_log_bytes: int = 262144,
                max_output_bytes: int = MAX_VIDEO_BYTES) -> None:
    _cancelled(cancel)
    started = time.monotonic()
    try:
        process = subprocess.Popen(arguments, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, shell=False, start_new_session=os.name == 'posix',
                                   pass_fds=media_handles())
    except OSError as exc:
        raise RuntimeError('Could not start FFmpeg; check that it is installed.') from exc
    selector = selectors.DefaultSelector()
    total = 0
    complete = False
    try:
        for stream in (process.stdout, process.stderr):
            selector.register(stream, selectors.EVENT_READ)
        while selector.get_map() or process.poll() is None:
            _cancelled(cancel)
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                raise RuntimeError('Video encoding exceeded its time limit.')
            if output.exists() and output.stat().st_size > max_output_bytes:
                raise RuntimeError('Video encoding exceeded its output file limit.')
            for key, _ in selector.select(min(0.05, remaining)):
                chunk = os.read(key.fd, min(65536, max_log_bytes - total + 1))
                if not chunk:
                    selector.unregister(key.fileobj)
                else:
                    total += len(chunk)
                    if total > max_log_bytes:
                        raise RuntimeError('Video encoding exceeded its diagnostic output limit.')
        process.wait()
        _cancelled(cancel)
        if output.exists() and output.stat().st_size > max_output_bytes:
            raise RuntimeError('Video encoding exceeded its output file limit.')
        if process.returncode:
            raise RuntimeError('FFmpeg could not encode this video; verify the backing audio and available disk space.')
        complete = True
    finally:
        if not complete:
            if os.name == 'posix':
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            elif process.poll() is None:
                process.kill()
            process.wait()
        selector.close()
        for stream in (process.stdout, process.stderr):
            if stream is not None:
                stream.close()


def _remaining(cancel: threading.Event, deadline: float) -> float:
    _cancelled(cancel)
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise RuntimeError('Video export exceeded its time limit.')
    return remaining


def _validate_backing(backing: Path, duration: float, cancel: threading.Event,
                      deadline: float, label: str = 'Backing') -> None:
    _remaining(cancel, deadline)
    try:
        with wave.open(str(backing), 'rb') as stream:
            if (stream.getnchannels(), stream.getsampwidth(), stream.getframerate(), stream.getcomptype()) != (2, 2, SAMPLE_RATE, 'NONE'):
                raise ValidationError(f'{label} audio must be stereo 44.1 kHz PCM16 WAV.')
            frames = stream.getnframes()
            if abs(frames / SAMPLE_RATE - duration) > 1 / SAMPLE_RATE + 1e-9:
                raise ValidationError(f'{label} audio duration does not match the project.')
            # Bound memory and cancellation latency while checking actual data,
            # including the end of a full five-minute backing track.
            remaining = frames
            while remaining:
                _remaining(cancel, deadline)
                count = min(65536, remaining)
                if len(stream.readframes(count)) != count * 4:
                    raise ValidationError(f'{label} audio is truncated.')
                remaining -= count
            _remaining(cancel, deadline)
    except (wave.Error, EOFError, OSError) as exc:
        raise ValidationError(f'{label} audio must be a readable canonical WAV file.') from exc


# A key change moves the backing (and any guide vocal) up or down by whole semitones, without changing its tempo.
MAX_SEMITONES = 6
KEY_PREVIEW_SECONDS = 12
MAX_KEY_PREVIEW_BYTES = 8 * 1024 * 1024


def validate_semitones(value) -> int:
    if type(value) is not int or not -MAX_SEMITONES <= value <= MAX_SEMITONES:
        raise ValidationError(f'Choose a key change from -{MAX_SEMITONES} to +{MAX_SEMITONES} semitones.')
    return value


def _audio_program(guide: float, semitones: int) -> str | None:
    """The FFmpeg filter program for the exported audio: inputs 1 (backing) and 2 (vocals), output [mix].

    Only validated numbers enter it."""
    steps = []
    if guide:
        steps.append(f'[1:a][2:a]amix=inputs=2:weights=1 {guide:.2f}:normalize=0')
    if semitones:
        steps.append(('' if guide else '[1:a]') + f'rubberband=pitch={2 ** (semitones / 12):.6f}:pitchq=quality')
    if not steps:
        return None
    # Limited so the sum, or a shifted transient, cannot clip.
    return ','.join(steps) + ',alimiter=limit=0.97[mix]'


def key_preview(backing: Path, duration: float, start: float, semitones: int, cancel: threading.Event,
                vocals: Path | None = None, guide: float = 0) -> bytes:
    """A short WAV from ``start`` with the export's key change and guide vocal, to hear before exporting."""
    semitones = validate_semitones(semitones)
    if not (isinstance(guide, (int, float)) and 0 <= guide <= 0.5) or (guide and vocals is None):
        raise ValidationError('Guide vocal level must be from 0 to 50 percent of the separated vocals.')
    if not (isinstance(start, (int, float)) and math.isfinite(start) and 0 <= start < duration):
        raise ValidationError('Choose a preview start inside the clip.')
    length = min(KEY_PREVIEW_SECONDS, duration - start)
    arguments = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin',
                 '-protocol_whitelist', 'file', '-ss', f'{start:.3f}', '-t', f'{length:.3f}', '-f', 'wav', '-i', str(backing)]
    if guide:
        arguments += ['-protocol_whitelist', 'file', '-ss', f'{start:.3f}', '-t', f'{length:.3f}', '-f', 'wav', '-i', str(vocals)]
    # Input indices start at 0 here; the program is written for an input 0 that is the video.
    program = _audio_program(guide, semitones)
    if program:
        arguments += ['-filter_complex', program.replace('[1:a]', '[0:a]').replace('[2:a]', '[1:a]'), '-map', '[mix]']
    arguments += ['-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1']
    _cancelled(cancel)
    try:
        result = subprocess.run(arguments, stdin=subprocess.DEVNULL, capture_output=True, timeout=60,
                                start_new_session=os.name == 'posix', pass_fds=media_handles())
    except OSError as exc:
        raise RuntimeError('Could not start FFmpeg; check that it is installed.') from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError('The key preview took too long.') from exc
    _cancelled(cancel)
    if result.returncode or not result.stdout or len(result.stdout) > MAX_KEY_PREVIEW_BYTES:
        detail = 'This FFmpeg cannot change the key (it lacks the rubberband filter).' if b'rubberband' in result.stderr else 'FFmpeg could not prepare the key preview.'
        raise RuntimeError(detail)
    return _sized_wav(result.stdout)


def _sized_wav(data: bytes) -> bytes:
    """FFmpeg cannot seek back in a pipe to write a WAV's sizes; fill them in from the bytes received."""
    at = data.find(b'data', 12)
    if data[:4] != b'RIFF' or data[8:12] != b'WAVE' or at < 0:
        raise RuntimeError('FFmpeg did not produce a WAV preview.')
    body = len(data) - at - 8
    return b'RIFF' + (len(data) - 8).to_bytes(4, 'little') + data[8:at + 4] + body.to_bytes(4, 'little') + data[at + 8:]


def _rgb(colour: str) -> tuple[int, int, int]:
    return int(colour[1:3], 16), int(colour[3:5], 16), int(colour[5:7], 16)


def melody_strips(notes: list, duration: float, size: str, style: str, directory: Path) -> tuple[Path, Path]:
    """The melody guide's notes for the whole clip, drawn once as two strips the lane's height (see ``guide_lane``):
    one in the colour of words still to be sung, one in the colour of sung words. A note sung at time t lies
    (t + GUIDE_PAST) * pps from a strip's left edge, so the lane at time t shows a strip from t * pps."""
    lane, look = guide_lane(size), STYLES[validate_style(style)]
    low, high = pitch_range(notes)
    width = math.ceil((duration + GUIDE_SECONDS) * lane['pps']) + 2
    paths = []
    for name, colour in (('unsung', look['main']), ('sung', look['accent'])):
        strip = Image.new('RGBA', (width, lane['height']), (0, 0, 0, 0))
        draw = ImageDraw.Draw(strip)
        for start, end, pitch in notes:
            top, thick = bar_box(pitch, low, high, lane['height'])
            left, right = (start + GUIDE_PAST) * lane['pps'], (end + GUIDE_PAST) * lane['pps']
            draw.rounded_rectangle((left, top, max(left + thick, right - 1), top + thick), radius=thick / 2, fill=(*_rgb(colour), 235))
        path = directory / f'melody-{name}.png'
        strip.save(path, format='PNG', compress_level=1)
        paths.append(path)
    return paths[0], paths[1]


def export_video(project: dict, backing: Path, output: Path, work_dir: Path,
                 font_path: Path, cancel: threading.Event, words: list | None = None,
                 vocals: Path | None = None, guide: float = 0, semitones: int = 0, style: str = 'classic',
                 background: str = 'cover', letters=None, size: str = '720p', language: str | None = None,
                 pronunciation: bool = True, melody: list | None = None) -> None:
    """Render the karaoke video at ``size`` (one of VIDEO_SIZES); ``words`` are recognized words that, with
    ``letters`` measured in the vocals when there are any (and the song's recognized ``language``), time the word
    highlighting. With ``pronunciation``, a line in Korean, Cyrillic, or Chinese or Japanese read in the song's
    language, shows how it is said in Latin letters under it.

    With ``guide`` above zero, the separated ``vocals`` are mixed under the backing at that share (a guide vocal).
    ``semitones`` moves the audio's key up or down without changing its tempo. With ``melody`` notes (see
    ``karaoke.melody``), the melody guide's pitch bars scroll past a playhead between the title and the lyrics.
    """
    deadline = time.monotonic() + VIDEO_TIMEOUT
    project = validate_project(project)
    _remaining(cancel, deadline)
    semitones, style, background, size = validate_semitones(semitones), validate_style(style), validate_background(background), validate_size(size)
    if not (isinstance(guide, (int, float)) and 0 <= guide <= 0.5) or (guide and vocals is None):
        raise ValidationError('Guide vocal level must be from 0 to 50 percent of the separated vocals.')
    backing, output, work_dir = Path(backing).absolute(), Path(output), Path(work_dir)
    _validate_backing(backing, project['duration'], cancel, deadline)
    if guide:
        vocals = Path(vocals).absolute()
        _validate_backing(vocals, project['duration'], cancel, deadline, label='Vocal')
    if melody is not None:
        try:
            melody = validate_notes(melody, project['duration'])
        except ValueError as error:
            raise ValidationError(str(error)) from None
    frame_count = math.ceil(project['duration'] * FPS)
    if frame_count > MAX_VIDEO_FRAMES:
        raise ValidationError('Video exceeds its frame limit.')
    work_dir.mkdir(parents=True, exist_ok=True)
    temporary_output = None
    try:
        with tempfile.TemporaryDirectory(prefix='export-', dir=work_dir) as temporary:
            directory = Path(temporary)
            states = {}
            card_bytes = 0
            # A cover picture is drawn once, as a backdrop the cards' words lie over; cards stay small.
            backdrop = None
            if background == 'cover' and project.get('cover'):
                backdrop = directory / 'backdrop.png'
                _cover_backdrop(project['cover'], STYLES[style]['background'], *VIDEO_SIZES[size]).save(backdrop, format='PNG')
            cues = project['cues']
            timings = word_timings(cues, words or [], project['duration'], letters, language)
            # Lines with right-to-left text have no pronunciation in Latin letters.
            said = [line_pronunciation(cue['text'], language) if pronunciation and not text_layout(cue['text'])[1] else None
                    for cue in cues]
            # Cards leave the melody guide's lane only when there is one.
            guided = {'guide': True} if melody is not None else {}
            for frame in range(frame_count):
                _remaining(cancel, deadline)
                position = frame / FPS
                active = next((index for index, cue in enumerate(cues)
                               if cue['start'] <= position < cue['end']), None)
                upcoming = next((index for index, cue in enumerate(cues) if cue['start'] > position), len(cues))
                sung = sung_count(timings[active], position) if active is not None else None
                count = count_in(cues, position) if active is None else None
                state = (active, upcoming if active is None else None, sung, count)
                if state not in states:
                    if len(states) >= MAX_CARDS:
                        raise RuntimeError('Video preparation exceeded its card count limit.')
                    card = directory / f'card{len(states):04}.png'
                    if active is None:
                        render_card({**project, 'cues': cues[upcoming:]}, None, card, font_path, count=count, style=style,
                                    background=background, layer=backdrop is not None, size=size, **guided)
                    else:
                        render_card(project, active, card, font_path,
                                    sung=[word['text'] for word in timings[active][:sung]], style=style, background=background,
                                    layer=backdrop is not None, size=size, said=said[active], **guided)
                    _remaining(cancel, deadline)
                    card_bytes += card.stat().st_size
                    if card_bytes > MAX_CARD_BYTES:
                        raise RuntimeError('Video preparation exceeded its card storage limit.')
                    states[state] = card
                # Fixed numbered local files give exact 24 fps timestamps, with
                # no user text or paths placed into a filter/concat program.
                os.link(states[state], directory / f'frame{frame:06}.png')
            descriptor, name = tempfile.mkstemp(prefix='.video-', suffix='.mp4', dir=output.parent)
            os.close(descriptor)
            temporary_output = Path(name)
            arguments = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
                         '-protocol_whitelist', 'file', '-framerate', str(FPS), '-start_number', '0',
                         '-i', str(directory / 'frame%06d.png'),
                         '-protocol_whitelist', 'file', '-f', 'wav', '-i', str(backing)]
            if guide:
                arguments += ['-protocol_whitelist', 'file', '-f', 'wav', '-i', str(vocals)]
            program = _audio_program(guide, semitones)
            video = None
            inputs = 3 if guide else 2
            if backdrop is not None:
                # The backdrop comes after the audio, so the audio program's input numbers stay as they are.
                arguments += ['-protocol_whitelist', 'file', '-loop', '1', '-framerate', str(FPS), '-i', str(backdrop)]
                video = f'[{inputs}:v][0:v]overlay=shortest=1:format=auto[video]'
                inputs += 1
            if melody is not None:
                # The notes are drawn once, as strips; each frame shows the stretch of them its time has reached (the
                # crop moves pps pixels a second), the sung strip only left of the playhead. Every value is a number.
                lane = guide_lane(size)
                unsung, sung_strip = melody_strips(melody, project['duration'], size, style, directory)
                arguments += ['-protocol_whitelist', 'file', '-i', str(unsung), '-protocol_whitelist', 'file', '-i', str(sung_strip)]
                base = '[base]' if video else '[0:v]'
                parts = [video.replace('[video]', '[base]')] if video else []
                for index, name, wide in ((inputs, 'unsung', lane['width']), (inputs + 1, 'sung', lane['playhead'])):
                    parts.append(f'[{index}:v]loop=loop=-1:size=1:start=0,setpts=N/{FPS}/TB,'
                                 f'crop=w={wide}:h={lane["height"]}:x=t*{lane["pps"]:.6f}:y=0[{name}]')
                parts.append(f'{base}[unsung]overlay=x={lane["left"]}:y={lane["top"]}:shortest=1:format=auto[laned]')
                parts.append(f'[laned][sung]overlay=x={lane["left"]}:y={lane["top"]}:shortest=1:format=auto[video]')
                video = ';'.join(parts)
            programs = ';'.join(part for part in (program, video) if part)
            arguments += (['-filter_complex', programs] if programs else []) + ['-map', '[video]' if video else '0:v:0', '-map', '[mix]' if program else '1:a:0']
            arguments += ['-c:v', 'libx264', '-threads', '2',
                         '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
                         '-c:a', 'aac', '-b:a', '192k', '-t', f'{project["duration"]:.9f}',
                         '-movflags', '+faststart', '-f', 'mp4', str(temporary_output)]
            _run_ffmpeg(arguments, cancel, temporary_output,
                        timeout=_remaining(cancel, deadline), max_output_bytes=MAX_VIDEO_BYTES)
            _remaining(cancel, deadline)
            if not temporary_output.stat().st_size:
                raise RuntimeError('FFmpeg did not produce a video.')
            os.replace(temporary_output, output)
    finally:
        if temporary_output is not None:
            temporary_output.unlink(missing_ok=True)
