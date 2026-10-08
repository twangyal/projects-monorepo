# Stock Notebook — an offline annual-financial research workflow

Idea #13, issue #32, path `apps/stock-notebook`. This spec defines one usable first milestone, not completion of the catalog's AI goal.
Root owns implementation release, tracking, catalog and Git changes. This task creates only this design document.
The user authorizes autonomous product decisions. No live financial API, model download, backend or paid service is required.

## Purpose and honest scope

Move from a research idea to an understandable shortlist: import annual CSV → describe criteria in supported language → inspect/edit filters → screen → inspect reported facts and derived observations → compare → save watchlist/notes → export/reopen.
Reported facts are user-supplied figures, not verified filings; derived ratios and rule-based observations are visibly separate.
Call the language feature “Supported screening language”, and the analysis “Derived observations”. Never label either AI or generated financial expertise.
No performance predictions, investment recommendations, fair-value estimates, inferred financial facts, or simulated real company data.
An original synthetic demo is clearly labelled “Synthetic demonstration — not real companies or filings” on import, results and exported reports.
This milestone stays ACTIVE: broad natural-language interpretation, genuinely generated outlook and dependable live coverage remain deferred.
Prefer explicit metric sorting over a weighted investment-quality score. No learned ranking is needed for this milestone.

## Architecture and bounds

Independent browser-local TypeScript/Vite DOM app with IndexedDB; no runtime network requests or cross-app runtime imports.
Use pure modules for shared validation, CSV/schema, query parsing, filtering/analysis and notebook/history; separate storage, exports and editor modules.
Require current desktop Chromium with File/Blob, TextDecoder, IndexedDB and structuredClone; unsupported storage retains an in-memory notebook with backup guidance.
Development port 4270; production browser checks 4271. Focused harnesses use separate output directories/ports coordinated by root.
One notebook holds one annual company universe: 1–500 companies, at most one row per normalized ticker.
CSV: 1 byte–2 MiB UTF-8; notebook JSON: at most 4 MiB UTF-8. Reject invalid UTF-8, NUL, invalid Unicode and duplicate decoded JSON keys.
JSON has exact known keys, plain data objects, nesting at most 24, finite safe numbers and schemaVersion exactly 1; no coercion or silent field stripping.
Ticker matches `[A-Z0-9][A-Z0-9.-]{0,15}` after uppercase normalization; name 1–100 Unicode code points, sector 1–60, source filename 1–120, title 1–80; trim text and reject controls. Notes alone allow LF/tab, normalize CRLF→LF and reject other controls.
Currency is exactly three uppercase ASCII letters, declared by the importer; validate syntax without pretending to verify an ISO currency registry.
Financial amounts: null or finite numbers with absolute value at most 1,000,000,000 currency millions, at most six decimal places.
Revenue, priorRevenue and gross debt must be nonnegative; netIncome/equity may be negative. Canonicalize negative zero to zero.
Query at most 500 code points; at most 16 filters. Watchlist at most 100 tickers, comparison at most 4, notes at most 100 distinct tickers × 4000 code points.
History holds at most 30 edit states and 8 MiB compact UTF-8 edit bytes; one immutable dataset sits outside edit history.
IDs are canonical lowercase UUIDs created with crypto.randomUUID. Date-only fields are real Gregorian YYYY-MM-DD dates, not permissive Date.parse strings.
Import validation uses supplied UTC today, within 2000-01-01–2099-12-31; company fiscalDate must be within 2000-01-01–today.
No exceptions are relaxed in direct public APIs. Error messages identify safe row/column/error codes without echoing cell text or complete URLs.

## Exact CSV contract

