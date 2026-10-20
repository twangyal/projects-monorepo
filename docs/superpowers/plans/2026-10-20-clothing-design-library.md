# Clothing Saved Designs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Save/reopen several complete named design copies from the3D workspace.
**Architecture:** Separate immutable IndexedDB library with metadata/payload stores; contextual mounted dialog; reuse existing Project JSON/media validation and owned backup-adoption path.
**Tech Stack:** Existing TypeScript, native IndexedDB/dialog, Vite, Node tests and Playwright; no dependencies.
**Spec:** `docs/superpowers/specs/2026-10-20-clothing-design-library.md`.

## Global Constraints
- At most12 copies, existing6MiB serialized-project limit;1–80 printable trimmed name characters, case-insensitive uniqueness.
- Preserve Project schema/current autosave database, complete graph, raw fields, history and ownership. No automatic application or overwriting copies.
- Atomic two-store mutations; native terminal outcomes;10second open/transaction deadlines; no clearing on failure.
- Follow AGENTS.md, main canonical, no PR, no paid service and skip project#8.

## Review Focus
- A concurrent same-name/cap save must not overwrite another copy (native transaction test).
- Saving captured work while editing cannot apply older data or clear newer name drafts (native held-decode test).
- A late selected read after raw input/Undo must not replace newer work (native held-read test).
- Invalid/decode/quota/blocked storage must retain current design and previous copies (pure/native failure checks).
- Closing a phone modal must retain fields and restore focus; selected backup bytes must stay captured (native keyboard/download test).

### Task1: Atomic immutable library persistence
**Files:** create `apps/clothing-studio/src/design-library.ts`; test `tests/design-library.test.ts` and native `tests/design-library.spec.ts`.
**Interfaces:** `DesignReceipt={id,name,savedAt,bytes}`; `listDesigns():Promise<DesignReceipt[]>`; `saveDesign(name:string,project:Project):Promise<DesignReceipt>`; `readDesign(receipt:DesignReceipt):Promise<Project>`; `deleteDesign(receipt:DesignReceipt):Promise<void>`; pure `validateDesignName`/`validateDesignReceipt`.
- [x] Write pure name/receipt/size detachment cases and native real-IDB save/read/delete/duplicate/cap/concurrent/failure cases; observe RED.
- [x] Implement separate DB/stores, Project/media admission before writes, native atomic transactions and receipt/byte verification. Observe focused GREEN and project unit suite.
- [x] Commit durable implementation to issue task branch.

### Task2: Usable workspace library
**Files:** create `src/design-library-view.ts`; modify `src/main.ts`, `src/workspace.ts`, `src/style.css` only if needed; extend native tests.
**Interfaces:** `mountDesignLibrary({current,guard,open,download})` mounts `#design-library`; main's async `open` uses `beginLoad`, `readDesign`, `adoptLoad` and `finishLoad`. The guard checks all existing draft groups and current load/gesture/export state.
- [x] Write native complete-design Save/open/Undo/Redo/reload/download, held save/read retirement, raw draft and phone focus cases; observe RED before implementation.
- [x] Implement mounted status/selection/name/actions; keep text via textContent and preserve independent captured operations. Add Saved designs to workspace modal panels.
- [ ] Run focused gate, inspect desktop/phone, then complete project checks/browser suite. Preserve every observed failure and repair its cause.
- [ ] Update README, portfolio direction/roadmap and actual verification receipt; commit.

### Task3: Review and canonical integration
- [ ] Independent review of final source, fix important findings with regressions, run required source gate.
- [ ] Compare exact local/remote tree and integrate verified task history to main with a lease. Record verification limitations truthfully; no PR.
- [ ] Close #295 only for the actually completed bounded milestone; report canonical CI and retain broader ACTIVE/physical gates.

## Execution ledger

Task1: complete — baseline161units; new pure admission2tests pass, then all163project units/lint/build pass. Three native storage cases observed RED at unimplemented API, then all5 native cases pass (8.2s), covering real complete-copy/read/delete/reload, independent concurrent writes, case-insensitive duplicate/cap refusal, stale receipt/corrupt payload, native quota rollback and queued-transaction deadline/no late publication. Existing autosave remains untouched. Task2 consumes the declared persistence signatures without interface changes. Native harness is test-only through the existing build flag.

Task2 checkpoint: complete UI implemented. Native UI RED was missing Saved designs action after valid complete-project import. Focused GREEN: all9 storage/UI browser cases (19.6s); project163units/lint/TypeScript/build pass. Complete snapshot/selected JSON/Undo/Redo/autosave reload, canceled/confirmed deletion, blank raw draft refusal,390×740 containment/Escape focus, held native image decode during save and selected read all verified. Phone capture inspected; no overflow. Status belongs inside the mounted panel, so no unused `notice` injection is needed; main retains existing global guard notices. Full browser gate and independent review pending.
