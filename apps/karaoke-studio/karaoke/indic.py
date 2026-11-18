"""Lyrics in the Indian scripts, read in Latin letters as their languages say them.

Devanagari (Hindi, Marathi, Nepali), Bengali, Gurmukhi (Punjabi), Gujarati, Odia, Tamil, Telugu, Kannada and Malayalam
share one layout, each letter at the same place in its script's Unicode block. Each consonant carries a vowel (a; o in
Bengali and Odia) unless a vowel sign or a virama follows it. Hindi, Punjabi, Gujarati and Bengali drop that vowel at
the end of a word and between two sounded syllables (करना is "karnaa", not "karanaa"; कमल stays "kamal"), unless three
consonants would meet (ज़िंदगी stays "zindagee"); the southern languages and Odia sound it. Long vowels are doubled the
way film lyrics are usually romanized (आ "aa", ई "ee", ऊ "oo"), except in Bengali and Odia, which do not tell them
apart, and e and o, which stay single; dotted letters take their Urdu sounds (ज़ "z", फ़ "f"), and Tamil's stops are
voiced where Tamil voices them. The nasal sign is "m" before p, b and m and at the end
of a Telugu, Kannada or Malayalam word, and "ng" in Bengali.
"""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field


@dataclass(frozen=True)
class _Script:
    start: int
    inherent: str = 'a'
    drops: bool = True
    long_vowels: bool = True
    southern: bool = False
    letters: dict[int, str] = field(default_factory=dict)
    after: dict[int, str] = field(default_factory=dict)
    signs: dict[int, str] = field(default_factory=dict)


# Consonants by their place in the block, as Devanagari reads them (क at 0x15 to ह at 0x39).
_CONSONANTS = dict(zip(range(0x15, 0x3A),
                       ['k', 'kh', 'g', 'gh', 'ng', 'ch', 'chh', 'j', 'jh', 'ny', 't', 'th', 'd', 'dh', 'n', 't', 'th', 'd', 'dh', 'n',
                        'n', 'p', 'ph', 'b', 'bh', 'm', 'y', 'r', 'r', 'l', 'l', 'zh', 'v', 'sh', 'sh', 's', 'h'], strict=True))
# A consonant with a dot below (nukta), by the plain consonant's place.
_DOTTED = {0x15: 'q', 0x16: 'kh', 0x17: 'gh', 0x1C: 'z', 0x21: 'r', 0x22: 'rh', 0x2B: 'f', 0x2F: 'y', 0x32: 'l', 0x38: 'sh'}
_VOWELS = {0x05: 'a', 0x06: 'aa', 0x07: 'i', 0x08: 'ee', 0x09: 'u', 0x0A: 'oo', 0x0B: 'ri', 0x0C: 'li', 0x0D: 'e', 0x0E: 'e', 0x0F: 'e',
           0x10: 'ai', 0x11: 'o', 0x12: 'o', 0x13: 'o', 0x14: 'au'}
_SIGNS = {0x3E: 'aa', 0x3F: 'i', 0x40: 'ee', 0x41: 'u', 0x42: 'oo', 0x43: 'ri', 0x44: 'ri', 0x45: 'e', 0x46: 'e', 0x47: 'e', 0x48: 'ai',
          0x49: 'o', 0x4A: 'o', 0x4B: 'o', 0x4C: 'au'}
# Nasalization and the breathy h after a vowel (Gurmukhi's tippi too).
_AFTER = {0x01: 'n', 0x02: 'n', 0x03: 'h'}
_VIRAMA, _NUKTA, _ANUSVARA = 0x4D, 0x3C, 0x02
# The nasal (anusvara, or Gurmukhi's tippi) is said "m" before these: p, ph, b, bh, m.
_LABIALS = range(0x2A, 0x2F)
_SHORT = {'aa': 'a', 'ee': 'i', 'oo': 'u'}

