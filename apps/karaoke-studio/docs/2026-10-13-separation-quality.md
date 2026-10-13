# Vocal separation quality — issue #236

## Intended outcome and gap

The direction asks for an automatic song-to-karaoke workflow, so the backing track is the product. The separated vocals also feed lyric recognition. Separation used Spleeter 2-stems (2019), and its quality had never been measured against reference stems.

## Measurement

`scripts/evaluate_separation.py` separates the 50 test excerpts of MUSDB18 (7 seconds each, [Zenodo 3270814](https://zenodo.org/records/3270814)). It compares each separator with the reference vocals; the reference backing is the mixture minus the vocals. The metric is global SDR per track (10 log10 of reference energy over error energy, as in the Music Demixing challenges), in dB, higher is better. All 50 excerpts have audible vocals.

| Separator | Vocals SDR median (mean) | Backing SDR median (mean) |
| --- | --- | --- |
| Spleeter 2-stems v1.4.0 (production before #236) | 6.46 (6.39) | 11.50 (11.39) |
| UVR_MDXNET_1_9703 via sherpa-onnx | 7.51 (6.75) | 11.85 (11.95) |
| UVR-MDX-NET-Voc_FT via sherpa-onnx | 9.96 (9.00) | 14.06 (14.20) |
| **UVR-MDX-NET-Voc_FT, studio implementation (production now)** | **9.96 (9.00)** | **14.06 (14.20)** |

Compared with Spleeter, Voc_FT is better on 45 of 50 excerpts for vocals and 46 of 50 for backing. The median gains are 2.9 dB and 3.2 dB; the worst excerpt loses 3.6 dB. The studio implementation matches sherpa-onnx's per-track scores exactly. The models are the ONNX conversions published by sherpa-onnx; their SHA-256 values are in the [evaluation record](2026-10-13-separation-evaluation.json).

## Why not sherpa-onnx's own separator

sherpa-onnx (already used for lyrics) can run the model. But it sends every 5.8-second segment of its input to the model in one batch, so memory grows with input length:

- 1 s of input: 1.4 GiB
- 12 s: 3.7 GiB
- one 30-second window: 7.2 GiB

The worker's limit is 3 GiB. `karaoke/mdx.py` runs the same signal path (centred STFT with a periodic Hann window, n_fft 6144, hop 1024, the lowest 3,072 bins, 256 frames per segment, 3,072 samples of discarded context on each side) one segment at a time through ONNX Runtime. It also turns off ONNX Runtime's memory arena and memory patterns. Peak memory for a 30-second window fell from 2.75 GiB to 1.40 GiB, at a small speed cost (about 22 s against 24 s per window on 3 threads).

## Cost on a full song

The same 600-second, three-song input used in #233 was run through `separate_clip` with the new worker. Environment: 4 cores, 4 ONNX Runtime threads, and the slim ML lock in a fresh virtual environment.

| | Spleeter (#233) | MDX-Net (#236) |
| --- | --- | --- |
| Separation wall time | 245 s | 589 s |
| Worker time (inference) | 245 s | 550 s (473 s) |
| Peak worker memory | 1.27 GiB | 1.38 GiB |

The worker's wall-clock limit rose from 20 to 30 minutes, which keeps about 3× headroom. Its CPU limits now allow four threads for that whole period, because CPU time counts every thread. The real-model smoke (`scripts/smoke_model.py`, 10 s) passed with 1.3 GiB peak and no network attempts.

## Dependencies

The worker no longer imports TensorFlow or Spleeter. The ML lock is now ONNX Runtime 1.31.0, sherpa-onnx 1.13.8, NumPy 1.24.3, SciPy 1.15.3 and four small dependencies. A fresh virtual environment from it is 362 MB and passes `pip check`; the previous one needed about 2 GB. `evaluate_separation.py --separator spleeter` still reproduces the Spleeter row, provided Spleeter 2.4.2 is installed separately.

## Compatibility

- Existing Spleeter projects keep their stems.
- Their processing records are still accepted for backup and restore.
- Each model may carry only its own provenance fields. Tests cover both models and reject mixed records.
- The model cache moves from `2stems/` to `mdx/`; run `scripts/setup_model.py` once after upgrading.

## Lyric recognition with the new vocals

The lyric pipeline was re-measured with the new separator on the same 20 JamendoLyrics songs as #214 (5,693 reference words, the first 300 s of each song). Recognition and alignment code are unchanged, so the difference comes from the vocals:

| | Spleeter vocals (#214) | MDX-Net vocals (#236) |
| --- | --- | --- |
| Word error rate, all songs | 41.9% | **30.9%** |
| Word error rate, median song | 40.1% | **28.5%** |
| Correct words starting within 0.3 s | 95.3% | **96.8%** |
| Reference lines with an automatic line start within 1 s | 76.4% | **78.5%** |
| Pasted lyrics: median line-start error | 0.143 s | **0.098 s** |
| Pasted lyrics: lines within 0.5 s / 1 s / 2 s | 72.7% / 78.1% / 83.9% | **81.5% / 86.9% / 90.0%** |

18 of 20 songs have lower WER. The largest gains are on Rxbyn "Bad Side" (−31 points), Slingshot Miracle "Whistler" (−26) and Explosive Ear Candy "Like The Sun" (−24). One song is worse by more than 2 points: Tom Orlando "The One" (37.1% → 40.6%). Word confidence remains a useful flag: words recognized with confidence below 0.7 were correct 30% of the time, against 87% at or above it. Per-song results are in [`2026-10-13-lyrics-with-mdx-evaluation.json`](2026-10-13-lyrics-with-mdx-evaluation.json).

## Verification (2026-10-13)

- The lyrics evaluation above ran entirely in a fresh virtual environment built from the slim lock.
- `python3.11 -m unittest discover -s tests`: **188** pass. New cases:
  - segmenting and spectrogram tests for `mdx.py` with stand-in models: exact STFT inversion, seam-free identity across segment joins, channel layout, boundary lengths, invalid output;
  - model-cache and setup verification;
  - archive admission of both models' processing records.
- `ruff check .` and `compileall` are clean.
- Chromium: the archive and workflow specs pass (23 cases).