Header, case and order are exactly:
`ticker,name,sector,currency,fiscal_date,revenue,prior_revenue,net_income,debt,equity,filing_url`
Accept an optional leading UTF-8 BOM, LF or CRLF records, RFC4180 quotes and escaped double quotes; reject lone CR and unterminated/trailing quote syntax.
Reject blank records, unknown/missing/duplicate headers, inconsistent field counts and more than 500 data records. A single final newline is permitted.
All cell contents are single-line; quoted embedded record breaks are rejected. Store each record's actual 1-based physical starting line, header at line 1.
Trim every cell; ticker is canonicalized to uppercase before uniqueness checks. Sector remains trimmed case-sensitive display text; sector matching is case-insensitive exact text.
Blank numeric cells become null, never zero. Tokens NA/N/A/null, thousands separators, currency symbols, exponent notation and percent signs are invalid.
Numeric grammar is `-?(0|[1-9][0-9]*)(\.[0-9]{1,6})?`; disallow a leading plus, leading zeros and numeric overflow.
Debt means supplied gross interest-bearing debt, not signed/net debt; do not silently substitute cash-adjusted debt.
All financial columns are currency millions, including priorRevenue; no units inference or mixed scale within a file. Import review requires explicit confirmation of these units.
Rows represent 12-month fiscal years under the same accounting/reporting basis. priorRevenue is the comparable preceding 12-month period supplied by the user, not independently checked.
The import confirmation states this assumption and warns that restatements, acquisitions, changed fiscal lengths and accounting bases may defeat comparability.
filing_url may be blank→null or an absolute HTTPS URL ≤2048 code points with hostname, no credentials, whitespace/control, fragment or nondefault port.
Reject localhost and literal loopback/link-local IP hosts. Do not fetch, rewrite or manufacture links; safe anchors use noreferrer/noopener and a visible external-link label.
A missing filing URL is allowed and produces “No filing link supplied”; filename plus row provenance is always present.
Duplicate normalized tickers, conflicting rows and future fiscal dates reject the entire staged import; do not silently keep first/latest rows.
Source filename is display provenance, never a path; remove supplied directory components before validation. JSON source names must already contain no slash/backslash.
A supplied filing link does not authenticate the data. The UI/report uses “Supplied source link”, not “Verified source”.

## Exact shared types — src/types.ts

```ts
export type Metric = 'revenue'|'netIncome'|'debt'|'equity'|'growthPct'|'marginPct'|'debtEquity';
export type Operator = 'gt'|'gte'|'lt'|'lte'|'eq';
export type MoneyMetric = 'revenue'|'netIncome'|'debt'|'equity';
export interface Company {
  ticker:string; name:string; sector:string; currency:string; fiscalDate:string;
  revenue:number|null; priorRevenue:number|null; netIncome:number|null;
  debt:number|null; equity:number|null; filingUrl:string|null; sourceLine:number;
}
export interface Dataset {
  id:string; fileName:string; importedDate:string;
  basis:'annual-12-month'; units:'currency-millions'; synthetic:boolean; companies:Company[];
}
export interface Filter {
  metric:Metric; operator:Operator; value:number; currency:string|null;
}
export interface Screen {
  sector:string|null; currency:string|null; filters:Filter[]; includeStale:boolean;
  sortBy:Metric|'ticker'; direction:'asc'|'desc';
}
export interface ResearchNote { ticker:string; text:string }
export interface EditState {
  title:string; query:string; screen:Screen;
  watchlist:string[]; comparison:string[]; notes:ResearchNote[];
}
export interface Notebook extends EditState { schemaVersion:1; id:string; dataset:Dataset }
export interface CsvPreview { fileName:string; companies:Company[] }
export interface QueryResult { screen:Screen; interpretation:string[] }
export interface Derived {
  growthPct:number|null; marginPct:number|null; debtEquity:number|null;
}
export interface Observation {
  kind:'strength'|'risk'|'uncertainty'; code:string; text:string;
  fields:(keyof Company)[];
}
export interface ResearchRow {
  company:Company; derived:Derived; stale:boolean; observations:Observation[];
}
export interface ScreenResult { rows:ResearchRow[]; excludedStale:number; excludedMissing:number }
export interface Comparison {
  rows:ResearchRow[]; warnings:string[]; monetaryComparable:boolean;
}
```

