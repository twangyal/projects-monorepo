"""How a lyric line is said, in Latin letters, for singers who do not read its script.

Korean is written in Revised Romanization and Cyrillic transliterated as Russian reads it (as the letter aligner spells
them); Chinese, in a song recognized as Mandarin, in pinyin with tone marks, and in one recognized as Cantonese, in
Jyutping with tone numbers; Japanese, in a song recognized as Japanese and with the optional reading dictionary, in
Hepburn romaji word by word, the particles は, へ and を as they are said; Hindi in Devanagari as Hindi says it
(``devanagari``).
Words already in Latin letters are kept as written.
"""
from __future__ import annotations

import unicodedata
from collections.abc import Callable

from .alignment import _HAN, CANTONESE, MANDARIN, _spelled, chinese_readings
from .devanagari import is_devanagari, romanized
from .japanese import JAPANESE, is_kana, is_kanji, japanese_words
from .lyrics_auto import lyric_words


def _script(ch: str) -> str:
    code = ord(ch)
    if 0xAC00 <= code <= 0xD7A3 or 0x1100 <= code <= 0x11FF or 0x3130 <= code <= 0x318F:
        return 'hangul'
    if 0x0400 <= code <= 0x04FF:
        return 'cyrillic'
    if is_kana(ch):
        return 'kana'
    if is_kanji(ch) or _HAN.match(ch):
        return 'han'
    if is_devanagari(ch):
        return 'devanagari' if unicodedata.category(ch).startswith('L') else ''
    if unicodedata.category(ch).startswith('L'):
        return 'latin' if 'LATIN' in unicodedata.name(ch, '') else 'other'
    return ''


def _respelled(word: str) -> str:
    """A Korean or Cyrillic word letter by letter in Latin letters, its capital kept; other characters as they are."""
    said = ''.join(_spelled(ch) for ch in word)
    return said[:1].upper() + said[1:] if word[:1].isupper() else said


def pronunciation(text: str, language: str | None = None,
                  words: Callable[[str], list[tuple[str, str, bool]]] | None = None) -> list[str] | None:
    """For each lyric word of ``text`` (``lyrics_auto.lyric_words``), the piece of the line's pronunciation it starts,
    '' for a word said with the one before it (the rest of a Japanese word). None when the line needs none, its
    letters all being Latin, or when a word of it cannot be read (Chinese characters in a song not recognized as
    Mandarin, Cantonese or Japanese, Japanese without the reading dictionary, other scripts). ``words`` stands in for the Japanese
    dictionary's tokens (surface, reading in katakana, whether it is a particle)."""
    tokens = lyric_words(text)
    scripts = [{_script(ch) for ch in token} - {''} for token in tokens]
    if not any(kinds - {'latin'} for kinds in scripts):
        return None
    if any('other' in kinds for kinds in scripts):
        return None
    starts, at = [], 0
    for token in tokens:
        at = text.index(token, at)
        starts.append(at)
        at += len(token)
    said: list[str | None] = [None] * len(tokens)
    if language == JAPANESE and any({'kana', 'han'} & kinds for kinds in scripts):
        spans = japanese_words(text, words)
        if spans is None:
            return None
        for k, (token, start) in enumerate(zip(tokens, starts, strict=True)):
            if not {'kana', 'han'} & scripts[k]:
                continue
            span = next((span for span in spans if span[0] <= start < span[1]), None)
            if span is None or not span[2]:
                return None
            said[k] = span[2] if span[0] == start else ''
    if language in (MANDARIN, CANTONESE) and any('han' in kinds for kinds in scripts):
        for run in _HAN.finditer(text):
            readings = chinese_readings(run.group(), language, tones=True)
            if readings is None or None in readings:
                return None
            for offset, reading in enumerate(readings):
                index = starts.index(run.start() + offset) if run.start() + offset in starts else None
                if index is not None:
                    said[index] = reading
    for k, token in enumerate(tokens):
        if said[k] is not None:
            continue
        if 'han' in scripts[k] or 'kana' in scripts[k]:
            return None
        said[k] = _respelled(token) if {'hangul', 'cyrillic'} & scripts[k] else romanized(token) if 'devanagari' in scripts[k] else token
    return [piece or '' for piece in said]


def said_line(pieces: list[str]) -> str:
    """The pronunciation as shown: its pieces, a space between each."""
    return ' '.join(piece for piece in pieces if piece)
