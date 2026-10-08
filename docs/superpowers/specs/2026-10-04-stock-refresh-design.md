# Stock Notebook reviewed CSV refresh

Issue [#56](https://github.com/twangyal/projects-monorepo/issues/56). Let users update a complete supplied annual-financial universe without rebuilding their research. Stage and review the replacement, preserve compatible committed criteria and annotations, resolve changed company details and losses explicitly, then save, reopen and export the result. This is financial-data research tooling, not generated analysis, issuer verification or an AI feature. The frozen experiment in #36 is outside scope.

## Scope and compatibility

Keep Notebook schema 2 and existing v1 migration, CSV grammar, database location and recovery behavior. `Company` and `Dataset` do not gain fields. Import one complete CSV: no incremental merging, automatic restatement resolution, inferred exchange rates or old rows relabeled with the incoming filename. Every applied raw row, source line, filename, filing URL, imported date, dataset ID and synthetic flag belongs to the incoming dataset. Preserve the existing notebook ID and title.

Keep the limits: 2 MiB CSV; 500 annual rows; five periods per ticker; 4 MiB notebook; 8 MiB text report; 100 watchlist entries; four comparison entries; 100 notes of 4,000 Unicode code points each; 16 filters; 30 history states within 8 MiB. Use Node 22.18+ (CI Node 24), existing TypeScript/Vite/browser APIs and existing dependencies only. No backend, external request, model access or new persisted analysis.

Existing **Replace universe**, demo and notebook-backup imports retain their behavior. A separate file input **Refresh financial data** is available only with a successfully loaded current notebook. It imports CSV, not JSON or a demo. Incoming CSV provenance is `synthetic: false`, as in the existing CSV import; a synthetic-to-supplied transition is disclosed and participates in annotation decisions below. Supplied does not mean authentic or independently verified.

## Frozen pure engine contract

New `apps/stock-notebook/src/refresh.ts` owns all exported refresh types and the two pure APIs below. It imports existing `Notebook`, `Dataset`, `Company` and `Screen` from `types.ts`; do not modify the persisted types for this feature. Results are detached, inputs are validated without mutation, and no helper reads the clock, DOM, browser storage or files.

```ts
export type CriteriaAction = 'keep' | 'clearQuery' | 'reset';
export type AnnotationAction = 'keep' | 'drop';
export type RefreshFactField =
  | 'name' | 'sector' | 'currency' | 'revenue' | 'priorRevenue'
  | 'netIncome' | 'debt' | 'equity';
export type RefreshSourceField = 'fileName' | 'sourceLine' | 'filingUrl';
export type RefreshIdentityReason = 'name' | 'sector' | 'currency' | 'synthetic';

export interface RefreshChoices {
  criteria: CriteriaAction;
  annotations: { ticker: string; action: AnnotationAction }[];
}
export interface RefreshPeriodChange {
  ticker: string; fiscalDate: string;
  kind: 'added' | 'removed' | 'changed' | 'unchanged';
  previous: Company | null; incoming: Company | null;
  factFields: RefreshFactField[]; sourceFields: RefreshSourceField[];
}
export interface RefreshCompanyChange {
  ticker: string; previous: Company | null; incoming: Company | null;
  latestDateMovedBackward: boolean;
}
export interface RefreshAnnotation {
  ticker: string;
  watchlisted: boolean; comparisonIndex: number | null; note: string | null;
  previous: Company; incoming: Company | null;
  policy: 'keep' | 'remove' | 'decide';
  reasons: RefreshIdentityReason[];
}
export interface RefreshCriteriaPreview {
  action: CriteriaAction; screen: Screen; query: string;
  screenError: string | null; queryError: string | null;
  matchedTickers: string[] | null;
}
export interface RefreshReview {
  notebookId: string; previousDatasetId: string; incomingDatasetId: string;
  today: string; previousFileName: string; incomingFileName: string;
  previousSynthetic: boolean; incomingSynthetic: boolean;
  companies: RefreshCompanyChange[];
  periods: RefreshPeriodChange[];
  annotations: RefreshAnnotation[];
  criteria: RefreshCriteriaPreview[];
}

export function reviewRefresh(
  base: Notebook, incoming: Dataset, today: string
): RefreshReview;
export function applyRefresh(
  base: Notebook, incoming: Dataset,
  choices: RefreshChoices, today: string
): Notebook;
```

Both APIs validate `today`, `base` through `validateNotebook`, and `incoming` through `validateDataset` using that same explicit date. `applyRefresh` recomputes its review and validates choices at runtime: exact plain-data keys, known enum values, normalized string tickers, no duplicate decisions, and exactly one decision for each `policy: 'decide'` ticker. Extra decisions for automatic keep/remove groups, absent tickers or unannotated companies are rejected. Decisions can be supplied in any order; results are deterministic.

`companies` is the union of current and incoming latest-per-ticker rows, sorted by ticker. `latestDateMovedBackward` is true only for a common ticker whose incoming latest fiscal date is earlier. `periods` is the union of `(ticker, fiscalDate)`, sorted by ticker then date, at most 1,000 entries. A paired period is `changed` only when a reported fact differs; otherwise it is `unchanged`, including source-only changes. Added/removed periods have one null endpoint and empty field arrays. Use ordinary equality for validated primitive amounts: null differs from zero; zero and negative zero do not differ.

For paired rows, fact fields use the declaration order above; source fields use `fileName`, `sourceLine`, `filingUrl` order. Different dataset IDs/import dates alone do not mark every row as changed; disclose these once in the review header. Compare filenames through the enclosing datasets, not a nonexistent Company field. Retain complete row endpoints so views/reports can show exact old/new inputs. Describe changes as supplied-input differences, not confirmed restatements or accounting conclusions.

`annotations` has one entry per ticker in the union of committed watchlist, comparison and notes, sorted by ticker; its maximum is 204 distinct tickers. `comparisonIndex` is the old zero-based position or null. `previous` and `incoming` are latest rows, not arbitrary first rows. Removed tickers have policy `remove` and empty reasons. Common tickers with any exact stored latest name/sector/currency difference, or a dataset synthetic-flag difference, have policy `decide` with reasons in declaration order. Other common tickers have policy `keep`. No decision is needed for an unannotated company. A changed name can be a spelling change or a different issuer; the app does not decide which.

Automatically kept groups carry their original selections and literal note text. A `keep` decision retains the whole group's research; `drop` removes its watchlist entry, comparison entry and note together. Removed groups cannot remain because schema 2 requires known ticker references. Preserve watchlist/comparison order after filtering; notes remain canonically sorted by existing validation. Do not create selections for added companies or rewrite retained notes to match new facts. Users must review retained research against updated evidence.

`criteria` contains exactly `keep`, `clearQuery`, `reset` in that order. Keep preserves the applied screen and saved query; clearQuery preserves the screen but sets query to empty; reset uses the existing default screen (all sectors/currencies, no filters, stale excluded, ticker ascending) and empty query. Independently assess `validateScreen`/`screenDataset` and `parseQuery` against incoming latest vocabulary. Errors contain bounded, actionable messages without interpolating arbitrary supplied row text; `matchedTickers` is null if either part fails, otherwise it follows the actual proposed screen result order. A failed screen preview retains its detached old screen for honest display. A successful screen uses its validated canonical spelling. Zero matches is valid.

Never silently remove predicates, reinterpret units, select a currency, change a monetary sort or replace a saved interpretation. `applyRefresh` rejects an incompatible selected action, computes annotation retention, validates the complete candidate through `validateNotebook` and returns canonical schema 2. Its notebook ID/title are the base values and its dataset is the incoming dataset. The existing 4 MiB candidate bound remains decisive even when both individual inputs were valid; do not truncate research to fit.

## Atomic staging, decisions and publication

Read native File bytes under the existing 2 MiB cap. Once the asynchronous read completes, capture one UTC date, call existing `parseCsv(bytes, file.name, today)` and `createDataset(preview, today, false)` once, and build a review from a detached current committed notebook. Bind the UI review to incoming dataset ID, current `generation`, `intentGeneration` and review date. Only one pending read and one staged refresh are retained; a newer input/cancel supersedes older results. Pending or failed refresh reads never write incoming data or alter the current notebook/history/results.

The current `draftIntent()` invalidates only pending loads. Extend refresh handling so any title/query/filter/note input, committed edit, undo/redo, import, reset or notebook replacement also marks an existing refresh review stale. `interpretCriteria()` also changes staged controls without calling `draftIntent()` today; invalidate the refresh review explicitly on that path. Show **Rebuild refresh review**, retain the already validated incoming dataset, disable Apply, and recompute against the latest committed notebook/date when requested. Rebuilding resets retention choices and confirmation checkboxes. Refresh-panel choice changes are separate UI intent and do not invalidate their own review. Reset the loss acknowledgement whenever a retention choice changes; consent to an earlier loss set is not consent to a new one. Exporting a current backup is read-only.

Uncommitted editor drafts block Apply: titleDirty, queryDirty, screenDirty or nonempty noteDrafts. They remain visible/focused through refresh failures. Users can save/apply them with existing controls, then rebuild, or choose **Discard editor drafts for refresh** with explicit native confirmation. That action restores fields from the committed notebook, clears only editor draft flags/maps/staged interpretation, leaves notebook/history/persistence unchanged, and rebuilds the refresh review with fresh confirmations. It does not discard committed notes. Its warning must say unsent drafts are absent from notebook backups. Existing save handlers clear dirty flags after commit/render; refresh readiness must update after that clearing, without replacing the editor or retention controls. Clearing dirty flags alone must never revive a stale review or its old decisions; only an explicit rebuild creates a fresh review.

The review shows raw-period counts, distinct ticker counts, files/import dates, synthetic/supplied provenance, added/removed periods/tickers, reported-fact changes, source-only changes, backward latest dates, annotation groups/decisions, and proposed criteria/errors. Show full saved note text on expansion; never claim an excerpt is the full note. Losing a historical period is also data loss even if its ticker survives. Require the units checkbox; additionally require a loss acknowledgement when any period is removed or any annotation group will be removed/dropped. Pending decisions cannot be treated as drop or keep for readiness.

**Apply reviewed refresh** is enabled only with a current review/date, no editor drafts, valid criteria, complete decisions, units confirmation and required loss acknowledgement. Native final confirmation summarizes losses, whole-dataset replacement and fresh history. After confirmation, recapture/check the UTC day and generation/intent binding. If the day changed, require a rebuilt review; if any binding changed, do not apply. Call `applyRefresh`, build the result and a new `NotebookHistory` with the same captured day, then publish once. Preflight must finish before notebook/history/draft assignment. Adjust `publish` to accept an optional explicit date so refresh does not validate under a second hidden clock read.

Refresh intentionally starts new history because `NotebookHistory` holds one immutable dataset. Make this visible before confirmation and offer **Download previous notebook** from the exact detached reviewed base. Cancel/failure retains the existing undo/redo cursor and any raw saved record. Do not advertise Undo as reversing dataset refresh.

Retain current autosave behavior after publication. An applied refresh is immediately usable in memory and is not called saved until the matching native IndexedDB transaction completes. Failed saving keeps refreshed memory editable/exportable, preserves the last durable record and exposes Retry saving. Do not silently roll memory back after save failure or claim stale successful writes saved a newer edit. Existing queued writes remain ordered; old in-flight completion must not clear the refreshed notebook's unsaved status. Preserve read-only v1 startup migration, exact raw recovery and explicit reset behavior. Cross-tab conflict detection is not added; existing guidance to close other Stock Notebook tabs still applies.

## Evidence, reports and UI contract

All incoming/previous evidence is rendered as literal text with explicit dataset provenance. Existing facts/history renderers currently obtain the filename from `notebook.dataset.fileName`; they cannot receive incoming rows without an explicit provenance parameter. Do not temporarily publish incoming data to reuse them. A dedicated compact before/after table is sufficient. Keep at most 50 period entries in the review DOM per page, with **Previous changes** / **Next changes**, a current page/count, and an accessible horizontally scrollable table. Include unchanged and source-only entries; pagination changes presentation, not the complete engine/report data.

New `src/refresh-report.ts` exports:

```ts
export function buildRefreshReport(
  base: Notebook, incoming: Dataset,
  choices: RefreshChoices, today: string
): string;
```

It calls the reviewed engine and `applyRefresh` for validation, never mutates/publishes/saves, and returns bounded UTF-8 text within existing `LIMITS.reportBytes`. Header: **Proposed CSV refresh review — not an applied or saved transaction**. Include review UTC date, both dataset IDs/files/import dates/provenance, units/basis disclosure, complete previous/proposed criteria and selected resolution, each period exactly once with endpoints, exact fact/source changes, all annotation groups with chosen outcome and literal saved notes, backward-date warnings, and history-reset/backup guidance. Every endpoint cites its correct filename/sourceLine/filing URL. No automatic fetching or generated outlook. Oversize reports fail before a partial download; both notebook backups remain usable.

**Download refresh review** uses fresh, complete, compatible decisions; units/loss acknowledgement is not required because this is only a proposed plan. Stale reviews cannot export. **Download previous notebook** uses existing serialization on the detached reviewed base; it is a canonical editable backup, not an exact raw legacy-record recovery. After application, the existing notebook JSON and research report contain incoming provenance, retained committed research and actual applied controls. No refresh audit is silently added to schema 2. The proposed review is a session-only artifact; download it before applying if a change log is needed.

Stable selectors/labels for browser ownership:

- `#refresh-csv`, accessible **Refresh financial data**; `#refresh-review`, `#refresh-summary`, `#refresh-status`, `#refresh-errors`.
- Criteria radios `name="refresh-criteria"`, values `keep`, `clearQuery`, `reset`; labels **Keep applied criteria and interpretation**, **Keep applied criteria, clear saved interpretation**, **Reset criteria and interpretation**.
- Annotation groups `data-refresh-annotation-ticker="TICKER"`; required selects `name="retention-TICKER"`, accessible **Research retention for TICKER**, values empty/keep/drop with labels **Choose research retention** / **Keep research** / **Drop research**.
- `#refresh-units-confirm`: **I confirm the refreshed CSV uses currency millions and comparable 12-month annual periods**.
- `#refresh-losses-confirm`: **I reviewed the annual periods and research that will be removed**.
- Buttons exactly **Apply reviewed refresh**, **Rebuild refresh review**, **Cancel refresh**, **Download previous notebook**, **Download refresh review**, **Discard editor drafts for refresh**, **Previous changes**, **Next changes**.
- Period rows `data-refresh-period-key="TICKER:YYYY-MM-DD"`; `#refresh-period-page` reports the current page and total.

Existing editor/import/export accessible labels stay unchanged. Default criteria action is keep even when incompatible; show the error and require a deliberate alternative. Automatic annotation groups have readable fixed outcomes; required decisions start empty. Normal product copy uses financial/research terms, leaving generation/storage implementation details to documentation. Controls must remain usable on mobile and with keyboard/screen-reader labels; do not replace an active retention control or focused editor form during unrelated rendering.

## Verification and ownership

Engine owner: `src/refresh.ts`, `tests/refresh.test.ts`. Publish frozen types/signatures first; meaningful RED then GREEN for diff, identity/annotation retention, criteria validity, strict decisions, immutable inputs and bounds. Existing core persisted types/validators/selectors remain unchanged unless a demonstrated integration defect requires a root-approved adjustment.

Report owner: `src/refresh-report.ts`, `tests/refresh-report.test.ts`; existing storage/native tests only as needed for integration. Verify exact provenance/complete endpoints, literal lost notes, compatibility failure, report cap and no state mutation. No new persisted audit/cache.

UI owner: `src/main.ts`, `src/style.css`, and an optional dedicated `src/refresh-view.ts` for the bounded explicit-provenance review renderer. Own refresh staging/forms, binding/draft/history/publication integration and the explicit-date publish adjustment. Consume engine/report APIs, preserve existing complete replacement and recovery paths, and coordinate shared builds with root.

Independent semantic-oracle owner: `tests/refresh-oracle.test.ts`, `tests/oracle/refresh-fixtures.ts`; do not derive expected diffs/retention from production refresh helpers. Independent browser owner: `tests/browser/refresh.spec.ts`, with existing native storage tests/harness extensions only after coordination. Browser verification uses existing production configuration/port 4271, actual files/IndexedDB/downloads and explicit root coordination. Existing workflow/storage suites remain intact.

Root owns final integration, README/catalog/evidence, issue/Git/CI and shared build/server scheduling. A separate read-only reviewer inspects capability-free lifecycle, criteria semantics and provenance before release. No new model work or dependency installation is needed.

Acceptance includes old/new field changes versus source-only ordering, added/removed/bounded periods, latest-first identity and backward dates, synthetic transition, exact retention order/text, missing/extra/duplicate decisions, invalid query versus valid screen, removed latest vocabulary, new mixed-currency money sort, invalid/oversize candidate, drafts and late reads before/after completed review, cancel/confirmation decline, UTC rollover, prior history preservation on failure/new history on success, native write failure/retry/queued completion, v1 raw preservation until successful explicit refresh save, complete JSON/report downloads/reopen, maximum 500-row review pagination, literal hostile text and mobile keyboard operation. Run full existing Stock checks and production suite after targeted gates; verify actual exported artifacts and native reopen before documenting acceptance.
