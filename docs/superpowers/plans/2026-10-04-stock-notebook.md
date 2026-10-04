# Stock Notebook implementation plan

Issue #32 · `apps/stock-notebook` · Astra. The user authorizes autonomous implementation. Root releases work after final contract review and owns all Git, issues and integration.

## Outcome and authoritative contract

Deliver a real annual-financial CSV → inspected interpretation → applied filters → shortlist/evidence → comparison/watchlist/notes → backup/report → reopen flow. Read `../specs/2026-10-04-stock-notebook-design.md` before implementing. Its final types, arithmetic, grammar, caps and error behavior are authoritative; do not create competing interfaces.

This milestone is an explicitly deterministic offline screening baseline for idea #13. Facts are supplied by the user, ratios are computed from visible inputs and observations follow documented rules. It does not claim AI interpretation, generated financial expertise, forecasts, live data or learned investment quality. The catalog remains ACTIVE for broader scope.

## Ownership and dependency order

- **git_history_review:** `src/types.ts`, `src/validation.ts`, `src/model.ts`, `src/history.ts` and associated pure tests/fixtures. Publish types, limits and shared validation APIs first. Validation imports types only; CSV/query/research depend on validation; model may consume query/research for operational validity without a cycle. Own strict JSON, detached notebook records and bounded history with the immutable dataset stored once.
- **audio_engine:** `src/csv.ts` and associated pure CSV tests. Own fatal UTF-8 decoding, complete CSV syntax/schema validation, filename/line provenance and creation of a detached dataset. No partial import, implicit units or silent duplicate/latest-row selection.
- **git_reader:** `src/query.ts`, `src/research.ts` and associated pure tests. Own full-consumption language interpretation, explicitly expanded thresholds, exact metric filtering/sorting, freshness, comparison and deterministic source-linked observations. No network/data inference or scoring model.
- **recorder:** `src/storage.ts`, `src/exports.ts`, `src/demo.ts`; their pure tests; `tests/storage-harness.{html,ts}` and `tests/browser/storage.spec.ts`. Own ordered actual IndexedDB reads/writes/clear/raw recovery, plain-text research export, and original fictional demo. Publish `createDemoDataset(today:string):Dataset` plus `blankCsvTemplate():string` (the latter belongs to CSV owner) to the UI owner. The demo always carries synthetic provenance.
- **next_project_assessment:** `src/main.ts`, `src/style.css`. Own the complete accessible workspace and staged import/query/edit flows. Publish a coherent CSV/demo/shortlist shell early, then integrate comparisons, notes, history, export and recovery. The user must see applied criteria and reporting assumptions; uncommitted drafts cannot be overwritten by late import/restore responses.
- **git_runner:** `tests/independent-research.test.ts`, fixtures under `tests/oracle/`, and `tests/browser/workflow.spec.ts`. Own independent arithmetic/freshness/order/provenance expectations and actual production workflows with real CSV, IndexedDB, downloaded JSON/text and reload. Build expected results independently of production calculation/parser helpers.
- **root:** package/lock/config/index, README, CI, catalog, runtime evidence, plan, all GitHub/Git actions and final integration. Development port 4270; full production browser suite 4271; test-only storage harness is excluded from normal production builds.

Pure tests may run concurrently. Coordinate any shared production build/server through root so one owner's output is not overwritten by another. Isolated temporary configurations/output directories may use agreed distinct ports. Owners fix findings in their own files; reviewers send concrete reproductions. No subagent commits independently.

## Task 1: data model and recovery semantics

- [x] Write meaningful failing checks for exact schema/keys, real dates, canonical IDs/tickers, five monetary inputs, signed versus nonnegative values, valid large six-decimal amounts, null versus zero, URLs and bounded references.
- [x] Publish shared types/limits/validation; preserve detached input and atomic errors. Use the reviewed decimal round-trip rule, not a fixed scaled epsilon that rejects legal values.
- [x] Implement strict bounded JSON and notebook creation/serialization; persisted query must parse and applied screens must remain operationally usable according to the contract.
- [x] Implement edit-state history with 30-state/8 MiB limits and no repeated dataset storage. Verify branching, no-op commits, different-dataset rejection and isolated returned states. History commit/undo/redo receive the same explicitly captured current UTC date as the UI calculation; include the 548→549-day midnight eligibility regression.

