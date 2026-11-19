"""MP3+G karaoke: the saved lyrics as CD+G graphics beside an MP3 of the backing, the pair karaoke player software and
karaoke machines play (for example KaraFun Player, VirtualDJ and PCDJ Karaoki).

A CD+G file is a stream of 24-byte subcode packets, 300 a second, each one drawing instruction for a screen of 300 × 216
pixels: 50 × 18 tiles of 6 × 12 pixels, in 16 colours chosen from 4,096, whose outer tiles are a border. Here the song
opens on its title and artist. Each lyric line, wrapped to the screen's width, then takes one of four places on screen
in turn, appears a few seconds before it is sung (or as soon as the line before it in that place has been sung), lights
up word by word, a tile at a time, as it is sung, and is cleared soon after. Instructions are sent in time order, wiping
before drawing when both are due, since a packet can only draw one tile; each place's instructions keep their order.
The colours and lyric size follow the video export's lyric style.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import math
from pathlib import Path
import threading
from typing import Callable
import zipfile

from PIL import Image, ImageDraw

from .lyrics_auto import needs_space, word_timings
from .model import validate_project
from .ultrastar import UNKNOWN_ARTIST, artist_and_title, song_name
from .video import STYLES, _fonts, text_layout

PACKETS_PER_SECOND = 300
WIDTH, HEIGHT = 300, 216
TILE_WIDTH, TILE_HEIGHT = 6, 12
COLUMNS, ROWS = WIDTH // TILE_WIDTH, HEIGHT // TILE_HEIGHT
# The four places a line can take, by their first tile row; each is three tile rows (36 pixels) tall, inside the
# border, with a tile row between them.
PLACES = (2, 6, 10, 14)
PLACE_ROWS = 3
# Text is centred and wrapped to this width, inside the border's 6 pixels either side.
WRAP = 276
# Lyric sizes in pixels for the normal and large-print styles, and the title page's.
LYRIC_SIZE, LARGE_SIZE, TITLE_SIZE, ARTIST_SIZE = 20, 25, 24, 18
# A line appears at most this many seconds before its first word, and stays this long after it has been sung.
LEAD, AFTER = 5.0, 0.4
# The palette: background, lyrics not yet sung, sung lyrics, and the artist on the title page.
BACKGROUND, TEXT, SUNG, MUTED = 0, 1, 2, 3

_GRAPHICS = 0x09
_MEMORY_PRESET, _BORDER_PRESET, _TILE, _TILE_XOR, _COLOURS_LOW, _COLOURS_HIGH = 1, 2, 6, 38, 30, 31
# Sending order when several instructions are due at once: wipes first, then clearing, then drawing.
_WIPE, _CLEAR, _DRAW = 0, 1, 2


def packet(instruction: int, data: bytes = b'') -> bytes:
    """One CD+G subcode packet: the graphics command, an instruction and its 16 data bytes (parity left empty, as
    players ignore it)."""
    if len(data) > 16:
        raise ValueError('A CD+G packet carries 16 data bytes.')
    return bytes([_GRAPHICS, instruction & 0x3F, 0, 0]) + data.ljust(16, b'\0') + b'\0\0\0\0'


def tile(colour0: int, colour1: int, row: int, column: int, rows: list[int], xor: bool = False) -> bytes:
    """A tile block: twelve rows of six pixels (bit 5 the leftmost), set pixels in ``colour1`` and the rest in
    ``colour0``; an XOR block instead flips the set pixels' colour numbers by ``colour1``."""
    if not (0 <= row < ROWS and 0 <= column < COLUMNS) or len(rows) != TILE_HEIGHT:
        raise ValueError('A tile lies on the screen and has twelve rows.')
    data = bytes([colour0 & 0x0F, colour1 & 0x0F, row & 0x1F, column & 0x3F, *(bits & 0x3F for bits in rows)])
    return packet(_TILE_XOR if xor else _TILE, data)


