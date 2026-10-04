# Karaoke Studio

A local karaoke maker: import a complete song or excerpt, estimate vocals and backing with the actual pretrained Spleeter model, supply and time lyrics, preview the result, and export a karaoke video. AI estimates the stems; you supply and synchronize the words. There is no automatic lyric recognition or alignment.

## Install and run

Use **Linux with procfs available**, **Python 3.11**, **Node.js 22.18+** (CI uses Node 24), and **FFmpeg/ffprobe** on your PATH. FFmpeg needs H.264/libx264 and AAC encoders. Media jobs use Linux directory handles and POSIX process/resource controls; other platforms are unsupported by this storage implementation.

From the repository root:

```sh
cd apps/karaoke-studio
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-core.txt
python -m pip install -r requirements-ml.lock.txt
npm ci
npm run build
```

The core dependency is Pillow; the separate ML lock installs Spleeter 2.4.2, TensorFlow 2.12.1, and their pinned dependencies. Use the same Python 3.11 environment to start the service, because its model subprocess uses that interpreter. Installation requires network access and substantial disk space; no paid service or GPU is required. On Ubuntu, FFmpeg can be installed with `sudo apt-get install ffmpeg`.

Explicitly set up the model cache outside Git, then start the service:

```sh
python scripts/setup_model.py --model-dir "$HOME/.cache/karaoke-studio/models"
python -m karaoke \
  --model-dir "$HOME/.cache/karaoke-studio/models" \
  --data-dir "$HOME/.local/share/karaoke-studio" \
  --port 8765
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765). The loopback service serves the production `dist/` build and its API from the same origin. `npm run dev` watches and rebuilds that production output; run it in a second terminal while the Python service is running, then refresh the browser after a rebuild. It does not start a separate browser-facing Vite server.

Startup never downloads models. Missing/corrupt weights disable new separation with setup guidance; install missing ML packages into the service's active environment. The service processes one separation or video-export job at a time. **Cancel job** stops pending work and cleans partial output while preserving completed clips. Stopping the service cancels active workers too.

## Make a karaoke song

1. Choose a local **WAV, MP3, FLAC, or Ogg** song lasting **1–300 seconds** (five minutes), at most **64 MiB**. Longer audio is rejected rather than silently trimmed. Inputs are decoded to stereo, 44.1 kHz, 16-bit PCM. Remote URLs, playlists, and video inputs are unsupported.
2. Wait for separation, then audition **Original**, **Vocals**, and **Backing**. Original playback uses the decoded source. Listen for remaining vocals and altered instruments before exporting.
3. Paste your lyrics, one line per cue, and press **Create draft timings**. Even spacing is only a starting point; it does not detect singing or identify words.
4. Listen and correct each line's start/end seconds. **Mark start** and **Mark end** use the current playback position; **Play line** seeks to its start. The preview highlights the active line, shows upcoming text, and displays an instrumental break between cues.
5. Press **Save lyrics**, then **Export karaoke MP4**. Downloads include backing WAV and saved SRT subtitles. Editing saved lyrics invalidates the previous video; save and export again to download the current revision.

Titles allow 1–100 Unicode code points. Projects support at most **200 cues**, **240 Unicode code points per cue**, and **20,000 lyric code points** overall. The pasted draft also counts line separators toward its limit. Cue intervals must be ordered, nonoverlapping, and within the clip; gaps are allowed. Invalid edits stay available for correction and cannot replace the saved project. Unsaved lyric drafts are not durable until you press **Save lyrics**.

**Undo lyric edit** and **Redo lyric edit** recover up to **30 unsaved edits**:
title/text/timing corrections, removed lines, pasted words, draft generation, and
discarded pastes. Typing in one field counts as one edit until you leave it.
Empty/invalid timing values are preserved for correction, with save/export still
blocked. Undoing back to the saved title and cues clears the lyric-edit warning;
unapplied pasted words keep their separate unsaved warning. A new edit after undo
clears redo. Saving successfully, opening another clip, deleting the selected clip,
or reloading resets this session-only history. Failed requests retain it. History
does not undo saved server revisions, media jobs, or permanent clip deletion.

Videos contain the estimated backing and rendered lyric cards at **1280×720, 24 fps, H.264/AAC**. Timings are represented on the video frame grid; this is line-level karaoke, not word-by-word highlighting. Bundled DejaVu Sans provides consistent typography; its license is in `assets/DejaVuSans.LICENSE`. Not every writing system/glyph is supported.

## Local projects and backups

Completed projects persist in the supplied data directory and reopen from **Saved clips** after a service restart. There is no account, cloud backup, browser-storage dependency, or external song upload. Only one service instance can use a data directory at a time; an exclusive lock prevents a second instance from interfering with its files.

Stop the service before moving, replacing, or linking storage directories. The
running service retains handles to its owned directories and rejects changed
library/project paths with recovery guidance. Restore the original directories
before restarting; existing projects are preserved. Temporary-job and selected
deletion cleanup stay anchored to owned storage even when a parent path moves.
Media children inherit only their job's open directory handles; procfs paths keep
their reads/writes in those directories while processing. This protects against
parent-directory replacement; it does not sandbox arbitrary same-user changes
to individual files inside owned storage.

Jobs stay **running** through temporary cleanup. A terminal job status means the
single worker has been released, so a new job can start immediately. Cancellation
after result publication does not relabel an already saved project as cancelled.

The library holds at most **20 completed projects**; reaching the limit preserves existing work and refuses new clips. **Delete selected clip** asks for explicit confirmation, removes only that selected project's media and metadata, and frees a library slot. Download or back up anything you want to keep first. Portable project archive import is not implemented.

For a full backup, stop the service and copy the data directory, including project metadata and generated audio. Downloaded WAV/SRT/MP4 files are useful deliverables but do not replace that editable project backup. To start another library after reaching the cap, retain the backed-up directory and start the service with a different `--data-dir`.

## Model provenance and limitations

Setup downloads the official [Deezer Spleeter v1.4.0 two-stem checkpoint](https://github.com/deezer/spleeter/releases/download/v1.4.0/2stems.tar.gz), **73,109,797 bytes**, and verifies its pinned SHA-256 against the value published in the official [checksum index](https://github.com/deezer/spleeter/releases/download/v1.4.0/checksum.json):

```text
f3a90b39dd2874269e8b05a48a86745df897b848c61f3958efc80a39152bd692
```

Only expected checkpoint files are extracted, each with its own pinned checksum, before the cache is published. An existing official archive can be reused without downloading:

```sh
python scripts/setup_model.py \
  --model-dir "$HOME/.cache/karaoke-studio/models" \
  --archive /path/to/2stems.tar.gz
