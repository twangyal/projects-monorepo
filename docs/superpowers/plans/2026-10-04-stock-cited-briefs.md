# Stock Notebook cited company briefs implementation plan

Issue: [#67](https://github.com/twangyal/projects-monorepo/issues/67). Authority: [reviewed design](../specs/2026-10-04-stock-cited-briefs-design.md). Reviewed and frozen; root explicitly releases the assigned producers after this documentation commit. No new dependencies, services, model inference or source fetching.

Baseline independently verified by root:149 unit tests,34 native browser tests, full check/build; unchanged source/test/config/package hashes recorded in `/tmp/stock67-baseline-99fz31c5/verification.json`. Existing annual-history, refresh, recovery, old-note and deterministic-screen behavior must remain.

## Ownership and sequencing

Four producers own disjoint files below. Root owns package/version/config/docs, narrowly necessary existing-test schema fixture updates, the storage.ts error-copy change from4 MiB to the shared6 MiB limit (no transaction redesign), shared build/port coordination and Git. Producer additions use new test files; do not rewrite old expectations merely to obtain green results. Two independent reviewers own their new oracle/native tests and read-only source reviews. No producer writes another owner's files; coordinate a contract correction before implementation divergence.

1. Domain/schema owner publishes types, constants and callable throwing signatures first. Other owners can compile imports, but no readiness claim until genuine implementation passes tests.
2. Each producer writes meaningful failing cases against frozen contracts, records RED, then implements and records scoped GREEN. Independent oracle fixtures are written before reading producer implementations.
3. UI owner coordinates an initial missing-control native RED with browser owner before publishing the shell. No competing shared builds; root assigns Stock port4271 and dist exclusively.
4. Integrate coherent actual APIs, run all old/new checks, then native acceptance. Root approves release only after evidence and independent review; agents do not commit/push/create issues.

## Producer 1 — Domain, schema and migration

Own `src/types.ts`, new `src/brief.ts`, `src/model.ts`, narrow `src/validation.ts` source-URL export; new `tests/brief.test.ts` and `tests/brief-migration.test.ts`.

Publish exact design types, schema3, BRIEF_LIMITS, legacy4 MiB/new6 MiB constants and the six brief APIs. Keep brief.ts dependent only on types/validation/periods, not model or reports. Export the existing filing URL validator under validateSourceUrl and use that same policy for CSV filing links and supplied excerpts. Preserve prior notes and screening validation.

Implement literal Unicode admission, dense exact-key graphs, UUID identity/reference checks, bounded detached annual capture, immutable existing citation updates and exact-period drift. Distinguish selected financial values, issuer identity and import/source metadata. Financial snapshots retain all raw Company fields and dataset provenance. Source-only/uncited briefs are valid; no automatic attachment or semantic verification.

Add v1/v2 migration before adding briefs, preserving v1 unique-ticker rejection and legacy raw/canonical ceiling. Canonical3 and editState extraction include briefs. Demonstrate a genuine accepted near4 MiB old notebook still migrates; no arbitrary fixture that the old validator rejected. Test null/zero and independent priorRevenue, literal astral/CRLF, identity/source-only drift, missing exact year, unknown/accessor/sparse/orphan/duplicate graphs, immutable mutation and detach-before-delete, all graph/count/byte/date bounds. Rejection never mutates inputs.

Scoped verification: `node --experimental-strip-types --test tests/brief.test.ts tests/brief-migration.test.ts`; ESLint owned files and app typecheck after dependent interfaces land. Notify all producers when actual APIs replace stubs.

## Producer 2 — History and complete refresh retention

Own `src/history.ts`, `src/refresh.ts`, `src/refresh-view.ts`; new `tests/brief-history.test.ts`, `tests/brief-refresh.test.ts`.

Add briefs to entry serialization/extraction/reconstruction; dataset remains shared immutable history data. Preserve30-state/8 MiB trimming, no-op redo and atomic rejection. Exact immutable snapshots and literals survive Undo/Redo; never shrink a retained brief to fit quotas.

Extend RefreshAnnotation with detached brief or null, union brief-only tickers into annotations and update maximum choices. Keep existing issuer-change criteria and retention semantics. Keep preserves the complete graph unchanged; Drop/absent removes the entire graph with existing research. Missing old period alone does not discard its citation. Review shows counts and an accessible collapsed full prior brief with incoming-source differences, including dropped groups. Use briefReportLines with old dataset and optional incoming comparison dataset; coordinate report owner without importing UI or modifying main.ts. Existing loss consent and readiness remain owned by main integration.

Test brief-only edits, exact Undo/Redo, no-op, limit failures preserving redo, brief-only Keep/Drop/absent groups, same financial values/new provenance, repeated refresh, missing captured year and full detached review data. Test original annotation behavior with no briefs. Run owned unit files and scoped lint; no shared build.

## Producer 3 — Complete reports and provenance

Own new `src/brief-report.ts`, `src/exports.ts`, `src/refresh-report.ts`; new `tests/brief-report.test.ts`.

Publish briefReportLines(brief,dataset,today,comparisonDataset?) and buildCompanyBriefReport(notebook,ticker,today) exactly as design. Avoid cycles: report modules may import model/brief, but those never import reports. Reuse a bounded complete formatter for standalone company report, ordinary whole-notebook report and proposed-refresh report. Preserve every existing note/annual-history section. Full report includes briefs outside shortlist. Proposed refresh includes complete prior briefs for kept/dropped/removed groups and explicit outcomes.

Clearly label user statements, uncited statements, unverified supplied excerpts, selected captured fields, complete captured raw context and current comparison. Preserve literal text/IDs/metadata and source spelling. Count actual UTF-8 bytes incrementally including all separators, repeated source details and CRLF; refuse above8 MiB before Blob/download. Never truncate. Complete JSON remains independent of text report refusal.

Test literal hostile text, astral strings/CRLF, exact references and order, null versus zero, complete old and incoming provenance, changed/missing categories, same import without changes, prior sources for dropped groups, included nonshortlist briefs and exact report-byte failure. Preserve existing old report content/limits. Run owned unit file and scoped lint.

## Producer 4 — Authoring UI and draft lifecycle

Own `src/main.ts`, `src/style.css`, optional new `src/brief-view.ts`; no other production files. New helper is private to the UI owner, with no callback imports from main and no consumer contracts outside those files. Use the exact selectors/accessibility names frozen in design.

Publish a coherent stable Company brief shell only after browser owner captures initial RED. Implement sectioned saved statements, explicit citation attachment, excerpt source authoring, exact-period/raw-field capture, inspectable library, blocked cited-source deletion, explicit whole-brief deletion and standalone download. Never infer a source's relevance or financial recommendation. Long source URLs/excerpts are inspectable disclosures; controls remain usable at390px.

Use detached per-ticker draft state for each form/attachment selection, never alias committed graph objects. All input intents invalidate pending import/refresh immediately. Preserve raw invalid input, focus/caret and unrelated old forms through normal redraws and async statuses. Successful source addition clears only its unchanged submitted form and does not attach to a statement automatically. Guard destructive form/Undo/Redo actions and incorporate all new drafts in beforeunload, editorDrafts and explicit discard paths. Clearing dirty flags never revives stale review. No intermediate edit registers into saved notebook or autosave.

Apply every valid edit through existing history/publication/save machinery, with explicit current UTC date; reject atomically. Ensure brief-only commits autosave, save failure stays exportable and retry does not lose prior durable state. Loading older records remains read-only until a real save. Run scoped UI lint/typecheck; no browser/build until assigned root slot.

## Independent reviewer 1 — Domain/report oracle and source review

Own new `tests/brief-oracle.test.ts` only; read production later after writing literal expectations. Hand-author annual rows and old/new sources independently. Pin all five raw fields, null/zero, negative/tiny values, selected versus contextual field changes, exact old date versus latest, source-only changes and changed issuer identity. Verify exact snapshots never rewrite through repeated refresh, orphan/ID/collision rejection, literal Unicode/code-point versus byte budgets, genuine old-version compatibility and complete report recoverability for dropped groups. Include brief-only history/no-op redo and deliberate malformed source snapshots.

After oracle passes unchanged, review producers 1–3 read-only for bounded allocation, dependency cycles, data loss and misleading provenance. Report concrete reproduction rather than broad hypothetical warnings. Root assigns any correction to its owner.

## Independent reviewer 2 — Native authoring, persistence and lifecycle

Own new `tests/browser/brief.spec.ts` plus an isolated new fixture helper if needed. Initial actual-browser missing-control RED before new UI shell. Use real native IndexedDB and independently authored CSV/JSON; no production test globals or fake product success paths. Coordinate all production builds/port4271 with root.

Exercise shortlist/excluded/watch detail → supplied excerpt and annual capture → explicit attachment → edit/detach/delete → standalone/full/JSON downloads → process restart/reopen. Verify exact literals, IDs, source snapshots and drift independently in downloaded data. Pin source-only/uncited status, same value/different provenance, missing old year, brief-only refresh group Keep/Drop and full dropped-content proposed report.

Exercise focus/raw drafts across each form/source addition/company switch, changed-back input, delayed native File read, refresh review invalidation, declined discard, Undo/Redo and UTC rollover. Verify native IDB abort/retry leaves prior complete record durable; protected invalid record recovery and legacy load without autosave remain. Native keyboard/mobile390px, literal hostile source text, safe links and bounded headings. Preserve old34 cases unmodified except root-approved schema fixture compatibility.

## Final integration and delivery

Root runs all unit tests, lint/typecheck, production build and original34 plus new native cases in one coordinated frozen build. Review genuinely maximal legal graphs/report sizes and near-limit old migration, not only toy examples. Confirm no production network source/model requests and no changes to the frozen #36 experiment. Record exact commands/log paths, counts, failures/fixes and limitations. Root updates README/catalog milestones without claiming broader AI analysis, then handles Git/CI/issue closure after actual acceptance.

## Root review and release

Root and both independent reviewers read the complete contract/plan. No blocking findings remain. Literal code-point limits must not be narrowed accidentally by UTF-16 HTML maxlength; deleting the final saved item requires explicit Delete brief. The unchanged149-unit/34-browser baseline, normal production restoration and49 unchanged input hashes are retained at `/tmp/stock67-baseline-99fz31c5/verification.json`.

Exclusive implementation assignments: git_reader domain/schema; recorder history/refresh; audio_engine reports; git_runner UI; git_history_review independent oracle; next_project_assessment independent native acceptance. Root owns old-test compatibility, shared build/ports, package/docs/storage error copy, Git/issues/CI. Melody #66 verification proceeds separately; no Stock implementation owner may touch its files.

## Integrated local acceptance

The completed v0.4 implementation passes all 206 unit cases (18 domain/migration, 11 history/refresh, 12 report and 16 independent oracle additions), full lint/type checking and normal production build. All 49 native Chromium 151 cases pass together in 55.0 seconds, with no skips or flaky cases. Original assertions remain except explicit schema-3, 6 MiB cap and complete-envelope compatibility updates. Native test corrections target real summary/stale controls and await actual durable save completion before reload; a root launch configuration failure occurred before app interaction and was corrected without source changes. No production defect was found in the final independent UI/persistence review.

The independent maximum artifact script imports an exact 1 MiB graph with 50 briefs and 100 citations, retains all evidence across 50 explicit Keep decisions after captured years are removed, and verifies byte-identical complete JSON/report after a full Chromium process restart. Original two-MiB annual-history and refresh smoke checks remain green. The project verification record carries final source hashes, exact artifacts and limitations. Stock CI run37199016473 passed commit634c4668da4bf9e45a669bbd0a315abba983ab13 with 206 unit and49 Chromium153 browser cases plus all project checks. The cited-brief milestone is complete. A separate existing raw-record recovery concern is tracked in issue72; the unrelated Shot workflow failure at the same repository commit is being investigated independently. No experiment files or results from issue #36 changed.
