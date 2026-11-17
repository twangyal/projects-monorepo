"""Japanese lyrics read in romaji (Hepburn) for the letter aligner.

Kana are read from a table; kanji are read with the word they belong to, from SudachiPy's small dictionary (Works
Applications, Apache-2.0; optional, see requirements-japanese.txt). A word's reading less its kana is its kanji's, and is
given to the first kanji of the run, the others being read with it. Without the dictionary Japanese lyrics stay unread
and are matched to the recognized words as before.

On 20 sung Japanese phrases (GTSinger) the romanized lyrics put 65% of breath-separated supplied lines within 0.3 s of
their sung start, against 48% when matched to the words SenseVoice recognized (median 0.16 s against 0.33 s); two of the
phrases had too many words the small dictionary could not read and kept the recognized words' timing. Single characters
were not clearly better (45% against 38% within 0.15 s, but 57% against 59% within 0.3 s), so they keep the recognized
words' timing.
"""
from __future__ import annotations

from collections.abc import Callable, Iterable
from functools import lru_cache

JAPANESE = 'ja'
# A character read together with the one before it (the rest of a kanji word, a small kana): known, but no letters.
CONTINUED = '⁠'

_ROMAJI = {
    'ア': 'a', 'イ': 'i', 'ウ': 'u', 'エ': 'e', 'オ': 'o', 'カ': 'ka', 'キ': 'ki', 'ク': 'ku', 'ケ': 'ke', 'コ': 'ko', 'サ': 'sa',
    'シ': 'shi', 'ス': 'su', 'セ': 'se', 'ソ': 'so', 'タ': 'ta', 'チ': 'chi', 'ツ': 'tsu', 'テ': 'te', 'ト': 'to', 'ナ': 'na', 'ニ': 'ni',
    'ヌ': 'nu', 'ネ': 'ne', 'ノ': 'no', 'ハ': 'ha', 'ヒ': 'hi', 'フ': 'fu', 'ヘ': 'he', 'ホ': 'ho', 'マ': 'ma', 'ミ': 'mi', 'ム': 'mu',
    'メ': 'me', 'モ': 'mo', 'ヤ': 'ya', 'ユ': 'yu', 'ヨ': 'yo', 'ラ': 'ra', 'リ': 'ri', 'ル': 'ru', 'レ': 're', 'ロ': 'ro', 'ワ': 'wa',
    'ヰ': 'i', 'ヱ': 'e', 'ヲ': 'o', 'ン': 'n', 'ガ': 'ga', 'ギ': 'gi', 'グ': 'gu', 'ゲ': 'ge', 'ゴ': 'go', 'ザ': 'za', 'ジ': 'ji',
    'ズ': 'zu', 'ゼ': 'ze', 'ゾ': 'zo', 'ダ': 'da', 'ヂ': 'ji', 'ヅ': 'zu', 'デ': 'de', 'ド': 'do', 'バ': 'ba', 'ビ': 'bi', 'ブ': 'bu',
    'ベ': 'be', 'ボ': 'bo', 'パ': 'pa', 'ピ': 'pi', 'プ': 'pu', 'ペ': 'pe', 'ポ': 'po', 'ヴ': 'vu', 'ァ': 'a', 'ィ': 'i', 'ゥ': 'u',
    'ェ': 'e', 'ォ': 'o', 'ャ': 'ya', 'ュ': 'yu', 'ョ': 'yo', 'ヮ': 'wa'}
_GLIDES = frozenset('ャュョ')
_SMALL_VOWELS = frozenset('ァィゥェォヮ')


def _katakana(text: str) -> str:
    return ''.join(chr(ord(ch) + 0x60) if 'ぁ' <= ch <= 'ゖ' else ch for ch in text)


def is_kana(ch: str) -> bool:
    return 'ぁ' <= ch <= 'ゖ' or 'ァ' <= ch <= 'ヺ' or ch == 'ー'


