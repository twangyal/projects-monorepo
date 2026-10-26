# Karaoke Studio

A local song-to-karaoke maker. Upload a song and it separates vocals from backing, transcribes and times the sung lyrics from the separated vocals, and gives you a word-by-word preview ready to export as a karaoke video. You then correct the words and timing the recognizer got wrong. It is for anyone making karaoke tracks from their own audio. Everything runs on a local Python service with local models.

**Status:** ACTIVE — portfolio priority. Direction: [docs/PRODUCT_DIRECTION.md](../../docs/PRODUCT_DIRECTION.md)

## What works today

- **Upload** a WAV, MP3, FLAC or Ogg song of 1–600 seconds, up to 128 MiB. It is decoded to 44.1 kHz stereo.
- **Vocal separation** with the UVR-MDX-NET-Voc_FT model (ONNX Runtime, CPU). Audition Original, Vocals or Backing, and download the backing WAV. Jobs can be cancelled. Cancelling automatic recognition keeps the finished stems as a saved clip, ready to listen to or transcribe again. Cancelling before all stems are staged discards that unfinished upload.
- **Automatic lyrics**: Silero VAD plus NVIDIA Parakeet TDT 0.6B (via sherpa-onnx) recognize the separated vocals. English uses Parakeet v2. Other European languages use v3, chosen by checking whether the first words look English. The result is saved as timed lyric lines, so preview and export work straight away. Lines with low confidence (average below 0.7) are flagged.
- **Review automatic lyrics** before applying them. Listen to or repeat each line, show only uncertain lines, correct words and start/end times, and exclude false lines. **Transcribe again** forces the English or multilingual model.
- **Paste real lyrics** and use **Create draft timings** to align each line to where it was sung. Long lyrics with recognition differences keep their matched timing; lines that were not clearly heard are named. If alignment cannot finish within its work limit, it reports a retry message and preserves your lyrics. You can also import an existing SRT after reviewing it.
- **Timing correction**: an original-audio waveform with draggable cue handles and keyboard nudges, mark start/end at the playhead, and play a single line. **Time lines while listening** taps out line timings during playback. You can also shift all lines or a passage, fit a passage to a time window, and copy a passage such as a chorus to a new time.
- **Text correction**: split at caret and playhead, merge with the next line, add a missed line, remove a passage, find a line, and replace words throughout the lyrics. Up to 30 unsaved edits can be undone or redone.
- **Practice**: play or repeat a range of lines on any track, at 0.5×, 0.75× or 1× speed.
- **Word-by-word highlighting** in the preview and in the exported video. Word times come from recognition, with words that were not heard estimated by length. If timing fails, the preview explains why and highlights whole lines until you edit the lyrics or transcribe again.
- **Export** a 1280×720, 24 fps H.264/AAC MP4 with the backing track and lyric cards, plus SRT subtitles.
- **Local library** of up to 20 saved clips that survives restarts. **Back up saved clip** writes a portable `.karaoke.zip` (audio, stems, lyrics); **Import project archive** restores one into any library.

## Known gaps

- Transcription and alignment quality on real songs has not been evaluated with users, and the effort needed to correct them has not been measured. A developer benchmark (`scripts/evaluate_lyrics.py` on JamendoLyrics) found roughly 31% word error on English songs, with large variation between songs. Recognition is a starting point, not a finished transcript.
- Multilingual lyrics are unfinished. Only 25 European languages are covered, mixed-language songs are not handled, and the bundled font lacks many scripts (for example Tibetan), which show as missing-glyph boxes in videos.
- Separated stems are estimates. Leftover singing or lost instruments can remain, and anything the model misses as vocals stays in the backing.
- Separation is slow on CPU: a ten-minute song takes roughly as long as the song itself on 4 cores. No GPU path.
- Limits: 200 cues, 240 characters per cue, 20,000 lyric characters, 20 clips. Linux only (it needs procfs and POSIX process controls). Recognized word data (`transcript.json`) is not included in archives; transcribe a restored clip again.

## Run locally

Prerequisites: Linux with procfs, Python 3.11 (`requires-python >=3.11,<3.12`), Node.js 22.18+ (CI uses 24), and FFmpeg/ffprobe on `PATH` with libx264 and AAC encoders (for example `sudo apt-get install ffmpeg`).

```sh
cd apps/karaoke-studio
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-core.txt        # Pillow
python -m pip install -r requirements-ml.lock.txt     # ONNX Runtime, sherpa-onnx, NumPy, SciPy (~360 MB)
npm ci
npm run build
```

**Models.** The models are not in the repository and the service never downloads them at startup. Install them into a cache outside Git:

```sh
python scripts/setup_model.py        --model-dir "$HOME/.cache/karaoke-studio/models"
python scripts/setup_lyrics_model.py --model-dir "$HOME/.cache/karaoke-studio/models"
```