def palette(colours: list[str]) -> list[bytes]:
    """The two packets loading 16 colours ('#rrggbb', each channel cut to the 4 bits CD+G keeps)."""
    entries = (colours + ['#000000'] * 16)[:16]
    def entry(colour: str) -> bytes:
        red, green, blue = (round(int(colour[i:i + 2], 16) / 17) for i in (1, 3, 5))
        return bytes([(red << 2) | (green >> 2), ((green & 3) << 4) | blue])
    return [packet(_COLOURS_LOW, b''.join(entry(c) for c in entries[:8])), packet(_COLOURS_HIGH, b''.join(entry(c) for c in entries[8:]))]


def clear_screen(colour: int = BACKGROUND) -> list[bytes]:
    """Fill the screen and its border with one colour; the fill is sent 16 times, as players expect."""
    return [packet(_MEMORY_PRESET, bytes([colour, repeat])) for repeat in range(16)] + [packet(_BORDER_PRESET, bytes([colour]))]


@dataclass
class _Line:
    """A line as drawn: its pixels (36 rows of the screen's width), and for each word when it is sung and where."""
    mask: list[list[bool]]
    start: float
    end: float
    words: list[tuple[float, float, int, int]] = field(default_factory=list)
    whole: bool = False  # lit all at once (right-to-left text, whose words' places are not measured here)


def _measure(text: str, size: int, font_path: Path) -> float:
    fonts = _fonts(str(font_path))
    direction, bidi = text_layout(text)
    if bidi or direction == 'rtl':
        return fonts.font(fonts.whole_face(text), size).getlength(text, direction=direction)
    return fonts.length(text, size)


def _pixels(text: str, size: int, font_path: Path, height: int = PLACE_ROWS * TILE_HEIGHT) -> tuple[list[list[bool]], float, bool]:
    """``text`` drawn centred on a strip of the screen's width, without smoothing (CD+G has no partial pixels), with its
    left edge and whether it reads right to left."""
    fonts = _fonts(str(font_path))
    direction, bidi = text_layout(text)
    image = Image.new('L', (WIDTH, height), 0)
    draw = ImageDraw.Draw(image)
    baseline = round(height * 0.72)
    if bidi or direction == 'rtl':
        draw.text((WIDTH / 2, baseline), text, font=fonts.font(fonts.whole_face(text), size), fill=255, anchor='ms', direction=direction)
        left, whole = WIDTH / 2 - _measure(text, size, font_path) / 2, True
    else:
        left = x = WIDTH / 2 - fonts.length(text, size) / 2
        for face, run in fonts.runs(text):
            font = fonts.font(face, size)
            draw.text((x, baseline), run, font=font, fill=255, anchor='ls')
            x += font.getlength(run)
        whole = False
    data = image.load()
    # Pixels at least partly covered count, so thin strokes stay whole.
    return [[data[x, y] >= 96 for x in range(WIDTH)] for y in range(height)], left, whole


def layout(project: dict, font_path: Path, size: int = LYRIC_SIZE, **timing) -> list[_Line]:
    """The saved lines as drawn, each wrapped to the screen's width with its words' times (see ``word_timings``)."""
    project = validate_project(project)
    cues = project['cues']
    timings = word_timings(cues, timing.get('words') or [], project['duration'], timing.get('letters'), timing.get('language'))
    lines: list[_Line] = []
    for cue, words in zip(cues, timings, strict=True):
        words = [word for word in words if word['text'].strip()]
        # Wrapped greedily: each piece is as many of the line's words as fit.
        pieces: list[list[int]] = []
        for index, word in enumerate(words):
            if pieces:
                candidate = _joined([words[k]['text'] for k in pieces[-1]] + [word['text']])
                if _measure(candidate, size, font_path) <= WRAP:
                    pieces[-1].append(index)
                    continue
            pieces.append([index])
        for number, piece in enumerate(pieces):
            texts = [words[k]['text'] for k in piece]
            text = _joined(texts)
            mask, left, whole = _pixels(text, size, font_path)
            # Each word is sung from its start to the next word's (the line's end for its last word).
            untils = [words[k + 1]['start'] if k + 1 < len(words) else float(cue['end']) for k in piece]
            end = untils[-1]
            placed, offset = [], 0
            for k, (word, until) in zip(piece, zip(texts, untils, strict=True), strict=True):
                spaced = text.index(word, offset)
                x0 = left + _measure(text[:spaced], size, font_path) - 1
                x1 = left + _measure(text[:spaced + len(word)], size, font_path) + 1
                placed.append((float(words[k]['start']), max(until, float(words[k]['start'])), math.floor(x0), math.ceil(x1)))
                offset = spaced + len(word)
            lines.append(_Line(mask, placed[0][0], end, placed, whole))
    return lines


