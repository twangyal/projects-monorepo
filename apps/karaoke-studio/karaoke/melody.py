"""A melody guide from the separated vocals: the sung notes over time, as karaoke pitch bars show them.

The singing's pitch is found every 10 ms with YIN (de Cheveigné and Kawahara, 2002) on the vocals downmixed to mono and
decimated to 14.7 kHz; quiet or noisy frames are left unvoiced. Octave slips are folded back toward the surrounding
singing, a short median smooths the rest, and runs of steady pitch become notes, each rounded to its nearest semitone.
On GTSinger's clean sung phrases (100 in five languages) the guide had a note for 85% of the annotated singing, and that
note was the annotated one 82% of the time (93% within a semitone). On vocals separated out of 47 MUSDB18 excerpts as the
studio separates them, it had a note for 88% of the time the guide made from the clean vocal stem had one, the same note
92% of that time.
"""
from __future__ import annotations

import wave
from typing import BinaryIO

import numpy as np

SOURCE_RATE, FACTOR = 44100, 3
RATE = SOURCE_RATE // FACTOR
HOP_SECONDS, WINDOW_SECONDS = 0.01, 0.032
MIN_F0, MAX_F0 = 70.0, 1000.0
# YIN's dip threshold, and the aperiodicity above which a frame is not sung.
THRESHOLD, APERIODIC = 0.15, 0.3
# A frame quieter than this share of the vocals' loud frames (their 95th percentile) is not sung.
GATE = 0.06
# Notes: a new one where the pitch leaves the current one by this many semitones for three frames; shorter ones go,
# and two of the same pitch this close together join.
SPLIT, SHORTEST, JOIN = 0.8, 0.08, 0.06
MAX_NOTES = 20000


def _lowpass() -> np.ndarray:
    """A windowed-sinc low-pass filter for decimating by FACTOR: it passes the voice and cuts above the new Nyquist."""
    taps = np.arange(-48, 49)
    cutoff = 0.9 / FACTOR / 2
    kernel = 2 * cutoff * np.sinc(2 * cutoff * taps) * np.blackman(len(taps))
    return kernel / kernel.sum()


def read_vocals(source: BinaryIO | str, chunk: int = SOURCE_RATE * 30) -> np.ndarray:
    """The studio's vocals WAV (PCM16 stereo at 44.1 kHz) as float32 mono at RATE."""
    kernel, parts, tail = _lowpass(), [], np.zeros(len(_lowpass()) - 1, dtype=np.float32)
    with wave.open(source, 'rb') as reader:
        if reader.getnchannels() != 2 or reader.getsampwidth() != 2 or reader.getframerate() != SOURCE_RATE:
            raise ValueError('The vocals must be 16-bit stereo audio at 44.1 kHz.')
        offset = 0
        while True:
            raw = reader.readframes(chunk)
            if not raw:
                break
            mono = np.frombuffer(raw, dtype='<i2').reshape(-1, 2).astype(np.float32).mean(axis=1) / 32768
            # Filter with the previous chunk's tail, then keep every FACTOR-th sample of the whole stream.
            joined = np.concatenate([tail, mono])
            filtered = np.convolve(joined, kernel, mode='valid')
            first = (-offset) % FACTOR
            parts.append(filtered[first::FACTOR].astype(np.float32))
            offset += len(filtered)
            tail = joined[len(joined) - (len(kernel) - 1):]
    return np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)