_SCRIPTS = (
    _Script(0x0900),
    # য is ja in Bengali and ং "ng".
    _Script(0x0980, inherent='o', long_vowels=False, letters={0x2F: 'j'}, after={0x02: 'ng'}),
    # Gurmukhi: ੲ and ੳ only carry vowel signs.
    _Script(0x0A00, letters={0x72: '', 0x73: ''}),
    _Script(0x0A80),
    _Script(0x0B00, drops=False, long_vowels=False, letters={0x2F: 'j', 0x71: 'w'}),
    # Tamil writes each stop with one letter for its voiceless and voiced sounds (see _tamil).
    _Script(0x0B80, drops=False, southern=True),
    _Script(0x0C00, drops=False, southern=True),
    _Script(0x0C80, drops=False, southern=True),
    # Malayalam's chillus are consonants that end a syllable, and its au is written with the length mark alone.
    _Script(0x0D00, drops=False, southern=True, letters={0x7A: 'n', 0x7B: 'n', 0x7C: 'r', 0x7D: 'l', 0x7E: 'l', 0x7F: 'k'},
            signs={0x57: 'au'}),
)
_CHILLUS = range(0x7A, 0x80)
_GURMUKHI_TIPPI, _GURMUKHI_ADDAK = 0x70, 0x71
_TAMIL, _TAMIL_RR, _TAMIL_NN = 0x0B80, 0x31, 0x29
# Tamil's stops (க ச ட த ப), voiceless and voiced, and its nasals (ங ஞ ண ந ன ம) as said before a stop.
_TAMIL_STOPS = {0x15: ('k', 'g'), 0x1A: ('ch', 'j'), 0x1F: ('t', 'd'), 0x24: ('th', 'dh'), 0x2A: ('p', 'b')}
_TAMIL_NASALS = {0x19: 'n', 0x1E: 'n', 0x23: 'n', 0x28: 'n', 0x29: 'n', 0x2E: 'm'}


def _script(ch: str) -> _Script | None:
    code = ord(ch)
    for script in _SCRIPTS:
        if script.start <= code < script.start + 0x80:
            return script
    return None


def is_indic(ch: str) -> bool:
    """Whether ``ch`` is in one of the scripts read here (or Devanagari's extension block)."""
    return _script(ch) is not None or 0xA8E0 <= ord(ch) <= 0xA8FF


def _dotted(ch: str) -> bool:
    """Whether ``ch`` is a consonant and its dot (nukta) written as one character."""
    parts = unicodedata.normalize('NFD', ch)
    script = _script(parts[-1]) if len(parts) == 2 else None
    return script is not None and ord(parts[1]) - script.start == _NUKTA


def _vowel(script: _Script, offset: int, table: dict[int, str]) -> str:
    # The southern scripts' short and long e and o are both written e and o, as their lyrics usually are (ప్రేమ "prema").
    vowel = script.signs.get(offset) if table is _SIGNS and offset in script.signs else table[offset]
    if script.inherent == 'o' and offset == 0x05:
        vowel = 'o'
    return vowel


def _sign(word: str, i: int, script: _Script) -> tuple[int, int] | None:
    """The vowel sign at ``word[i]`` as (offset, characters it takes), joining a two-part sign typed as its parts
    (Tamil's ொ as ெ and ா); None when there is no vowel sign there."""
    def offset(k: int) -> int:
        return ord(word[k]) - script.start if k < len(word) and _script(word[k]) is script else -1
    if offset(i) not in _SIGNS and offset(i) not in script.signs:
        return None
    end = i + 1
    while offset(end) >= 0x3E and len(unicodedata.normalize('NFC', word[i:end + 1])) == 1:
        end += 1
    joined = unicodedata.normalize('NFC', word[i:end])
    whole = ord(joined) - script.start if len(joined) == 1 else -1
    return (whole, end - i) if whole in _SIGNS or whole in script.signs else (offset(i), 1)


def _nasal(word: str, i: int, script: _Script) -> str:
    """How the nasal sign at ``word[i]`` is said: "m" before p, b or m, and at the end of a word in the southern
    languages (Malayalam's മലയാളം is "malayaalam"), but always "ng" in Bengali."""
    if _ANUSVARA in script.after:
        return script.after[_ANUSVARA]
    after = word[i + 1] if i + 1 < len(word) else ''
    if after and _script(after) is script and ord(after) - script.start in _LABIALS:
        return 'm'
    if script.southern and not (after and _script(after) is script):
        return 'm'
    return 'n'


def _tamil(syllables: list[list]) -> None:
    """Tamil's stops as said: voiceless at the start of a word, doubled or after another consonant, voiced after a nasal
    and between vowels (அன்பு "anbu", தங்கம் "thangam", மாதம் "maadham"), with ச "s" except after a nasal (மஞ்சள்
    "manjal"); ற்ற is "tr" and ன்ற "ndr" (காற்று "kaatru", ஒன்று "ondru")."""
    for k, here in enumerate(syllables):
        before = syllables[k - 1] if k else None
        if here[5].start != _TAMIL or (before is not None and before[5] is not here[5]):
            continue
        offset, closed = here[6], before is not None and before[6] >= 0 and not before[2]
        if offset in _TAMIL_STOPS:
            voiceless, voiced = _TAMIL_STOPS[offset]
            if closed and before[6] == offset:
                before[1], here[1] = voiceless[0], voiceless
            elif closed and before[6] in _TAMIL_NASALS:
                before[1], here[1] = _TAMIL_NASALS[before[6]], voiced
            elif before is None or not closed:
                here[1] = 's' if offset == 0x1A else voiceless if before is None else voiced
            else:
                here[1] = voiceless
        elif offset == _TAMIL_RR and closed and before[6] == _TAMIL_RR:
            before[1] = 't'
        elif offset == _TAMIL_RR and closed and before[6] == _TAMIL_NN:
            here[1] = 'dr'


