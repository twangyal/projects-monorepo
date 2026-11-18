"""Hindi lyrics in Devanagari, read in Latin letters as Hindi says them.

Each consonant carries the vowel a unless a vowel sign or a virama follows it, and Hindi drops that a at the end of a
word and between two sounded syllables (करना is "karnaa", not "karanaa"; कमल stays "kamal"). Long vowels are doubled the
way film lyrics are usually romanized (आ "aa", ई "ee", ऊ "oo"), and dotted letters take their Urdu sounds (ज़ "z",
फ़ "f"). Marathi and Nepali, written in the same letters, are read the same way.
"""
from __future__ import annotations

import unicodedata

_CONSONANTS = dict(zip('कखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसहळ',
                       ['k', 'kh', 'g', 'gh', 'ng', 'ch', 'chh', 'j', 'jh', 'ny', 't', 'th', 'd', 'dh', 'n', 't', 'th', 'd', 'dh', 'n',
                        'p', 'ph', 'b', 'bh', 'm', 'y', 'r', 'l', 'v', 'sh', 'sh', 's', 'h', 'l'], strict=True))
# Consonants with a dot below (nukta), written as one character or as the consonant and the dot.
_DOTTED = {'क': 'q', 'ख': 'kh', 'ग': 'gh', 'ज': 'z', 'ड': 'r', 'ढ': 'rh', 'फ': 'f', 'य': 'y'}
_VOWELS = dict(zip('अआइईउऊऋएऐओऔऍऑ', ['a', 'aa', 'i', 'ee', 'u', 'oo', 'ri', 'e', 'ai', 'o', 'au', 'e', 'o'], strict=True))
_SIGNS = dict(zip('ािीुूृेैोौॅॉ', ['aa', 'i', 'ee', 'u', 'oo', 'ri', 'e', 'ai', 'o', 'au', 'e', 'o'], strict=True))
_VIRAMA, _NUKTA = '्', '़'
_SHORT = {'aa': 'a', 'ee': 'i', 'oo': 'u'}
# Nasalization and the breathy h after a vowel.
_AFTER = {'ं': 'n', 'ँ': 'n', 'ः': 'h'}


def is_devanagari(ch: str) -> bool:
    return 0x0900 <= ord(ch) <= 0x097F or 0xA8E0 <= ord(ch) <= 0xA8FF


def readings(word: str, long_vowels: bool = True) -> list[str]:
    """Each character of a Devanagari ``word`` as it is read, the syllable's letters on its first character and '' on
    the signs that follow; characters outside Devanagari are read as ''. Without ``long_vowels``, long vowels are one
    letter (आ "a"), as the letter aligner finds them more surely."""
    text = unicodedata.normalize('NFD', word)
    if len(text) != len(word):
        # Precomposed dotted letters: read the decomposed form and put each reading back on its original character.
        decomposed, owners = [], []
        for index, ch in enumerate(word):
            for part in unicodedata.normalize('NFD', ch):
                decomposed.append(part)
                owners.append(index)
        read = readings(''.join(decomposed), long_vowels)
        result = [''] * len(word)
        for owner, reading in zip(owners, read, strict=True):
            result[owner] += reading
        return result
    # Syllables: [first character, consonant letters, vowel, inherent (droppable a), letters after the vowel].
    syllables: list[list] = []
    owner = [-1] * len(word)
    i = 0
    while i < len(word):
        ch = word[i]
        if ch in _CONSONANTS:
            letters = _CONSONANTS[ch]
            start = i
            i += 1
            if i < len(word) and word[i] == _NUKTA:
                letters = _DOTTED.get(ch, letters)
                owner[i] = len(syllables)
                i += 1
            vowel, inherent = 'a', True
            if i < len(word) and word[i] in _SIGNS:
                vowel, inherent = _SIGNS[word[i]], False
                owner[i] = len(syllables)
                i += 1
            elif i < len(word) and word[i] == _VIRAMA:
                vowel, inherent = '', False
                owner[i] = len(syllables)
                i += 1
            owner[start] = len(syllables)
            syllables.append([start, letters, vowel, inherent, ''])
        elif ch in _VOWELS:
            owner[i] = len(syllables)
            syllables.append([i, '', _VOWELS[ch], False, ''])
            i += 1
        elif ch in _AFTER and syllables:
            owner[i] = len(syllables) - 1
            syllables[-1][4] += _AFTER[ch]
            i += 1
        else:
            i += 1
    # Hindi drops the inherent a at the end of a word of more than one syllable, then, right to left, between a sounded
    # syllable and one that keeps its vowel, unless that would join three consonants (ज़िंदगी stays "zindagee").
    if len(syllables) > 1 and syllables[-1][3] and not syllables[-1][4]:
        syllables[-1][2] = ''
    for k in range(len(syllables) - 2, 0, -1):
        here, before, after = syllables[k], syllables[k - 1], syllables[k + 1]
        if here[3] and not here[4] and before[2] and not before[4] and after[2] and after[1]:
            here[2] = ''
    result = [''] * len(word)
    for start, letters, vowel, _, tail in syllables:
        result[start] = letters + (vowel if long_vowels else _SHORT.get(vowel, vowel)) + tail
    return result


def romanized(word: str) -> str:
    """A Devanagari word in Latin letters as Hindi says it, other characters kept as they are."""
    read = readings(word)
    return ''.join(reading if is_devanagari(ch) else ch for ch, reading in zip(word, read, strict=True))
