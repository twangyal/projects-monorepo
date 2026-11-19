"""UltraStar songs: the saved lyrics laid on the melody, for the open singing games that score pitch (UltraStar Deluxe,
Vocaluxe, Performous).

An UltraStar song is a text file beside its audio. Each sung word becomes a note at the pitch the melody guide found
while it was sung (see ``melody``): a word sung across several notes takes one note each, the later ones carrying
"~" as UltraStar writes a held word, and a word sung where the guide found no steady note becomes a freestyle note,
shown but not scored. Times are beats of 15/BPM seconds counted from the gap before the first word. Each saved line
ends with a line break. The song's audio is the original mix, with the backing and the separated vocals beside it for
the games that offer karaoke without the singer.
"""
from __future__ import annotations

from pathlib import Path
import re
import threading
from typing import Callable
import zipfile

from .lyrics_auto import needs_space, word_timings
from .model import validate_project

# One beat is 15 / BPM seconds: 37.5 ms, fine enough for word starts.
BPM = 400
BEAT = 15 / BPM
# UltraStar pitches count semitones from middle C (MIDI 60).
MIDDLE_C = 60
# The song's language as UltraStar names it, for the recognizers' language codes.
LANGUAGES = {'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German', 'it': 'Italian', 'pt': 'Portuguese', 'nl': 'Dutch',
             'pl': 'Polish', 'sv': 'Swedish', 'da': 'Danish', 'fi': 'Finnish', 'cs': 'Czech', 'ru': 'Russian', 'uk': 'Ukrainian',
             'zh': 'Chinese', 'yue': 'Cantonese', 'ja': 'Japanese', 'ko': 'Korean', 'hi': 'Hindi', 'tr': 'Turkish', 'el': 'Greek'}
_CONTROL = re.compile(r'[\x00-\x1f\x7f]')


def _plain(text: str) -> str:
    return re.sub(r'\s+', ' ', _CONTROL.sub(' ', text)).strip()


UNKNOWN_ARTIST = 'Unknown artist'


def artist_and_title(title: str) -> tuple[str, str]:
    """A clip named "Artist - Title" as its artist and title; otherwise an unknown artist."""
    artist, separator, song = _plain(title).partition(' - ')
    return (artist.strip(), song.strip()) if separator and artist.strip() and song.strip() else (UNKNOWN_ARTIST, _plain(title) or 'Untitled')


def _header(name: str, value: str) -> str:
    return f'#{name}:{_plain(value)}'


def render_ultrastar(project: dict, words: list | None = None, letters=None, language: str | None = None, notes: list | None = None, *,
                     audio: str = 'song.mp3', instrumental: str | None = None, vocals: str | None = None) -> str:
    """The project's saved lyrics as an UltraStar song text; ``words`` are recognized words (may be empty), ``letters``
    the letters measured in the vocals, ``language`` the song's recognized language and ``notes`` the melody guide's
    notes [start s, end s, MIDI note]."""
    project = validate_project(project)
    cues = project['cues']
    timings = word_timings(cues, words or [], project['duration'], letters, language)
    notes = sorted(notes or [], key=lambda note: note[0])
    sung = [(cue, [word for word in timing if _plain(word['text'])]) for cue, timing in zip(cues, timings)]
    sung = [(cue, line) for cue, line in sung if line]
    if not sung:
        raise ValueError('Add lyric lines with words before exporting an UltraStar song.')
    gap = round(sung[0][1][0]['start'] * 1000)
    beat = lambda seconds: round((seconds * 1000 - gap) / (BEAT * 1000))  # noqa: E731
    artist, title = artist_and_title(project['title'])
    lines = [_header('TITLE', title), _header('ARTIST', artist), '#ENCODING:UTF8']
    if language in LANGUAGES:
        lines.append(_header('LANGUAGE', LANGUAGES[language]))
    lines += [_header('MP3', audio), *([_header('INSTRUMENTAL', instrumental)] if instrumental else []),
              *([_header('VOCALS', vocals)] if vocals else []), f'#BPM:{BPM}', f'#GAP:{gap}']
    end = 0  # The beat after the last note written.
    pitch = 0
    for number, (cue, line) in enumerate(sung):
        previous = ''
        for index, word in enumerate(line):
            text = _plain(word['text'])
            start = word['start']
            until = line[index + 1]['start'] if index + 1 < len(line) else cue['end']
            # The melody guide's notes sung during the word, cut to it.
            heard = [(max(start, note[0]), min(until, note[1]), note[2]) for note in notes if note[0] < until and note[1] > start]
            heard = [part for part in heard if beat(part[1]) > beat(part[0])]
            spaced = (' ' if previous and needs_space(previous, text) else '') + text
            if not heard:
                first = max(beat(start), end)
                length = max(1, beat(until) - first)
                lines.append(f'F {first} {length} {pitch} {spaced}')
                end = first + length
            for part, (a, b, midi) in enumerate(heard):
                first = max(beat(a), end)
                length = max(1, beat(b) - first)
                pitch = midi - MIDDLE_C
                lines.append(f': {first} {length} {pitch} {spaced if part == 0 else "~"}')
                end = first + length
            previous = text
        if number + 1 < len(sung):
            lines.append(f'- {end}')
    lines.append('E')
    return '\n'.join(lines) + '\n'


def song_name(project: dict) -> str:
    """The song's folder and file name, "Artist - Title", safe on any file system."""
    artist, title = artist_and_title(project['title'])
    name = re.sub(r'[\\/:*?"<>|]+', ' ', f'{artist} - {title}')
    return re.sub(r'\s+', ' ', name).strip(' .')[:120] or 'Karaoke song'


def export_ultrastar(project: dict, sources: dict[str, Path], work_dir: Path, encode: Callable[[Path, Path], None],
                     cancel: threading.Event, stage: Callable[[str], None], **timing) -> Path:
    """Writes the song as a zip in ``work_dir``: a folder named after it holding the song text and its audio, encoded
    from the ``sources`` WAVs ('original', 'backing' and 'vocals') by ``encode``. Returns the zip's path."""
    name = song_name(project)
    files = {'original': f'{name}.mp3', 'backing': f'{name} [INSTR].mp3', 'vocals': f'{name} [VOC].mp3'}
    encoded = {}
    for kind, label in (('original', 'the song'), ('backing', 'the backing'), ('vocals', 'the vocals')):
        if cancel.is_set():
            raise RuntimeError('UltraStar export was cancelled.')
        stage(f'Encoding {label} for the UltraStar song')
        target = work_dir / f'{kind}.mp3'
        encode(sources[kind], target)
        encoded[kind] = target
    text = render_ultrastar(project, audio=files['original'], instrumental=files['backing'], vocals=files['vocals'], **timing)
    output = work_dir / 'export.ultrastar.zip'
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_STORED) as archive:
        archive.writestr(f'{name}/{name}.txt', text.encode('utf-8'))
        for kind, path in encoded.items():
            archive.write(path, f'{name}/{files[kind]}')
    return output