def readings(word: str, long_vowels: bool = True) -> list[str]:
    """Each character of a ``word`` in one of these scripts as it is read, the syllable's letters on its first character
    and '' on the signs that follow; other characters are read as ''. Without ``long_vowels``, long vowels are one letter
    (आ "a"), as the letter aligner finds them more surely."""
    # Precomposed dotted letters (Devanagari's ज़, Bengali's য়, Gurmukhi's ਜ਼ ...): read the letter and its dot, and put
    # each reading back on the original character. Two-part vowel signs (Bengali's ো) stay whole.
    if any(_dotted(ch) for ch in word):
        decomposed, owners = [], []
        for index, ch in enumerate(word):
            for part in (unicodedata.normalize('NFD', ch) if _dotted(ch) else ch):
                decomposed.append(part)
                owners.append(index)
        read = readings(''.join(decomposed), long_vowels)
        result = [''] * len(word)
        for owner, reading in zip(owners, read, strict=True):
            result[owner] += reading
        return result
    # Syllables: [first character, consonant letters, vowel, inherent (droppable), letters after the vowel, script,
    # the consonant's place in its block (-1 for a vowel)].
    syllables: list[list] = []
    doubled = False
    i = 0
    while i < len(word):
        ch, script = word[i], _script(word[i])
        offset = ord(ch) - script.start if script else -1
        if script and (offset in _CONSONANTS or offset in script.letters):
            letters = script.letters.get(offset, _CONSONANTS.get(offset, ''))
            start = i
            i += 1
            if i < len(word) and _script(word[i]) is script and ord(word[i]) - script.start == _NUKTA:
                letters = _DOTTED.get(offset, letters)
                i += 1
            if doubled and syllables:
                # Gurmukhi's addak doubles the consonant after it: the syllable before ends in it.
                syllables[-1][4] += letters[:1]
                doubled = False
            vowel, inherent = script.inherent, offset not in _CHILLUS
            sign = _sign(word, i, script) if inherent else None
            if not inherent:
                vowel = ''
            elif sign:
                vowel, inherent = _vowel(script, sign[0], _SIGNS), False
                i += sign[1]
            elif i < len(word) and _script(word[i]) is script and ord(word[i]) - script.start == _VIRAMA:
                vowel, inherent = '', False
                i += 1
            syllables.append([start, letters, vowel, inherent, '', script, offset])
        elif script and offset in _VOWELS:
            syllables.append([i, '', _vowel(script, offset, _VOWELS), False, '', script, -1])
            i += 1
        elif script and offset == 0x4E and script.start == 0x0980:
            syllables.append([i, 't', '', False, '', script, offset])
            i += 1
        elif script and (offset in _AFTER or (script.start == 0x0A00 and offset == _GURMUKHI_TIPPI)) and syllables:
            nasal = offset in (_ANUSVARA, _GURMUKHI_TIPPI)
            syllables[-1][4] += _nasal(word, i, script) if nasal else script.after.get(offset, _AFTER[offset])
            i += 1
        elif script and script.start == 0x0A00 and offset == _GURMUKHI_ADDAK:
            doubled = True
            i += 1
        else:
            i += 1
    # The northern languages drop the inherent vowel at the end of a word of more than one syllable, then, right to left,
    # between a sounded syllable and one that keeps its vowel, unless three consonants would meet.
    if len(syllables) > 1 and syllables[-1][3] and not syllables[-1][4] and syllables[-1][5].drops:
        syllables[-1][2] = ''
    for k in range(len(syllables) - 2, 0, -1):
        here, before, after = syllables[k], syllables[k - 1], syllables[k + 1]
        if here[5].drops and here[3] and not here[4] and before[2] and not before[4] and after[2] and after[1]:
            here[2] = ''
    _tamil(syllables)
    result = [''] * len(word)
    for start, letters, vowel, _, tail, script, _ in syllables:
        long = long_vowels and script.long_vowels
        result[start] = letters + (vowel if long else _SHORT.get(vowel, vowel)) + tail
    return result


def romanized(word: str) -> str:
    """A word in one of these scripts in Latin letters as its language says it, other characters kept as they are."""
    read = readings(word)
    return ''.join(reading if is_indic(ch) else ch for ch, reading in zip(word, read, strict=True))