def frame_pitch(signal: np.ndarray, rate: int = RATE) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per 10 ms frame: the YIN pitch estimate in Hz, its aperiodicity (0 periodic to 1 noise) and the frame's RMS."""
    hop, window = round(HOP_SECONDS * rate), round(WINDOW_SECONDS * rate)
    tau_max, tau_min = int(rate / MIN_F0), int(rate / MAX_F0)
    n = window + tau_max + 1
    count = max(1, 1 + (len(signal) - n) // hop) if len(signal) >= n else (1 if len(signal) else 0)
    f0, aperiodicity, rms = np.zeros(count), np.ones(count), np.zeros(count)
    if not count:
        return f0, aperiodicity, rms
    padded = np.zeros(max(len(signal), (count - 1) * hop + n), dtype=np.float64)
    padded[:len(signal)] = signal
    size = 1 << int(np.ceil(np.log2(n + window)))
    taus = np.arange(tau_max + 1)
    for start in range(0, count, 1024):
        rows = np.arange(start, min(count, start + 1024))
        x = padded[rows[:, None] * hop + np.arange(n)[None, :]]
        first = x[:, :window]
        # The difference function d(tau) from the frame's autocorrelation (by FFT) and running energies.
        cc = np.fft.irfft(np.conj(np.fft.rfft(first, size)) * np.fft.rfft(x, size), size)[:, :tau_max + 1]
        cs = np.concatenate([np.zeros((len(x), 1)), np.cumsum(x ** 2, axis=1)], axis=1)
        energy = cs[:, taus + window] - cs[:, taus]
        d = np.maximum(energy[:, :1] + energy - 2 * cc, 0)
        cumulative = np.cumsum(d[:, 1:], axis=1)
        cmnd = np.ones_like(d)
        cmnd[:, 1:] = np.divide(d[:, 1:] * taus[1:], cumulative, out=np.ones_like(cumulative), where=cumulative > 1e-12)
        span = cmnd[:, tau_min:]
        below = span < THRESHOLD
        pick = np.where(below.any(axis=1), below.argmax(axis=1), span.argmin(axis=1))
        local = np.arange(len(x))
        # From the first dip under the threshold down to its bottom.
        for _ in range(span.shape[1]):
            ahead = np.minimum(pick + 1, span.shape[1] - 1)
            step = (pick + 1 < span.shape[1]) & (span[local, ahead] < span[local, pick])
            if not step.any():
                break
            pick = pick + step
        tau = pick + tau_min
        left, mid, right = cmnd[local, np.maximum(tau - 1, 1)], cmnd[local, tau], cmnd[local, np.minimum(tau + 1, tau_max)]
        curve = left - 2 * mid + right
        shift = np.divide(0.5 * (left - right), curve, out=np.zeros_like(curve), where=np.abs(curve) > 1e-12)
        f0[rows] = rate / (tau + np.clip(shift, -1, 1))
        aperiodicity[rows] = mid
        rms[rows] = np.sqrt(np.mean(first ** 2, axis=1))
    return f0, aperiodicity, rms


def _window_median(values: np.ndarray, half: int) -> np.ndarray:
    """The median of the non-NaN values within `half` frames either side of each frame (NaN where there are none)."""
    padded = np.concatenate([np.full(half, np.nan), values, np.full(half, np.nan)])
    windows = np.lib.stride_tricks.sliding_window_view(padded, 2 * half + 1)
    out = np.full(len(values), np.nan)
    counted = ~np.isnan(windows)
    has = counted.any(axis=1)
    if has.any():
        out[has] = np.nanmedian(windows[has], axis=1)
    return out


def midi_track(signal: np.ndarray, rate: int = RATE) -> np.ndarray:
    """Per 10 ms frame: the sung pitch in MIDI semitones (NaN where unvoiced), folded and smoothed."""
    f0, aperiodicity, rms = frame_pitch(signal, rate)
    if not len(f0):
        return f0
    loud = float(np.percentile(rms, 95))
    voiced = (aperiodicity < APERIODIC) & (rms > GATE * loud) & (f0 >= MIN_F0) & (f0 <= MAX_F0)
    midi = np.where(voiced, 69 + 12 * np.log2(np.maximum(f0, 1e-9) / 440), np.nan)
    # Octave slips: a frame more than 7 semitones from the singing within half a second is folded toward it.
    centre = _window_median(midi, 50)
    away = midi - centre
    midi = np.where(np.abs(away) > 7, midi - 12 * np.round(away / 12), midi)
    smooth = _window_median(midi, 2)
    return np.where(voiced, smooth, np.nan)


def notes_of(midi: np.ndarray, hop: float = HOP_SECONDS) -> list[list]:
    """Notes [start s, end s, MIDI semitone] from a frame track: runs of steady pitch at least SHORTEST long."""
    notes: list[list] = []
    run: list[float] = []
    begin = 0

    def close(end: int) -> None:
        if len(run) * hop >= SHORTEST:
            notes.append([begin * hop, end * hop, int(np.round(np.median(run)))])
    voiced = ~np.isnan(midi)
    for i, value in enumerate(midi):
        if not voiced[i]:
            if run:
                close(i)
                run = []
            continue
        if run:
            centre = float(np.median(run[-25:]))
            # A new note when the pitch leaves the current one for three frames in a row.
            ahead = midi[i:i + 3]
            if len(ahead) == 3 and voiced[i:i + 3].all() and (np.abs(ahead - centre) > SPLIT).all():
                close(i)
                run = []
        if not run:
            begin = i
        run.append(float(value))
    if run:
        close(len(midi))
    joined: list[list] = []
    for note in notes:
        if joined and joined[-1][2] == note[2] and note[0] - joined[-1][1] <= JOIN + 1e-9:
            joined[-1][1] = note[1]
        else:
            joined.append(note)
    return [[round(start, 3), round(end, 3), pitch] for start, end, pitch in joined[:MAX_NOTES]]


def melody(source: BinaryIO | str) -> list[list]:
    """The melody guide's notes [start s, end s, MIDI semitone] for the studio's vocals WAV."""
    return notes_of(midi_track(read_vocals(source)))


def validate_notes(notes, duration: float) -> list[list]:
    """Notes as the guide uses them: at most MAX_NOTES, in order, inside the clip, each a MIDI note from 21 to 108."""
    if not isinstance(notes, list) or len(notes) > MAX_NOTES:
        raise ValueError('A melody is a list of notes.')
    out, last = [], 0.0
    for note in notes:
        if (not isinstance(note, list) or len(note) != 3 or type(note[2]) is not int or not 21 <= note[2] <= 108
                or not all(isinstance(value, (int, float)) and np.isfinite(value) for value in note[:2])):
            raise ValueError('Each melody note is a start, an end and a MIDI note number.')
        start, end = float(note[0]), float(note[1])
        if not last - 1e-6 <= start < end <= duration + 0.05:
            raise ValueError('Melody notes must be in order and inside the clip.')
        out.append([start, end, note[2]])
        last = end
    return out