Export LIMITS with the exact bounds above. Arrays contain distinct references/values where uniqueness is required; returned objects are detached.
The Dataset.synthetic flag is retained through JSON, replacements, all views and reports. User imports default false; synthetic demo construction alone sets true.
Exact equality uses canonical normalized values. CSV precision is lexical; JSON/direct numeric precision requires `Number(v.toFixed(6)) === v` within the stated magnitude bound, then canonicalize -0 to 0. Never use a fixed scaled epsilon that rejects legal large six-decimal amounts.
Dataset.importedDate is within 2000-01-01–today; each row fiscalDate≤importedDate. sourceLine is an integer 2–501 and strictly increasing in dataset row order.
Notes, watchlist and comparison refer only to current dataset tickers. Empty notes are removed rather than stored. Notes array is ordered by ticker for serialization.
Filters may repeat a metric to express a bounded range; exact duplicate filters are rejected. Contradictory filters are legal, visibly produce zero matches.
Money filters require a currency present in the dataset, except value exactly zero may use null to compare the sign across currencies.
Ratio filters require currency null. Filter values are finite with absolute value ≤1,000,000,000 and at most six decimal places.
Screen.sector is null or an actual dataset sector under trimmed Unicode toLowerCase equality; do not use locale-dependent fuzzy matching. Screen.currency is null or a currency present in the dataset and acts as a whole-universe equality filter.
Default screen has sector/currency null, filters [], includeStale false, sortBy ticker, direction asc. No hidden scoring or implicit ratio filter.

## Public module contracts

```ts
// validation.ts — shared by CSV/query/research/model; imports types only, no model cycle
validateToday(value:unknown):string;
validateCompany(value:unknown,today:string):Company;
validateDataset(value:unknown,today:string):Dataset;
validateScreen(value:unknown,dataset:Dataset):Screen;
// csv.ts — fatal UTF-8 decode, actual CSV syntax, whole-file validation
parseCsv(bytes:Uint8Array, fileName:string, today:string):CsvPreview;
createDataset(preview:CsvPreview, today:string, synthetic?:boolean):Dataset;
blankCsvTemplate():string; // header plus final newline only
// demo.ts — original fictional universe, always synthetic
createDemoDataset(today:string):Dataset;
// query.ts — no fallback, no guessed partial interpretation
parseQuery(query:string, dataset:Dataset):QueryResult;
// research.ts — validated input, deterministic output, never mutate the dataset
calculateDerived(company:Company):Derived;
analyzeCompany(company:Company, today:string):ResearchRow;
screenDataset(dataset:Dataset, screen:Screen, today:string):ScreenResult;
compareCompanies(dataset:Dataset, tickers:string[], today:string):Comparison;
// model.ts / history.ts
createNotebook(dataset:Dataset,today:string):Notebook;
validateNotebook(value:unknown, today:string):Notebook;
parseNotebookJson(text:string, today:string):Notebook;
serializeNotebook(notebook:Notebook, today:string):string;
editState(notebook:Notebook):EditState;
class NotebookHistory {
  constructor(notebook:Notebook, today:string);
  get current():Notebook; get canUndo():boolean; get canRedo():boolean;
  commit(next:Notebook,today:string):void; undo(today:string):Notebook; redo(today:string):Notebook;
}
// storage.ts — one named local record, transactional replacement
class NotebookStore {
  constructor(name?:string);
  load(today:string):Promise<Notebook|null>;
  save(notebook:Notebook,today:string):Promise<void>;
  exportRaw():Promise<string|null>;
  clear():Promise<void>;
  close():void;
}
// exports.ts — text only; no HTML or CSV spreadsheet export
buildReport(notebook:Notebook,today:string):string;
```

