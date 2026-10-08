# Melody Studio Saved Composition Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep, update, reopen, download and deliberately delete up to eight complete named Melody compositions without changing current-workspace autosave or portable backups.

**Architecture:** A separate IndexedDB store holds exact canonical backup Blobs plus bounded metadata. Store-owned receipts provide per-entry revision CAS; only a selected backup is decoded. A stable library view delegates guarded opening to the existing complete-project commit/history path.

**Tech Stack:** TypeScript, existing native IndexedDB/Blob/Web Crypto and Melody backup/domain APIs, Vite, Node test runner, Playwright/Chromium. No new dependency or backend.

**Spec:** [2026-10-05-melody-composition-library-design.md](../specs/2026-10-05-melody-composition-library-design.md)

## Global Constraints

- Issue #126; Astra; accepted design, implementation and verification pending. The user's autonomous execution authorization removes any approval wait.
- Skip Gaze Nav/catalog #1 and catalog #8 entirely; do not touch frozen Stock #36 or blocked handwriting #82.
- Node **22.18+**; existing TypeScript/Vite/browser stack; no new dependency, service, migration, implicit library save or full-library archive.
- Separate database **`melody-studio.library`**, version **1**, store **`copies`**.
- **8 entries**, **12,582,912 bytes (12 MiB)** each, **100,663,296 bytes (96 MiB)** aggregate backup payload capacity, **16,384 bytes (16 KiB)** aggregate metadata.
- Library labels trim on explicit Save/Update: **1–80 UTF-16 code units**, well-formed Unicode, no C0/C1 controls or U+2028/U+2029; composition titles stay unchanged.
- Existing bounds remain **1–8 tracks**, **256 notes/track**, **8 references**, **882,000 PCM bytes/reference**, **2 MiB document**, **12 MiB backup**, JSON depth **16**, and **64 MiB** unique-audio Undo history.
- **10,000 ms** per library operation; logical cancellation retains native open/transaction drains. Success requires transaction completion. No automatic mutation retries.
- CAS compares a fresh revision plus exact canonical metadata and Blob size/type; selected reads verify SHA. Do not claim synchronous byte-by-byte Blob CAS.
- Current-workspace autosave, saved-copy protection, legacy records, history, backup bytes and exports keep their established contracts.
- Frozen UI IDs: `library-label`, `library-select`, `library-refresh`, `library-create`, `library-update`, `library-open`, `library-download`, `library-delete`, `library-cancel`, `library-status`, `library-details`.
- Root owns Git/GitHub and **all test, browser and service execution**. Agents author disjoint files and report readiness; root runs the listed commands and preserves first results.

## Review Focus

- A title/numeric field still owns focus when Save is clicked: its raw spelling, DOM node and selection survive; Task 3 pins pointer/keyboard admission.
- Two tabs create the last available slot or mutate different entries: capacity stays eight and unrelated writes survive; Task 2 pins native transactions.
- A same-size corrupt backup retains a plausible header: selected integrity checking refuses Open while exact bounded download remains available; Tasks 1 and 2 pin this distinction.
- A valid copy collides with a retained audio ID or exceeds existing history memory: Open refuses atomically without clearing scratch/history; Tasks 1 and 3 pin domain admission.
- Cancellation or page departure races a native commit: no false rollback/saved claim, replay, overlapping native retry or stale editor replacement; Tasks 2 and 3 pin terminal ownership.

---

## File ownership

- Producer: create `apps/melody-studio/src/composition-library.ts`, `apps/melody-studio/tests/composition-library.test.ts` and `apps/melody-studio/docs/2026-10-05-composition-library-store.json`.
- UI: create `apps/melody-studio/src/library-view.ts`; modify `apps/melody-studio/src/main.ts` and `apps/melody-studio/src/style.css`; record `apps/melody-studio/docs/2026-10-05-composition-library-client.json`.
- Oracle: create `apps/melody-studio/tests/library-fixtures.ts`, `apps/melody-studio/tests/library.spec.ts`, and `apps/melody-studio/docs/2026-10-05-composition-library-oracle.json`.
- Maximum author: create `apps/melody-studio/scripts/smoke_library.mjs` and `apps/melody-studio/docs/2026-10-05-composition-library-maximum.json`.
- Root: modify `apps/melody-studio/README.md`, package version declarations if warranted, `PROJECT_IDEAS.md`, and final verification/CI receipts. Existing complete-project modules are consumed, not rewritten.

### Task 1: Preserve exact complete copies through the public library contract

**Files:** Producer files above; read `reference-backup.ts`, `reference-project.ts`, `reference-types.ts`, and `reference-storage.ts`.

**Interfaces:** Consume `validateBundle`, `encodeProjectBackup(bundle): Promise<Uint8Array>`, `decodeProjectBackup(bytes): Promise<ReferenceBundle>`. Produce the exact `CompositionLibrary`, `LibraryEntry`, `LibraryReceipt`, `LibraryReview` and `LibraryOptions` API in the spec; later tasks import it from `composition-library.ts`.

