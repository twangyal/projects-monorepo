# Section onset quantization — 2026-10-09

Tracking: [#163](https://github.com/twangyal/projects-monorepo/issues/163).

Quantize section note starts provides adjustable-strength timing correction for the selected track. Original onsets in the selected exclusive range move toward a song-zero-anchored grid of 1, 0.5, 0.25 or 0.125 beats. Exact midpoint ties choose the later grid. Strength zero is unchanged; intermediate strengths retain part of the original timing. The complete candidate is validated before any history/autosave change; overflow refuses all proposed changes instead of clamping. Durations, pitches, IDs, dynamics, sound effects, other tracks and reference takes stay intact.

Pointer preblur and keyboard admission use the existing complete-editor draft/proposal/gesture guard. Busy/startup controls are locked. Grid and strength are retained raw session settings; resulting notes use ordinary project/history/storage/playback/export paths. No schema or audio-source transformation is introduced.

## Verification

- Initial domain execution failed for the missing quantization module. A test-only history-class import was corrected to the existing CompositionHistory. Four deterministic cases then passed: complete detached graph comparison, partial strength, ties, exclusive original-onset inclusion, crossing durations, zero/aligned no-op Redo preservation, invalid settings/selections and atomic timeline overflow.
- The first focused native run passed draft/no-op tests but failed the exact grid label lookup. The select now has a stable explicit accessible name; the unchanged lookup passes. This was corrected in the product rather than weakening the locator or timeout.
- Native actual Apply compares complete independently expected project graphs. MIDI notes and WAV PCM are checked against independent timing/audio expectations, with unchanged references/assets and the muted control track. Undo/Redo, autosave/reload, partial strength, zero/invalid/empty refusal and an existing Redo branch are exercised.
- A native 512-beat edge fixture containing retained echo and real reference bytes refuses overflow after earlier notes would otherwise move; complete download and native saved project remain exact.
- At 390px, pointer Apply retains a focused unsent title before blur; keyboard activation refuses an invalid note-duration draft. Explicitly discarding it permits keyboard Apply without horizontal page overflow. The control screenshot is inspected before publication.

Final local gates: `npm run check` passes all 366 unit tests, lint, typecheck and production build; all four focused native cases and the complete 189-case browser suite pass (2.6m, exit 0). The narrow screenshot and final diff were reviewed. Exact-head hosted CI outcomes are retained in issue #163 after completion. Tests use CPU Chromium 153. They establish note editing and scheduled/exported data, not physical recording accuracy or musician evaluation. This is onset quantization, not duration quantization, swing, transcription correction or audio warping. Melody remains ACTIVE toward the full DAW destination.
