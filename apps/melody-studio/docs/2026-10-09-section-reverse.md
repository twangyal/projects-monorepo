# Phrase timing reversal — 2026-10-09

Issue #165 adds a creative note-arrangement tool toward the revised full-DAW vision: reverse the selected track’s whole note intervals within the existing exclusive section bounds. Internal beat math is `newStart = first + (last - originalEnd)`. Leading and trailing rests mirror with the intervals. Pitches, lengths, velocities, IDs, order in storage, track sounds/effects, other tracks and original reference bytes/bindings are preserved.

Any selected-track note crossing either boundary refuses the whole detached operation before candidate starts change. Exact boundary endings are supported. Other-track crossings remain untouched and do not block the edit. Missing/empty/invalid sections refuse; a symmetric result adds no history and retains Redo. A changed result is one autosaved Undo/Redo edit. Existing raw field, suggestion, roll gesture, busy/startup and preblur pointer admission protect unapplied work.

## Verification

- Five new deterministic cases first failed with the absent module, then passed. Literal expected starts for the polyphonic fractional fixture are 2.5, 2.25 and 1; complete detached sounds and other tracks are preserved. Further cases cover fractional section origin, exact boundaries/outside notes and exact double reversal of binary fractions, both crossing boundaries, unrelated crossing tracks, symmetric/no-op Redo and invalid/missing/empty sections.
- `npm run check` passed: 376 unit tests, lint, TypeScript and production build.
- Four new native Chromium 153 cases passed (9.7 seconds). Trusted UI actions produce complete backups and actual MIDI/WAV downloads. Independently expected literal starts agree with the complete graph, existing independent MIDI decoder and direct oscillator/envelope PCM oracle. Undo/Redo, autosave and reload retain complete references. A separate effect-bearing project preserves echo/filter settings through success, both boundary refusals and Redo. No-op/empty selections keep the prior history branch.
- At 390px a pointer action keeps a focused unsent title before blur; keyboard activation refuses an invalid note duration and succeeds after Discard. All variation controls fit without horizontal overflow; the screenshot was inspected for readability.
- The full native Chromium regression suite passed all 197 cases (2.8 minutes). Exact published-head hosted results are recorded in the issue completion summary. The MIDI/WAV checks exercise committed synthesis, not reversed recording samples.

## Limits

This reverses synthesized note timing, not captured audio, envelopes or oscillator sample order. Synthesized notes attack/release normally at the new onsets. Simultaneous original onsets with different durations can become different onsets when whole intervals mirror. JavaScript fractional precision means double reversal need not be bit-exact for arbitrary decimal values; Undo restores the exact original graph. The existing song end is the last note end; moving the last notes earlier can shorten that implicit end and require reducing the session range before another section action. Explicit arrangement-length/playlist persistence remains future work. No schema/dependency changes are needed. Audio editing, broader instruments, mixing/routing/automation and musician evaluation remain ACTIVE DAW work.
