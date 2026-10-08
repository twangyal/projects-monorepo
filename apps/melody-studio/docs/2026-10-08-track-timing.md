# Reviewed track timing — 2026-10-08

Issue: [#143](https://github.com/twangyal/projects-monorepo/issues/143). Parent: `722e242e961098f6ced659e5cc20d9442eff7221`. Branch: `Astra`.

## Product milestone

The full-DAW vision requires practical performance editing. Existing roll snapping moves individual notes by deltas and deliberately retains imported fractional offsets. The selected-track timing editor now proposes nearest-grid onset correction for an entire part, with explicit strength and swing, exact changed-start review and one-edit Apply. It adds no project schema, dependency or remote service.

Supported grids are 1, 0.5, 0.25 and 0.125 beats. Strength blends original and target starts from 0 to 100%; swing delays odd subdivisions in each two-grid pair by 0–50% of the grid interval. Exact nearest ties select the later target. Note durations, pitches, velocities, IDs/order, every other track and reference PCM remain unchanged. Any shifted note beyond beat 512 refuses the entire detached proposal. Review/settings are session-only; committed exports, history and saved state change only on Apply. No-change Apply preserves redo. Source/settings changes retire review ownership.

Raw editor fields, continuation proposals and active gestures refuse Review/Apply, including a capture-phase pointer guard before focused raw fields can commit on blur. Generation, intent, selected track and serialized source must still match when applying. This establishes bounded editing correctness; musical usefulness, physical vocal capture, richer DAW mixing/effects and intended-user evaluation remain unfinished.

## Verification and original outcomes

- Test-first calculation probe: three new behavior cases failed against an explicit unavailable implementation; the refusal-only case passed. After implementation all four pass, including independently authored straight-grid/later-tie targets, exact partial strength/swing, distant positions, exact endpoint and atomic overflow refusal on frozen input.
- First native launch failed because the prior temporary Chromium executable was absent. Restored native Chromium 153.0.8010.0 from an isolated temporary package; no browser dependency was added to the app.
- With native Chromium restored, the old UI failed at the missing Review timing control, establishing the missing user flow.
- First implemented targeted run: three native cases passed and two failed. The nested grid label included option text in exact label lookup; separating its label repaired access. The raw-title test's later Save click itself blurred and committed the field; the test now checks native saved state while focus remains preserved, following the existing section guard pattern. Neither failure was hidden by retries or looser export/numeric gates.
- Final targeted native run: all five cases passed. Real MIDI/WAV downloads are decoded with independent timing/sine-envelope oracles; complete backups preserve original reference bytes through Apply, Undo/Redo and reload. Additional cases cover raw blank settings, swing/partial strength, focused raw-title guard, stale source, no-change/discard redo, and 390px keyboard application without page overflow.
- Complete unit/lint/TypeScript/production build gate: **333 units passed**, no failures.
- Full serial native Chromium regression: **154 passed (3.3 minutes)**, no failures. Command: `CHROMIUM_PATH=/tmp/melody-chromium-wrapper npm --prefix apps/melody-studio run test:browser -- --workers=1`.
- Fresh independent read-only reviewer found no Critical/Important defects. It did not edit files or run tests/builds.

Verification commands run serially so production/harness output and test-results are not shared by concurrent builds. CI results belong in issue #143 after the implementation commit is published.
