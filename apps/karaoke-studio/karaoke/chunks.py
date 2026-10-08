"""Bounded stereo float32 stitching and WAV conversion, without ML dependencies."""
from __future__ import annotations

import array
from collections.abc import Callable, Sequence
from dataclasses import dataclass
import math
from pathlib import Path
import sys
from typing import BinaryIO
import wave

from .limits import MAX_DURATION, MAX_WINDOWS, OVERLAP_FRAMES, SAMPLE_RATE, WINDOW_FRAMES

BLOCK_FRAMES = 16384
FRAME_BYTES = 8
Check = Callable[[], None] | None


def _check(check: Check) -> None:
    if check is not None:
        check()


def _frame_count(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= MAX_DURATION * SAMPLE_RATE:
        raise ValueError('Audio frame count must be a bounded positive integer.')
    return value


@dataclass(frozen=True)
class AudioWindow:
    start: int
    frames: int


def plan_windows(frame_count: int, *, window_frames: int = WINDOW_FRAMES,
                 overlap_frames: int = OVERLAP_FRAMES) -> tuple[AudioWindow, ...]:
    total = _frame_count(frame_count)
    if (isinstance(window_frames, bool) or not isinstance(window_frames, int)
            or isinstance(overlap_frames, bool) or not isinstance(overlap_frames, int)
            or not 2 <= window_frames <= WINDOW_FRAMES
            or not 1 <= overlap_frames <= OVERLAP_FRAMES
            or overlap_frames * 2 > window_frames):
        raise ValueError('Windows require bounded integer sizes with no triple overlap.')
    hop = window_frames - overlap_frames
    count = 1 + max(0, (total - window_frames + hop - 1) // hop)
    if count > MAX_WINDOWS:
        raise ValueError('Audio planning exceeds the eleven-window processing budget.')
    result = []
    start = 0
    while True:
        frames = min(window_frames, total - start)
        result.append(AudioWindow(start, frames))
        if start + frames == total:
            return tuple(result)
        start += window_frames - overlap_frames


def _values(data: bytes) -> array.array:
    values = array.array('f')
    if values.itemsize != 4:
        raise RuntimeError('This platform does not provide 32-bit float arrays.')
    values.frombytes(data)
    if sys.byteorder != 'little':
        values.byteswap()
    return values


def _bytes(values: array.array) -> bytes:
    if sys.byteorder == 'little':
        return values.tobytes()
    copied = array.array(values.typecode, values)
    copied.byteswap()
    return copied.tobytes()


def _finite(data: bytes, check: Check) -> None:
    for offset in range(0, len(data), BLOCK_FRAMES * FRAME_BYTES):
        _check(check)
        if any(not math.isfinite(value) for value in _values(data[offset:offset + BLOCK_FRAMES * FRAME_BYTES])):
            raise ValueError('Float audio must contain only finite samples.')


def _write(stream: BinaryIO, data: bytes | memoryview, check: Check) -> None:
    for offset in range(0, len(data), BLOCK_FRAMES * FRAME_BYTES):
        _check(check)
        remaining = memoryview(data)[offset:offset + BLOCK_FRAMES * FRAME_BYTES]
        while remaining:
            count = stream.write(remaining)
            if not isinstance(count, int) or count <= 0 or count > len(remaining):
                raise OSError('Float audio could not be written completely.')
            remaining = remaining[count:]


class FloatStemAssembler:
    """Callers own the two scratch streams and cleanup after any failure."""

    def __init__(self, frame_count: int, vocals: BinaryIO, backing: BinaryIO, *,
                 window_frames: int = WINDOW_FRAMES, overlap_frames: int = OVERLAP_FRAMES,
                 check: Check = None):
        _check(check)
        self.windows = plan_windows(frame_count, window_frames=window_frames, overlap_frames=overlap_frames)
        if vocals is backing or vocals.tell() != 0 or backing.tell() != 0:
            raise ValueError('Use two separate empty float output streams.')
        self.frame_count = frame_count
        self._streams = (vocals, backing)
        self._overlap = overlap_frames
        self._check = check
        self._tails = (b'', b'')
        self._next = 0
        self._written = 0
        self._finished = False

    def append(self, index: int, vocals_bytes: bytes, backing_bytes: bytes) -> None:
        _check(self._check)
        if self._finished or isinstance(index, bool) or not isinstance(index, int) or index != self._next or index >= len(self.windows):
            raise ValueError('Stem windows must arrive exactly once in planned order.')
        window = self.windows[index]
        payloads = (vocals_bytes, backing_bytes)
        if any(not isinstance(data, bytes) or len(data) != window.frames * FRAME_BYTES for data in payloads):
            raise ValueError('Both stems must match the exact stereo float32 window shape.')
        # Validate both complete predictions before writing either stream.
        for data in payloads:
            _finite(data, self._check)
        incoming = self._overlap if index else 0
        hold = self._overlap if index + 1 < len(self.windows) else 0
        for stream, previous, data in zip(self._streams, self._tails, payloads):
            if incoming:
                old = _values(previous)
                new = _values(data[:incoming * FRAME_BYTES])
                for start in range(0, incoming, BLOCK_FRAMES):
                    _check(self._check)
                    count = min(BLOCK_FRAMES, incoming - start)
                    joined = array.array('f')
                    for frame in range(start, start + count):
                        weight = (frame + 0.5) / incoming
                        for channel in (0, 1):
                            sample = frame * 2 + channel
                            joined.append(old[sample] * (1 - weight) + new[sample] * weight)
                    _write(stream, _bytes(joined), self._check)
            _write(stream, memoryview(data)[incoming * FRAME_BYTES:(window.frames - hold) * FRAME_BYTES], self._check)
        self._tails = tuple(data[-hold * FRAME_BYTES:] if hold else b'' for data in payloads)
        self._written += window.frames - hold
        self._next += 1

    def finish(self) -> int:
        _check(self._check)
        if self._finished:
            return self.frame_count
        if self._next != len(self.windows) or self._written != self.frame_count:
            raise ValueError('All planned windows are required to finish the exact audio duration.')
        for stream in self._streams:
            if stream.tell() != self.frame_count * FRAME_BYTES:
                raise ValueError('Float output does not match the expected exact size.')
            stream.flush()
        self._finished = True
        return self.frame_count


def _source(path: Path, frame_count: int) -> Path:
    count = _frame_count(frame_count)
    path = Path(path)
    try:
        valid = not path.is_symlink() and path.is_file() and path.stat().st_size == count * FRAME_BYTES
    except OSError:
        valid = False
    if not valid:
        raise ValueError('Float audio must be a complete exact-size local stereo file.')
    return path


def _blocks(path: Path, frame_count: int, check: Check):
    remaining = frame_count * FRAME_BYTES
    with path.open('rb') as stream:
        while remaining:
            _check(check)
            data = stream.read(min(remaining, BLOCK_FRAMES * FRAME_BYTES))
            if not data or len(data) % FRAME_BYTES:
                raise ValueError('Float audio contains truncated stereo frames.')
            remaining -= len(data)
            values = _values(data)
            if any(not math.isfinite(value) for value in values):
                raise ValueError('Float audio must contain only finite samples.')
            yield values
        if stream.read(1):
            raise ValueError('Float audio exceeds its declared frame count.')


def scan_float_peak(paths: Sequence[Path], frame_count: int, check: Check = None) -> float:
    _check(check)
    if not 1 <= len(paths) <= 2:
        raise ValueError('Scan one source or exactly two assembled stems.')
    sources = [_source(path, frame_count) for path in paths]
    peak = 0.0
    for path in sources:
        for values in _blocks(path, frame_count, check):
            peak = max(peak, max((abs(value) for value in values), default=0.0))
    _check(check)
    return peak


def normalization_gain(peak: float) -> float:
    if isinstance(peak, bool) or not isinstance(peak, (int, float)) or not math.isfinite(peak) or peak < 0:
        raise ValueError('Audio peak must be finite and nonnegative.')
    return 1 / peak if peak > 1 else 1.0


def write_pcm16_wav(float_path: Path, output: Path, frame_count: int, gain: float,
                    check: Check = None) -> None:
    _check(check)
    source = _source(float_path, frame_count)
    if isinstance(gain, bool) or not isinstance(gain, (int, float)) or not math.isfinite(gain) or not 0 < gain <= 1:
        raise ValueError('Audio gain must be finite, positive and at most one.')
    output = Path(output)
    temporary = output.with_suffix(output.suffix + '.part')
    if output == source or temporary.exists() or temporary.is_symlink():
        raise ValueError('Use a separate WAV destination without an existing partial file.')
    created = False
    try:
        with temporary.open('xb') as stream:
            created = True
            with wave.open(stream, 'wb') as audio:
                audio.setnchannels(2)
                audio.setsampwidth(2)
                audio.setframerate(SAMPLE_RATE)
                for values in _blocks(source, frame_count, check):
                    _check(check)
                    pcm = array.array('h', (max(-32768, min(32767, round(value * gain * 32768))) for value in values))
                    audio.writeframesraw(_bytes(pcm))
        _check(check)
        temporary.replace(output)
    finally:
        if created:
            temporary.unlink(missing_ok=True)
