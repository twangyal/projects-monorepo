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
3. Paste your lyrics, one line per cue, and press **Create draft timings**, or choose **Import timed lyrics (SRT)** to review existing timings before replacing the current cues. Even spacing is only a starting point; it does not detect singing or identify words.
4. Use **Time lines while listening** to mark each supplied line during playback, review the complete result, and apply the times together. You can also correct individual start/end seconds. The **Original audio waveform** provides a full-song overview and 60/15/5-second detail windows. Click either view or use **Seek in song** to find a phrase, select its lyric line, then drag its start/end handle or use the arrow keys. **Mark start** and **Mark end** also use the current playback position; **Play line** seeks to its start. The preview highlights the active line, shows upcoming text, and displays an instrumental break between cues.
5. Press **Save lyrics**, then **Export karaoke MP4**. Downloads include backing WAV and saved SRT subtitles. Editing saved lyrics invalidates the previous video; save and export again to download the current revision.

Titles allow 1–100 Unicode code points. Projects support at most **200 cues**, **240 Unicode code points per cue**, and **20,000 lyric code points** overall. The pasted draft also counts line separators toward its limit. Cue intervals must be ordered, nonoverlapping, and within the clip; gaps are allowed. Invalid edits stay available for correction and cannot replace the saved project. Unsaved lyric drafts are not durable until you press **Save lyrics**.