```

Spleeter's **code** is [MIT-licensed](https://github.com/deezer/spleeter/blob/master/LICENSE). A separate license for the pretrained checkpoint was not established from the checked official documentation; the release archive contains no LICENSE/NOTICE/model card. Weights are not bundled in this repository. Preserve the official provenance and this distinction when using or redistributing artifacts.

After installation/setup, separation operates on the cached model locally; the model worker rejects intercepted network calls and records offline checks in `processing.json`. Each job starts a new CPU worker. It processes 30-second windows with two-second overlaps (at most eleven windows for five minutes). Overlaps use complementary linear sample weights; both complete stems receive one shared gain after assembly. Exact source sample count and positions are preserved. Spleeter may initialize a prediction session for each call, so warmup is part of the measured runtime. This windowing controls resource use; it does not guarantee inaudible seams or separation quality.

Worker limits are ten minutes of wall time, ten minutes of CPU time and 3 GiB observed RSS. Decode has a 60-second subprocess deadline; video validation, card preparation and encoding share a ten-minute deadline with a 128 MiB output cap. Slower systems may time out. Uploads retain the five-second inactivity limit and have a 60-second absolute deadline. Job progress reports actual completed inference windows.

Uploads/exports require at least 1 GiB free space on the owned job filesystem; this check cannot reserve space against other programs. A maximum song's three WAV files use about 151.4 MiB. Temporary float stems add about 201.9 MiB, with a conservative maximum separation working set around 417.3 MiB on disk including a 64 MiB upload, before small headers. Twenty maximum-duration projects need about 2.96 GiB for WAVs alone, and optional maximum-size videos add 2.5 GiB. Disk exhaustion fails without replacing completed work. Smoke reports distinguish measured peaks from these calculated bounds.

Vocals and accompaniment are **estimates**. Residual singing, lost instruments, reverb, and other separation artifacts can remain. The default Spleeter configuration estimates a limited frequency range, so high-frequency content can also be affected. Synthetic smoke audio validates inference plumbing, not real-song accuracy. A real singing smoke provides additional runtime evidence but no reference-stem quality score or guarantee. Automatic transcription/alignment, songs longer than five minutes, broader device testing, subjective boundary listening and reference-stem separation-quality evaluation remain future work.

## Fast verification and CI

Fast checks require Python 3.11, FFmpeg, the core dependency, and Ruff; they do **not** require TensorFlow or model weights:

```sh
python -m pip install -r requirements-core.txt -r requirements-dev.txt
python -m unittest discover -s tests -v
python -m compileall -q karaoke scripts tests
ruff check .
npm run test
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:browser
```

For an existing Chromium executable, use `CHROMIUM_PATH=/path/to/chromium npm run test:browser`. Playwright builds the production UI and starts the test HTTP service on port 4188. Its separator is explicitly **fake** and copies fixture WAV audio; the resulting video export uses real Pillow/FFmpeg. HTTP unit tests also inject test callbacks. These tests verify workflow, persistence, request validation, cancellation, export structure, and lyric-frame boundaries; they do not demonstrate model separation quality.

The path-scoped GitHub workflow uses Node 24, Python 3.11, FFmpeg, Pillow, and Ruff, then runs Python/TypeScript checks and production Chromium tests. Normal CI neither installs ML dependencies nor downloads the model.

## Real-model verification

With the ML environment and verified cache installed:

```sh
python scripts/smoke_model.py \
  --model-dir "$HOME/.cache/karaoke-studio/models" \
  --work-dir /tmp/karaoke-smoke \
  --seconds 10
