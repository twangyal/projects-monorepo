# Stock Notebook supplied annual history

Issue [#35](https://github.com/twangyal/projects-monorepo/issues/35). Extend the working local research flow with dated historical evidence. Keep catalog #13 ACTIVE: this feature does not supply broad language understanding, generated AI analysis, forecasts, valuation or learned investment-quality rankings. No new runtime service, dependency or external data access.

## Data, migration and current-period selection

Keep `Company` fields and flat `Dataset.companies` as annual rows, preserving strictly increasing original CSV `sourceLine` order. Notebook schema version 2 distinguishes multi-period semantics. Accept at most 500 total rows and five rows per normalized ticker; reject duplicate `(ticker, fiscalDate)` even when values match. Existing 2 MiB CSV, 4 MiB notebook, 8 MiB report and edit-history bounds remain. Same eleven CSV columns and complete replacement/import confirmation; no incremental merge or automatic restatement resolution.

Canonical `Notebook.schemaVersion` becomes `2`. `validateNotebook` accepts only versions 1 and 2 and returns a detached canonical v2 notebook. Version 1 must first satisfy its former unique-ticker rule; malformed old records cannot become valid through relaxed v2 semantics. Preserve notebook/dataset IDs, title, query, applied controls, all annotations, synthetic flag, raw values, dates, filenames and source lines. Existing JSON parser continues rejecting duplicate keys, invalid Unicode, unsupported versions and oversized/deep data atomically.

Keep IndexedDB database `stock-notebook-v1`, version 1, store/key unchanged. Loading a valid v1 record migrates in memory without rewriting or deleting raw persisted text. Only a subsequent successful save writes v2. Invalid migration keeps original recovery/download/reset behavior. Undo snapshots always emit v2 and retain one immutable dataset, with annotations scoped to ticker rather than period.

New types-only-dependency `periods.ts` exports detached `latestCompanies(rows: readonly Company[]): Company[]` sorted by normalized ticker, and `periodsForTicker(rows: readonly Company[], ticker: string): Company[]` sorted by ascending fiscal date. Inputs are already validated annual rows; selectors never mutate them. The ticker argument is an exact normalized ticker; the period selector returns an empty array if absent. Export NOTEBOOK_SCHEMA_VERSION = 2 and LIMITS.periodsPerTicker = 5 from types.ts. Every consumer uses the selectors rather than first-match `.find(ticker)`: screen, comparison, watchlist, detail, report, sector/currency choices and validation/query vocabulary. Pick latest BEFORE freshness, currency, sector, missing-value or financial filtering. Older good facts cannot rescue missing/bad/stale latest facts. No historical currency/sector becomes a current filter choice.

## Historical arithmetic and limits of comparison

Keep all existing per-row ratios and observations unchanged. In particular `growthPct` remains `100 * (revenue - priorRevenue) / priorRevenue` using that row's own declared inputs. For stored revenue 100 followed by revenue 150/priorRevenue 120, the current screen growth is 25%, while the separate stored-row revenue change is 50%. Never overwrite either value or infer which source is correct.

Historical calculations use adjacent supplied rows in ascending fiscal-date order; never skip an intervening row or interpolate an absent year/value. A pair is automatically comparable only when:

- Later calendar year is exactly earlier year plus one, and fiscal month/day matches (February 28/29 pairs are allowed).
- Currency, trimmed stored company name and sector match exactly. Ticker is already shared.

Otherwise retain all raw rows, give explicit gap/date-alignment/name/sector/currency reasons and withhold automatic pair deltas. This conservative calendar rule is a disclosed heuristic: 52/53-week reporters or renamed companies are not called invalid, but need manual comparison. No annualization, inferred FX or accounting-basis verification.

For comparable pairs, compute separate historical changes in revenue, gross debt and net margin. Amount delta is current minus previous; relative percent change additionally requires previous amount > 0. Zero base can retain an absolute delta while relative percent is unavailable. Missing endpoints make that metric unavailable, never zero. Net margin delta is a percentage-point difference between valid per-row margins, not a percent-of-a-percent. Keep full IEEE754 values for thresholds and report formulas, with display rounding only; calculations make no ledger-precision claim. Differences in declared `priorRevenue` and the immediately preceding stored `revenue` are warned only for otherwise comparable pairs when both are present. The warning identifies both rows and does not claim a restatement.

Neutral direction summaries cover ALL three to five supplied periods, not a selectively reduced window. Every pair must qualify, every metric delta must exist, and no prior-revenue mismatch warning may be present. Strictly positive deltas mean `increasing`, strictly negative `decreasing`, all zero `flat`; otherwise `mixed` (including flat intervals, so label it “mixed or unchanged intervals”, never “both rises and falls”). Fewer than three periods, missing values, noncomparable pairs or mismatch warnings yield `unavailable` with a reason. These are retrospective descriptions with full dates, never strengths, forecasts or recommendations.

## Shared interfaces and ownership

`annual-history.ts` owns exported types and `analyzeCompanyHistory(dataset: Dataset, ticker: string, today: string): CompanyHistory`, validating data/date and known exact ticker. It uses existing per-row `analyzeCompany` and the selectors, returning detached data:

```ts
type HistoryMetric = 'revenue' | 'debt' | 'marginPct';
interface HistoricalChange {
  metric: HistoryMetric;
  delta: number | null;
  percentChange: number | null;
  reason: string | null;
  percentReason: string | null;
}
interface PeriodComparison {
  previous: Company; current: Company;
  comparable: boolean; reasons: string[]; warnings: string[];
  changes: HistoricalChange[];
}
interface HistoryTrend {
  metric: HistoryMetric;
  direction: 'increasing' | 'decreasing' | 'flat' | 'mixed' | 'unavailable';
  reason: string | null; periodCount: number;
}
interface CompanyHistory {
  ticker: string; periods: ResearchRow[];
  comparisons: PeriodComparison[]; trends: HistoryTrend[];
}
```

Keep every adjacent pair, including incomparable pairs. `changes` has exactly revenue, debt, marginPct in that order; unavailable entries carry nulls and reasons. `reason` explains unavailable delta; `percentReason` explains an unavailable relative percentage (margin uses percentage points and has no relative percentage). Pair source evidence comes directly from previous/current fields, fiscal dates, source lines and links. No opaque persisted analysis or generated prose enters the notebook schema.

## User workflow and exports

Import review/source header distinguish annual-row count from unique-company count. Synthetic demo includes original multi-period examples and remains clearly fictional. Results, comparisons, watchlist and current facts use latest rows. Opening company evidence adds all dated annual rows, original links/source lines and raw facts, then adjacent calculations and neutral all-period summaries with explicit unavailable reasons. Give every historical anchor ticker/date/scope uniqueness; use safe text/URL handling already in the app. A scrollable accessible table and dated calculation sections are sufficient; no chart is required to complete this milestone.

Text reports add every raw supplied period once in a dedicated annual-history appendix, even for companies excluded from the shortlist, preserving all source rows/links and synthetic disclosure. Current shortlist/comparison/watchlist blocks continue using latest facts; avoid duplicating large historical blocks for each placement. Appendix includes per-period ratios, exact historical formulas/inputs, comparison warnings and summary reasons. JSON retains every raw row. Existing byte caps fail actionably without publishing partial downloads or replacing work. Keep notes, draft/generation guards, undo/redo, autosave and recovery controls intact.

## Verification

Before this feature, a real CI recovery-test race was reproduced and fixed in `88866fd`: awaiting an already-visible import control did not wait for IndexedDB reset commit. The controlled native transaction now proves pending state, waits for explicit commit/status, checks absence, then reloads. No product recovery change was needed. All 11 remote workflows passed at that fix, including the complete Stock browser suite (run 37168885482).

Required feature checks: strict v1-to-v2 migration and raw-record preservation; unsorted dates and latest-before-filter behavior; historical-only filter vocabulary rejection; duplicate/sixth-period/501st-row failures; source-line and 2 MiB limits; 25% declared growth versus 50% stored-row example; exact zero/missing/negative-margin/gap/leap-date/currency/name/sector/mismatch behavior; all-period direction with flat intervals; independent expected arithmetic; immutable history; bounded full appendix; actual native-IDB migration/autosave/reload; CSV/JSON/report download/reimport; desktop/mobile access and no new horizontal page overflow. Run existing checks and full production browser suite, measure maximum 500-row history flow on real Chromium, review, commit/push, check CI and close only actual completion. Immediately reassess after completion.
