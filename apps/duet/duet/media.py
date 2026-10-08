"""Bounded local audio normalization. No network, shell, or AI dependencies.

Returned durations count decoded 48 kHz stereo frames, excluding Opus pre-skip
and final padding. Inputs are decoded in full: duration limits never trim audio.
"""
from __future__ import annotations

from collections.abc import Callable
import json
import math
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time

MAX_INPUT_BYTES = 25 * 1024 * 1024
MAX_OUTPUT_BYTES = 8 * 1024 * 1024
SAMPLE_RATE = 48000
MAX_PCM_BYTES = 300 * SAMPLE_RATE * 4
TIME_LIMIT = 45.0
RSS_LIMIT_KIB = 512 * 1024
LOG_LIMIT = 64 * 1024
FORMATS = 'wav,mp3,flac,ogg'


class _SubprocessError(RuntimeError):
    """Bounded diagnostics for trusted tests; public string/repr stay generic."""

    def __init__(self, returncode: int, stderr: bytes):
        super().__init__('The audio could not be decoded or encoded. Check the file and FFmpeg installation.')
        self.returncode = returncode
        self.stderr = stderr[:LOG_LIMIT]


def _check_cancel(cancel: threading.Event) -> None:
    if cancel.is_set():
        raise RuntimeError('Audio processing cancelled.')


def _terminate(process: subprocess.Popen) -> None:
    """Kill the whole session even if its leader has already exited, then reap."""
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=5)


def _rss_kib(pid: int) -> int:
    """Account for descendants as well as the command itself on Linux."""
    pending, seen, total = [pid], set(), 0
    while pending:
        current = pending.pop()
        if current in seen:
            continue
        seen.add(current)
        try:
            for line in Path(f'/proc/{current}/status').read_text().splitlines():
                if line.startswith('VmRSS:'):
                    total += int(line.split()[1])
            pending.extend(int(child) for child in Path(f'/proc/{current}/task/{current}/children').read_text().split())
        except (OSError, ValueError):
            continue
    return total


def _run(command: list[str], cancel: threading.Event, *, timeout: float = TIME_LIMIT,
         stdout_limit: int = LOG_LIMIT, stderr_limit: int = LOG_LIMIT,
         rss_limit_kib: int = RSS_LIMIT_KIB, output: Path | None = None,
         file_limit: int = MAX_OUTPUT_BYTES, count_stdout: bool = False,
         deadline: float | None = None) -> tuple[bytes | int, bytes]:
    """Drain bounded pipes concurrently; count PCM without retaining it in RAM."""
    _check_cancel(cancel)
    started = time.monotonic()
    end = min(started + timeout, deadline if deadline is not None else math.inf)
    if started >= end:
        raise RuntimeError('Audio processing timed out.')
    # A tiny isolated bootstrap sets hard bounds then execs the fixed command.
    # preexec_fn is unsafe in the multithreaded HTTP service and is never used.
    bootstrap = ('import os,resource,sys; '
                 'resource.setrlimit(resource.RLIMIT_AS,(536870912,536870912)); '
                 'resource.setrlimit(resource.RLIMIT_FSIZE,(8388608,8388608)); '
                 'resource.setrlimit(resource.RLIMIT_CORE,(0,0)); '
                 'os.execvp(sys.argv[1],sys.argv[1:])')
    bounded = [sys.executable, '-I', '-c', bootstrap, *command]
    # Codec flags do not govern linked math libraries or glibc's per-thread
    # arenas. Bound both before exec without changing the service environment.
    child_environment = os.environ.copy()
    child_environment.update({key: '1' for key in (
        'OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'OMP_THREAD_LIMIT',
        'MKL_NUM_THREADS', 'BLIS_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS',
        'NUMEXPR_NUM_THREADS', 'GOTO_NUM_THREADS',
    )})
    child_environment['MALLOC_ARENA_MAX'] = '2'
    try:
        process = subprocess.Popen(bounded, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, start_new_session=True, close_fds=True,
                                   env=child_environment)
    except FileNotFoundError as error:
        raise RuntimeError('FFmpeg and ffprobe must be installed for audio uploads.') from error
    buffers, counts = [bytearray(), bytearray()], [0, 0]
    overflow = threading.Event()

    def collect(stream, index: int, limit: int) -> None:
        try:
            while chunk := stream.read(8192):
                counts[index] += len(chunk)
                if counts[index] > limit:
                    overflow.set()
                    return
                if index != 0 or not count_stdout:
                    buffers[index].extend(chunk)
        finally:
            stream.close()

    readers = [threading.Thread(target=collect, args=(process.stdout, 0, stdout_limit), daemon=True),
               threading.Thread(target=collect, args=(process.stderr, 1, stderr_limit), daemon=True)]
    for reader in readers:
        reader.start()

    def check() -> None:
        _check_cancel(cancel)
        if overflow.is_set():
            raise RuntimeError('Audio subprocess exceeded its output limit.')
        if time.monotonic() >= end:
            raise RuntimeError('Audio processing timed out.')
        if _rss_kib(process.pid) > rss_limit_kib:
            raise RuntimeError('Audio subprocess exceeded its memory limit.')
        if output is not None and output.exists() and output.stat().st_size > file_limit:
            raise RuntimeError('Audio output file exceeded its size limit.')

    try:
        while process.poll() is None:
            check()
            cancel.wait(0.02)
        # A forked descendant could retain pipes after the leader finishes.
        for reader in readers:
            reader.join(timeout=0.1)
        if any(reader.is_alive() for reader in readers):
            _terminate(process)
            for reader in readers:
                reader.join(timeout=1)
            raise RuntimeError('Audio subprocess left unfinished child processes.')
        check()
        if process.returncode != 0:
            raise _SubprocessError(process.returncode, bytes(buffers[1]))
        return counts[0] if count_stdout else bytes(buffers[0]), bytes(buffers[1])
    finally:
        _terminate(process)
        for reader in readers:
            reader.join(timeout=1)