validateNotebook recursively revalidates dataset rows, dates/provenance, screen values, references, exact objects and collection bounds, checks saved query full consumption, and calls screenDataset to reject an uncomputable applied sort. research/query depend on shared validation, never on model, so this creates no import cycle.
createDataset validates the preview independently, assigns an ID/date, and freezes the declared units/basis; callers cannot use a forged preview to bypass limits.
Public research APIs validate their own arguments; today is an explicit deterministic dependency for date-relative operations. calculateDerived uses validateCompany(company,'2099-12-31') for intrinsic shape/amount/date bounds without consulting a clock; analyzeCompany/screen/compare use supplied today. validateToday enforces the bounded real date contract. The editor captures current UTC YYYY-MM-DD explicitly at each date-relative operation. A loaded future-dated notebook is retained on disk but rejected safely.
History constructor today validates only its baseline; commit/undo/redo receive the operation's current UTC today and validate candidates before mutating state/cursor. Never reuse constructor yesterday for a new operation. A rejected history transition leaves state/cursor unchanged; current returns a detached snapshot, not cached research results.
History commits cannot replace/mutate the dataset or notebook ID; dataset replacement creates a fresh history instance after confirmation.
NotebookStore uses IndexedDB `stock-notebook-v1`, version 1, store `notebooks`, key `current`; custom name exists only for isolated tests.
Stored current value is exactly serialized notebook JSON text, not a second divergent object schema. exportRaw returns that untouched string or null only when absent, without parsing it; every raw export must be serializable, valid Unicode and ≤4 MiB UTF-8, including stored strings; non-string legacy/corrupt records are JSON.stringify-encoded only if serializable, valid Unicode and within 4 MiB UTF-8. Cyclic/unserializable/oversized raw values return an actionable error and never become empty backups. clear deletes only current in a committed readwrite transaction; failure retains the record.
Storage errors are safe actionable errors, not silently successful writes. Invalid saved records remain untouched for recovery/download/reset actions.

## Supported screening language — exact full-consumption grammar

Trim the sentence; ASCII keywords are case-insensitive, and one or more ASCII spaces/tabs separate words where the grammar shows spaces. Match multiword metric names before shorter prefixes.
Quoted sectors retain exact internal spacing; normalize only their surrounding whitespace. No terminal punctuation, OR, parentheses, negation, fuzzy names or trailing prose.
Empty query means default screen. A nonempty sentence follows this EBNF (quoted sector contents retain their text):
```text
query      = "companies" [" in " quotedSector] [" using currency " currency] [" with " predicate {" and " predicate}]
             [" sorted by " metric " " direction]
predicate  = shortcut | metric " " comparison " " number unit
shortcut   = "profitable" | "growing" | "low debt" | "high margin"
comparison = "above" | "at least" | "below" | "at most" | "equal to"
direction  = "ascending" | "descending"
metric     = "revenue" | "net income" | "debt" | "equity" |
             "revenue growth" | "profit margin" | "debt to equity"
unit       = " million " currency | "%" | ""
```
quotedSector is a JSON-style quoted string with only `\"`/`\\` escapes, ≤60 code points, matching an actual dataset sector case-insensitively.
Numbers use the financial numeric grammar/bounds above. Currency tokens are three ASCII letters, normalized uppercase, and must exist in the dataset.
Revenue/net income/debt/equity require ` million XXX`; growth/margin require `%`; debt to equity requires no unit. There is no number/unit inference.
Money zero may still use an explicit currency in language; only the profitable shortcut emits the cross-currency zero test.
Above/at least/below/at most/equal to map exactly to gt/gte/lt/lte/eq. No fuzzy numeric equality.
Shortcuts emit: profitable→netIncome>0 currency null; growing→growthPct>0; low debt→debtEquity≤1; high margin→marginPct≥10.
Show all expanded thresholds and units in editable controls before Apply. They are app conventions, never universal definitions of good financial health.
Default ordering is ticker ascending. Unsupported/incomplete sentences return one safe syntax error plus examples; never apply a recognized prefix.
Examples: `companies with profitable and revenue growth at least 10% sorted by profit margin descending`;
`companies in "Software" with revenue above 100 million USD and debt to equity at most 1`.
Parsing replaces sector/currency/filters/sort only; it always returns includeStale false. Manual Include stale is an explicit subsequent edit, reflected in the visible interpretation.
Notebook.query stores only the last successfully applied interpretation text; typing/invalid/staged interpretation are transient drafts and never change query/history/storage. A nonempty saved query must itself parse completely against the saved dataset.
Editing controls leaves query as the last successfully applied text and derives “Filters edited after interpretation” by comparing the current screen to parseQuery(query,dataset).screen (or default screen for empty query); effective filters, not stale query text, drive/export results.
No parse-on-keystroke application: Enter/Interpret stages the interpretation; Apply precomputes screenDataset against current today before committing one history edit. Invalid interpretation or cross-currency sort refusal leaves applied notebook/history/results/storage unchanged.

