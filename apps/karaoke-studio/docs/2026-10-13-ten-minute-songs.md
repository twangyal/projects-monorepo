# Ten-minute songs — issue #233

## Intended outcome and gap

The direction asks for an automatic song-to-karaoke workflow from an upload. Karaoke Studio refused anything longer than five minutes (300 s, 64 MiB), so many ordinary songs could not be used at all.

## What changed

The supported duration is now **600 s** and uploads up to **128 MiB**. Every limit that follows from duration moved together, so none silently caps the new length:

| Limit | Before | After |
| --- | --- | --- |
| `MAX_DURATION` | 300 s | 600 s |
| `MAX_INPUT_BYTES` | 64 MiB | 128 MiB |
| Decode and WAV byte limits | from 300 s | from 600 s (derived) |
| Separation windows (30 s, 2 s overlap) | 11 | 22 |
| Worker wall-clock, CPU soft and CPU hard limits | 600 / 600 / 605 s | 1200 / 1200 / 1205 s |
| Job scratch budget | 800 MiB | 1600 MiB |
| Portable archive | 160 MiB | 3 × maximum WAV + 4 MiB = 306.8 MiB |
| Archive timeout | 180 s | 360 s |
| Client waveform frames and bytes | from 300 s | from `MAX_DURATION` |
| Client upload and archive limits | fixed constants | derived from the same constants |

The video deadline (600 s) and the 3 GiB worker memory limit are unchanged; the measurement below shows they fit. Messages now name the limits from the constants, so the next change cannot leave stale text behind.

## Measured with the real models (2026-10-13)

The machine had 4 CPU cores and no GPU. The models were Spleeter 2-stems and Parakeet TDT 0.6B v2 int8, pinned as in the setup scripts. The input was 600.0 s built from three English JamendoLyrics songs played back to back: Ridgway "Fire Inside" (284.0 s), HILA "Give Me the Same" (233.7 s) and the first 82.4 s of Quentin Hannappe "Keep On". It was encoded as a 192 kb/s MP3.

| Step | Result |
| --- | --- |
| Separation (`separate_clip`) | 245 s wall time for 22 windows; worker CPU 245 s; peak RSS 1.27 GiB. The limits are 1200 s, 1200 s and 3 GiB. |
| Recognition (`transcribe_vocals`) | 61 s; peak RSS 1.32 GiB; 583 words recognized |
| Recognition quality vs. the songs' reference word timings (716 words) | WER 40.2%; median onset error 0.068 s; 95.7% within 0.3 s |
| The same songs in the single-song evaluation (#214) | WER 30.4% (HILA), 48.7% (Ridgway), 37.1% (Quentin), against 35.7%, 45.4% and 40.0% here |
| Video export (`export_video`, 127 automatic lines, 578 highlight steps) | 130 s; 17 MB H.264/AAC MP4 |

Separation scales linearly with duration: about 100 s for 240 s of audio in #214, and 245 s for 600 s here. The old 600 s worker limit would have left only about 2.4× headroom for a 10-minute song on this machine. The new 1200 s limits restore about 5× headroom.

## Two code bugs found by updating the tests

Updating the boundary tests (done by a delegated agent, then reviewed) exposed two real problems, both fixed here:

1. **Portable archives capped separation records at 11 windows** in two hard-coded places in `archive.py`. A backed-up or restored separated song longer than about 310 s would have been refused. Both places now use `MAX_WINDOWS`. A regression test admits a 22-window record built from the real window planner and refuses 23.
2. **The free-space check was below a job's scratch budget.** `MIN_FREE_BYTES` (1 GiB) was smaller than the new 1.6 GiB budget, so a job could start without room to finish. It is now 2 GiB, the messages name it from the constant, and the existing contract test enforces the ordering.

## Verification (2026-10-13)

- `python3.11 -m unittest discover -s tests`: **181** pass, and `ruff check .` is clean. The boundary tests now accept exactly 600 s, 128 MiB, 22 windows and the new archive size, and reject the next value up. Oversized-body tests send the new limits + 1. The streamed-decode test runs a 600 s fixture.
- `npm run check`: 128 TypeScript tests, ESLint and the build. Client tests accept exactly 600 s and reject the next floating-point value above it. Waveform tests cover 26,460,000 frames and 60,000 min/max pairs.
- Native Chromium: **all 99 cases pass**.
- **End to end through the real service** (`python -m karaoke` with the real models, driven in Chromium):
  - the session reported a 600 s, 128 MiB and 321,726,592-byte archive limit, and the page showed "1–600 seconds · up to 128 MiB";
  - uploading the 10-minute MP3 reached "Your stems and 127 automatically timed lyric lines are ready" in **315 s**, with the clock at 9:59.96;
  - **Export karaoke MP4** downloaded a 599.96 s, 17.9 MB video after **144 s**;
  - no page errors.
