# Native month/week Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Autonomous main integration authorized; no PR.

**Goal:** Complete monthly/weekly fields through the extension (#325).

**Architecture:** Explicit literal month YYYY-MM/week YYYY-Www and kind-specific Undo. Extend existing snapshots/temporal setter/controller with separate bounded histories. Detached native controls enforce calendar/min/max/step before focus/events; retained-value verification stays shared. No custom roles/relative/locale parsing.

**Tech Stack:** Existing JavaScript/Chrome extension/Playwright; no dependency/permission/workflow/deadline changes.

**Spec:** PRODUCT_DIRECTION.md section1/#325. Native browser is calendar authority; uppercaseW/four-digit years for new values. GazeACTIVE/#132open/#8skip.

## Review Focus

- Typed intent must not fall through to other input kinds/text.
- Invalid ISOweek53 and min/max/step bases refuse before live effects.
- Empty/no-op/overlapping Undo and per-kind histories stay exact.
- Stale roles/types/values/frames/locks/focus callbacks must preserve identity.
- Clarification/confirmation/cancel/site overrides and injected-extension behavior remain honest.

### Task1

- [x] Currentmain eb05b93/clean linked detached worktree/open issues/PRs/direction;217baselineunits pass.
- [x] Eight intent tests (6RED/2existing refusal passes); controlled pre-feature interpreter reversion produces2native period REDs; restoreGREEN.
- [x] Descriptions/snapshots/setters/history/interpreter/help/extension tests;225unit/static/build and96focused native pass.
- [x] Final228unit/static/build/56native checks; fresh review and one necessary fix pass. Full canonical780/780 passes on source`a26b195` (run40136272669).
- [x] Connected-tool source commit `a26b195`, checkpoint/roadmap; final canonical acceptance documented; close#325; physical#132 remains open.

## Ledger

No incomplete source from prior run. Known#300 independent; owner-deferred Shot/Composure/#8 excluded. Reuse existing clone/exact calendar admission/focus/retained-value helper. Physical speech/gaze/intended-user acceptance remains unverified. Local setup path error corrected before product edits.

Task1progress: corrected an early fixture old time-action expectation and overlap expectation before acceptance. Controlled reversion is the accepted nativeRED evidence; final225units/syntax110/extension build and96native cases pass40.2s. Local680non-installed-extension/full772canonical cases pending. Portable extension limitation is explicit; no workflow/deadline edits.

Fresh read-only review: Important explicit-period grammar fallback fixed in one RED/GREEN pass; new native competing-control checks added. Minor direct value/default step-base and long-existing-year Undo coverage deferred and recorded in project checkpoint. Full local/canonical outcomes pending; no rereview, physical #132 unchanged. Final suite now780 including installed-extension cases.