## Ratios, freshness, filtering and comparison

Derived formulas use unrounded IEEE754 numbers; never compute from displayed rounded text. Show percentages with % and money with currency plus “million”.
growthPct = 100×(revenue−priorRevenue)/priorRevenue only when both inputs exist and priorRevenue>0, else null.
marginPct = 100×netIncome/revenue only when both inputs exist and revenue>0, else null.
debtEquity = debt/equity only when both inputs exist and equity>0, else null; negative/zero equity never becomes deceptively negative/zero leverage.
Ratios may be large; require finite results and label undefined inputs/denominators explicitly. Display up to two decimals for ordinary values; a nonzero value that would display as zero instead uses scientific notation with at least three significant digits. Never display a nonzero amount/ratio as zero. Full unrounded String(number) values and exact formula inputs appear in fact details/report.
Inputs have at most six decimal places by the lexical CSV or numeric toFixed-roundtrip rule; no scaled-epsilon test is used. Formula/filter/sort arithmetic is IEEE754; do not silently replace nonfinite results with zero/null—reject with a safe arithmetic error. Tests compare independent formula outputs with relative tolerance 1e-12, while filter comparisons themselves have no epsilon.
A company is stale iff UTC day difference(today,fiscalDate)>548. Exactly 548 days is not stale. Date age measures supplied annual period end, not filing recency.
The results header/report shows the evaluated UTC date. Freshness is evaluated against current UTC today on each load/screen/report; neither import date nor saved results freezes stale status.
Screen first applies stale inclusion, exact sector/currency and all filters (AND). Null for any required metric never passes even equality/negative thresholds.
A currency-specific money filter excludes other currencies; do not convert FX. Mixed currencies may be screened together with ratios or sign-zero filters.
excludedStale counts rows excluded solely by the initial stale gate. Then evaluate sector, Screen.currency and every money-filter currency before missing/threshold checks. excludedMissing counts each remaining row with any null required metric once, even if another defined metric would fail its threshold; a wrong-currency row never contributes. Numeric threshold nonmatches without missing values are ordinary exclusions.
Remaining nonmatches are normal filter exclusions. A zero-result view shows effective criteria, missing/stale counts and Clear filters.
Money sorting is refused if matched rows contain more than one currency, even if some values are null; retain previous results and offer ratio/ticker sorting or a currency filter.
No synthetic exchange rate or lexicographic currency-plus-amount ordering. A sole currency sorts its raw amounts; ratio/ticker sorts allow mixed currencies.
Null sort values always come last for either direction. Numeric/ticker ties resolve by canonical ticker ascending; use code-unit ordering, not environment locale.
Comparison accepts 0–4 distinct known tickers, preserves the user's chosen ticker order; an empty comparison returns rows/warnings [] and monetaryComparable false. The UI requests at least two selections before showing side-by-side comparison.
Comparison facts/ratios/provenance/dates appear side by side with null shown as “Not supplied” or explicit undefined reason.
monetaryComparable is true only if all selected currencies match. If false, warn “Different currencies: amounts are not directly comparable”; do not calculate monetary deltas/ranks.
Different fiscal dates warn “Different fiscal year ends: periods may not align”, even within one currency. Show each actual date; no invented synchronization or extrapolation.
Always show the declared 12-month basis and priorRevenue comparability assumption; ratios can be compared with these caveats, never called winners/valuation recommendations.
Comparison never silently removes stale companies/watchlist entries. Mark stale rows and their age; these lists are manual research choices, not screening outputs.

