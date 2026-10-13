"""MDX-Net vocal separation (UVR-MDX-NET-Voc_FT ONNX) with bounded memory.

The model maps a stereo spectrogram segment (real and imaginary parts of both channels, the
lowest ``DIM_F`` bins, ``DIM_T`` frames) to the vocals' spectrogram. A window is cut into
segments that each carry ``N_FFT / 2`` samples of context on both sides; only the centre of each
segment is kept, so consecutive segments join without seams. The backing is the input minus the
vocals. Segments run one at a time, so memory stays near one segment's activations whatever the
window length. The STFT conventions follow sherpa-onnx's UVR implementation (centred, reflect
padded, periodic Hann window).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

SAMPLE_RATE = 44100
N_FFT = 6144
HOP = 1024
DIM_F = 3072
DIM_T = 256
TRIM = N_FFT // 2
SEGMENT = HOP * (DIM_T - 1)  # samples per model call, including context
STEP = SEGMENT - 2 * TRIM  # samples each call contributes
_WINDOW = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N_FFT) / N_FFT)).astype(np.float64)


def stft(signal: np.ndarray) -> np.ndarray:
    """Centred STFT of a 1-D signal: (frames, N_FFT // 2 + 1) complex."""
    padded = np.pad(signal, TRIM, mode='reflect')
    frames = 1 + (len(padded) - N_FFT) // HOP
    index = np.arange(N_FFT)[None, :] + HOP * np.arange(frames)[:, None]
    return np.fft.rfft(padded[index] * _WINDOW, axis=1)


def istft(spectrum: np.ndarray, length: int) -> np.ndarray:
    """Inverse of :func:`stft` (windowed overlap-add normalised by the squared window)."""
    frames = spectrum.shape[0]
    pieces = np.fft.irfft(spectrum, n=N_FFT, axis=1) * _WINDOW
    total = N_FFT + HOP * (frames - 1)
    output = np.zeros(total)
    weight = np.zeros(total)
    for index in range(frames):
        start = index * HOP
        output[start:start + N_FFT] += pieces[index]
        weight[start:start + N_FFT] += _WINDOW ** 2
    output /= np.where(weight > 1e-10, weight, 1.0)
    return output[TRIM:TRIM + length]


def segment_starts(frames: int) -> list[int]:
    """Start offsets (into the context-padded signal) of the segments covering ``frames`` samples."""
    return list(range(0, frames, STEP))


def separate_vocals(stereo: np.ndarray, run) -> tuple[np.ndarray, np.ndarray]:
    """Split ``stereo`` (frames, 2) float audio into (vocals, backing), each (frames, 2) float32.

    ``run`` maps a float32 array (1, 4, DIM_F, DIM_T) to the model output of the same shape.
    """
    if stereo.ndim != 2 or stereo.shape[1] != 2 or not len(stereo):
        raise ValueError('MDX separation needs non-empty stereo audio.')
    frames = len(stereo)
    starts = segment_starts(frames)
    padded = np.zeros((TRIM + len(starts) * STEP + TRIM, 2))
    padded[TRIM:TRIM + frames] = stereo
    vocals = np.empty((len(starts) * STEP, 2), dtype=np.float32)
    for number, start in enumerate(starts):
        spectra = [stft(padded[start:start + SEGMENT, channel]) for channel in range(2)]
        features = np.empty((1, 4, DIM_F, DIM_T), dtype=np.float32)
        for channel, spectrum in enumerate(spectra):
            features[0, 2 * channel] = spectrum[:, :DIM_F].real.T
            features[0, 2 * channel + 1] = spectrum[:, :DIM_F].imag.T
        estimate = np.asarray(run(features))
        if estimate.shape != features.shape or not np.isfinite(estimate).all():
            raise RuntimeError('The vocal model returned an invalid spectrogram.')
        for channel in range(2):
            spectrum = np.zeros((DIM_T, N_FFT // 2 + 1), dtype=np.complex128)
            spectrum[:, :DIM_F] = estimate[0, 2 * channel].T + 1j * estimate[0, 2 * channel + 1].T
            vocals[number * STEP:(number + 1) * STEP, channel] = istft(spectrum, SEGMENT)[TRIM:TRIM + STEP]
    vocals = vocals[:frames]
    backing = (stereo - vocals).astype(np.float32)
    return vocals, backing


def load_model(path: Path, threads: int):
    """An ONNX Runtime session for the model file at ``path``, returned as a ``run`` callable."""
    import onnxruntime
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    options.log_severity_level = 3
    # Without the arena and planned memory patterns, peak memory for a 30 s window drops from
    # about 2.8 GiB to 1.4 GiB at a small speed cost (measured 2026-10-13).
    options.enable_cpu_mem_arena = False
    options.enable_mem_pattern = False
    session = onnxruntime.InferenceSession(str(path), options,
                                           providers=['CPUExecutionProvider'])
    name = session.get_inputs()[0].name

    def run(features: np.ndarray) -> np.ndarray:
        return session.run(None, {name: features})[0]
    return run