- [ ] **Step 1: Author focused failing contract cases.** For an original complete bundle, saving label `  First take  ` yields `First take`, preserves the composition title/input graph, and returns exactly the original `encodeProjectBackup` bytes on review. Include invalid labels/capacities and forged receipts.

- [ ] **Step 2: Root runs the focused file before implementation.** From `apps/melody-studio`: `node --experimental-strip-types --test tests/composition-library.test.ts`. Preserve the actual absent-behavior failure; a syntax/setup failure is not feature RED.

- [ ] **Step 3: Implement bounded rows, receipts and detached preparation.** Create the exact separate schema; keep opaque receipt authority private. Listing reads no Blob contents. Create/update encode an already detached bundle; `review` verifies selected hash/decode and rechecks identity. Return safely bounded corrupt bytes with `bundle: null`, never broaden existing parsers.

- [ ] **Step 4: Pin selected content and caller-mutation cases.** Mutating input PCM immediately after create/update starts cannot change the captured backup. Mutating a returned bundle cannot change later reads. A deliberately corrupted same-size Blob fails content verification. Test the ordinary preexisting `ReferenceHistory` collision/budget refusal as an integration premise; do not change its limits.

- [ ] **Step 5: Root reruns focused tests and reviews the source diff.** Expected: all authored contract assertions pass. Producer freezes source and records exact first/final results; root stages completed progress when its reviewable gate is satisfied.

### Task 2: Make native library mutations atomic and bounded

**Files:** Producer module/tests; oracle `library-fixtures.ts` and `library.spec.ts` for actual IndexedDB behavior.

**Interfaces:** Use Task 1's API unchanged. `create` checks current count in its transaction; `update`/`remove` consume a selected receipt and return/refuse according to revision CAS. `nativePending` and `close()` retain actual native cleanup ownership.

- [ ] **Step 1: Author independent failing concurrency/terminal cases.** From seven copies, simultaneous creates in two store instances produce exactly one success and eight entries. Independent-ID updates both survive; a stale same-ID delete/update refuses. Also pin deleted-row nonresurrection, quota/abort after put, opaque receipts, malformed catalog, and held native open/transaction drains.

- [ ] **Step 2: Root runs the focused/native selection and preserves the first result.** Author freezes test titles and fixtures before execution. No agent starts a server or browser.

- [ ] **Step 3: Implement transaction and deadline ownership.** Validate/read current bounded rows and enqueue writes synchronously within readwrite callbacks, with no awaited crypto/Blob read. Distinguish native terminal completion from logical timeout; abort where possible, retain drains, and sanitize failures. No automatic mutation replay after uncertain completion.

- [ ] **Step 4: Root verifies unchanged assertions.** Run `node --experimental-strip-types --test tests/composition-library.test.ts`, then the relevant `tests/library.spec.ts` cases with an unused `MELODY_TEST_PORT`. Expected: eight-entry ceiling, independent entries retained, stale mutations refused, unchanged bytes after rollback, and no later mutation before held native cleanup ends.

- [ ] **Step 5: Freeze reviewed storage behavior.** Producer/oracle report hashes and preserved failures; root commits the coherent verified storage/UI slice when integrated. Do not publish an unverified success receipt.

### Task 3: Add the explicit saved-copy workflow without changing the workspace

**Files:** `src/library-view.ts`, `src/main.ts`, `src/style.css`; oracle native files; client receipt.

**Interfaces:** Consume Task 1's public store API and spec IDs. View callbacks must capture `history.snapshot()`, inspect existing busy/scratch/review state, and admit Open via existing `commit(next, text, redraw, document, assets)`. They do not own or replace `ReferenceStorage` or `ReferenceHistory`.

- [ ] **Step 1: Author native workflow and preservation cases.** Cover all seven actions with exact original note/reference graphs. Create/Update leave current backup, saved row, title, raw numeric text, DOM/focus/selection, history and reviews unchanged. Pin confirmation cancellation, recording/native-cleanup guards, protected autosave, same-ID conflicts, and changed-back input during a held read.

- [ ] **Step 2: Root runs new native cases against the absent/incomplete UI.** Preserve the actual missing-control/behavior result. Fixtures must release their own resources and use a unique profile; never clear unrelated user storage.

- [ ] **Step 3: Implement a stable view and operation ownership.** Mount outside `app.innerHTML`; use the exact product copy and IDs. Keep separate library status and label drafts. Save/update capture only committed work; refresh/select never open; download uses the original Blob. Confirm update/delete against their captured selection and retain native CAS enforcement.

