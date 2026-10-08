# Track sound-envelope milestone — 2026-10-08

Tracked in [#151](https://github.com/twangyal/projects-monorepo/issues/151). The revised full-DAW direction remains ACTIVE.

## Delivered behavior

Each track optionally retains strict linear attack/decay/sustain/release settings. Attack, decay and release range from zero to two seconds; sustain ranges from zero to one. Early note-off releases from the actual attack/decay level. The shared renderer includes the full release, groups only matching sounds and retains the existing frame-allocation guard. Complete edited-note comparison admission now permits the longest two-second release at the 512-beat/40-BPM limit (16,978,500 frames at 22,050 Hz).

Absent envelopes retain the legacy sound and project representation. Applied settings use one complete-project history edit, autosave, saved compositions and portable backups. Raw or invalid settings remain unapplied through track selection; Discard settles only the current track's sound fields. Apply refuses other editor drafts, suggestions and active piano-roll gestures before pointer focus can blur them. Applying settles fields without rebuilding the editor.

All synthesized playback and WAV use the shared renderer. MIDI retains its existing program/note representation; it does not encode custom envelopes. Reference recordings are preserved rather than processed. Section WAV keeps its exclusive crop bounds. This is amplitude shaping of the existing three oscillators, not filters, effects, sample instruments or mixer routing.

## Verification and failures that drove fixes

Seven new units use independent scalar sine/ADSR PCM checks, exact frame counts, simultaneous same-pitch sounds, early note-off, zero phases, detached strict validation and accessor rejection. Before implementation, six failed and one passed. After implementation, two existing comparison-budget cases failed because they still used the old 0.08-second ceiling; their over-budget fixtures were moved to one frame beyond the actual two-second ceiling, preserving refusal assertions.

Three native Chromium 153 cases use an original complete project with retained reference PCM. They inspect genuine playback buffer samples without replacing playback, independently decode the exported WAV, verify unchanged actual MIDI, exact untouched tracks/reference assets, complete backups, Undo/Redo, autosave and reload. They also cover blank/out-of-range drafts across track selection, unchanged unapplied exports/redo, zero phases through keyboard Apply and 390px layout width.

The first mobile test failed because its backup action could itself blur the title. Reading the saved project directly still failed: sound Apply rebuilt the editor and committed an unrelated raw title through blur. Pre-focus admission and sound-only field settling fix the product bug; the final three cases pass (7.5 seconds). Independent read-only review of the final guards, canonical grouping and implementation found no Critical or Important blockers.

`npm run check` passes all 348 unit cases, lint, type checking and production build. The complete production Chromium 153 regression suite passes all 175 cases (1.3 minutes), including all prior capture, backing, reference, recovery, piano-roll, timing and arrangement flows. Local playback/PCM/fixture tests do not establish musician preference, physical device latency or cross-browser acceptance.
