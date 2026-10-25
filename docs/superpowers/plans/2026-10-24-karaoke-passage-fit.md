# Karaoke selected-passage fit plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Correct drift across a lyric passage using one explicit target time window, with Undo and saved/exported timings.
**Architecture:** Pure `fitCues(cues,duration,rawStart,rawEnd,passage)` in cue-fit.ts validates a complete dense cue graph, then maps selected boundaries by normalized source position, pins outer endpoints exactly and revalidates. Existing selected-passage contextual controls own two session-only fields. Apply validates before retiring listening/review or recording one draft-history edit; existing backend/save/export schemas stay unchanged.
**Tech Stack:** Existing TypeScript/Node24/Playwright and unchanged Python3.11 service; no dependencies or workflow changes.
**Spec:** #327, docs/PRODUCT_DIRECTION.md section6 and current cue-editor conventions. This is cue-level correction, not audio stretching or new word-level alignment accuracy.

## Global Constraints

Preserve exact words/unselected times/raw drafts/title/paste on refusal and Undo. No clipping or silent overlap/precision collapse; no-op window refuses without history. Existing selected-range identity, busy/save/import guards and explicit Save remain. KaraokeACTIVE/#241open/#8skip/noPR. Inline autonomous execution; no interactive approval.

## Review Focus

- Correct first/last boundaries and all cue/gap proportions, including a single cue/shared endpoints.
- Extreme valid source intervals do not overflow a scale factor; collapsed destinations refuse.
- Outside neighbors, malformed source/raw values and stale selection refuse before listening/history retirement.
- One Undo restores literal raw timing spellings/title/paste and Redo reapplies saved/exported timing.
- Native phone selection, save/SRT/video/reload, invalid raw field retention and live-listening refusal.

## Task1 — proportional passage correction

- [x] Baseline154,4modelREDmissingmodule→GREEN; nativeREDmissingcontrol.
- [x] Pure fit/model admission; review positive-gap collapse regressionRED→GREEN added.
- [x] Contextual guarded UI;4focused native cases pass21.1s including decoded video.
- [x] Final159TSunits/static/build,compileall; fresh reviewImportantgap repaired onepass. LocalPython205/206twice andseparateRSS1/1 retained;fullnative/canonicalpending. Source/docs/roadmap connected commit.
- [ ] Observe canonical gates; actual acceptance and issue closure or durable pending handoff.

## Ledger

Clean linked detached worktree reused at68ff328; all recent canonical project workflows pass and no PR/open task implementation is pending. #300's bounded terminal-clock research is complete with cause still unresolved; it does not justify a shipping workaround. Selected affine fitting closes a correction gap beyond existing uniform shift/copy/split/merge. Automatic multilingual evaluation remains#241open.

Baseline154TSunits;4newmodel cases RED missing module→GREEN. First nativeRED missing fit control. A post-implementation native expectation assumed an unchanged numeric boundary would be reformatted; existing raw-timing preservation correctly keeps1.500, and the fixture now asserts that literal value. No product change or weakened guard.

Review has no Critical/Minor. Important positivegap precision loss fixed with modelRED/GREEN and native pre-effect refusal; complete159Node suitegreen. Review boundaries: actual native/Python/CI gates recorded by executor onlyafterobservation; broader real-song/physical/intended-user acceptance remainsunverified. No rereview.