- [ ] **Step 4: Implement guarded Open through existing admission.** Block partial/native audio work and pending current saves/reads; resolve or explicitly confirm scratch/reviews. Check epochs/generation/intent after every await and confirmation. Commit before clearing scratch. Preserve no-op Undo/Redo and atomic audio-history refusal. Opening into protected workspace recovery must not grant a saved-copy receipt or enable writes.

- [ ] **Step 5: Pin late and lifecycle cases.** Hold a genuine selected Blob read, then edit, change selection/label, cancel or leave; its completion cannot open/update a newer workspace or change newer status. Cover actual committed-before-cancel uncertainty separately from rollback. A persisted page return requires explicit subsequent actions and remains usable.

- [ ] **Step 6: Root runs focused native cases and static checks.** From the app: `npm run lint`, `npm run typecheck`, `npm run build`, and `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser -- tests/library.spec.ts`. Expected: all original assertions pass and no external requests/page errors; inspect desktop and narrow screenshots. Fix reproduced defects without widening timing/data assertions.

- [ ] **Step 7: Freeze the integrated source.** UI and oracle record ownership, hashes, first failures and limitations. Root commits/pushes complete useful progress after integration review, referencing #126.

### Task 4: Prove the eight-copy capacity and complete restart flow

**Files:** `scripts/smoke_library.mjs`; maximum receipt. Read the public UI contract; do not import production reducers into the independent artifact oracle.

**Interfaces:** Runner consumes a root-owned production origin, the exact library IDs and independently authored complete `.melody.json` files. Freeze its command line/environment and numerical assertions before root execution; publish those commands in its receipt and README.

- [ ] **Step 1: Author original maximum inputs and independent expectations.** Eight distinct compositions each reach eight tracks, 2,048 notes and eight 20-second references. Record each original canonical backup/hash, byte counts and music/reference facts. Separately exercise the existing 12 MiB parser boundary where needed, without claiming padding is musical content.

- [ ] **Step 2: Author one bounded native runner.** Create eight copies, refuse a ninth, update one without touching seven, cancel/delete/recreate deliberately, download every exact saved copy, and restart Chromium fully before reopening each. Instrument Blob reads around Refresh to prove only metadata/handles were inspected. Keep original graphs and independent MIDI/WAV checks on a selected reopened composition.

- [ ] **Step 3: Root executes prepared fixtures, then the frozen runner once against a frozen production build.** Preserve artifacts before inspection/repair. Expected: exact selected bytes and reference samples, eight-entry cap, restart retention, correct independent exported audio/MIDI, no library mutation of the workspace save/recovery contract.

- [ ] **Step 4: Root diagnoses any first failure before changing code or fixtures.** Retain the original result and document whether it is a producer defect, fixture premise or environment limitation. Rerun only the affected gate after a justified correction, then the required integrated gate if source changed.

### Task 5: Complete integrated acceptance and durable publication

**Files:** Root-owned README/package/catalog and `docs/2026-10-05-composition-library-verification.json` / `docs/2026-10-05-composition-library-ci.json` under the app.

**Interfaces:** Consume frozen producer/UI/oracle/maximum artifacts and exact source hashes. Keep project status grounded in the actual finished product, not pending evidence.

- [ ] **Step 1: Review spec coverage and disjoint diffs.** Confirm every public signature/ID matches, no current autosave migration occurred, metadata CAS is described honestly, no parser/history bounds changed, and safe corrupt download does not enable unreadable Open.

- [ ] **Step 2: Root runs the complete project gate sequentially.** From the app: `npm run check`, then `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser` with the verified unique-port setup. Expected: all original and new unit/native cases plus lint/type/build pass. Do not overlap browser invocations or infer acceptance from test counts alone.

- [ ] **Step 3: Root updates usage/evidence documentation.** Explain explicit copies versus current autosave, capacity, conflict/uncertain-write recovery, exact selected download, opening/history limits and nonselected audio behavior. Record exact invocations, hashes, actual first results and maximum artifacts; leave unresolved observations explicit.

- [ ] **Step 4: Root commits and pushes durable verified progress.** Stage only the milestone's reviewed files, reference #126, check remote movement and push Astra without force. Preserve concurrent work. Update the existing draft PR rather than create a duplicate.

- [ ] **Step 5: Root checks published implementation CI and reconciles its actual checkout.** Preserve first push/PR results; fix caused regressions and republish. Close #126 only after real acceptance, attach/update the existing PR evidence, and immediately reassess the next unblocked goal task.

## Plan self-review

Written against the accepted spec. Product/API/row/bounds map to Task 1; transaction/receipt/deadline guarantees to Task 2; all stable IDs, scratch/lifecycle/current-workspace guards to Task 3; complete capacity/restart/export evidence to Task 4; full verification and durable publication to Task 5. All five Review Focus conditions have explicit owning tests. Interfaces retain the spec's names and nullable corrupt-review result. Implementation and every execution checkbox remain pending; no test pass is asserted here.