def _input_format(source: Path) -> str:
    try:
        info = source.lstat()
    except OSError as error:
        raise ValueError('Choose a local WAV, MP3, FLAC, or Ogg audio file.') from error
    if not stat.S_ISREG(info.st_mode):
        raise ValueError('Choose a regular local audio file; symlinks are unsupported.')
    if not 0 < info.st_size <= MAX_INPUT_BYTES:
        raise ValueError('Choose a nonempty audio file of at most 25 MiB.')
    with source.open('rb') as stream:
        header = stream.read(12)
    if header[:4] == b'RIFF' and header[8:12] == b'WAVE':
        return 'wav'
    if header.startswith(b'ID3') or (len(header) >= 2 and header[0] == 255 and header[1] & 0xe0 == 0xe0
                                   and (header[1] >> 1) & 3 == 1 and (header[1] >> 3) & 3 != 1):
        return 'mp3'
    if header.startswith(b'fLaC'):
        return 'flac'
    if header.startswith(b'OggS'):
        return 'ogg'
    raise ValueError('Choose actual WAV, MP3, FLAC, or Ogg audio; URLs, video, and playlists are unsupported.')


def _probe(source: Path, input_format: str, cancel: threading.Event, deadline: float,
           *, canonical: bool = False) -> float:
    encoded, _ = _run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file',
                       '-format_whitelist', FORMATS, '-f', input_format,
                       '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name,sample_rate,channels,duration',
                       '-of', 'json', str(source)], cancel, deadline=deadline)
    try:
        probe = json.loads(encoded)
        streams = probe['streams']
        if probe['format']['format_name'] != input_format:
            raise ValueError('Audio container does not match its signature.')
        if len(streams) != 1 or streams[0].get('codec_type') != 'audio':
            raise ValueError('Choose audio-only media with one audio stream; video is unsupported.')
        audio = streams[0]
        rate, channels = int(audio['sample_rate']), int(audio['channels'])
        if not 8000 <= rate <= 192000 or not 1 <= channels <= 8:
            raise ValueError('Audio must use 8–192 kHz sampling and one to eight channels.')
        duration = float(audio.get('duration', probe['format'].get('duration', 'nan')))
        if canonical and (audio.get('codec_name') != 'opus' or rate != SAMPLE_RATE or channels != 2):
            raise ValueError('Normalized audio must be stereo 48 kHz Opus in Ogg.')
    except (KeyError, TypeError, json.JSONDecodeError, OverflowError) as error:
        raise ValueError('Audio format or duration could not be validated.') from error
    # Compressed containers can include delay/padding. The full PCM count below
    # is authoritative; this allowance does not permit or truncate long audio.
    maximum = 300.5 if input_format in {'mp3', 'ogg'} else 300
    if not math.isfinite(duration) or duration < 0.5 or duration > maximum:
        raise ValueError('Audio must last 1–300 seconds. Longer audio is never silently trimmed.')
    return duration