def _joined(words: list[str]) -> str:
    text = ''
    for word in words:
        text += (' ' if text and needs_space(text, word) else '') + word
    return text


def _tiles(mask: list[list[bool]], top: int, columns=range(COLUMNS), only=None) -> list[tuple[int, int, list[int]]]:
    """The strip's tiles in ``columns`` that have set pixels, as (screen row, column, twelve rows of bits); ``only(x)``
    keeps some columns of pixels."""
    found = []
    for row in range(len(mask) // TILE_HEIGHT):
        for column in columns:
            bits = []
            for y in range(row * TILE_HEIGHT, (row + 1) * TILE_HEIGHT):
                value = 0
                for x in range(column * TILE_WIDTH, (column + 1) * TILE_WIDTH):
                    value = (value << 1) | (1 if mask[y][x] and (only is None or only(x)) else 0)
                bits.append(value)
            if any(bits):
                found.append((top + row, column, bits))
    return found


def _index(seconds: float) -> int:
    return max(0, round(seconds * PACKETS_PER_SECOND))


def _title_page(project: dict, font_path: Path) -> list[bytes]:
    artist, title = artist_and_title(project['title'])
    packets = []
    # A clip not named "Artist - Title" shows its name alone.
    for text, size, top, colour in ((title, TITLE_SIZE, 5, TEXT), *([(artist, ARTIST_SIZE, 9, MUTED)] if artist != UNKNOWN_ARTIST else [])):
        # A long title is cut to fit rather than wrapped.
        while len(text) > 1 and _measure(text, size, font_path) > WRAP:
            text = text[:-2].rstrip() + '…'
        mask, _, _ = _pixels(text, size, font_path)
        packets += [tile(BACKGROUND, colour, row, column, bits) for row, column, bits in _tiles(mask, top)]
    return packets


def render_cdg(project: dict, font_path: Path, style: str = 'classic', **timing) -> bytes:
    """The project's saved lyrics as a CD+G file as long as the clip (see the module's description)."""
    project = validate_project(project)
    if style not in STYLES:
        raise ValueError('Choose a lyric style for the karaoke graphics.')
    colours = STYLES[style]
    lines = layout(project, font_path, LARGE_SIZE if style == 'large' else LYRIC_SIZE, **timing)
    if not lines:
        raise ValueError('Add lyric lines with words before exporting MP3+G karaoke.')
    total = math.ceil(project['duration'] * PACKETS_PER_SECOND)
    # Each place is a queue of steps sent in order: (due packet, kind, packets).
    places: list[list[tuple[int, int, list[bytes]]]] = [[] for _ in PLACES]
    first = max(0.0, lines[0].start - LEAD)
    opening = [*palette([colours['background'], colours['main'], colours['accent'], colours['muted']]), *clear_screen()]
    title = _title_page(project, font_path) if first >= 1.5 else []
    # The screen is cleared of the title just before the first line is drawn.
    places[0].append((_index(first), _CLEAR, clear_screen()))
    cleared = [_index(first)] * len(PLACES)  # when each place is free for its next line
    for number, line in enumerate(lines):
        place, top = number % len(PLACES), PLACES[number % len(PLACES)]
        due = max(cleared[place], _index(line.start - LEAD))
        places[place].append((due, _DRAW, [tile(BACKGROUND, TEXT, row, column, bits) for row, column, bits in _tiles(line.mask, top)]))
        if line.whole:
            places[place].append((_index(line.start), _WIPE, [tile(0, TEXT ^ SUNG, row, column, bits, xor=True)
                                                              for row, column, bits in _tiles(line.mask, top)]))
        else:
            for start, until, x0, x1 in line.words:
                span = max(1, x1 - x0)
                for column in range(max(0, x0 // TILE_WIDTH), min(COLUMNS, (x1 - 1) // TILE_WIDTH + 1)):
                    # A tile lights as the wipe reaches it, so a word is fully lit while it is still sung.
                    share = min(1.0, max(0.0, (column * TILE_WIDTH - x0) / span))
                    low, high = max(x0, column * TILE_WIDTH), min(x1, (column + 1) * TILE_WIDTH)
                    flips = [tile(0, TEXT ^ SUNG, row, at_column, bits, xor=True)
                             for row, at_column, bits in _tiles(line.mask, top, range(column, column + 1), lambda x, low=low, high=high: low <= x < high)]
                    if flips:
                        places[place].append((_index(start + (until - start) * share), _WIPE, flips))
        erase = _index(line.end + AFTER)
        places[place].append((erase, _CLEAR, [tile(BACKGROUND, BACKGROUND, row, column, [0] * TILE_HEIGHT)
                                              for row, column, _ in _tiles(line.mask, top)]))
        cleared[place] = erase
    return _schedule(total, opening + title, places)


def _schedule(total: int, opening: list[bytes], places: list[list[tuple[int, int, list[bytes]]]]) -> bytes:
    """Lays the packets out in time, ``total`` of them: the opening at once, then at each packet the most urgent due
    step (a wipe, then clearing, then drawing; then the earliest due) sends its next packet. A step waits for the one
    before it in its place. Whatever is still waiting when the clip ends is left out."""
    stream = bytearray(b''.join(opening))
    position = [0] * len(places)  # each place's current step
    sent = [0] * len(places)      # packets of that step already sent
    slot = len(opening)
    while slot < total:
        best = None
        for place, steps in enumerate(places):
            if position[place] < len(steps):
                due, kind, _ = steps[position[place]]
                if due <= slot and (best is None or (kind, due, place) < best):
                    best = (kind, due, place)
        if best is None:
            # Nothing is due: empty packets until something is.
            upcoming = [steps[position[place]][0] for place, steps in enumerate(places) if position[place] < len(steps)]
            until = min([total, *upcoming])
            stream += bytes(24 * (until - slot))
            slot = until
            continue
        place = best[2]
        packets = places[place][position[place]][2]
        if packets:
            stream += packets[sent[place]]
            sent[place] += 1
            slot += 1
        if sent[place] >= len(packets):
            position[place] += 1
            sent[place] = 0
    return bytes(stream[:total * 24]).ljust(total * 24, b'\0')


def export_cdg(project: dict, backing: Path, work_dir: Path, encode: Callable[[Path, Path], None], font_path: Path,
               cancel: threading.Event, stage: Callable[[str], None], style: str = 'classic', **timing) -> Path:
    """Writes the song as a zip in ``work_dir``: "Artist - Title.cdg" and "Artist - Title.mp3", the backing encoded by
    ``encode``. Returns the zip's path."""
    name = song_name(project)
    stage('Drawing the karaoke graphics')
    graphics = render_cdg(project, font_path, style, **timing)
    if cancel.is_set():
        raise RuntimeError('MP3+G export was cancelled.')
    stage('Encoding the backing as MP3')
    audio = work_dir / 'backing.mp3'
    encode(backing, audio)
    output = work_dir / 'export.mp3g.zip'
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f'{name}.cdg', graphics)
        archive.write(audio, f'{name}.mp3', compress_type=zipfile.ZIP_STORED)
    return output