- `setup_model.py` downloads `UVR-MDX-NET-Voc_FT.onnx` (66,762,795 bytes) from the sherpa-onnx `source-separation-models` release into `MODELS/mdx`. It checks the pinned SHA-256 `e411182ce2c53541fefdcc99a8f46f2fe03978eb22038b9497c1d9d95a00fad4`. Use `--model PATH` to reuse an existing copy.
- `setup_lyrics_model.py` downloads two archives (about 483 MB each) from the sherpa-onnx `asr-models` release, plus `silero_vad.onnx`. Parakeet v2 (English) goes into `MODELS/lyrics-asr`, and v3 (multilingual) into `MODELS/lyrics-asr-v3`. Every archive and extracted file is checked against a pinned SHA-256 before it is published. `--only english|multilingual` installs one model, and `--archive PATH` / `--vad PATH` reuse files you already have.
- Without separation weights, new uploads are refused with setup guidance. Without lyric models, clips start with no lyrics.

**Start the service** with the same Python environment:

```sh
python -m karaoke --model-dir "$HOME/.cache/karaoke-studio/models" \
  --data-dir "$HOME/.local/share/karaoke-studio" --port 8765
```

Open http://127.0.0.1:8765. The service serves the built `dist/` and its API from the same origin. For UI work, `npm run dev` rebuilds `dist/` on change (`vite build --watch`); refresh the page after each rebuild. The service runs one separation, transcription or export job at a time, and only one service can use a data directory.

## Verify

Fast checks do not need ONNX Runtime or model weights:

```sh
python -m pip install -r requirements-core.txt -r requirements-dev.txt   # Pillow, Ruff, NumPy
python -m unittest discover -s tests -v
python -m compileall -q karaoke scripts tests
ruff check .
npm test               # Node unit tests (tests/*.test.ts)
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run build
npx playwright install chromium
npm run test:browser   # production build + test service (port 4188) with a fake separator, real FFmpeg export
```

Use `CHROMIUM_PATH=/path/to/chromium` to run against an existing browser. `KARAOKE_ARCHIVE_NO_MODEL=1 npm run test:browser -- tests/archive.spec.ts` runs the archive cases with no model available. CI: `.github/workflows/karaoke-studio.yml`, which does not install ML dependencies or models.

With models installed, `python scripts/smoke_model.py --model-dir MODELS --work-dir /tmp/karaoke-smoke --seconds 10` runs real offline separation on synthetic audio. `python scripts/smoke_archive.py --work-dir DIR --report FILE` checks archive transfer between two services. `scripts/evaluate_lyrics.py` and `scripts/evaluate_separation.py` are the quality benchmarks. A passing fake-separator browser suite does not show real separation quality, so also try a real song end to end: upload, correct, save, reopen and export.

## Project layout

- `karaoke/server.py`: loopback HTTP service, project library, job queue and archive import.
- `karaoke/pipeline.py`, `mdx.py`, `chunks.py`, `worker.py`: decoding, windowed MDX-Net separation and the sandboxed worker.
- `karaoke/transcription.py`, `transcribe_worker.py`, `lyrics_auto.py`: model registry, recognition worker, and grouping recognized words into lines.
- `karaoke/video.py`, `archive.py`, `model.py`, `limits.py`, `jobs.py`, `media_io.py`: video rendering, the `.karaoke.zip` format, validation, limits, job control and directory-anchored I/O.
- `src/main.ts`: the browser UI. Other `src/*.ts` modules handle cue editing, alignment and word timing, SRT, practice, the waveform worker and review.
- `scripts/`: model setup, smoke tests and evaluations.
- `tests/`: Python tests (`test_*.py`), TypeScript unit tests (`*.test.ts`), Playwright specs (`*.spec.ts`) and test servers.
- `assets/`: bundled DejaVu Sans font and its licence.

## Data & privacy

- Songs, stems, lyrics, recognition output and videos are stored only in `--data-dir`. There is no account or cloud upload, and the app does not rely on browser storage. The service binds to `127.0.0.1` only.
- After setup, separation and recognition run offline in resource-limited worker processes that refuse network calls.
- Archives are unencrypted and contain your private audio and lyrics. Checksums detect corruption only, and imported clips are marked as unverified. To back up the whole library, stop the service and copy the data directory.

## Licences and attribution

- **DejaVu Sans** is bundled for video lyrics. Its licence is in `assets/DejaVuSans.LICENSE`.
- **Parakeet TDT 0.6B v2/v3**: CC-BY-4.0 (NVIDIA). **sherpa-onnx**: Apache-2.0. **Silero VAD**: MIT.
- **UVR-MDX-NET-Voc_FT** comes from the Ultimate Vocal Remover project ([model repository](https://github.com/TRvlvr/model_repo/releases); the UVR application is MIT-licensed). sherpa-onnx (Apache-2.0) converted it to ONNX. A separate licence for the weights was not established from those publications. No weights are stored in this repository.
- The optional `smoke_model.py --licensed-sample` input is the Spleeter `audio_example.mp3`. It is an excerpt of *Slow Motion Dream* by Steven M Bryant, ©2011, featuring CSoul, Alex Beroza and Robert Siekawitch, licensed CC BY 3.0. Keep its [attribution](http://dig.ccmixter.org/files/stevieb357/34740) when sharing the excerpt or stems derived from it.
