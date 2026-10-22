# Melody chord attack rolling — 2026-10-22 (#306)

## Outcome and scope

Melody's full DAW direction calls for capable authored note editing. Building simultaneous chord tones was already available; staggering their attacks required moving each voice. Notes → Roll chord attacks now spreads every distinct melodic pitch at the selected note's exact onset, ordered low-to-high or high-to-low with 0.25/0.5/1 beat spacing. The first voice retains the original onset. IDs, pitches, durations and velocities are retained; releases may overlap and the phrase may extend. These remain ordinary notes, not a repeating arpeggiator or learned harmony.

The validated cloned composition changes only those attacks. Other notes/tracks, sound settings, song-time automation and original reference assets remain intact. Drums, stale selection, fewer than two voices, duplicate pitches at that onset, invalid settings, new external same-pitch interval intersections and releases beyond the existing 512-beat boundary refuse atomically. Existing intersections remain permitted. Full tracks require no extra capacity. Drafts, pending suggestions and piano-roll gestures use the existing articulation guard. One commit to editor history supports Undo/Redo, autosave/reload, complete backups and ordinary MIDI/WAV.

## Source verification

- 455/455 units, lint, TypeScript and production build pass.
- Seven new model tests cover both orderings, exact-onset exclusion of near attacks, supported spacing/full 256-note graphs, immutable input, malformed graph/stale/drum/unison/single refusal, exact 512-beat release/overflow and new versus existing same-pitch intersections.
- Four initial native roll/chord flows pass; the raw-draft keyboard refusal was strengthened to require a visible focused button and refusal notice, then all four pass again.
- Actual complete backup graph equality retains owned reference bytes and unrelated track data. The model fixture separately retains its pan-automation curve and track settings. Existing independent export decoders compare MIDI event timing and decoded WAV against the literal expected composition. Undo/Redo and durable reload preserve the same data. The phone flow exercises downwards order, retained session choices, raw drafts, refusal, keyboard activation and no horizontal overflow.

## Review correction and retained evidence

Fresh read-only review found that `details.note-editor` did not match the existing Notes group selector. Consequently it remained visible in other focused sections. A new native assertion reproduced this (`toBeHidden` received visible in Compose). The Notes group now explicitly owns the complete `#chord-roll-panel`; the test checks Compose, Sound and Arrange hide it and Notes reveals it before keyboard use. The initial full browser run was deliberately interrupted for this correction; it is not final-source acceptance. Original tests and acceptance thresholds remain intact.

A separate follow-up disclosure test reproduced a passive-navigation defect: opening the new summary blurred and committed a valid but unapplied project title. The summary is now included in the existing `workspacePresentation` handling, preserving pointer and keyboard open/close navigation, drafts and authorized library reads. The regression verifies the saved composition and retained title, disclosure toggling and action refusal until the draft is resolved. Desktop 1280px and phone 390px layouts were visually inspected. A second local 257-case run was deliberately interrupted after 136 passing cases for this correction; it is not final-source acceptance. The earlier canonical [run39859614561](https://github.com/twangyal/projects-monorepo/actions/runs/39859614561) on23d3a81 completed 455 units and all 257 browser cases in3.2 minutes; it is superseded for final acceptance by this correction. No source-audio or original acceptance bounds changed.

## Acceptance status

The first visibility correction passed all22 targeted chord/roll/workspace cases in28.7seconds. The final targeted suite, including passive disclosure navigation, passes all23 cases in25.8seconds. Fresh read-only re-review resolves both integration findings with no new findings.

Final corrected source is `1be7a189cd5a0ef8f9e49dd0f093a7d817fcc8b5`. Canonical [run39860237618](https://github.com/twangyal/projects-monorepo/actions/runs/39860237618), job120108762407, passes **455 unit tests and all258 native Chromium browser cases (3.9minutes)**, plus lint, TypeScript and production build. Full job logs and successful required steps were inspected on2026-10-22. The final local native suite also passes **all258 cases in6.4minutes**, using Chromium143 with one worker and an isolated output directory. Issue#306 is complete.

Melody remains ACTIVE against the complete DAW destination, including broader audio editing, mixing/routing/effects and musician evaluation. Passing original backed-recording cases in this gate does not identify or resolve the intermittent upstream gaps/startup refusal tracked in#300. No PR was opened; project#8 remains skipped.