```

This runs actual offline separation on original synthetic audio, checks matching non-silent stems and duration, and writes media, processing metadata, and `smoke-report.json` under a generated directory. It is separate from fast tests.

For an optional local copy of the official [singing example](https://raw.githubusercontent.com/deezer/spleeter/master/audio_example.mp3), add `--licensed-sample /path/to/audio_example.mp3`. The sample is an excerpt of *Slow Motion Dream*, Steven M Bryant, ©2011, featuring CSoul, Alex Beroza, and Robert Siekawitch, licensed CC BY 3.0; retain its [attribution](http://dig.ccmixter.org/files/stevieb357/34740) when sharing the excerpt or derived stems. The smoke script reads this file locally and does not download it.

Also verify the production service manually with real separation: upload → audition stems → correct/save timings → reopen → export/download MP4. Inspect the video and listen back. A passing fake browser suite alone is insufficient evidence for that real-model flow.

The initial [verification notes](docs/verification.md) record observed Linux real-model and production-browser checks, including the licensed singing example, seeking, cue boundaries, and exported video structure. [Measured smoke reports](docs/2026-10-03-model-smoke.json) preserve runtime, memory, duration, and offline-worker evidence. These results do not establish reference-stem separation accuracy or compatibility on other systems.


## Full-song verification (2026-10-04)

The full-song milestone ([#33](https://github.com/twangyal/projects-monorepo/issues/33)) passed 114 Python tests, 18 TypeScript tests, Ruff, ESLint, type checking and the production build. All 17 production browser cases passed together in [CI](https://github.com/twangyal/projects-monorepo/actions/runs/37167470645) at `8be72d1`; all 11 project workflows passed at that commit. Fast browser separation remains explicitly fake; real audio/video codecs and downloaded files are exercised.

Actual **offline Spleeter** ran on the existing verified cache in Python 3.11.16, TensorFlow 2.12.1 and Spleeter 2.4.2, on a four-CPU-quota/16 GiB Debian 13 environment:

| Original synthetic input | Windows | Exact output frames per stem | Measured completion | Peak worker RSS |
| --- | --- | --- | --- | --- |
| 30 seconds + 1 frame | 2 | 1,323,001 | 13.34 s pipeline | 1,204 MiB |
| 180 seconds | 7 | 7,938,000 | 48.79 s pipeline | 1,279 MiB |
| 300 seconds | 11 | 13,230,000 | 75.48 s browser upload-to-ready; 63.80 s worker | 1,290 MiB |

These are individual local observations, with different pipeline/UI measurement boundaries, not cross-device speed guarantees. All recorded workers reported zero intercepted network attempts. Both stems retained the exact decoded frame count and used one recorded shared gain. Cancelling a real 300-second job after its third completed window reaped all three captured media subprocesses and removed generated work while preserving the uploaded source; cleanup and verification completed about 0.11 seconds after cancellation.

The actual 300-second production flow saved supplied lyrics across two inference-window boundaries and near the end, sought/switched all three tracks, reopened after a real service restart, and downloaded SRT plus an **8,216,851-byte MP4**. Independent decoding verified H.264/AAC, 1280×720 at 24 fps, 7,200 video frames, 300-second audio/video duration, 13 cue/gap/boundary frame checks including the actual final frame, and non-silent decoded AAC at 299 seconds. Desktop/mobile screenshots were inspected. The maximum video's export timing was not retained after a verification-script reporting error, so no encoding-speed figure is claimed.

Reproduce real inference separately from the fast suite:

```sh
python scripts/smoke_model.py --model-dir /path/to/verified/models --work-dir /tmp/karaoke-smoke --seconds 180
python scripts/smoke_model.py --model-dir /path/to/verified/models --work-dir /tmp/karaoke-smoke --seconds 300
python scripts/smoke_model.py --model-dir /path/to/verified/models --work-dir /tmp/karaoke-smoke --seconds 30.00002267573696
python scripts/smoke_model.py --model-dir /path/to/verified/models --work-dir /tmp/karaoke-smoke --seconds 300 --cancel-after-window 3
```

The runner checks exact non-silent PCM, distinct stems, finite common gain, offline/runtime metadata and sampled disk use without retaining entire songs in memory. Synthetic waveforms validate processing and timeline plumbing; neither they nor overlap arithmetic establish real-song isolation quality or inaudible seams. Subjective boundary listening and reference-stem quality evaluation were **not performed**. See [the complete measured evidence](docs/2026-10-04-full-song-verification.json); the earlier ten-second licensed singing example remains historical evidence for its original short-clip run.
