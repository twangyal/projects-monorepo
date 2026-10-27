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

from PIL import Image, ImageDraw, ImageFont

from .limits import (MAX_CARD_BYTES, MAX_CARDS, MAX_VIDEO_BYTES, MAX_VIDEO_FRAMES,
                     SAMPLE_RATE, VIDEO_TIMEOUT)
from .model import ValidationError, validate_project
from .media_io import media_handles
from .lyrics_auto import sung_count, word_timings

WIDTH, HEIGHT, FPS = 1280, 720, 24
BACKGROUND = '#14232f'
MUTED = '#9dafbb'
MAIN = '#f7f5ed'
ACCENT = '#e4b77d'


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


def _center_text(draw: ImageDraw.ImageDraw, text: str, y: int, font_path: Path,
                 size: int, minimum: int, max_height: int, fill: str,
                 sung_chars: int | None = None, sung_fill: str = ACCENT) -> None:
    """Draw a centred, wrapped text block. With ``sung_chars``, that many leading non-space
    characters are drawn in ``sung_fill`` for word-by-word karaoke highlighting."""
    fonts = _fonts(str(font_path))
    for chosen in range(size, minimum - 1, -1):
        measure = functools.partial(fonts.length, size=chosen)
        lines = _wrap(text, measure, 1000)
        spacing = math.ceil(chosen * 1.25)
        if len(lines) * spacing <= max_height:
            break
    # Very newline-heavy lyrics still retain all words without spilling into
    # adjacent regions: compact blank/newline separators and fit one block.
    if len(lines) * spacing > max_height:
        lines = _wrap(' '.join(text.split()), measure, 1000)
    if len(lines) * spacing > max_height:
        # This is an upcoming-text preview: a visible ellipsis keeps it within
        # its own region. Full active lyrics fit at the main block's minimum.
        lines = lines[:max(1, max_height // spacing)]
        while lines[-1] and measure(lines[-1] + '…') > 1000:
            lines[-1] = lines[-1][:-1]
        lines[-1] += '…'
    total = len(lines) * spacing
    # Every face sits on the bundled font's baseline, centred on the line as that font's text would be.
    ascent, descent = fonts.font(0, chosen).getmetrics()
    remaining = len(text) if sung_chars is None else sung_chars
    colour = sung_fill if sung_chars is not None else fill
    for index, line in enumerate(lines):
        baseline = y - total / 2 + (index + 0.5) * spacing + (ascent - descent) / 2
        left = WIDTH / 2 - measure(line) / 2
        for face, run in fonts.runs(line):
            font = fonts.font(face, chosen)
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


def render_card(project: dict, active_index: int | None, output: Path, font_path: Path,
                sung: list[str] | None = None) -> None:
    """One video card. ``sung`` lists the active line's words already sung; without it the whole
    active line is highlighted."""
    project = validate_project(project)
    cues = project['cues']
    if active_index is not None and (type(active_index) is not int or not 0 <= active_index < len(cues)):
        raise ValidationError('Active cue index must identify a saved lyric cue.')
    image = Image.new('RGB', (WIDTH, HEIGHT), BACKGROUND)
    draw = ImageDraw.Draw(image)
    _center_text(draw, ' '.join(project['title'].split()), 80, font_path, 32, 22, 100, MAIN)
    active = cues[active_index]['text'] if active_index is not None else 'Instrumental break'
    if active_index is not None and sung is not None:
        _center_text(draw, active, 320, font_path, 44, 24, 300, MAIN, sum(len(word) for word in sung))
    else:
        _center_text(draw, active, 320, font_path, 44, 24, 300,
                     ACCENT if active_index is not None else MAIN)
    next_index = active_index + 1 if active_index is not None else 0
    if next_index < len(cues):
        _center_text(draw, 'Next: ' + cues[next_index]['text'], 540, font_path, 26, 18, 80, MUTED)
    _center_text(draw, 'Karaoke Studio · Backing track', 660, font_path, 20, 20, 40, MUTED)
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


def export_video(project: dict, backing: Path, output: Path, work_dir: Path,
                 font_path: Path, cancel: threading.Event, words: list | None = None,
                 vocals: Path | None = None, guide: float = 0) -> None:
    """Render the karaoke video; ``words`` are recognized words that time the word highlighting.

    With ``guide`` above zero, the separated ``vocals`` are mixed under the backing at that share (a guide vocal).
    """
    deadline = time.monotonic() + VIDEO_TIMEOUT
    project = validate_project(project)
    _remaining(cancel, deadline)
    if not (isinstance(guide, (int, float)) and 0 <= guide <= 0.5) or (guide and vocals is None):
        raise ValidationError('Guide vocal level must be from 0 to 50 percent of the separated vocals.')
    backing, output, work_dir = Path(backing).absolute(), Path(output), Path(work_dir)
    _validate_backing(backing, project['duration'], cancel, deadline)
    if guide:
        vocals = Path(vocals).absolute()
        _validate_backing(vocals, project['duration'], cancel, deadline, label='Vocal')
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
            cues = project['cues']
            timings = word_timings(cues, words or [], project['duration'])
            for frame in range(frame_count):
                _remaining(cancel, deadline)
                position = frame / FPS
                active = next((index for index, cue in enumerate(cues)
                               if cue['start'] <= position < cue['end']), None)
                upcoming = next((index for index, cue in enumerate(cues) if cue['start'] > position), len(cues))
                sung = sung_count(timings[active], position) if active is not None else None
                state = (active, upcoming if active is None else None, sung)
                if state not in states:
                    if len(states) >= MAX_CARDS:
                        raise RuntimeError('Video preparation exceeded its card count limit.')
                    card = directory / f'card{len(states):04}.png'
                    if active is None:
                        render_card({**project, 'cues': cues[upcoming:]}, None, card, font_path)
                    else:
                        render_card(project, active, card, font_path,
                                    sung=[word['text'] for word in timings[active][:sung]])
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
                # Only validated numbers enter the filter program: backing plus the vocals at the guide share,
                # limited so the sum cannot clip.
                arguments += ['-protocol_whitelist', 'file', '-f', 'wav', '-i', str(vocals),
                              '-filter_complex', f'[1:a][2:a]amix=inputs=2:weights=1 {guide:.2f}:normalize=0,alimiter=limit=0.97[mix]',
                              '-map', '0:v:0', '-map', '[mix]']
            else:
                arguments += ['-map', '0:v:0', '-map', '1:a:0']
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
