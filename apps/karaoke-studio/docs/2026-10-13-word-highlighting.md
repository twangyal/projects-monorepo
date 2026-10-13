# Word-by-word highlighting — issue #228

## Intended outcome and gap

The direction asks for an automatic song-to-karaoke result with a usable preview and export. Since #214, every sung word is recognized with its time. However, the preview and the MP4 only highlighted whole lines, which reads like subtitles rather than karaoke. Recognized word times were discarded once lines were formed, and corrected or pasted text had no word timing at all.

## What changed for people

- In the **preview**, the active line appears in white and each word turns amber as it starts being sung. The **exported MP4** shows the same thing.
- Corrections follow the singing. An unsaved but valid edit is timed again after a short pause in typing, so the preview always matches what the next export will show.
- Without recognized words (no model, a restored archive, or text nobody was heard singing), a line's words are spread across its interval from its start, in proportion to their length. Manually timed lines therefore highlight sensibly too.

## Design

- **`word_timings(cues, words, duration)`** in `karaoke/lyrics_auto.py` is pure and has no ML dependencies.
  - Each line is split on whitespace, and its words are aligned to the recognized words overlapping the line (±0.25 s). It uses the spelling-tolerant global alignment already used for pasted lyrics.
  - Matched words take their recognized start, clamped into the line. A match that would run backwards is dropped.
  - Unmatched words share the time between their heard neighbours, or between the line start and the end of singing (the line end minus a short hold), by word length.
  - A line with more than 16 words is highlighted in 16 groups. This bounds the number of video cards.
- **`POST /api/projects/{id}/word-timings`** takes `{cues}`, validated by the same rules as saving. It returns `{recognized, lines: [[{text, start, heard}]]}`. A missing or corrupt transcript falls back to estimates rather than failing.
- **Preview** (`src/word-timing.ts`, `src/main.ts`):
  - The reply is accepted only if it matches the current lines word for word, in order and inside each line. Anything else keeps whole-line highlighting.
  - The prefix of sung words is drawn in the highlight colour and the rest after it, as one centred line, counting Unicode code points so emoji are never split.
- **Export** (`karaoke/video.py`):
  - The export job passes the stored recognized words. Cards are keyed by (line, words sung).
  - The card text is laid out with Pillow's own centring offset, so a fully sung line is pixel-identical to the previous whole-line highlight.
  - Limits: up to `200 × 17 + 201 = 3,601` cards and 192 MiB of cards. A card is about 30 KB and takes about 35 ms, so the worst case is about 2 minutes, inside the existing 10-minute export deadline.

## Verification (2026-10-13)

Local runs with Python 3.11, Node.js 22 and Chromium 141 via `CHROMIUM_PATH`:

- `python3.11 -m unittest discover -s tests`: **180** pass, and `ruff check .` is clean. The new and changed cases cover:
  - recognized words timing a line;
  - a misspelled correction still matching;
  - unheard words between neighbours;
  - length-proportional estimates that start with the line;
  - clamping of a moved line, and dropping a backwards match;
  - 16-step grouping;
  - the HTTP endpoint (recognized, estimated after a corrupt transcript, and rejected bodies), and recognized words passed to the export;
  - card pixels: no highlight, first word only, the whole line matching the old line highlight, and identical glyph placement;
  - a real H.264 export whose decoded frames step word by word at the expected 24 fps frames;
  - the full-song card plan (601 cards for 200 two-word lines) with a shared deadline.
- `npm run check`: 128 TypeScript tests (2 new: strict reply validation, and code-point sung prefixes including emoji), ESLint and the production build.
- Native Chromium: **all 99 cases pass**. The automatic-lyrics cases check:
  - recognized word timing in the preview, with highlight pixels only on the sung side;
  - re-timing after an unsaved correction;
  - estimated timing for a clip without recognition.

  Five older cases first failed because a line opened unsung for 0.15 s. That showed estimates must start with the line, because a marked or imported start is when singing begins. It is now so. A first draft of the browser case added two clips and exceeded the fixture's 20-project limit, so the checks now live in the existing cases.
- A demo export with recognized words was inspected frame by frame.

## Measured on real songs (2026-10-13)

`scripts/evaluate_word_highlighting.py` compares the time each word lights up with its annotated start for all 5,693 reference words of the 20 English JamendoLyrics songs (first 300 s). Recognized words are the cached transcripts of the #214 evaluation, produced by the same production path and pinned models. Per-song results are in [`2026-10-13-word-highlighting-evaluation.json`](2026-10-13-word-highlighting-evaluation.json).

| Situation | Median error | Within 0.2 s | Within 0.3 s | Within 0.5 s | Within 1 s |
| --- | --- | --- | --- | --- | --- |
| Lines timed correctly, with recognized words | **0.068 s** | 82.8% | **90.2%** | 94.6% | 97.8% |
| … words matched to recognition (64% of words) | 0.057 s | 92.0% | 97.0% | 98.9% | 99.4% |
| … words placed between heard neighbours | 0.113 s | 66.8% | 78.3% | 87.2% | 95.1% |
| Same lines, estimates only (no recognition) | 0.136 s | 61.8% | 74.7% | 88.2% | 97.2% |
| Pasted lyrics aligned automatically | 0.109 s | 65.0% | 71.4% | 76.6% | 81.5% |

**Interpretation**

- With well-timed lines, recognized words put 9 of 10 word highlights within 0.3 s of the singing, against 3 of 4 with length estimates alone. The gain is largest on songs with uneven phrasing, for example Lower Loveday (0.29 s → 0.07 s) and Cortez (0.30 s → 0.09 s).
- With automatically aligned pasted lyrics, the remaining large errors come from lines that were themselves misplaced, not from word placement. Two songs dominate: Pure Mids (median 2.1 s) and Moon I Mean (0.65 s). Correcting a line's timing fixes its words, because word timing follows the line.
- Thresholds such as "good enough for singing along" were not established with singers.
