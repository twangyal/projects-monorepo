# Reversible melody arrangement

Issue: #10. Continue the verified MVP on Astra; autonomous design and execution are authorized.

## Design

Add session history of up to 50 prior validated composition snapshots. Undo/redo restores and autosaves whole edits, including imported/replaced compositions. Invalid and no-op edits preserve redo; editing after an undo creates a new history branch. Defensive copies prevent caller mutation. History is not persisted across reloads; composition state is.

Provide buttons and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl+Y shortcuts outside editable controls. Capture/render operations disable history and arrangement changes. Full rerenders preserve actionable focus; settings updates keep native input behavior.

Duplicate the selected track and every note with new IDs, retaining sound settings. Transpose a nonempty track by ±1 or ±12 semitones; reject the whole operation if a pitch leaves C2–C7. Repeat the phrase with span `max(note ends) - min(note starts)`, so leading silence occurs only once and the next phrase starts at the previous end. Reject overflow beyond 8 tracks, 256 notes or 128 beats. Every action forms one history entry and autosaves.

## Tasks and verification

- [x] Pure `CompositionHistory` implementation and tests for limits, aliasing, invalid/no-op inputs, branching and boundary navigation.
- [x] Pure `duplicateTrack`, `transposeTrack`, `repeatTrack` and tests for immutable atomic transforms, IDs, rests, polyphony and bounds.
- [x] UI integration with accessible buttons and keyboard routing; production Chromium capture→duplicate→transpose→repeat→undo→export flow, replaced project recovery, invalid operation and reload tests.
- [x] Full checks, independent review, commit/push and issue update.

## Verification record

2026-10-03: 83 unit tests and 13 production Chromium tests pass, with strict typecheck, ESLint and build passing. Independent review found no implementation defects; a browser assertion prompted a clearer pitch-range error message. Core sketchbook status moved to MAINTENANCE while real vocal/device evaluation and generative assistance remain explicit future work.
