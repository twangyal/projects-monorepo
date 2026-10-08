# Unsaved timing audio audition — 2026-10-08

Issue: [#143](https://github.com/twangyal/projects-monorepo/issues/143), audio-review follow-up. Parent: `95a1a7bcaccfdc7e6596341f24f403ddc11bce86`. Branch: `Astra`.

## User outcome and boundaries

After Review timing, Audition timing plays the private candidate in the current synthesized mix at current tempo. Apply remains deliberate and undoable. Original project/reference bytes, history, autosave and standard exports stay committed until Apply. No saved schema changed. The existing worker, native AudioContext, cancellation and transport are reused; reference recordings and unapplied fields are excluded.

The review retains an operation/playback-generation lease. Source/settings/Discard retire only the audition that owns that lease, including pending resume/render. New Solo or ordinary playback survives stale review cancellation. Discard is available while this review owns a held render. Deferred redraw after cancellation lets raw editor input handlers retain their draft first. Natural audio completion refreshes audition readiness.

## Verification history

- Native baseline failed because Audition timing did not exist.
- First implementation passed actual PCM and held-render retirement cases. The ownership case failed because the changed Strength field remained focused; its later native change-on-blur correctly retired the next review. The test now explicitly finishes the setting change before reviewing. No product guard was weakened.
- Final targeted native run: **three passed (10.5 seconds)**. A transparent observer delegates to the real AudioBufferSourceNode.start and reads its actual buffer. Independent scalar sine/envelope arithmetic verifies changed onset samples and the exact **40,352-frame** candidate, rather than importing production synthesis. Natural completion re-enables audition. Actual WAV and complete backup retain the original committed notes before Apply.
- Native settings/discard checks retire live owned audio, keep newer Solo alive, and preserve complete reference bytes. A separate labelled held-worker fault case releases an old render after Discard and fresh playback; it cannot start audio or replace the current notice. The fresh reply starts exactly once.
- Unit/lint/TypeScript/production build gate passes **336 units**, zero failures. Fresh read-only review found no Critical/Important blocker.
- Full serial native Chromium regression: **162 passed (3.6 minutes)**, zero failures, using `CHROMIUM_PATH=/tmp/melody-chromium-wrapper npm --prefix apps/melody-studio run test:browser -- --workers=1`.

Tests use native Chromium 153.0.8010.0 and Node 24.19. Commands are serialized to protect shared production/harness dist and test results. Temporary browser files/dependencies are not committed. This verifies synthetic browser audio and lifecycle behavior; physical speakers, microphone timing and musician usefulness were not measured. CI outcome is recorded in the issue after publication.
