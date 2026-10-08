# Full Chromium155 stage observations — 2026-10-07 (#128)

Source head: `0f4c1def55ec34516946352332f928265616ac39`. These are the first
push/PR attempts, with original and diagnostic results preserved separately.
Both workflows passed. All thirteen normal portfolio PR workflows, and both
Shot push/PR workflows, also passed at this head (350 units/109 native cases).

| First run | Original export/download | Separate stage variation | addVideo elapsed waits | Draw elapsed | Video sample elapsed | Finalize elapsed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| [Push37599287274](https://github.com/twangyal/projects-monorepo/actions/runs/37599287274) | 46.564s | 44.965s | 43.100s | 0.821s | 0.227s | 0.069s |
| [PR37599295042](https://github.com/twangyal/projects-monorepo/actions/runs/37599295042) | 70.124s | 69.798s | 66.966s | 1.438s | 0.322s | 0.100s |

All four actual VP9/Opus captures retain the exact11,554,385-byte complete archive
through a full process restart, with SHA256
`a6137efd2434bd48dfd36aa6cf21c3d0c63f04694d14c3025458243a6bc03751`.
Their unchanged independent inspections pass1,800 video/2,880,648 audio frames,
all fixed motion/color samples and stereo timing/pitch/gain/silence gates.
Both diagnostic snapshots record1,800 video/addVideo and3,000 audio/addAudio
operations, all completed without errors; finalization completes once.

The PR variation approaches the70-second product deadline. Export/download wall
time starts around the UI click and includes publication/download overhead;
70.124s in the original receipt is not evidence that the product deadline was
widened or violated. The stage window identifies addVideo waits as dominant
elapsed work in these successful attempts. The pinned Mediabunny source includes
both native encoder dequeue and muxer/writer backpressure inside addVideo;
these counters do not separate those components or establish additive CPU time.
Draw timings exclude later GPU work and include several UI draws. Different CI
runners and attempt conditions prevent treating these as a controlled benchmark.
Neither attempt reproduced or explains the prior timeout. #128 stays open.

## Retained evidence

`*-verification.json` and `*-browser.log` are raw entries from each downloaded
artifact. `provenance.json` records source head/run/artifact IDs, original ZIP
bytes/digests and raw receipt/log hashes. All four ZIP digests and every receipt
artifact's original byte count/hash were independently checked locally. Media
inspection ran in CI; these records do not claim a second local decode of those
four CI movies. Large original movie/archive binaries remain CI artifacts with
one-day retention; raw text evidence and hashes remain durable here.

## Rejected local VP8-first candidate

The next separate experiment patches only codec order in an isolated archived
source copy. Production remains VP9-first, with VP8 fallback; quality mode,
960x540/30fps/2.5Mbps, frame plan, deadlines and every original gate stay unchanged.
The new diagnostic-only CI job archives its patch provenance before capture and
keeps a separately named candidate artifact, including failures. Its result cannot
clear an original maximum failure or promote a production preference change.

The first local software-WebGL153 VP8/Opus candidate, under concurrent110-case
browser-suite load, captures the archive/restart and movie in42.778s, with40.749s
addVideo waits. Independent inspection rejects `Torso control clip2 0/27 points`.
A second literal decoding of frame202 at6.733 authored seconds verifies expected
control RGB `[0,169,0]` versus actual `[14,197,6]` at all27 fixed points:28 maximum
channel error exceeds the unchanged24 tolerance;23 matches are required.
Both original VP9 and candidate VP8 report BT709 limited-range stream metadata,
so an unspecified-color-metadata explanation is not established. The candidate's
underlying color/rendering cause remains unknown; no clear speed gain or media
acceptance is established. Do not widen the gate or change production preference.
Raw failure and source/probe/pixel provenance are retained in
`local-vp8-candidate-failure.json` and `local-vp8-candidate-provenance.json`.
Full155 candidate results remain pending.

A follow-up native cancellation test checks real encoder cancellation completion,
no download and unchanged complete saved sequence/ordinary scene. Both focused
native observer cases and all110 native cases pass locally. This is observer
lifecycle validation, not physical device acceptance.
