# Section audition verification (#140)

Baseline: 1a202619d3126c8065152235379347f4d482e360, owner direction reset; no project schema/dependency changes. Four new unit checks plus all existing cases: **319 passed**, lint/typecheck/production build passed. Final native production-browser run: **143 passed**, one worker, Chromium 153.0.0 from a temporary @sparticuz distribution (local wrapper/SwiftShader libraries are not committed). This is local native validation, not a published-head CI or physical musician evaluation claim.

The five new browser cases prove:

- Actual section WAV PCM equals the literal full-export slice at fractional 137 BPM; seven loud overlapping tracks outside the crop activate whole-song limiting, and the crossing note is not retriggered.
- Native loop remains active across several iterations; changing bounds stops the real source. One-pass section ends and ordinary full playback remains usable.
- Blank/invalid raw bounds survive redraw and do not change project backup bytes; reload restores default session-only bounds.
- Retired pending native AudioContext resume cannot start audio after bounds change.
- Stop retires a held worker response without cancelling subsequent full playback; stale release starts no source and the current reply starts exactly one.

Initial two-worker full run: 139 passed, two failures. An existing count-in observation missed its transient state under concurrent execution; it passed in serial follow-up and final full serial run. Existing Start beat test selector became ambiguous with Section start beat; changed to an exact label and verified. An intermediate targeted run collected that old selector before its fix: 36 passed/one failure. Initial local browser startup also failed because temporary native libraries were not colocated; corrected environment only, with no application/browser-test bypass. These outcomes are not relabeled as passing.

Bounds round to nearest 22,050 Hz frames. Cropping excludes release after the exclusive end and uses hard loop joins, which may click. No crossfade, tempo automation or measured musician-quality claim. Melody remains ACTIVE toward the full DAW destination.