## Source-linked deterministic observations

Every row shows a Reported facts block with all five raw amounts, currency, fiscal date, supplied link and exact source filename:line; a Derived ratios block names formulas/inputs.
Observation rules are fixed, independent and ordered as below, with factual wording and field links back to that same row:
Strengths: growthPct>0 → “Revenue exceeds the supplied prior annual period”; marginPct≥10 → “Calculated net margin is at least 10%”; debtEquity≤1 → “Calculated debt/equity is at most 1”.
Risks: growthPct<0 → “Revenue is below the supplied prior annual period”; marginPct<0 → “Calculated net margin is negative”; debtEquity>2 → “Calculated debt/equity exceeds 2”; equity≤0 → “Reported equity is nonpositive; debt/equity is undefined”.
Zero growth and margins 0–<10 or debt/equity >1–≤2 produce no strength/risk claim; thresholds are not a completeness claim or industry-adjusted assessment.
Uncertainties, ordered: growth/margin/leverage undefined reasons, then missing raw amounts in revenue/priorRevenue/netIncome/debt/equity order; stale fiscal date; missing filing link; always “Figures and period comparability are supplied by the importer and have not been independently verified”.
Emit each missing-FIELD observation at most once; several ratio reasons may cite the same missing input because they describe distinct undefined metrics. Null ratio reasons distinguish missing data, zero denominator and nonpositive equity. Missing either input takes precedence over denominator reasons; with both inputs present, priorRevenue/revenue zero gives zero-denominator and equity≤0 gives nonpositive-equity.
Stable code strings are growth-positive, margin-high, leverage-low, growth-negative, margin-negative, leverage-high, equity-nonpositive, growth-undefined, margin-undefined, leverage-undefined, missing-FIELD, stale-period, missing-source, unverified-inputs.
fields contain exactly the raw inputs relevant to the claim; freshness cites fiscalDate, missing-source cites filingUrl, unverified-inputs cites fiscalDate/priorRevenue.
No net “bullish/bearish” summary, recommendations, confidence estimate, inferred quality label or prose absent a defined rule. Display “No rule-based strengths/risks found” when empty.

## Editor, import transactions and persistence

Layout: import/current-source header, language+editable filters, shortlist, selected-company details; Comparison and Watchlist/notes are accessible tabs with persistent selection.
First visit offers Import CSV, Download blank template and clearly labelled Load synthetic demo; no invented stock quotes or charts.
Read the real file, stage the entire parse and show filename, rows, missing counts, currencies, date range, stale count and exact units/basis confirmation before Replace universe.
Invalid import never changes current notebook/history/storage. A newer import/restore attempt supersedes an older pending read using an operation generation; late completion cannot publish.
Replacement confirmation states that current watchlist/notes/comparison/history will be cleared and offers Download current backup before proceeding; cancel retains everything.
Successful import creates a new notebook, empty annotations/default screen, and one history baseline. Commit storage transaction before claiming saved; in-memory work remains usable on quota failure.
JSON restore likewise validates whole structure/reference/date bounds and applied-screen computability before replacement and uses the same explicit confirmation. Never merge partially valid backups.
Autosave validated committed edits after a 300ms debounce; monotonically queued snapshots cannot let an older save overwrite a newer state. Switching datasets cancels queued generations.
On startup load+validate before publication. Corrupt/incompatible/future-dated stored data offers Download raw saved record and explicit Reset; do not overwrite it with a demo.
Save failure shows an enduring unsaved indicator and Backup now/Retry; edits and undo still work in memory. Explicit save success clears it only for the matching latest generation.
Undo/redo covers title, applied query/screen, watchlist/comparison/notes; new edit clears redo. Selection-only navigation and staged query/import do not create history entries.
Search/sector dropdowns are conveniences, never hidden financial predicates. Render all imported text with textContent; no HTML/Markdown execution.