## Task 2: complete source import

- [x] Exercise actual UTF-8/BOM/CRLF/quoted-comma/escaped-quote inputs, physical row provenance, malformed fields/records, blank/missing values, duplicate identities, invalid dates and exact row/byte limits.
- [x] Implement complete parsing and shared validation before returning any preview; explicit currency-millions/annual-basis confirmation belongs to the UI staging flow.
- [x] Provide header-only template and original unit fixtures; imported facts remain unverified and links are never fetched.

## Task 3: visible interpretation and research calculations

- [x] Test every grammar branch/operator/unit/shortcut, quoted sectors, unsupported suffix/OR/negation and exact limits; never accept a recognized prefix of unsupported criteria.
- [x] Implement staging-compatible QueryResult with visible expanded thresholds and explicit currency/sector/sort controls.
- [x] Independently test ratios, null/zero/negative denominators, six-decimal boundaries, current 548/549-day freshness, ties, null-last sorts, money-currency refusal and comparison warnings.
- [x] Implement observations with stable codes and exact raw-field provenance; distinguish reported facts, derived ratios and rule-based strengths/risks/uncertainties. Use effective filters in every result/export.

## Task 4: persistent notebook and real exports

- [x] Test actual IndexedDB transaction completion/order, corrupted text/object records, raw backup, clear, quota/blocked/unavailable behavior and queue recovery.
- [x] Capture validated immutable snapshots at save invocation and serialize operations; failure retains the previous committed record and never claims success.
- [x] Implement plain-text report with current evaluation date, synthetic marker, source file/row/link, formulas/inputs, missing reasons, exact applied criteria, comparison and annotations.
- [x] Build the fictional demo with intentionally varied currencies, missing values, leverage, margins and reporting dates. Verify its synthetic label survives all exports/restores.

## Task 5: complete browser workspace and independent acceptance

- [x] Root establishes isolated Node/TypeScript/Vite/Playwright tooling, self-only page policy, documentation and scoped CI.
- [x] UI stages import review, units/basis confirmation and explicit replacement; CSV/JSON failures or canceled confirmation retain the current notebook/history/storage.
- [x] UI interprets criteria without applying silently, supports equivalent manual editing, validates screen computation before publication, preserves invalid drafts, and shows stale/missing exclusions.
- [x] UI provides company evidence details, currency/date-aware comparisons, watchlist, notes, undo/redo, title, template, actual backups/reports and local save/retry/raw-recovery/reset states.
- [x] Browser checks use real files and downloads through the full flow, keyboard/mobile layouts, literal hostile text, no external requests, delayed native file reads/restore, and persistent-storage failures.
- [x] Independent reviewer checks financial semantics and state races after implementation; owners resolve material findings with regressions.
- [x] Root measures maximum 500-row import/screen/report latency on actual Chromium, inspects desktop/mobile output and records measured facts without broad performance claims.

## Durable milestone

- [x] Final unit, lint, typecheck, build and production-browser gates pass; README/schema/example and runtime evidence match the delivered scope.
- [ ] Review scoped diff, fetch concurrent Astra changes, commit and push without force; retain excluded projects untouched.
- [ ] Check CI, update #32 to actual milestone completion and update draft PR #12. Keep catalog #13 ACTIVE for broad language/generated outlook/live coverage.
- [ ] Reassess and immediately continue the highest-value unblocked work.

## Review focus

The main failure modes are missing values becoming zero, mixed currencies being numerically ranked, illegal period comparability claims, source facts turning into unsupported prose, partially accepted language, stale filters driving exports, and late reads/saves overwriting edits. The separate validation, research, UI and independent browser/numerical owners each verify these at their boundaries. Corrupt storage is a recovery case, not permission to overwrite user work.
