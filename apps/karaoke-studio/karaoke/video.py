"""Literal Pillow lyric cards and bounded, local FFmpeg video exports."""
import math
import os
from pathlib import Path
import selectors
import signal
import subprocess
import tempfile
import threading
import time
import wave

from PIL import Image, ImageDraw, ImageFont

from .model import ValidationError, validate_project
from .media_io import media_handles

WIDTH, HEIGHT, FPS = 1280, 720, 24
BACKGROUND = '#14232f'
MUTED = '#9dafbb'
MAIN = '#f7f5ed'
ACCENT = '#e4b77d'


def _wrap(text: str, draw: ImageDraw.ImageDraw, font: ImageFont.FreeTypeFont, width: int) -> list[str]:
    lines = []
    # Keep explicit lyric line breaks; wrap long tokens too. Pillow only draws
    # these strings, so braces, percent signs, shell syntax and markup are data.
    for paragraph in text.replace('\r\n', '\n').replace('\r', '\n').split('\n'):
        current = ''
        for word in paragraph.split():
            candidate = f'{current} {word}' if current else word
            if draw.textlength(candidate, font=font) <= width:
                current = candidate
                continue
            if current:
                lines.append(current)
                current = ''
            for char in word:
                if current and draw.textlength(current + char, font=font) > width:
                    lines.append(current)
                    current = ''
                current += char
        lines.append(current)
    return lines


def _center_text(draw: ImageDraw.ImageDraw, text: str, y: int, font_path: Path,
                 size: int, minimum: int, max_height: int, fill: str) -> None:
    for chosen in range(size, minimum - 1, -1):
        font = ImageFont.truetype(str(font_path), chosen)
        lines = _wrap(text, draw, font, 1000)
        spacing = math.ceil(chosen * 1.25)
        if len(lines) * spacing <= max_height:
            break
    # Very newline-heavy lyrics still retain all words without spilling into
    # adjacent regions: compact blank/newline separators and fit one block.
    if len(lines) * spacing > max_height:
        lines = _wrap(' '.join(text.split()), draw, font, 1000)
    if len(lines) * spacing > max_height:
        # This is an upcoming-text preview: a visible ellipsis keeps it within
        # its own region. Full active lyrics fit at the main block's minimum.
        lines = lines[:max(1, max_height // spacing)]
        while lines[-1] and draw.textlength(lines[-1] + '…', font=font) > 1000:
            lines[-1] = lines[-1][:-1]
        lines[-1] += '…'
    total = len(lines) * spacing
    for index, line in enumerate(lines):
        draw.text((WIDTH / 2, y - total / 2 + (index + 0.5) * spacing), line,
                  font=font, fill=fill, anchor='mm')


def render_card(project: dict, active_index: int | None, output: Path, font_path: Path) -> None:
    project = validate_project(project)
    cues = project['cues']
    if active_index is not None and (type(active_index) is not int or not 0 <= active_index < len(cues)):
        raise ValidationError('Active cue index must identify a saved lyric cue.')
    image = Image.new('RGB', (WIDTH, HEIGHT), BACKGROUND)
    draw = ImageDraw.Draw(image)
    _center_text(draw, ' '.join(project['title'].split()), 80, font_path, 32, 22, 100, MAIN)
    active = cues[active_index]['text'] if active_index is not None else 'Instrumental break'
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
                timeout: float = 120, max_log_bytes: int = 262144,
                max_output_bytes: int = 128 * 1024 * 1024) -> None:
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


def _validate_backing(backing: Path, duration: float) -> None:
    try:
        with wave.open(str(backing), 'rb') as stream:
            if (stream.getnchannels(), stream.getsampwidth(), stream.getframerate(), stream.getcomptype()) != (2, 2, 44100, 'NONE'):
                raise ValidationError('Backing audio must be stereo 44.1 kHz PCM16 WAV.')
            frames = stream.getnframes()
            if abs(frames / 44100 - duration) > 1 / 44100 + 1e-9:
                raise ValidationError('Backing audio duration does not match the project.')
            # Check decoded length as well as the header before publication.
            if len(stream.readframes(frames)) != frames * 4:
                raise ValidationError('Backing audio is truncated.')
    except (wave.Error, EOFError, OSError) as exc:
        raise ValidationError('Backing audio must be a readable canonical WAV file.') from exc


def export_video(project: dict, backing: Path, output: Path, work_dir: Path,
                 font_path: Path, cancel: threading.Event) -> None:
    project = validate_project(project)
    _cancelled(cancel)
    backing, output, work_dir = Path(backing).absolute(), Path(output), Path(work_dir)
    _validate_backing(backing, project['duration'])
    work_dir.mkdir(parents=True, exist_ok=True)
    temporary_output = None
    try:
        with tempfile.TemporaryDirectory(prefix='export-', dir=work_dir) as temporary:
            directory = Path(temporary)
            states = {}
            cues = project['cues']
            for frame in range(math.ceil(project['duration'] * FPS)):
                _cancelled(cancel)
                position = frame / FPS
                active = next((index for index, cue in enumerate(cues)
                               if cue['start'] <= position < cue['end']), None)
                upcoming = next((index for index, cue in enumerate(cues) if cue['start'] > position), len(cues))
                state = (active, upcoming if active is None else None)
                if state not in states:
                    card = directory / f'card{len(states):03}.png'
                    view = project if active is not None else {**project, 'cues': cues[upcoming:]}
                    render_card(view, active, card, font_path)
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
                         '-protocol_whitelist', 'file', '-f', 'wav', '-i', str(backing),
                         '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-threads', '2',
                         '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
                         '-c:a', 'aac', '-b:a', '192k', '-t', f'{project["duration"]:.9f}',
                         '-movflags', '+faststart', '-f', 'mp4', str(temporary_output)]
            _run_ffmpeg(arguments, cancel, temporary_output)
            _cancelled(cancel)
            if not temporary_output.stat().st_size:
                raise RuntimeError('FFmpeg did not produce a video.')
            os.replace(temporary_output, output)
    finally:
        if temporary_output is not None:
            temporary_output.unlink(missing_ok=True)
