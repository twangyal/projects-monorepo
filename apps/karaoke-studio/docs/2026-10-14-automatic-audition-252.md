# Audition recognized passages before applying — #252

The owner's song-to-karaoke direction requires understandable uncertainty and efficient correction. Automatic review previously showed recognized text/times but listening could only use current editor cues. This milestone allows direct audition of a captured recognized passage, even when current editable timings differ or are invalid.

## Behavior and ownership

The review offers per-line once/repeat, explicit pause/resume/stop and an uncertainty-only filter. Normal 1× playback uses the selected Original/Vocals/Backing source. The existing PracticeController handles seek admission, playback deadlines, exact end pause, repeat and cancellation. The new owner additionally binds the SRT review object, project/edit/recognition epochs, media generation, track/source and duration. Only audition admission bypasses editor validity; it validates the captured recognized cue set instead. Ordinary editor-based practice keeps its original validity check.

Listening/filtering does not mutate drafts, titles, cue graphs, history, saved data or normal practice selections. Filtered rows retain original numbering; complete apply semantics remain explicit and undoable. Review cancellation/replacement, edits, clip/track/media changes, jobs and lifecycle changes retire the owner. Imported SRT does not receive automatic confidence/filter controls. No schema, model pin, backend or ML setup changes.

## Local evidence

- Baseline 128 TypeScript tests passed; the previous canonical main hosted gate [38529362686](https://github.com/twangyal/projects-monorepo/actions/runs/38529362686) also completed successfully.
- Test-first native filter case failed for the absent control. Initial test-helper selector and timeout cleanup failures were corrected before that meaningful red run. A broad implementation replacement initially touched the parallel SRT row loop and failed TypeScript's missing-name check; it was restored to its original behavior before browser verification.
- 128 TypeScript tests plus ESLint/typecheck/build pass; Python compileall passes. No Python backend changed.
- 24 focused native cases passed across automatic lyrics, the new audition flow and existing SRT import. Four new cases exercise actual fixture WAV playback at the recognized 8.85→11.75 s interval despite invalid raw corrections, filtered complete Apply/Undo, Repeat/Pause/Resume/Cancel/edit retirement, track retirement and a held result from real native play released after review cancellation. A 390px check passes.
- Independent review found no critical/important product issue and independently passed typecheck. Its test-cleanup concern was repaired: the helper captures the accepted upload job's exact project ID, and only cancels/deletes that owned ID while preserving all pre-existing and unrelated new IDs. New cases were rechecked after that repair.
- Local native checks use portable Chromium 143 with web security enabled and isolated artifact output. Standard hosted full browser CI remains the publication/integration gate. The local Python environment has a previously recorded procfs/RSS limitation; hosted Linux is used for the unchanged full Python gate.

## Limits

Fixture recognition and original synthetic tones verify UI/media ownership, not real transcription quality or measured correction effort. Confidence is the existing model signal. Playback can only audition the loaded local clip; a filtered view does not prove high-confidence lines are accurate. #241's real multilingual timing and correction-effort measurements remain open. Karaoke stays ACTIVE against the broader intended product.
