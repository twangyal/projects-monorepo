# Chord voicing Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline; owner authorizes autonomous noninteractive decisions, main integration and no PR.

**Goal:** Explore octave voicings by moving one chord boundary voice, without tedious individual pitch edits (#320).

**Architecture:** cycleChordVoicing(Composition,trackId,noteId,direction:unknown):Composition validates a complete independent graph, finds distinct exact-onset melodic voices, and moves the lowest up or highest down by the smallest positive12-semitone multiple putting it strictly outside the chord's opposite boundary. Ordinary note identity/expression and consumers remain intact. Two guarded buttons join the existing selected-note chord panel.

**Tech Stack:** Existing TypeScript/Vite/Canvas/WebAudio/MIDI/WAV; no dependencies or format changes.

**Spec:** #320 and PRODUCT_DIRECTION.md section3. Autonomous choice: explicit boundary-cycle controls over a key-inference assistant or multi-note selection system. Wide voicings can require more than one octave; exact12-semitone spacing must not create unison duplicates. This is authored pitch-class-preserving placement, not learned harmony or automatic voice leading.

## Global Constraints

C2–C7 / MIDI36–96, exact onset grouping, complete project admission, existing limits/drafts/reference/history guards. Do not change recording #300, workflows or deadlines. Melody remains ACTIVE; #8 skipped; no PR.

## Review Focus

- Exact octave gaps require one additional octave to pass the opposite voice.
- Wide chords and unsorted storage order must move the pitch boundary, not selected/index-first note.
- Only the moved voice must avoid newly introduced external same-pitch overlap; touching boundaries are legal, unrelated existing overlaps remain.
- Full malformed graphs/drums/unisons/singleton/stale selections and out-of-range placement refuse atomically.
- Raw drafts must refuse pointer/keyboard activation before blur; history/export/reference identity remain.

### Task1: complete chord-cycle action

Files: new src/chord-voicing.ts, tests/chord-voicing.test.ts and .spec.ts; src/main.ts integration, README/checkpoint/roadmap.

- [x] RED helper: literal up/down expected graph; wide/exact-octave bounds; stale/malformed/drum/unison/singleton/direction/collision/capacity. Confirm baseline463 units.
- [x] Minimal helper implementation; GREEN geometry/full units. Native RED missing action then guarded UI in existing chord panel and both activation lists.
- [x] Native ordinary project/backups/reference/MIDI/WAV/history/reload, refusal/drafts/focused phone checks. Preserve initial failures and actual verification scopes.
- [x] Full project checks/native gates, fresh review and connected-tools source commit.
- [x] Observe canonical CI; root-only final receipt/roadmap/issue state reflecting actual gates.

## Ledger

Pre-flight: helper consumes Composition and returns a validated independent Composition; commit preserves reference document/history. Existing renderer/exporters consume ordinary pitch fields unchanged. Current source402ee0b; Motion #319 code is complete, local283unit/209browser gates pass, hosted CI pending. No PR.

Task1 progress: baseline463units pass; missing-module RED then6helperGREEN; native missing actionRED.469units/lint/build pass; first2nativecases pass8.9s. Three final cases included in full267browser invocation. Freshreview no blockers and independently6helperpass; no independent browser claim.

Task1 complete: source c6be69e; local and canonical469units/static/build/all267browser pass. See docs/2026-10-24-melody-chord-voicing-acceptance.md. Original capture-study artifacts for separate #300 were lost before commit; they are not part of #320 acceptance.
