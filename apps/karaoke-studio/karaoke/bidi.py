"""Where the words of a lyric line with right-to-left text are drawn, so they can light up as they are sung.

Such a line is shaped and ordered as a whole: Arabic letters join, and the Unicode bidirectional algorithm places Latin
words and numbers among the right-to-left ones, so the words sung first can lie anywhere along it. The video draws the
line whole twice over, in the colour of words not yet sung and in the sung colour where the sung words lie. The levels
come from FriBidi, the library Pillow's RAQM layout orders text with, so the words are found where Pillow draws them.
The preview finds them with the browser's own layout (src/bidi-highlight.ts); sung-stretches.json holds cases both
agree on.
"""
import ctypes
import ctypes.util
import functools
import math

# FriBidi's paragraph directions (FRIBIDI_PAR_LTR and FRIBIDI_PAR_RTL in fribidi-bidi-types.h).
_PAR_LTR, _PAR_RTL = 0x110, 0x111
# The names Pillow loads FriBidi by on each platform, after the one the system reports.
_NAMES = ('libfribidi.so.0', 'libfribidi.dylib', 'libfribidi.0.dylib', 'fribidi.dll', 'libfribidi-0.dll')


@functools.cache
def _fribidi():
    """The FriBidi library with the calls used here, or None where it cannot be loaded."""
    for name in filter(None, (ctypes.util.find_library('fribidi'), *_NAMES)):
        try:
            library = ctypes.CDLL(name)
            types, brackets = library.fribidi_get_bidi_types, library.fribidi_get_bracket_types
            levels = library.fribidi_get_par_embedding_levels_ex
        except (OSError, AttributeError):
            continue
        u32 = ctypes.POINTER(ctypes.c_uint32)
        types.argtypes, types.restype = [u32, ctypes.c_int, u32], None
        brackets.argtypes, brackets.restype = [u32, ctypes.c_int, u32, u32], None
        levels.argtypes, levels.restype = [u32, u32, ctypes.c_int, u32, ctypes.POINTER(ctypes.c_int8)], ctypes.c_int8
        return library
    return None


def levels(text: str, rtl: bool) -> list[int] | None:
    """Each character's embedding level with ``text`` as one paragraph in that base direction, as RAQM resolves it
    (brackets included); None when FriBidi is not available."""
    library = _fribidi()
    if library is None:
        return None
    size = len(text)
    if not size:
        return []
    characters = (ctypes.c_uint32 * size)(*map(ord, text))
    types, brackets, resolved = (ctypes.c_uint32 * size)(), (ctypes.c_uint32 * size)(), (ctypes.c_int8 * size)()
    base = ctypes.c_uint32(_PAR_RTL if rtl else _PAR_LTR)
    library.fribidi_get_bidi_types(characters, size, types)
    library.fribidi_get_bracket_types(characters, size, types, brackets)
    if not library.fribidi_get_par_embedding_levels_ex(types, brackets, size, ctypes.byref(base), resolved):
        return None
    return list(resolved)


def word_places(text: str, rtl: bool, measure, width: float) -> list[list[tuple[float, float]]] | None:
    """Where each whitespace-separated word of ``text`` lies when it is drawn as one line ``width`` wide in that base
    direction: the left and right edges of its pieces from the line's left edge, several for a word the bidirectional
    algorithm splits. ``measure(piece, direction)`` gives a piece's advance width. None when the levels are unknown."""
    resolved = levels(text, rtl)
    if resolved is None:
        return None
    # Pieces: runs of one level, also split where spaces start and end, so each lies in one word or between words.
    pieces: list[list] = []
    for index, (character, level) in enumerate(zip(text, resolved, strict=True)):
        space = character.isspace()
        if pieces and pieces[-1][2] == level and pieces[-1][3] == space:
            pieces[-1][1] = index + 1
        else:
            pieces.append([index, index + 1, level, space])
    # Rule L2: from the highest level down, reverse every run of pieces at that level or higher.
    order = list(range(len(pieces)))
    for level in range(max(resolved, default=0), 0, -1):
        start = 0
        while start < len(order):
            if pieces[order[start]][2] < level:
                start += 1
                continue
            end = start
            while end < len(order) and pieces[order[end]][2] >= level:
                end += 1
            order[start:end] = order[start:end][::-1]
            start = end
    edges, x = {}, 0.0
    for piece in order:
        start, end, level, _space = pieces[piece]
        advance = measure(text[start:end], 'rtl' if level % 2 else 'ltr')
        edges[piece] = (x, x + advance)
        x += advance
    # Kerning between pieces is lost when they are measured apart; spread the difference over the line.
    scale = width / x if x else 1.0
    places: list[list[tuple[float, float]]] = []
    after_space = True
    for piece, (_start, _end, _level, space) in enumerate(pieces):
        if space:
            after_space = True
            continue
        if after_space:
            places.append([])
            after_space = False
        left, right = edges[piece]
        places[-1].append((left * scale, right * scale))
    # Pieces of a word side by side are one stretch of it.
    joined = []
    for boxes in places:
        merged: list[tuple[float, float]] = []
        for left, right in sorted(boxes):
            if merged and left - merged[-1][1] < 0.5:
                merged[-1] = (merged[-1][0], max(merged[-1][1], right))
            else:
                merged.append((left, right))
        joined.append(merged)
    return joined


def lit_words(text: str, count: int) -> list[bool]:
    """Which whitespace-separated words of ``text`` are lit when ``count`` leading non-space characters are sung: each
    word once its first character is."""
    lit, before = [], 0
    for word in text.split():
        lit.append(before < count)
        before += len(word)
    return lit


def sung_stretches(places: list[list[tuple[float, float]]], lit: list[bool]) -> list[tuple[float, float]]:
    """The stretches of a line to draw in the sung colour: the lit words' pieces, widened halfway to the neighbouring
    pieces of unlit words and, where no unlit piece lies further out, to the line's ends and beyond (infinite)."""
    boxes = sorted((left, right, on) for place, on in zip(places, lit, strict=True) for left, right in place)
    stretches: list[tuple[float, float]] = []
    start = None
    for index, (left, _right, on) in enumerate(boxes):
        between = (boxes[index - 1][1] + left) / 2 if index else -math.inf
        if on and start is None:
            start = between
        if not on and start is not None:
            stretches.append((start, between))
            start = None
    if start is not None:
        stretches.append((start, math.inf))
    return stretches
