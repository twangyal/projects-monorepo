# Automatic lyric transcription and synchronization — issue #214

## Intended outcome and gap

`docs/PRODUCT_DIRECTION.md` asks Karaoke Studio to transcribe and synchronize lyrics automatically after upload. Manual editing should be the correction workflow. Before this work, users supplied every word and timed every line themselves. Earlier attempts were blocked because model hosts were unreachable. GitHub release assets turned out to be reachable, and that unblocked this work.

## What changed for people

- **Upload a song and it arrives with lyrics.** After separation, the clip's vocals are recognized and grouped into timed lines, which are saved as the clip's starting lyrics. The preview, SRT and MP4 export work immediately. If recognition fails or the model is not installed, the clip is still kept and simply starts without lyrics.
- **Know where to listen.** The *Automatic lyrics* panel names the automatic lines whose recognized words had low confidence. *Review automatic lyrics* lists every recognized line with those flags. Applying them is one undoable edit, and nothing is saved until *Save lyrics*.
- **Paste the real lyrics and they are synchronized.** With recognized words available, *Create draft timings* aligns each pasted line to where it was sung. The pasted text is kept exactly. Lines whose words were not clearly heard are named, and are placed over unmatched singing between their neighbours. Without recognized words, the previous even spacing remains.
- **Transcribe lyrics / Transcribe again** recognizes an existing or restored clip as a cancellable job. It never changes saved lyrics.

## Design

- `karaoke/transcription.py` handles the parent side and imports no ML packages.
  - It pins five model files by SHA-256 and caches readiness by file identity.
  - It runs `transcribe_worker.py` through the existing bounded subprocess runner: 10-minute wall clock, 3 GiB RSS, bounded output, cancellation.
  - It strictly validates the transcript: model name, word text, ordered times inside the clip, and confidence between 0 and 1.
- `karaoke/transcribe_worker.py` runs in the subprocess. Its runtime limits and protections are:
  - network access is denied and a CPU-time limit is set;
  - input must be canonical PCM16 stereo WAV;
  - the transcript is written atomically through a `.part` file.

  Its processing:
  1. Downmixes to mono and resamples to 16 kHz with a polyphase filter (`resample_poly`), then peak-normalizes.
  2. Splits the separated vocals into phrases with Silero voice-activity detection: threshold 0.4, 0.4 s silences, phrases of at most 20 s.
  3. Recognizes each phrase with NVIDIA Parakeet TDT 0.6B v2 (int8, English) through sherpa-onnx.

  Subword tokens become words with start and end times. Each word's confidence is the geometric mean of its token probabilities.
- `karaoke/lyrics_auto.py` holds pure functions.
  - `words_to_cues` breaks lines at a pause of at least 0.6 s, or at a 0.4 s pause once a line reaches 20 characters, and always before 40 characters. It adds a 0.15 s lead-in and a 0.35 s hold, and keeps cues ordered, non-overlapping and within the project limits.
  - `align_lines` performs a global edit-distance alignment between the supplied-lyric tokens and the recognized tokens, tolerating near-miss spellings. Each line takes the time of its matched words, and stray matches and backwards anchors are discarded. Unheard lines are spread over unmatched recognized singing between their anchors, and `matched` reports each line's share of found words.
- Server routes:
  - `GET /api/projects/{id}/transcript` returns `{available, model, words, cues[confidence]}`.
  - `POST …/align` takes `{lines}` and returns `{cues[matched]}`.
  - `POST …/transcribe` starts a job of the new kind `transcribe`.
  - `/api/session` reports `lyricsModelReady`.
- Storage and setup:
  - `transcript.json` lives beside the project. Portable `.karaoke.zip` archives keep their exact format and do not include it; a restored clip can be transcribed again.
  - `scripts/setup_lyrics_model.py` downloads the pinned archive (482,468,385 bytes, SHA-256 `157c157b…e1ad`) and `silero_vad.onnx` from the sherpa-onnx GitHub releases. It verifies both, extracts only the expected files, and publishes them atomically into `MODEL_DIR/lyrics-asr`.
  - `requirements-ml.lock.txt` adds `sherpa-onnx==1.13.8`.
- Licenses: Parakeet TDT 0.6B v2 is CC-BY-4.0 (NVIDIA); sherpa-onnx is Apache-2.0; Silero VAD is MIT. No weights are committed.

## Measured quality on real songs (2026-10-13)

