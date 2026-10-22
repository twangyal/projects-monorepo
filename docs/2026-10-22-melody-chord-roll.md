# Melody chord attack rolling — 2026-10-22 (#306)

## Outcome and scope

Melody's full DAW direction calls for capable authored note editing. Building simultaneous chord tones was already available; staggering their attacks required moving each voice. Notes → Roll chord attacks now spreads every distinct melodic pitch at the selected note's exact onset, ordered low-to-high or high-to-low with 0.25/0.5/1 beat spacing. The first voice retains the original onset. IDs, pitches, durations and velocities are retained; releases may overlap and the phrase may extend. These remain ordinary notes, not a repeating arpeggiator or learned harmony.

The validated cloned composition changes only those attacks. Other notes/tracks, sound settings, song-time automation and original reference assets remain intact. Drums, stale selection, fewer than two voices, duplicate pitches at that onset, invalid settings, new external same-pitch interval intersections and releases beyond the existing512-beat boundary refuse atomically. Existing intersections remain permitted. Full tracks require no extra capacity. Drafts, pending suggestions and piano-roll gestures use the existing articulation guard. One commit to editor history supports Undo/Redo, autosave/reload, complete backups and ordinary MIDI/WAV.

## Source verification

- 455/455 units, lint, TypeScript and production build pass.
- Seven new model tests cover both orderings, exact-onset exclusion of near attacks, supported spacing/full256-note graphs, immutable input, malformed graph/stale/drum/unison/single refusal, exact512-beat release/overflow and new versus existing same-pitch intersections.
- Four initial native roll/chord flows pass; the raw-draft keyboard refusal was strengthened to require a visible focused button and refusal notice, then all four pass again.
- Actual complete backup graph equality retains owned reference bytes and unrelated tracks/sounds/automation. Existing independent export decoders compare MIDI event timing and decoded WAV against the literal expected composition. Undo/Redo and durable reload preserve the same data. The phone flow exercises downwards order, retained session choices, raw drafts, refusal, keyboard activation and no horizontal overflow.

## Review correction and retained evidence

Fresh read-only review found that `details.note-editor` did not match the existing Notes group selector. Consequently it remained visible in other focused sections. A new native assertion reproduced this (`toBeHidden` received visible in Compose). The Notes group now explicitly owns the complete `#chord-roll-panel`; the test checks Compose, Sound and Arrange hide it and Notes reveals it before keyboard use. The initial full browser run was deliberately interrupted for this correction; it is not final-source acceptance. Original tests and acceptance thresholds remain intact.

A separate follow-up disclosure test reproduced a passive-navigation defect: opening the new summary blurred and committed a valid but unapplied project title. The summary is now included in the existing `workspacePresentation` handling, preserving pointer and keyboard open/close navigation, drafts and authorized library reads. The regression verifies the saved composition and retained title, disclosure toggling and action refusal until the draft is resolved. Desktop1280 and phone390 layouts were visually inspected. A second local257-case run was deliberately interrupted after136 passing cases for this correction; it is not final-source acceptance. The earlier canonical run39859614561 is likewise superseded by this correction. No source-audio or original acceptance bounds changed.

## Acceptance status

After the review correction, all22 targeted native chord/roll/workspace cases pass in28.7seconds before the disclosure correction. The final targeted suite passes all23 cases in25.8seconds. Fresh read-only re-review resolves the visibility finding with no new findings. Corrected-source full native regression and canonical CI remain pending. Issue#306 stays OPEN until the required checks are inspected. Melody remains ACTIVE against the complete DAW destination, including broader audio editing, mixing/routing/effects and musician evaluation. No PR was opened; project#8 remains skipped.
