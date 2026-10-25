# Karaoke selected-passage timing fit — final software acceptance

Issue: [#327](https://github.com/twangyal/projects-monorepo/issues/327). Reviewed source on canonical main: `1e685b307881e8ccea7fa7c95aa57f3c877caf13`.

## Delivered outcome

A selected inclusive lyric passage can be proportionally fitted into explicit corrected start/end seconds. This corrects endpoint drift that a uniform offset cannot address. Exact lyric words, untouched cues and their raw numeric spellings remain intact. The fit is one unsaved Undo/Redo edit; existing Save, SRT and video workflows retain the resulting boundaries. Audio tempo, recognition and word alignment are unchanged.

Full-graph validation precedes listening/review retirement and history mutation. Invalid source data, malformed or nonfinite targets, out-of-clip windows, neighbor collisions, reversed/stale selection, unchanged windows, collapsed cue durations and collapsed positive internal gaps refuse without side effects. The utility fields remain session-only.

## Implementation and review evidence

Baseline154 TypeScript tests passed. Four initial model tests failed for the absent module, then passed after implementation. The native missing-control assertion failed before UI implementation. An initial post-implementation expectation incorrectly required an unchanged numeric boundary to lose its literal spelling; the fixture was corrected to expect1.500 rather than1.5, preserving existing behavior.

One fresh read-only review found no Critical or Minor issues and one Important precision issue: a positive internal gap could round to touching boundaries. Source cues [0,1] and [1.0000000000000002,2] fitted to [1,2] reproduced it. A RED model assertion demonstrated the missing rejection. The single fix pass now explicitly preserves positive-gap separation; five model tests and a native refusal case pass. No rereview was performed.

Final local checks before the workspace reset:159 TypeScript units, lint, types, production build and compileall passed. Four focused native workflows passed in21.1s. They cover exact Undo/Redo/title/paste/raw values, saved API/SRT/reload,390px keyboard use, stale selection and refusals preserving review/listening/Redo. A real six-second144-frame H.264/AAC export was independently inspected through FFprobe and decoded timing/gap pixels.

## Retained local failures and unavailable result

Both full local Python runs finished205/206:70.286s initially and69.506s in the isolated rerun. The unchanged `test_subprocess_rss_limit_is_enforced` expected a memory-limit error but received a timeout. A separate isolated1/1 retry passed. Local Python3.12.14/Pillow12.3.0 differed from canonical Python3.11/Pillow11.3.0. No cause is established; no source, threshold, test or deadline was changed to hide these failures.

The fresh complete143-case local browser run was observed through138 passing cases with no observed failure before context loss. Its scratch worktree and log are unavailable after the workspace reset. Its final outcome is **unknown**, not a complete local pass. Earlier focused results above remain distinct from the full canonical run below.

## Canonical acceptance

[Run40159697764](https://github.com/twangyal/projects-monorepo/actions/runs/40159697764), job121068474561, completed successfully for exact source `1e685b307881e8ccea7fa7c95aa57f3c877caf13`. Retrieved completed job logs establish:

- Python3.11.17: all206 tests passed in83.797s, including the RSS-limit case.
- All159 TypeScript tests passed, zero failures.
- Ruff, compileall, lint, typecheck and production build passed.
- All143 production browser cases passed in6.4minutes, completed2026-10-25T03:59:43Z, using the fixture separator and real video export.

Canonical success does not erase the two local Python failures or identify their cause. The browser suite uses synthetic fixtures; no real-song recognition quality, physical audio-latency calibration, improved word alignment or intended-user correction-effort acceptance is claimed.

The bounded software milestone is accepted and #327 can close. Karaoke remains ACTIVE against the owner's multilingual automatic-lyrics destination; #241 remains open. Project #8 stays skipped. No PR, dependency, schema or workflow changes were made.
