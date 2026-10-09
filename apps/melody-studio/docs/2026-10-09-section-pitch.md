# Section pitch transforms — 2026-10-09

Issue #164 advances creative note editing toward the revised full-DAW destination. Whole-track transpose remains available; these controls independently change a verse/chorus section on one track. Four directions move pitches by ±1/±12 semitones. Inversion mirrors each included interval around the lowest pitch at the earliest included onset, independent of note storage order.

Selection uses the existing one-based exclusive section bounds and original onsets. Crossing-note lengths are retained whole; timing, velocities, IDs, other tracks, track sounds/effects and complete reference bytes/bindings remain unchanged. Complete detached validation refuses any resulting pitch outside MIDI 36–96 without clamping or partially committing earlier notes. Empty/invalid selections refuse; unison inversion preserves Redo without adding history. Actual changed results are one autosaved Undo/Redo edit.

## Verification

- Five new deterministic cases first failed with the absent module, then passed. They cover complete detached transpose/effect retention, all four directions, chord ties and reversed storage order, exact exclusive/onset selection with crossing durations, unison/no-op Redo, invalid operations/ranges and upper/lower pitch refusal after earlier valid candidate changes.
- `npm run check` passed: 371 unit tests, lint, TypeScript and production build.
- Four new native Chromium 153 cases passed (9.9 seconds). Trusted UI actions download actual full-project, MIDI and WAV files; literal independently expected pitches and complete graphs agree. The existing independent MIDI decoder and direct sine/envelope PCM oracle verify audible transformed output, including polyphony and unchanged muted tracks. Undo/Redo, autosave and reload retain the expected graph and original recording assets. All four directions also preserve retained echo/filter settings.
- Native no-op, empty-section and pitch-bound refusals retain the complete project and Redo. At 390px, a pointer button preserves a focused unsent title before blur; keyboard activation refuses a retained invalid note duration, and succeeds after Discard. Page containment and a screenshot inspect control readability.
- The full native Chromium regression suite passed all 193 cases (2.6 minutes). Exact published-head hosted CI results are recorded in the issue completion summary. No production graph changes are made by test harnesses for these checks.

## Limits

These operations change synthesized note pitches. They do not reverse or pitch-shift reference audio, infer harmony, preserve keys automatically, introduce automation, or establish musician-quality acceptance. MIDI carries its existing note/program representation; custom sounds remain in project/WAV. Melody Studio remains ACTIVE under the revised full music-production vision.