## Exports and verification gates

JSON backup contains validated dataset/provenance/notes/effective filters, excludes cached results and transient save state, and reopens to equivalent behavior.
Plain UTF-8 `.txt` research report is bounded to 8 MiB UTF-8 and contains title, export UTC date, source filename/date, synthetic label, declared units/basis, last query plus effective criteria, sort/stale policy, all shortlist facts/formulas/observations, selected comparison, watchlist and notes.
Report includes exact source row and supplied URL for each company, current freshness, missing-data explanations and the unverified-input statement. Do not export HTML or a misleading prediction.
No company CSV export in this milestone; the blank template contains header only. If added later, every spreadsheet formula-leading text cell must be neutralized in addition to RFC4180 quoting.
Download real files through Blob URLs, revoke them after download scheduling; snapshot validation/report generation occurs before any download.
Reference fixture: USD annual revenue120/priorRevenue100/netIncome12/gross debt40/equity80 yields growth20%, margin10%, debt/equity0.5 and all three defined strengths. With today2026-10-04, fiscal2025-04-04 is548days old/fresh and2025-04-03 is549days old/stale.
Unit gates: actual RFC4180 UTF-8 fixtures; valid six-decimal amounts34237.026104 and543113052.487179; missing/zero/negative equity; BOM/CRLF/quotes/line provenance; duplicate/future/invalid dates; exact 500 rows; malformed URL; oversized bytes; no partial imports.
History regression crosses UTC midnight with an EUR row age548→549 and a fresh USD row: current-day monetary Apply/commit succeeds when only USD remains, without constructor-date rejection.
Independent scalar fixtures include debt0/equity80→leverage0+leverage-low, debt0/equity0 or−1→undefined leverage (never leverage-low), and missing numerator plus zero denominator→missing-input reason. They prove ratios, threshold boundaries, 548/549-day freshness, null-last sort both directions, ticker ties, cross-currency rejection, comparison warnings and every observation code/field.
Parser gates exercise all exact shortcuts/operators/units, escaped sector, duplicate/contradictory filters, unsupported OR/negation, bad suffix/full consumption, malformed numbers and 16/17 filters.
Real production Chromium gate: import an original non-demo CSV with missing/negative values and two currencies; inspect staged units; apply language then edit filters; verify source links and known shortlist; compare currencies/date warnings; save notes/watchlist.
Independently decode downloaded JSON/text; reopen JSON after a full reload and compare facts/annotations/effective filters; prove export uses applied controls after query edits.
Production invalid CSV/JSON replacement and cancelled confirmation preserve prior notebook; stale pending read cannot publish; seeded bad IDB data remains recoverable; quota/transaction failure shows unsaved and preserves the usable current state.
Use real IndexedDB and actual downloads, no fake endpoint or substitute product; keyboard-only flows and accessible labels cover import, filters, results, tabs, notes and recovery.
Run scoped units, typecheck, lint, production build and browser suite; record measured max500-row import/screen/report latency, with a target below 1s each on the repository's Chromium environment.
Ship README with schema/example, annual/currency caveats, supported grammar, persistence/backup limits and honest delivered subset; catalog remains ACTIVE.
