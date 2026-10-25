# Remove unwanted lyric passage implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove adjacent unwanted recognition lines as one recoverable unsaved edit.
**Architecture:** Reuse selected first/last passage identity and complete existing history. Pure removeCues validates range/structure, preserving literal survivors; UI maps raw timing drafts before removal and invalidates obsolete operations only after admission.
**Tech Stack:** Existing TypeScript DOM app, Node tests, Playwright native media/Python service.
**Spec:** Issue #330 and product direction Karaoke automatic recognition/correction loop.

## Global constraints

No audio/source-recognition changes, paid service, PR or automatic save. KaraokeACTIVE/#241open/#8skip. Invalid selected cues can be deleted; unrelated invalid survivor drafts remain visible/save-blocking. Empty cue list is allowed.

## Review focus

- Stale/reversed/missing range refuses without consuming history or stopping listening/review.
- Invalid selected and survivor raw drafts keep their intended recovery behavior.
- One Undo/Redo restores exact title/paste/timing spellings and all removed words.
- All-lines removal and follow-up selection reset remain usable on phone.
- Save/reopen/SRT reflect survivors only; server state stays unchanged before Save.

### Task1: Passage removal vertical slice

Files: src/cue-edit.ts,src/main.ts,tests/cue-edit.test.ts,tests/cue-edit.spec.ts,README/checkpoint/roadmap.
Interface: removeCues(cues:Cue[],passage:CuePassage):Cue[]; no survivor normalization.
- [ ] Baseline check; write missing function/native action RED.
- [ ] Implement pure slice and selected-passage UI/ownership/history integration.
- [ ] Units/static/build plus focused native desktop/phone/save/history/refusal; full project gates.
- [ ] One fresh readonly final review and one Important/Critical RED→GREEN fix pass, no rereview.
- [ ] Commit through connected GitHub; track canonical results and actual remaining work in #330.

## Ledger

Ruling: reuse existing passage selection rather than introduce another range widget; correction tools stay in Shift lyric timing. Cost: removal discovery uses that existing panel. Inline execution under noninteractive authorization. No shared interfaces across tasks (one cohesive unit).
Baseline160units; missingremoveCues API RED then161units/static/build GREEN. Fresh review1Important: handler accidentally registered inside control refresh; native success-status regression RED against built prior source, move listener once to module scope, final161units/static/build GREEN. One fix pass/no rereview/noMinor. Initial native fixture corrections and setup mistakes retained in app checkpoint. Local Python205/206 failure in unchanged RSS enforcement test (timeout instead of memory limit), no retry. Final native/full canonical pending.
Ruling: physical-phone/recognition acceptance and full-gate claims are excluded from code review; rely on actual executor/CI checks and keep#241open. Cost: software viewport tests do not guarantee physical usability.