def _decode_args(source: Path, input_format: str) -> list[str]:
    return ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror',
            '-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1',
            '-protocol_whitelist', 'file', '-format_whitelist', FORMATS,
            '-err_detect', 'explode', '-f', input_format, '-i', str(source)]


def _pcm_args() -> list[str]:
    return ['-map', '0:a:0', '-vn', '-sn', '-dn', '-ar', str(SAMPLE_RATE), '-ac', '2',
            '-threads', '1', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1']


def _duration(byte_count: int) -> float:
    if byte_count % 4 or not SAMPLE_RATE * 4 <= byte_count <= MAX_PCM_BYTES:
        raise ValueError('Decoded audio must last 1–300 seconds; longer audio is never silently trimmed.')
    return byte_count / (SAMPLE_RATE * 4)


def normalize_audio(source: Path, output: Path, cancel: threading.Event,
                    stage: Callable[[str], None]) -> float:
    """Atomically replace output only after full input and output validation."""
    _check_cancel(cancel)
    source, output = Path(source).absolute(), Path(output).absolute()
    input_format = _input_format(source)
    if source.resolve() == output.resolve() or output.is_symlink() or (output.exists() and not output.is_file()):
        raise ValueError('Audio output must be a separate regular file; input is preserved.')
    # Keep descriptor-backed /proc paths intact for every read. Resolving
    # their symlink parents would discard the caller's verified inode anchor.
    deadline = time.monotonic() + TIME_LIMIT
    stage('Checking audio format and duration')
    _probe(source, input_format, cancel, deadline)
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix='.duet-audio-', suffix='.ogg.part', dir=output.parent)
    os.close(descriptor)
    temporary = Path(name)
    try:
        stage('Normalizing complete audio to stereo Opus')
        command = _decode_args(source, input_format) + [
            '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1', '-ar', str(SAMPLE_RATE), '-ac', '2',
            '-threads', '1', '-c:a', 'libopus', '-b:a', '128k', '-vbr', 'off', '-application', 'audio',
            '-frame_duration', '20', '-f', 'ogg', '-y', str(temporary)] + _pcm_args()
        try:
            count, _ = _run(command, cancel, stdout_limit=MAX_PCM_BYTES, count_stdout=True,
                            output=temporary, deadline=deadline)
        except RuntimeError as error:
            if 'output limit' in str(error):
                raise ValueError('Decoded audio must last 1–300 seconds; longer audio is never silently trimmed.') from error
            raise
        source_duration = _duration(count)
        stage('Checking normalized audio and exact duration')
        _check_cancel(cancel)
        if temporary.stat().st_size == 0 or temporary.stat().st_size > MAX_OUTPUT_BYTES:
            raise RuntimeError('Normalized audio must contain at most 8 MiB.')
        _probe(temporary, 'ogg', cancel, deadline, canonical=True)
        count, _ = _run(_decode_args(temporary, 'ogg') + _pcm_args(), cancel,
                        stdout_limit=MAX_PCM_BYTES, count_stdout=True, deadline=deadline)
        duration = _duration(count)
        if abs(duration - source_duration) > 1 / SAMPLE_RATE:
            raise RuntimeError('Normalized audio did not preserve the complete input duration.')
        _check_cancel(cancel)
        with temporary.open('rb') as complete:
            os.fsync(complete.fileno())
        temporary.replace(output)
        return duration
    finally:
        temporary.unlink(missing_ok=True)
