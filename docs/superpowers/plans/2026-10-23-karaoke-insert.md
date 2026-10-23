# Missed lyric insertion — #309

Native execution under the owner's autonomous, noninteractive instruction.

Goal: insert literal text with explicit start/end times into an empty span while retaining corrected cues. Existing TypeScript/service schema, native controls and complete draft history remain the architecture. Replacing pasted lyrics is destructive to corrections; copying a passage cannot supply missed words. A small explicit insertion form is the chosen approach.

- [x] Add unit tests for detached literal insertion, boundaries, overlap/refusal and complete budgets; observe RED.
- [ ] Add native workflow tests before UI implementation, observe missing-control RED.
- [ ] Implement insertCue(cues,duration,text,rawStart,rawEnd) returning cues/insertIndex; validate existing graph and whole proposal, strict nonblank finite numeric input.
- [ ] Add Add lyric line panel; validate before stopping work. Record complete prior snapshot, insert matching raw timing entry, render, changed() one edit. Preserve title/paste and unrelated numeric spellings; no service schema change. Clear insertion fields on success/opening clips; utility drafts are outside history/save.
- [ ] Verify full unit/static/browser gates and available Python checks, fresh review, saved/reopened SRT and mobile flow. Commit and update issue with actual evidence.

Review focus: blank/raw invalid times must refuse rather than coerce to zero; rejection must retain playback/review/Redo; successful insertion must preserve exact unrelated native spelling and raw Undo; service output must include the added line; clip switching must reset utility drafts.