**Data and method.** The evaluation uses the 20 English songs of JamendoLyrics (Creative Commons; word- and line-level reference timings), 5,693 reference words. Each song goes through the production path, `separate_clip` then `transcribe_vocals`. Songs over 300 s are evaluated on their first 300 s. The command is `scripts/evaluate_lyrics.py`, and the full per-song record is in [`2026-10-13-automatic-lyrics-evaluation.json`](2026-10-13-automatic-lyrics-evaluation.json).

**Recognition**

| Measure | Result |
| --- | --- |
| Word error rate (all songs) | **41.9%** |
| Word error rate, median song | 40.1% |
| Word error rate, range | 20.6% (stripped-back pop) to 85.7% (heavily distorted rock) |
| Onset error of correctly recognized words, median | **0.06 s** |
| Correctly recognized words within 0.3 s | 95.3% |

**Automatic lines**

| Measure | Result |
| --- | --- |
| Reference line starts with an automatic line starting within 1 s | **76.4%** |
| Line-start F1 | 0.714 (0.700 when each song is held out of tuning) |

**Supplied lyrics aligned to the singing (868 lines)**

| Measure | Result |
| --- | --- |
| Median start error | **0.14 s** |
| Within 0.5 s / 1 s / 2 s | 72.7% / **78.1%** / 83.9% |
| Lines flagged as heard | 69% of lines; 94.5% within 1 s |
| Lines flagged as not clearly heard | 41.6% within 1 s; these are the lines the interface names |

**Confidence.** Recognized words below 0.7 confidence (24% of words) were right 28.8% of the time. Words at or above 0.7 were right 84.4% of the time. This is why automatic lines averaging below 0.7 are flagged.

**Speed.** Recognition takes about 0.09 s per second of audio on 4 CPU cores, roughly 27 s for a 5-minute song, on top of separation.

**Before tuning.** The first run used provisional constants. It found 59.1% of automatic line starts within 1 s, and supplied lines had a median error of 0.20 s with 75.9% within 1 s. The line-break constants were then chosen by grid search on these songs; leave-one-out scoring shows little overfitting. Placement of unheard lines was also changed. All of this is recorded in the evaluation JSON.

**Interpretation.** On most pop, hip-hop and indie songs, automatic lines start close to the singing and the words are mostly right, so correction effort is moderate. Pasting the real lyrics gives accurate timing for most lines. Heavily distorted vocals, dense backing vocals and some reggae/RnB phrasing fail more often, with word error rates of 57–86%. The flags then point at many lines that need listening.

## Verification (local, 2026-10-13)

Python 3.11, Node.js 22, Chromium 141 via `CHROMIUM_PATH`.

- `python3.11 -m unittest discover -s tests` passes **176** tests. The 10 in `tests/test_lyrics_auto.py` are new:
  - line segmentation and its bounds;
  - alignment despite misrecognitions, unheard lines and repeated choruses;
  - token-to-word confidence;
  - strict transcript validation and model readiness;
  - the HTTP flow with an injected recognizer: automatic lyrics at upload, transcript, align and its input bounds, re-transcription leaving saved lyrics unchanged, and an archive backup that excludes the transcript;
  - recognition failure keeping the clip, and a corrupt transcript being refused;
  - a missing model, and cancelling while keeping the earlier transcript.
- `npm run check` passes: 126 TypeScript tests, 3 of them new (reply validation, exact supplied text, line naming), plus ESLint and the production build. `ruff check .` passes.
- Native Chromium: **all 99 cases pass**, 2 of them new.
  - A 16-second fixture clip arrives with three saved, previewable lines, and the unsure line is named. Pasted lyrics are aligned with an unheard line called out; then Undo, review-and-apply, and *Transcribe again* are exercised.
  - A clip without recognized lyrics explains itself, keeps even spacing, and fits a 390 px screen.
- The real service with real models (`python -m karaoke`):
  - A 240-second song was uploaded over HTTP and finished in 123 s (separation plus recognition), with 64 automatic lines and 327 recognized words.
  - Aligning that song's real lyrics gave a 0.105 s median start error, with 97.6% of lines within 1 s.
  - *Transcribe again* completed and left saved lyrics unchanged.
  - Desktop and phone screenshots were inspected.
- `scripts/setup_lyrics_model.py` verified and published the models from local copies of the official files. A rerun is idempotent. A corrupt VAD file is refused, leaving nothing behind.

## Not established

- **Language and material.** Languages other than English are not supported by this model. The evaluation covers 20 songs only; subjective correction effort with real users has not been measured.
- **Line breaks.** They follow pauses in the singing, not the songwriter's lines. Merge and Split remain the correction tools.
- **Excluded content.** Archives exclude recognized words. Songs over five minutes remain unsupported.