To break a supplied phrase into shorter cues, pause or seek the audio inside its
interval, place a single text caret between its words, then choose **Split at
caret and playhead**. Both literal text halves keep their original outer times.
The playhead becomes their shared boundary; no words or spacing are generated.
Whitespace-only halves, selected text ranges and cuts inside an emoji are refused.
**Merge with next** joins the two literal texts with one newline and spans both
intervals, including any instrumental gap. These actions validate the entire
proposal before changing the editor, preserve unrelated numeric spellings and
pasted drafts, and make one unsaved Undo/Redo edit. Save lyrics when ready.
The last line has no next line to merge. Existing cue and character limits apply
to the complete result. See [issue #121](https://github.com/twangyal/projects-monorepo/issues/121).

**Undo lyric edit** and **Redo lyric edit** recover up to **30 unsaved edits**:
title/text/timing corrections, removed lines, pasted words, draft generation, and
discarded pastes. Typing in one field counts as one edit until you leave it.
Empty/invalid timing values are preserved for correction, with save/export still
blocked. Undoing back to the saved title and cues clears the lyric-edit warning;
unapplied pasted words keep their separate unsaved warning. A new edit after undo
clears redo. Saving successfully, opening another clip, deleting the selected clip,
or reloading resets this session-only history. Failed requests retain it. History
does not undo saved server revisions, media jobs, or permanent clip deletion.

### Time supplied lines while listening

With valid supplied cue text and an audio track loaded, choose **Begin timing session**
under **Time lines while listening**. Press Play in the audio player, then use
**Mark line start** and **Mark line end** as you hear each line. The same button
advances through every existing cue in order. Focus it and press Enter or Space
for keyboard timing; release between marks. Holding a key records only one mark.
Beginning a session does not start playback or move the playhead.

Marks use the player's current position at normal speed, without rounding. Gaps
and adjacent lines are allowed; each end must follow its start. Pause and resume
retain staged marks. Seeking, switching tracks/clips, editing, changing playback
speed, looping or leaving the page cancels the session to prevent stale timing.
At the natural end of the song, an open final line offers **End final line at clip
end**. This explicit action closes it at the exact project duration. Earlier
unfinished lines cannot be applied as a partial result.

The complete review pauses playback. **Apply captured timings** replaces only cue times
as one unsaved Undo/Redo edit; **Cancel timing session** leaves the editor intact. Titles,
literal multiline text and unapplied pasted words remain unchanged. Existing
invalid numeric fields do not prevent timing valid cue text, and Undo restores
their original spelling. Unapplied pasted words still need to be used or discarded
before saving. Press **Save lyrics** explicitly when ready; staged marks and
session history do not survive a reload. This is manual line timing, with no
automatic speech recognition or compensation for physical playback/input latency.

### Import existing timed lyrics

With a clip open, choose **Import timed lyrics (SRT)** and review every cue before
pressing **Replace lyric cues**. The replacement is one unsaved Undo/Redo edit.
Your clip title, audio and unapplied pasted words stay intact; an unapplied paste
still needs to be used or discarded before saving. Press **Save lyrics** when the
result is ready. Cancel, invalid input and superseded reads keep the current
editor and saved revision intact. Editing or changing clips invalidates an old
review. Reading and reviewing the file sends no lyrics to a service.

Supported files are **UTF-8, at most 128 KiB**, with an optional leading BOM,
LF or CRLF line endings, consecutive cue numbers starting at 1 and exact
`HH:MM:SS,mmm --> HH:MM:SS,mmm` timestamps. Every interval must fit the current
clip. Gaps and adjacent cues are allowed; overlaps, zero-length cues, VTT,
timestamp settings and unsupported formatting are rejected without partial
import. The existing 200-cue, 240-character-per-cue and 20,000-character total
limits apply, counting Unicode code points and preserved intra-cue newlines.

Multiline cues remain editable as multiline text. Empty or space/tab-only lines
separate subtitle blocks; other whitespace-only lines and unsupported control
characters are rejected. Meaningful text retains its spacing. Raw `<` and `>`
are rejected: escape literal brackets as `&lt;` and `&gt;`. Those two escapes and
`&amp;` decode exactly once, matching this app's SRT exports; other ampersand
sequences stay literal. Imported text is never evaluated as HTML or styling.
SRT represents milliseconds: exported pre-existing fractional timings are
rounded by the existing exporter. Submillisecond source intervals can round to
overlapping cues, and a boundary can round beyond the clip's exact duration;
such files need correction before import. Complete clip archives
remain the way to preserve original timing precision and all audio together.

### Timing with the waveform

The waveform always shows the **original recording**, including while you listen
to the vocal or backing estimate. Its peaks represent amplitude in both stereo
channels; they do not detect words or provide automatic lyric alignment. Select
a cue to center the detail view. **Previous window**, **Next window** and
**Center on playhead** move the view without changing the lyrics. Seeking does
not automatically start playback.

A completed handle drag is one undoable lyric edit. Arrow keys move a focused
handle by 10 ms, or 100 ms with Shift; holding a key remains one edit until release.
Movement preserves an existing boundary's fractional precision. Other cue
boundaries and text are unchanged. Overlap or a zero-length cue is rejected;
gaps and exactly adjacent cues are allowed. Escape, lost pointer capture,
switching views/tracks/projects or another edit cancels an unfinished gesture.
Invalid numeric timings disable the handles until corrected; waveform navigation
and the original numeric fields remain available. Waveform activity does not
replace your input fields or clear incomplete text/timing drafts.

Waveform loading streams the local normalized WAV in a browser worker. Each
441-frame/10 ms bin retains exact signed 16-bit minimum and maximum values across
both channels, including opposite-phase audio. A five-minute song has 30,000
bins and 120,000 bytes of peak data. The final partial bin uses only real samples.
Container overhead is limited to 4 KiB, and the whole load has a 30-second deadline.
**Stop waveform** releases pending work; **Retry waveform** starts a new attempt.
Playback and manual timing continue to work after a stopped or failed load.
Peaks are temporary and are recomputed when a project is reopened. No model,
network service, project migration or extra setup is needed for this view.

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

The library holds at most **20 completed projects**; reaching the limit preserves existing work and refuses new clips. **Delete selected clip** asks for explicit confirmation, removes only that selected project's media and metadata, and frees a library slot. Download or back up anything you want to keep first.

### Portable editable clips

Choose **Back up saved clip**, then **Download saved archive**, to keep a `.karaoke.zip` containing the saved title, lyric cues/revision, original audio, estimated vocals/backing and recognized processing metadata. Unsent title, pasted lyrics and numeric timing drafts are not included or implicitly saved. They stay available while the backup runs. An archive is tied to that saved revision; saving later edits makes an older cached download unavailable until you back up again.

Use **Import project archive** to add a restored clip to the current library with a fresh ID. It preserves the saved revision, cue text/times and every WAV byte, without running separation or requiring model readiness. The current editor, waveform, audio position and unsaved drafts stay open. **Open imported clip** is a separate action and asks before leaving unsaved work. Failed or canceled imports do not replace existing clips. The normal 20-clip limit still applies.

Cancel an accepted archive job with the existing job control. **Cancel archive upload** stops the browser request, but a lost response can leave acceptance uncertain. Use **Check restore status** to inspect the current library/job before retrying; it preserves the editor and does not repeat the import or cancel unrelated work. It also retries a failed provenance read. Ordinary editing/audio/video remain usable when provenance is unavailable, while archive backup waits for that check to recover.

This is a versioned, uncompressed application format, limited to **160 MiB**, not a general ZIP importer. It admits only project/manifest JSON, three canonical 44.1 kHz stereo PCM16 WAVs and optional bounded processing metadata. It rejects extra paths/files, links, compression, encryption, ZIP64, duplicate/unknown JSON fields, inconsistent lengths and mismatched hashes/CRC. Processing stays within existing 1–300-second limits, with 64 KiB streaming buffers, a 60-second upload deadline and a separate 180-second archive-job deadline. Restore requires Linux with atomic no-replace directory publication; unsupported systems fail before upload admission. Existing directory ownership and cleanup protections still apply.

The archive is **unencrypted private audio and lyrics**. Checksums detect corruption, not authentic provenance, media rights or separation quality. Imported audio and processing claims remain visibly **unverified** after restart and re-export; they never change local model readiness. Missing metadata is identified separately. Unrecognized/private processing metadata or a malformed provenance sidecar blocks backup visibly without changing the project. Stored local metadata is also not independently authenticated.

One completed archive cache per clip is retained, up to an additional 3,200 MiB across a full 20-clip library. Replacement publishes only a complete archive; failure preserves the previous cache. The existing free-space admission remains in force. Downloaded archives can be restored into a different `--data-dir` library. WAV/SRT/MP4 downloads alone do not preserve the whole editable clip.

For a whole-library backup, stop the service and copy the data directory, including project metadata, audio and any imported-provenance sidecars. Retain the backed-up directory when starting a new library after reaching the clip cap.

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

Run the archive cases with model readiness explicitly disabled:

```sh
KARAOKE_ARCHIVE_NO_MODEL=1 CHROMIUM_PATH=/path/to/chromium npm run test:browser -- tests/archive.spec.ts
```

The independent portability smoke starts two production service processes with separation forbidden, transfers an actual archive, restarts the destination service, and checks the saved record, WAV bytes, provenance, SRT and decoded MP4. Its default five-second fixture needs no weights; the work directory must be new or empty:

```sh
python scripts/smoke_archive.py --work-dir /tmp/karaoke-archive-smoke --report /tmp/karaoke-archive-report.json
```

To check an existing full-song project, add `--source-project /path/to/library/projects/PROJECT_ID`. It copies the supplied project into private smoke libraries and never modifies that source. The supplied final cue must have a preceding gap so the independent video check can distinguish active lyrics from a blank card. `--skip-video` is available for archive-only diagnosis and does not constitute complete media acceptance.

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

## Waveform timing verification (2026-10-04)

The waveform milestone ([#54](https://github.com/twangyal/projects-monorepo/issues/54)) passed **114 Python, 51 TypeScript and 31 production browser tests**, Ruff, ESLint, type checking and the production build. All twelve project workflows passed at `27bbc557`; the [Karaoke CI run](https://github.com/twangyal/projects-monorepo/actions/runs/37178106328) used Chromium 153. Coverage includes independent PCM extrema, bounded streaming failures, cancellation/retry, pointer/keyboard edits, undo/redo, preserved raw drafts, mobile endpoint handles and lifecycle cleanup. A deterministic resize regression releases a gesture before deferred geometry notifications arrive, ensuring a moved viewport or canvas cannot commit stale timing.

A separate native Chromium 151 run used a private copy of the existing **300-second real-Spleeter project** from #33. The worker reduced 13,230,000 stereo frames to 30,000 amplitude bins (120,000 bytes) in an observed 208 ms; every bin matched an independent Python PCM reducer by SHA-256. Fourteen animation frames continued during loading, with a largest observed gap of 16.8 ms. These are single local observations, not performance guarantees. Switching audition stems retained the original waveform.

Actual pointer and held-key edits moved the last cue to **298.2–300 seconds**, with exact undo/redo, explicit save, reload and real process restart. A transient maximum 200-cue draft remained usable at 390 px and was undone without changing saved work. The production service exported an **8,213,246-byte, 300-second H.264/AAC MP4** in an observed 35.59 seconds. Independent decoding checked fifteen cue/gap frames, the changed late boundaries, frame 7,199 and non-silent AAC at 299 seconds. SRT retained the exact edited times; all seven original fixture files remained byte-identical.

See [the measured waveform evidence](docs/2026-10-04-waveform-verification.json). No new inference was needed for this timing milestone. It establishes timeline and export behavior, not subjective separation quality. Controlled persisted-page lifecycle tests do not establish native BFCache admission.

## Editable archive verification (2026-10-04)

The portability milestone ([#59](https://github.com/twangyal/projects-monorepo/issues/59)) passes **166 Python tests, 51 TypeScript tests and 44 production browser cases**, plus Ruff, ESLint, type checking and the production build. The archive browser suite also passes with model readiness explicitly false: twelve cases pass and the legacy separation-only case is intentionally skipped. Independent binary fixtures verify the archive contract; real HTTP tests cover atomic publication, output replacement, stale revisions, cancellation, upload shutdown, quota and retained storage ownership.

The native regressions keep invalid raw timings, Unicode title/cue/paste drafts, undo/redo, actual input nodes and audio state through backup and restore. They also cover uncertain upload acceptance without replay, delayed/duplicate terminal responses, provenance retry and explicit opening. Concrete focus-loss and unsolicited observed-job video-download failures were reproduced before their fixes. Existing separation, waveform and video flows remain covered by the unchanged preceding 31 browser cases.

All twelve project workflows passed at `042218218f02b82a1082af485eb33ee06e08c67c`; the [Karaoke workflow](https://github.com/twangyal/projects-monorepo/actions/runs/37184306831) ran all 44 browser cases in Chromium 153. A separate production-service run moved a **158,779,475-byte archive** containing three exact 52,920,044-byte WAVs, 200 cues and saved revision 7 into a different library. The imported record survived actual process restarts and re-export with permanently unverified provenance; source files remained byte-identical and separation was forbidden.

The restored five-minute clip produced an **8,491,153-byte H.264/AAC MP4** with 7,200 frames. Independent decoding verified the final cue at 299.25 seconds, the preceding instrumental gap at 298.25 seconds and non-silent late backing audio. A glyph/color oracle models the declared chroma subsampling, matches over 99.6% of sampled core pixels and rejects swapped, incorrect and blank text. It checks these late cards, not every lyric. The bundled font still lacks Tibetan glyphs; archive/SRT Unicode bytes are exact, while the video displays missing-glyph boxes for those characters.

The first large-run metrics sampler raced normal temporary-directory cleanup after the video was published. The helper now tolerates disappearing scratch files and always reaps its services on sampling errors. Recovery independently checked the retained video and restarted the service without another encode. Original encode timing, memory/disk peaks and terminal cancellation status were not retained and are not claimed. The separate five-second smoke observed a canceled backup preserving the previous cache and project with no remaining job files.

A native Chromium 151 run downloaded the full archive and uploaded it as an actual browser File into the second library. Invalid draft fields, their DOM nodes, focus, redo history and audio position survived; accepting **Open imported clip** was a separate decision. The restored final cue moved from 298.50 to **298.51 seconds** with keyboard timing, Undo/Redo and Save, then survived another real service restart at revision 8. Its downloaded 200-cue SRT retained the edited interval and literal text. Desktop and 390-pixel screenshots were inspected with no overflow, page errors or external requests. The observed backup/download and upload/restore checks took 1.41 and 1.90 seconds respectively on this local warm-cache fixture; these are not performance guarantees.

See [the complete portability evidence](docs/2026-10-04-portability-verification.json), including original validation-helper failures, recovered media facts and explicit measurement limits. No new inference, model download or separation-quality evaluation was performed.

## Reviewed SRT import verification (2026-10-04)

Issue [#105](https://github.com/twangyal/projects-monorepo/issues/105) adds the
reviewed import flow in version 0.4.0. Local checks pass **166 Python tests,
66 TypeScript tests and 61 production browser cases**, plus compilation, Ruff,
ESLint, type checking and build. The 17 new browser cases and all 44 unchanged
existing cases each pass their first final-source run. Literal independent
fixtures verify complete review, exact text/times, raw-field Undo/Redo,
superseded File reads, failed saves, waveform edits, manual persistence and real
SRT/ZIP downloads. The native four-second archive preserves all three WAV hashes.

The deadline test advances a controlled browser clock; lifecycle tests dispatch
page events and do not establish physical BFCache admission. Existing Spleeter
inference evidence remains separate. See the [local verification receipt](docs/2026-10-04-srt-import-verification.json)
and [new native evidence](docs/2026-10-04-srt-import-native.json). Both push and PR
CI at `6ec2f2cf827c16eb591d5721a87ac50813b73b49` pass the complete 166/66/61
suites and static/build checks; the PR merge has the identical tree. The
[CI receipt](docs/2026-10-04-srt-import-ci.json) preserves exact checkouts and
log hashes. Twelve of thirteen project PR workflows passed at that head; the
separate Motion fixture-readiness failure remains tracked in #106.

The separate maximum run imports **200 cues / 20,000 Unicode code points** into
an original 300-second clip from an exact **128 KiB** UTF-8 File. One extra byte
is refused without changing the editor. Complete review, one Undo/Redo, manual
Save and actual SRT export retain every supported literal text value and timing.
The **158,790,486-byte archive** restores through a real browser File into a new
clip, then survives a complete service and Chromium restart with exact cues,
**30,691-byte SRT** and all three original **52,920,044-byte WAVs**.

A separate original six-second clip produces a **193,273-byte H.264/AAC MP4**
with 144 frames. Fourteen independently decoded cue/gap/boundary samples match
original glyph and color masks, reject wrong/blank text controls and retain
non-silent late audio. Minimum sampled glyph coverage is 99.632%; sampled spatial
precision is 100%. This checks the declared samples, not every lyric in a
five-minute video. No inference was run. The corrected full acceptance took
17.533 seconds locally; this is not a speed or peak-memory guarantee.

The first two attempts exposed runner errors: FFmpeg requires `0.5` rather than
`.5` for the audio sample duration, and Playwright's in-memory upload buffers are
limited to 50 MiB. The runner now passes the already-downloaded archive path to
the same native File input. Original fixtures, pixel/text/timing expectations
and product source stayed unchanged; both failures are retained in the
[maximum receipt](docs/2026-10-04-srt-import-maximum.json). Source-byte capacity
uses declared trailing empty lines; the decoded lyrics still reach both limits.

To reproduce with new output directories after building the app:

```sh
KARAOKE_SRT_FIXTURES=/tmp/karaoke-srt-fixtures node scripts/smoke_srt_import.mjs --fixtures-only
KARAOKE_SRT_FIXTURES=/tmp/karaoke-srt-fixtures KARAOKE_SRT_OUTPUT=/tmp/karaoke-srt-run CHROMIUM_PATH=/usr/bin/chromium node scripts/smoke_srt_import.mjs --run-existing
```

The runner starts and stops its own local no-model service and browser profile,
using only its newly generated synthetic audio library. It never opens your
normal library. Set `KARAOKE_PYTHON` if a different core-test Python executable is
needed; omit `CHROMIUM_PATH` to use Playwright's installed browser.

### Sequential timing verification (#115)

The supplied-line timing flow passes **86 TypeScript tests**, **166 Python tests**,
lint/type/build and **all 75 native browser cases** in one local full regression.
Both published-head push and PR CI pass the same counts and static/build gates;
all thirteen project PR workflows pass, with the actual PR checkout tree matching
the implementation. The fourteen original new cases also passed their first
separate invocation, including a real 144-frame H.264/AAC export.

The independent maximum records **400 trusted actions during 300.168 seconds of
actual playback**, retaining all 200 supplied cues and 20,000 Unicode code points.
Complete review, one Apply/Undo/Redo and explicit Save preserve literal text and
raw drafts. Its **158,792,632-byte archive**, exact 29,891-byte SRT and all three
52,920,044-byte original WAVs survive an actual same-origin service restart and a
new Chromium process. The **12,560,208-byte five-minute H.264/AAC video** passes
all 7,200 frame timestamps, full audio/video decode, 13,230,080 decoded stereo PCM
frames (80 padding frames), fifteen independent glyph/boundary/final-frame checks
and non-silent late audio. Export/download took 41.909 seconds; independent media
inspection took 16.577 seconds. These measured times are not general performance
guarantees or physical synchronization accuracy.

Two verification failures remain explicit. The first maximum stopped after 148
marks because locator actionability work exceeded the original 150 ms scheduling
bound. Pre-positioning a hit-tested trusted mouse action retained that bound;
the next 400-action run had at most 41.955 ms scheduling lateness and 3.742 ms
clock-observation difference, below the unchanged 20 ms observation limit. Its
last audio-inspection command then used an unsupported FFmpeg `.5` duration.
Changing only that argument to `0.5` allowed the **same captured video** to pass
inspection, followed by separate saved-state and restart checks. This is staged
acceptance, not an uninterrupted all-green second invocation. Product source,
original media/text and acceptance tolerances were unchanged.

See the [root verification](docs/2026-10-04-sequential-timing-verification.json),
[native evidence](docs/2026-10-04-sequential-timing-native.json),
[maximum receipt](docs/2026-10-04-sequential-timing-maximum.json),
[CI receipt](docs/2026-10-04-sequential-timing-ci.json),
[pure oracle](docs/2026-10-04-sequential-timing-oracle.json) and
[UI review](docs/2026-10-04-sequential-timing-client-review.json).

The standalone maximum runner needs installed Playwright/Chromium, core Python
with Pillow, FFmpeg/ffprobe and fresh output directories. From this app directory,
set `KARAOKE_TIMING_FIXTURES` and run
`node scripts/smoke_sequential_timing.mjs --fixtures-only`. Copy its generated
`library/` to a new `KARAOKE_TIMING_LIBRARY` directory, then separately start
`python3 -u tests/srt_smoke_server.py --serve /absolute/library --port 8766`.
This synthetic test service forbids inference and serves the existing production
build. Set `KARAOKE_TIMING_SERVICE_PID` to that Python process, `KARAOKE_TIMING_ORIGIN`
to `http://127.0.0.1:8766`, `KARAOKE_TIMING_OUTPUT` to a fresh directory and
`CHROMIUM_PATH` to the browser executable. Run the script with `--capture`, which
listens for a real five minutes. After a successful capture, gracefully restart
that owned service on the same port/library, update its PID variable and run
`--verify-restart`. Optional `KARAOKE_PYTHON` selects the core interpreter. The
runner owns its browsers, never its service, and neither generates model stems
nor claims subjective alignment quality.
