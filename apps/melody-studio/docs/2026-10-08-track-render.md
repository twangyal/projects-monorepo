# Selected-track solo and aligned WAV export — 2026-10-08

Issue: [#144](https://github.com/twangyal/projects-monorepo/issues/144). Parent: `d26f61c61377cba9e0933355b32f49b23326707c`. Branch: `Astra`.

## User outcome and boundaries

Musicians can inspect a committed synthesized part at current song tempo and export it for aligned use in another editor. `isolatedTrack` validates a detached composition, refuses inaudible selected tracks, and mutes only other tracks in that render snapshot. All original note endpoints remain, preserving song origin, leading rests and whole-composition duration with release tail. Existing worker/transport ownership, cancellation and peak limiting are reused. Solo/exports do not commit, alter references, save or consume history. Filenames contain a track index and sanitized track label.

Output remains mono 22,050 Hz 16-bit PCM. Each stem is peak-limited independently; additive identity with the separately limited full mix is not promised. References/unapplied notes are excluded. Users export desired tracks individually; no ZIP, pan, effects, routing or full DAW/musician-quality acceptance is claimed.

## Verification history

- Before implementation, two valid isolation/render unit cases failed against the unavailable helper; the refusal-only case passed. The native baseline failed because Export track WAV was missing.
- After implementation all three new units pass, including frozen graph preservation, leading silence and a complete 512-beat/40 BPM isolated render of **16,936,164 frames**, with trailing silence after the short selected part.
- The complete unit/lint/TypeScript/production build gate passes **336 units**, no failures.
- First targeted native run: all four cases passed. Actual decoded WAV excludes another audible part using an independent sine/envelope oracle; original complete backup/reference bytes, redo and MIDI remain exact. Solo/Stop preserves an unapplied timing review; muted/zero-volume parts refuse; a short selected part exports **5,646,564 frames** at 120 BPM when another part ends at beat 512, then preserves exact backup through reload.
- Fresh read-only review found one Important defect: natural end updated existing transport controls but left Solo disabled. A new native test reproduced it after actual Solo completion. `syncTransport` now refreshes Solo using the same readiness conditions as render. The native test verifies both Solo and full-mix natural endings restore readiness without Stop/edit, with exact unchanged backup. A narrow follow-up review found no remaining blocker.
- Final targeted native run: **five passed**. Full serial native Chromium regression: **159 passed (3.3 minutes)**, no failures. Command: `CHROMIUM_PATH=/tmp/melody-chromium-wrapper npm --prefix apps/melody-studio run test:browser -- --workers=1`.

Commands were serialized to preserve production/harness dist and test-results. Local native Chromium 153.0.8010.0/Node 24.19 were used; temporary browser restoration did not add dependencies to the app. CI completion is recorded in issue #144 after publication. Physical output fidelity and creative usefulness still require musician/device evaluation.
