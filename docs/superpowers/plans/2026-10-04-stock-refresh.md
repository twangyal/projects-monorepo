# Stock Notebook Reviewed CSV Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update a complete supplied annual universe while retaining reviewed committed research and making incompatibilities, changed company details and data loss explicit.

**Architecture:** A pure refresh engine validates/diffs two bounded snapshots and builds a canonical v2 replacement with explicit decisions. A separate pure report exports the proposed change review. Existing browser staging, history and ordered IndexedDB persistence publish one fully preflighted transition; no new service or persisted schema.

**Tech Stack:** Existing TypeScript/Vite, Node 22.18+ (CI Node 24), DOM/IndexedDB/File APIs, node:test and production Playwright Chromium. No new dependencies.

**Spec:** [Reviewed CSV refresh design](../specs/2026-10-04-stock-refresh-design.md); issue [#56](https://github.com/twangyal/projects-monorepo/issues/56).

## Global Constraints

- Whole CSV replacement only; every retained financial row/provenance belongs to the incoming file. No merge, issuer inference, external fetch, FX or generated analysis.
- Notebook schema 2; preserve notebook ID/title and existing v1 read-only migration, database location, backup/recovery/reset and complete-replacement flows.
- 2 MiB CSV; 500 annual rows; five periods per ticker; 4 MiB notebook; 8 MiB report; 100 watchlist entries; four comparison entries; 100 notes of 4,000 Unicode code points each; 16 filters; 30 history states within 8 MiB.
- Explicit date for every calculation/publication; review binding must match current generation, editor intent and UTC day after final confirmation.
- Retention decisions are exact/complete for changed annotated groups. Unsent drafts block Apply; no silent cleanup, criteria repair, note truncation or lost-reference migration.
- One immutable dataset per history; successful refresh starts new history. Persistence failure retains refreshed memory and last durable record with honest retry/backup status.
- Root owns Git/issues/docs/config/CI and shared build/server scheduling. Workers do not commit or run competing builds. Excluded projects, concurrent recovery work and frozen #36 remain untouched.

## Review Focus

- Editing a note after a completed review must stale its old decisions, not lose the new research on Apply.
- File/row/filing-link changes must not be called financial changes or assigned the wrong enclosing filename.
- New matched currencies can invalidate a previously valid monetary sort even when the filter vocabulary still exists.
- Losing old periods or moving the latest period backward must be visible even when the ticker and notes survive.
- An old native write finishing after publication must not clear the newer refresh's unsaved warning; failed writes preserve durable raw data.

---

## Task 1: Pure review and replacement engine

**Files:** Create `apps/stock-notebook/src/refresh.ts`, `apps/stock-notebook/tests/refresh.test.ts`.

**Interfaces:** Consume existing `validateNotebook`, `validateDataset`, `validateScreen`, `validateToday`, `parseQuery`, `screenDataset`, `latestCompanies` and existing persisted types. Export exactly all types plus `reviewRefresh(base: Notebook, incoming: Dataset, today: string): RefreshReview` and `applyRefresh(base: Notebook, incoming: Dataset, choices: RefreshChoices, today: string): Notebook` in the spec. Other workers import types from this module; publish signatures first.

- [ ] Write failing tests named `source_only_reordering_is_not_a_fact_change`, `latest_metadata_and_provenance_require_exact_annotated_decisions`, `retention_preserves_order_text_and_known_references`, `incompatible_query_can_clear_without_changing_applied_screen`, `incoming_matches_can_break_money_sort`, and `failed_or_oversized_application_keeps_inputs_detached_and_unchanged`. Assert exact period endpoints/field order, union bound 1,000, annotation bound 204, absent/extra/duplicate decisions, null versus zero, synthetic transition, backward date and unchanged source ordering.
- [ ] Run `node --experimental-strip-types --test tests/refresh.test.ts` from the app; observe failure from missing behavior before implementation.
- [ ] Implement strict detached review and choice validation, three independent criteria previews, canonical annotation filtering and final full-notebook validation. Never fetch a clock or use random metadata beyond the incoming dataset already created by UI.
- [ ] Run the focused engine tests plus existing `tests/model.test.ts`, `validation.test.ts`, `periods.test.ts`, `history.test.ts`, `query.test.ts`, `research.test.ts`; require all pass. Send API readiness and exact verification to root/report/UI owners.

## Task 2: Complete source-accurate refresh report

**Files:** Create `apps/stock-notebook/src/refresh-report.ts`, `apps/stock-notebook/tests/refresh-report.test.ts`. Storage integration tests may extend `tests/browser/storage.spec.ts`/native harness after coordination; do not change storage implementation without a reproduced defect.

**Interfaces:** Consume Task 1's engine and frozen types. Export `buildRefreshReport(base: Notebook, incoming: Dataset, choices: RefreshChoices, today: string): string`. Reuse existing validation/serialization and 8 MiB report bound; existing research exporter remains unchanged.

- [ ] Write failing tests named `report_retains_every_endpoint_under_its_own_filename`, `full_literal_annotations_and_explicit_resolution_are_retained`, `report_is_proposed_not_an_applied_transaction`, and `invalid_choices_or_byte_excess_publish_no_partial_report`. Assert all period keys once, source-only changes separately, synthetic and units disclosure, exact selected criteria, removed notes including Unicode/markup, deterministic date/IDs and immutable inputs.
- [ ] Run `node --experimental-strip-types --test tests/refresh-report.test.ts`; observe RED.
- [ ] Implement full bounded plain-text output from engine snapshots and selected resolution, checking UTF-8 bytes incrementally before returning. Do not introduce a persisted audit or rewrite note content.
- [ ] Run focused report plus existing `tests/exports.test.ts`/`storage.test.ts`. Where useful, extend native fixtures to prove v1 raw text is untouched by loading/review and a failed explicit refresh save retains it, while successful save writes/reopens v2.

## Task 3: Full refresh editor flow

**Files:** Modify `apps/stock-notebook/src/main.ts`, `apps/stock-notebook/src/style.css`; optionally create `src/refresh-view.ts` to isolate the bounded provenance-aware review renderer.

**Interfaces:** Consume Task 1/2 APIs, existing `parseCsv`, `createDataset`, `NotebookHistory`, `NotebookStore` and `serializeNotebook`. Own all DOM/generation/intent/confirmation state. Stable selectors and accessible action labels are frozen in the spec; coordinate them with Task 4 before production runs.

- [ ] With Task 4, obtain RED for committed research currently being cleared by replacement, stale completed-review decisions, and premature publication/save status. Browser owner writes/executes acceptance tests; UI owner supplies source readiness without competing builds.
- [ ] Implement isolated CSV-refresh staging with one detached reviewed base/incoming dataset/date and bounded 50-row review pages. Render old/new facts with explicit provenance rather than global active-notebook filename. Keep original editor/imports usable.
- [ ] Implement required retention choices, three criteria actions/errors, units/loss acknowledgement, previous-notebook/proposed-review downloads and final confirmation. Block Apply on unresolved editor drafts; confirmed discard restores only draft fields and rebuilds. Bind both pending and completed reviews to generation/intent/date; Rebuild resets choices/acknowledgements while reusing the validated incoming dataset. Explicitly invalidate on `interpretCriteria()`; update readiness after existing save handlers clear dirty flags, without rebuilding focused controls. Reset loss acknowledgement after a retention choice changes.
- [ ] Preflight full candidate/results/new history before one publication; allow `publish` an explicit captured date. Preserve existing save queue, matching-generation status, retry/raw recovery, beforeunload guard, current JSON/research exports and old state/history on rejection/cancel.
- [ ] Run `npm run typecheck` and `npm run lint`; send integration readiness. Fix only reproduced issues and preserve active form focus/drafts during unrelated review rendering.

## Task 4: Independent arithmetic/data and production acceptance

**Files:** Semantic-oracle owner creates `apps/stock-notebook/tests/oracle/refresh-fixtures.ts`, `tests/refresh-oracle.test.ts`. Separate browser owner creates `tests/browser/refresh.spec.ts`, with existing native storage tests/harness extensions only after coordination. Existing workflow/storage suites remain intact.

**Interfaces:** Import public engine only as the system under test. Expected diff fields, retained references/text and criteria results must come from independently authored fixtures/explicit assertions, not production review/apply/report outputs. Use real native File reads, IndexedDB and downloaded artifacts; no private application-state hooks.

- [ ] Author original old/new fixtures with unchanged and changed paired periods, source reordering, added/removed/older latest dates, missing amounts, changed metadata/currency, synthetic transition and maximum annotations. Write explicit independent expected data before calling production helpers.
- [ ] Run independent tests against the initial implementation/stubs and record meaningful failures. Cover exact decision admission, 500/501 rows, fifth/sixth period, 2 MiB input and 4 MiB candidate boundaries without relaxing existing validators.
- [ ] Write production flows named `refresh_retains_research_and_reopens_exact_download`, `changed_company_details_and_removed_periods_require_review`, `invalid_saved_query_and_money_sort_require_deliberate_resolution`, `completed_review_stales_after_new_editor_input`, `native_late_reads_cancel_without_erasing_drafts`, and `failed_native_refresh_save_preserves_raw_record_until_retry`. Exercise current labels, whole-data provenance, dirty title/query/filter/note fields, confirmation decline, history reset, read-only legacy migration, failed writes and old queued completion.
- [ ] Add controlled UTC rollover between review/final confirmation, actual 500-row/1,000-union pagination, keyboard/mobile decisions, literal hostile content, real previous/proposed/new JSON/TXT artifacts and no external requests/page errors.
- [ ] With root's port 4271/build slot, run `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser -- tests/browser/refresh.spec.ts --output=/tmp/stock-refresh-focused` (or installed Playwright Chromium). Report exact RED/GREEN and artifacts; do not weaken source/retention expectations to match implementation.

## Task 5: Independent review and full integration gate

**Files:** Root owns `apps/stock-notebook/README.md`, measured evidence under its docs, catalog progress and existing CI/config only if needed. No worker Git/config changes.

- [ ] Review engine decision admission, UI completed-review binding, preserved drafts, explicit date, source naming, v1 raw retention, actual transaction completion and report completeness against this spec. Reproduce concrete findings before fixes and keep targeted regressions.
- [ ] Run `npm run check` and the complete `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser -- --output=/tmp/stock-refresh-full` in the app, preserving existing 111-unit/22-browser baseline plus new coverage. Check exact returned counts; do not assume old documentation counts are current.
- [ ] Independently inspect downloaded before/proposed/after artifacts, source links/lines, loss text and actual native reload. Measure one maximum 500-row refresh and review pagination on desktop/mobile; record local timings as observations, not cross-device guarantees.
- [ ] Root documents actual behavior/limits/evidence, reconciles current remote work, commits/pushes without force, verifies exact-source path-scoped CI and closes #56 only after its complete acceptance. Keep original AI intent and frozen #36 limitation truthful; reassess the next coherent milestone.

This plan is documentation only until root releases implementation after contract review. Existing autonomous authorization governs execution; no additional user approval is requested by these docs.