def is_kanji(ch: str) -> bool:
    code = ord(ch)
    return 0x4E00 <= code <= 0x9FFF or 0x3400 <= code <= 0x4DBF or 0xF900 <= code <= 0xFAFF or code == 0x3005  # 々 repeats a kanji


def romaji(kana: Iterable[str]) -> list[str]:
    """Each kana's romaji: a small kana joins the one before it (キャ is kya, ファ fa), っ takes the next one's
    consonant, and ー repeats the vowel before it."""
    kana, out = [_katakana(ch) for ch in kana], []
    for k, ch in enumerate(kana):
        if (ch in _GLIDES or ch in _SMALL_VOWELS) and out and out[-1] and out[-1] != CONTINUED:
            # The small kana replaces the vowel before it: キャ is kya and ファ fa, while シャ, チャ and ジャ are sha, cha
            # and ja, without the glide's y.
            stem = out[-1][:-1]
            out[-1] = stem + (_ROMAJI[ch][1:] if ch in _GLIDES and stem.endswith(('sh', 'ch', 'j')) else _ROMAJI[ch])
            out.append(CONTINUED)
        elif ch == 'ッ':
            following = _ROMAJI.get(kana[k + 1], '') if k + 1 < len(kana) else ''
            out.append(following[:1] if following and following[0] not in 'aiueo' else CONTINUED)
        elif ch == 'ー':
            vowel = next((reading for reading in reversed(out) if reading and reading != CONTINUED), '')[-1:]
            out.append(vowel or CONTINUED)
        else:
            out.append(_ROMAJI.get(ch, ''))
    return out


@lru_cache(maxsize=1)
def _dictionary() -> Callable[[str], list[tuple[str, str]]] | None:
    """Words of a text with their readings in katakana, or None without SudachiPy and its small dictionary."""
    try:
        from sudachipy import Dictionary
        tokenizer = Dictionary(dict='small').create()
    except Exception:  # not installed, or its dictionary missing: Japanese stays unread
        return None
    return lambda text: [(word.surface(), word.reading_form()) for word in tokenizer.tokenize(text)]


def japanese_readings(text: str, words: Callable[[str], list[tuple[str, str]]] | None = None) -> list[str | None] | None:
    """Each character of ``text`` in romaji: CONTINUED for one read with the character before it, None for one that is
    not Japanese (Latin letters, digits) or has no reading. None for the whole text without a reading dictionary."""
    words = words or _dictionary()
    if words is None:
        return None
    result: list[str | None] = []
    for surface, reading in words(text):
        reading = _katakana(reading)
        kana = [_katakana(ch) if is_kana(ch) else None for ch in surface]
        if not any(is_kana(ch) or is_kanji(ch) for ch in surface):
            result += [None] * len(surface)
            continue
        if all(kana):
            result += romaji(kana)
            continue
        # The word's kana before and after its kanji match the reading's ends; what is left is the kanji's.
        head = 0
        while head < len(surface) and kana[head] and head < len(reading) and reading[head] == kana[head]:
            head += 1
        tail = 0
        while (tail < len(surface) - head and kana[len(surface) - 1 - tail] and tail < len(reading) - head
               and reading[len(reading) - 1 - tail] == kana[len(surface) - 1 - tail]):
            tail += 1
        # Kana left between them mean the reading does not line up with the characters: the word stays unread.
        if any(kana[k] for k in range(head, len(surface) - tail)):
            result += [None] * len(surface)
            continue
        spelled = romaji(reading)
        middle = ''.join(part for part in spelled[head:len(reading) - tail] if part != CONTINUED)
        run = len(surface) - head - tail
        out = spelled[:head] + ([middle or None] + [CONTINUED if middle else None] * (run - 1) if run > 0 else []) + (spelled[len(reading) - tail:] if tail else [])
        # A word whose reading does not line up with its characters is left unread rather than misread.
        result += out if len(out) == len(surface) else [None] * len(surface)
    return result if len(result) == len(text) else None
