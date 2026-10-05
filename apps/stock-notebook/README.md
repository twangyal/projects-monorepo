# Stock Notebook

An offline workspace for turning supplied annual financial data into an understandable research shortlist. Import a company universe, inspect a supported-language interpretation, apply editable filters, compare the underlying figures and write company briefs with explicitly attached sources. Download a research report or an editable notebook backup. Data stays in this browser.

This is a deterministic screening and annual-history workspace for catalog idea #13. The parser and observations follow documented rules; they are not AI analysis. The initial milestone is tracked in [issue #32](https://github.com/twangyal/projects-monorepo/issues/32), with supplied annual history in [issue #35](https://github.com/twangyal/projects-monorepo/issues/35). Broad language understanding, generated outlooks and live financial coverage remain future work.

## Run

Use Node.js 22.18 or newer (CI uses Node 24) and current desktop Chromium.

```sh
cd apps/stock-notebook
npm ci
npm run dev
```

Open `http://localhost:4270`. For a production build:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 4270 --strictPort
```

There is no backend, account, API key, paid service or model download. Browser storage belongs to the exact origin, so changing the host or port opens a different notebook. Download a JSON backup before moving work or clearing browser data.

## Annual CSV format

Use this exact header order, available through **Download blank template**:

```csv
ticker,name,sector,currency,fiscal_date,revenue,prior_revenue,net_income,debt,equity,filing_url
```

Every amount is in **millions of the row's declared currency**. Each row represents a 12-month fiscal year; `prior_revenue` is the comparable preceding 12-month period. The import review requires confirmation of these assumptions. Changes in fiscal length, acquisitions, restatements and accounting basis can undermine comparisons; this tool cannot verify the source facts.

| Field | Meaning |
| --- | --- |
| `ticker`, `name`, `sector` | A normalized ticker identifying up to five supplied annual periods, with the company name and sector reported for that row. |
| `currency` | Three uppercase letters supplied by the importer; no exchange-rate conversion. |
| `fiscal_date` | Actual fiscal year-end date in `YYYY-MM-DD`, from 2000-01-01 through the current UTC date. |
| `revenue`, `prior_revenue` | Nonnegative current and prior annual revenue, in currency millions. |
| `net_income` | Signed annual net income, in currency millions. |
| `debt` | Nonnegative **gross debt**, in currency millions; not net debt after cash. |
| `equity` | Signed equity, in currency millions. |
| `filing_url` | Optional supplied HTTPS source link. It is displayed, never fetched or authenticated by the app. |

An empty numeric cell means **not supplied**, never zero. Use ordinary decimal notation with at most six decimal places and magnitude at most 1,000,000,000 million. Do not include separators, currency symbols, percent signs, exponent notation or `N/A`. A file may contain different currencies, but each row must use one consistent currency and scale.

Import supports UTF-8, a leading BOM, LF/CRLF, quoted commas and escaped quotes. Fields must be single-line. The complete file is rejected on malformed syntax, inconsistent columns, duplicate ticker/fiscal-date pairs, more than five periods for one ticker, future/invalid dates or invalid values. CSV is bounded at 2 MiB and 500 annual rows total. Exact source filename and physical row are retained with the facts. Dates may be in any order; the original CSV row order is preserved, and chronology is derived separately. Replacing a universe imports one complete CSV; the app does not merge duplicate periods or decide which restatement is authoritative.

Choose **Load synthetic demo** to explore original fictional companies. Its synthetic label persists through views, backup and research report; its figures are not real company information.

## Refresh data while keeping research

With a notebook open, choose **Refresh financial data** to stage a complete replacement CSV. Your current data and research remain usable while you review the proposal. The incoming file must contain every annual row you want to retain; refresh does not merge it with older files. Missing old periods are removals, including when the company itself remains.

The review separates reported-fact changes from filename, source-line and filing-link changes. It shows both supplied rows, added/removed companies and periods, and any latest fiscal date moving backward. All periods remain inspectable in pages of 50, with scrollable tables and expandable filing URLs. Sources are not fetched or verified.

The notebook keeps its ID and title. Watchlist/comparison order, literal saved notes and complete cited briefs carry forward automatically when the ticker's latest name, sector, currency and synthetic status are unchanged. Changed company details require an explicit **Keep research** or **Drop research** decision for that ticker's complete research group. A matching ticker does not prove issuer continuity. Removed tickers cannot retain annotations; their research remains available in the previous notebook backup and proposed review. Retained notes and cited snapshots are not rewritten to match new figures. The review includes complete prior briefs, including any dropped research, with separate financial, issuer and source differences against the incoming data. A retained citation to a removed annual period remains intact and is labeled missing.

Choose whether to keep applied criteria and the saved interpretation, keep the criteria but clear the interpretation, or reset both. Each choice is checked against the incoming latest periods. Missing sectors/currencies, unsupported saved text or mixed-currency monetary sorting require an explicit compatible choice; filters are never silently repaired. Draft editor values do not affect this preview.

Unsent title, screening, filter, note or brief drafts (including drafts in another company) block Apply. Save/apply them with the existing controls and **Rebuild refresh review**, or explicitly **Discard editor drafts for refresh**. Discarding affects only unsent drafts; notebook backups contain committed work. Any later edit or changed UTC date makes the review stale. Rebuilding keeps the validated incoming file and resets decisions and confirmations.

Before applying, **Download previous notebook** for an editable backup and optionally **Download refresh review** for the complete proposed change record, including old/new source references, full saved notes and complete prior briefs. The text review is bounded at 8 MiB and is explicitly a proposal, not proof of a saved transaction. It is not stored inside the notebook. An oversized report fails without a partial download or changing either dataset.

Confirm the units and any removed periods/research, then choose **Apply reviewed refresh** and confirm the replacement. Successful application starts a **fresh undo history**: Undo cannot restore the previous dataset. The refreshed notebook becomes usable in memory, and the save status confirms when browser storage completes. If saving fails, download its notebook backup and use **Retry saving**; the last durable record stays intact. Reopened JSON and research reports contain the incoming data, accepted criteria and retained research. See [issue #56](https://github.com/twangyal/projects-monorepo/issues/56).

## Interpret, inspect, then apply

The supported language has a small explicit grammar. These examples show valid forms when the named sector/currency exists in the imported universe:

```text
companies with profitable and revenue growth at least 10% sorted by profit margin descending
companies in "Software" with revenue above 100 million USD and debt to equity at most 1
companies using currency USD sorted by revenue descending
```

Use `above`, `at least`, `below`, `at most` or `equal to`. Available metrics are revenue, net income, debt, equity, revenue growth, profit margin and debt to equity. Amount thresholds require `million XXX`; growth and margin require `%`; debt/equity has no unit. Criteria combine with `and`. Unsupported clauses, OR, negation and trailing prose produce an error; a recognized prefix is never silently applied.

The shortcuts expand visibly: **profitable** means net income > 0, **growing** means growth > 0%, **low debt** means gross debt/equity ≤ 1, and **high margin** means margin ≥ 10%. These are app conventions, not universal judgments of financial health. Review the interpretation and editable controls before applying it.

Results and exports use the **applied controls**. After manual changes, the app marks that filters differ from the last interpreted text. Draft text or an invalid interpretation cannot silently alter the current shortlist.

The **Excluded companies** tab explains every failed applied rule for each ticker's latest supplied annual row. It shows unrounded threshold values, missing inputs or invalid ratio denominators, fiscal age, sector/currency mismatches and source fields. A money filter with a different currency is rejected without comparing its amounts. A company can have multiple reasons; stale/missing headline counts retain their existing first-gate precedence and are not counts of every audit reason. Open **View excluded evidence** to inspect its full facts/history and keep a research note. Draft criteria do not change these decisions until applied. The downloaded research report includes the same exclusion audit and source provenance. See [issue #37](https://github.com/twangyal/projects-monorepo/issues/37).

## Understand the evidence

Screening, sorting, current facts, watchlists and company comparisons select each ticker’s **latest supplied fiscal date first**. Older profitable or complete rows cannot rescue a latest row that fails a filter or has missing values. Sector and currency choices also come only from latest rows. Notes and manual selections belong to the ticker, while every historical fact keeps its own date and source.

Each company keeps reported facts separate from derived ratios and fixed-rule observations. Growth is `100 × (revenue − prior revenue) / prior revenue`, margin is `100 × net income / revenue`, and leverage is `gross debt / equity`. Missing inputs or a nonpositive denominator leave the ratio undefined with an explanation. A negative equity value is never turned into misleading negative leverage.

Thresholds, filtering and sorting use unrounded numbers. Displayed details and reports retain the full computed values and inputs; very small nonzero values use scientific notation rather than displaying as zero. Arithmetic uses IEEE754 numbers and does not claim accounting-ledger precision.

By default, fiscal periods more than 548 days old are excluded. **Include stale** is explicit. Age is measured from the supplied annual period end, not filing publication, and is reevaluated against the displayed UTC date. Watchlist and comparison selections remain visible even when their periods become stale.

Money filters identify their currency; monetary sorting refuses mixed-currency matches. Ratio sorting supports mixed currencies with dates and assumptions visible. Missing sort values come last in either direction. Comparison shows up to four companies, warns about currency and fiscal-date differences, and computes no invented exchange rates or monetary ranks across currencies.

Rule-based strengths, risks and uncertainties cite only the row's supplied fields and visible formulas. They do not establish investment quality, fair value, future returns or a complete financial outlook. Supplied source links remain unverified.

## Inspect supplied annual history

Opening company evidence shows all accepted annual rows in date order, with their own names, sectors, currencies, five reported amounts and supplied source links. These remain visible even when automatic comparison is unavailable. A history table is horizontally scrollable on small screens.

Historical changes compare **adjacent supplied rows only**. Automatic comparison requires consecutive calendar years, matching fiscal month/day (February 28/29 is allowed), and identical company name, sector and currency. Otherwise a reason is shown and automatic deltas are withheld. This is a conservative alignment rule, not accounting verification: a 52/53-week fiscal calendar, renamed company or changed business classification can require manual comparison. Missing years and missing values are never bridged.

For comparable rows, revenue and gross debt show `current − previous` in currency millions. Relative change is `100 × (current − previous) / previous` only when the previous amount is positive; a zero base can retain an absolute difference while relative change is unavailable. Net-margin changes use **percentage points** between valid per-period margins. No currency conversion or annualization is performed.

Each row’s declared `prior_revenue` remains independent of another uploaded row’s revenue. For example, current revenue 150 and declared prior revenue 120 yield **25% screening growth**. If the preceding stored row reports revenue 100, its separately labeled historical change is **50%**. Both sources remain intact and a disagreement warning is shown; the app does not infer or fix a restatement.

Neutral direction summaries cover **all three to five supplied periods** only when every pair and metric qualifies and no prior-revenue disagreement is present. They distinguish strict increases, strict decreases, unchanged values, and mixed or unchanged intervals. Missing or incomparable data produces an unavailable reason. These are retrospective descriptions, not predictions or investment-quality assessments.

## Write cited company briefs

Open **View evidence** from a shortlist, watchlist or comparison, or **View excluded evidence** for a company outside the current screen. **Company brief** separates your saved statements into **Business**, **Risks** and **Open questions**. Existing research notes remain independent.

Write a statement and explicitly choose its citation attachments before **Save statement**. Unattached statements are visibly **Uncited**. Adding a source only adds it to the library; it does not attach it or establish that it supports a claim.

For supplied text, enter **Source title** and **Supplied excerpt**, with optional author, publication date and HTTPS link, then **Add excerpt citation**. The app neither fetches nor authenticates that source. For financial evidence, choose the exact **Annual period to cite**, explicitly select one or more raw fields, and **Capture annual fields**. No fields are preselected. The immutable snapshot retains the complete supplied row and its dataset ID, filename, import date, units, synthetic label and physical source line. Null means not supplied; zero remains zero. Declared prior revenue remains independent of another stored year's revenue.

**Inspect citation** reveals the complete source. Annual citations compare only the selected financial values plus issuer identity and source metadata with that exact ticker and fiscal date in the current dataset. A new filename, row or link is a source difference even when values match. Removing the captured year makes the citation **missing**; a newer year cannot replace it. Unselected amounts are retained as context. A matching source does not verify the authored statement or issuer continuity.

Saved sources are immutable. To correct one, add a new citation, explicitly edit the statement attachments, then delete the old source after nothing references it. Deleting a statement keeps its source library. Removing the final item requires **Delete brief**, with confirmation; Undo restores the complete brief. Undo/Redo and deletion ask you to finish or discard conflicting brief drafts first. Draft forms stay separate for each company, and ordinary save completion preserves their text and focus. **Discard brief drafts** discards only the selected company's unsent brief forms.

**Download company brief** exports the selected company's complete committed statements and sources. Whole-notebook and proposed-refresh reports include every complete applicable brief, including excluded or dropped research. JSON backups preserve literal whitespace, tabs, LF/CRLF and Unicode exactly; an explicit later edit in a browser textarea can normalize line endings. Reports preserve source text and clearly separate statements, citations and current-data differences.

Limits are 50 briefs per notebook, 12 statements and 12 citations per brief, 100 citations overall, and six attachments per statement. Statement text permits 1,200 Unicode code points, excerpts 4,000, titles 160 and authors 120. The complete compact UTF-8 brief graph is bounded at 1 MiB independently of the notebook limit. A failed edit keeps the prior saved graph and raw draft intact. See [issue #67](https://github.com/twangyal/projects-monorepo/issues/67).

## Keep and recover work

One notebook is autosaved locally after committed edits. It includes the dataset, applied screen, watchlist, comparisons, notes and complete cited briefs. Up to 30 edit states fit within an 8 MiB history budget; the immutable dataset is held once. **Replace universe** starts a new history and replaces its old annotations only after successful staging and confirmation. **Refresh financial data** instead retains the research accepted in its review, also starting a new history for the new dataset.

JSON backups use schema v3, are bounded at 6 MiB and are validated atomically on import. Valid schema-v1 single-period and schema-v2 annual-history notebooks migrate in memory with IDs, facts, controls and annotations retained and an empty brief library. Legacy inputs retain their original 4 MiB raw and canonical bounds before the new field is added; old v1 records with duplicate tickers remain invalid. The existing browser database location is unchanged. Loading a legacy record does not rewrite its raw saved bytes; a subsequent successful save writes v3. A plain UTF-8 research report includes effective criteria, source provenance, facts, formulas, observations, comparisons, notes and every complete brief, including excluded companies. Text reports are bounded at 8 MiB and fail without a partial download; a complete JSON backup remains available independently. A dedicated annual-history appendix retains every supplied period once, including companies excluded by the current screen, with source rows, formulas and comparison reasons. The report is a readable snapshot; use JSON to reopen an editable notebook.

Save failures leave work usable in memory with backup/retry actions. Corrupt or incompatible saved records are retained for raw backup or explicit reset, not replaced by a demo. A raw record that cannot be safely serialized within the bound produces an error rather than an empty backup. Keep downloaded backups for data you need to retain.

## Verify

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

For system Chromium use `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`. The browser suite reserves port 4271 and uses the production app, real IndexedDB and actual downloaded files. Its storage harness is built only for tests.

The original milestone passed 67 unit and 15 production Chromium tests. Annual history passed 105 unit and 20 browser cases together at `236be2e`. The initial exclusion audit passed 110 unit tests, ESLint, TypeScript, the production build, the exact 2 MiB annual-history smoke and 22 browser cases in [exact-source CI](https://github.com/twangyal/projects-monorepo/actions/runs/37170541308) at `096d575`. The corrected Unicode report flow passes **111 unit tests and all 22 browser cases locally and in [exact-source CI](https://github.com/twangyal/projects-monorepo/actions/runs/37171297057)** at `66125d0`, plus lint, type checking and build. Independent arithmetic, source parsing, interpretation, ordering, persistence and full workflow checks verify processing, not uploaded financial facts. Audit cases cover operator boundaries, simultaneous failures, latest-period selection, currency rejection, missing and zero denominators, drafts, undo/redo, evidence, notes, native reopen, actual downloads and mobile keyboard navigation.

The expanded production case uses a 120-code-point Unicode filename and maximum-length company/sector text. It retained 500 excluded companies with 8,000 threshold failures and 499 sector failures, downloaded a 4,495,041-byte report and reopened the identical notebook. Each exclusion block retains its source once and every reason retains its raw fields, avoiding thousands of repeated filenames. Literal imported markup stayed text; mobile layout had no page overflow, and no external requests or page errors occurred. These are fixture measurements, not device-performance guarantees; see [audit verification evidence](docs/2026-10-04-exclusion-audit-verification.json).

A single Chromium 151 production-build measurement on Debian 13 used 500 original fictional companies in a 55,529-byte CSV: parsing 13.8 ms, screening 9.9 ms and report creation 54.1 ms. The actual UI rendered all 500 rows in 274 ms and downloaded a 593,257-byte report retaining source line 501. These are local sample measurements, not a worst-case 2 MiB benchmark or a device-performance guarantee. See [runtime-verification.json](docs/runtime-verification.json) for exact measurements and limitations.


For a reproducible maximum-bound annual-history fixture and independent arithmetic check:

```sh
node --experimental-strip-types scripts/annual-history-smoke.ts
```

The command writes original fictional CSV, schema-v3 JSON, a complete report and measured results into a new temporary directory; it never fetches the supplied source links. CI runs this check too. [Annual-history evidence](docs/2026-10-04-annual-history-verification.json) records an exact 2 MiB CSV with 500 annual rows across 100 tickers, five periods each in deliberately unsorted source order, and long retained source links. Node parsed it in 201 ms and built the 3,518,575-byte report in 245 ms. Real Chromium staged it in 289 ms, published 100 current cards in 466 ms, and downloaded a 3,521,695-byte report after a watchlist/note edit. All 500 annual appendix blocks and source row 501 were retained. Native IndexedDB reopen reproduced the downloaded notebook exactly; desktop/mobile layouts and keyboard table scrolling passed with zero external requests or page errors. These are single-runtime measurements of this fixture, not device-performance or financial-accuracy guarantees.

The isolated [learned-paraphrase experiment](experiments/paraphrase/README.md) in issue #36 failed development readiness and is not enabled. Its fitted model, immutable failure evidence and independent numerical checks are reproducible; no held-out evaluation or learned product behavior is claimed.

## Reviewed refresh verification (2026-10-04)

The refresh milestone passed **149 unit tests and all 34 production browser cases**, full lint, type checking and the normal production build. Twelve new browser cases cover real files, complete downloads, changed research decisions, raw editor drafts, stale reads/reviews, UTC rollover after native confirmation, IndexedDB rollback/retry, older queued writes, read-only v1 migration and mobile keyboard operation. Independent engine/report and UI lifecycle reviews found no remaining issues. [Chromium 153 CI](https://github.com/twangyal/projects-monorepo/actions/runs/37179896113) passed implementation commit `85091d8`; all twelve project workflows passed that commit. The unchanged isolated experiment's 31 tests and frozen development diagnostics also passed without opening holdouts.

Reproduce the maximum data/retention gate with original fictional inputs:

```sh
node --experimental-strip-types scripts/refresh-smoke.ts
```

It writes two exact **2 MiB CSVs**, each with 500 annual rows and five periods per ticker, plus before/after notebooks, a complete proposed review and research report into a new temporary directory. The disjoint histories create a **1,000-period union**. Independent assertions verify latest-period selection, correct old/new source references and exact retention of 100 watchlist entries, four ordered comparisons and 100 notes of 4,000 Unicode code points each. CI runs this gate as well.

An additional normal-production Chromium 151 run reviewed all twenty 50-period pages, retained the native record unchanged while reviewing, applied the accepted refresh and reopened the exact downloaded notebook. The actual **4,057,011-byte proposed review** preserved every old/new period and full note; the **5,026,336-byte research report** used only incoming financial provenance. Observed review preparation was 673 ms, proposed-report download 1.17 s, and application through native save completion 1.36 s. Desktop and 390 px mobile layouts had no page overflow, external requests or page errors.

A separate persistent-profile run applied the same maximum refresh through the UI, closed the entire Chromium process, then launched a new process against the same profile. Downloaded JSON and native IndexedDB remained byte-identical at 2,274,413 bytes, retaining all incoming rows and accepted research. These are individual synthetic-data observations, not device-performance, financial-accuracy or OS-crash guarantees. See [the complete refresh evidence](docs/2026-10-04-refresh-verification.json); no learned product behavior or issuer verification is claimed.

## Cited brief verification (2026-10-04)

[Stock CI](https://github.com/twangyal/projects-monorepo/actions/runs/37199016473) passed the complete implementation at `634c4668da4bf9e45a669bbd0a315abba983ab13`, including 206 unit and 49 Chromium 153 browser cases, lint/typecheck/build and the existing maximum-data checks.

The v0.4 milestone passes **206 unit tests and all 49 native Chromium cases**, including every previous authoring, annual-history, refresh and recovery flow, plus lint, type checking and the normal production build. Independent fixtures pin literal CRLF/Unicode, immutable snapshots, selected versus contextual financial drift, null/zero, source-only changes, missing captured periods, complete dropped-brief reports, real near-4 MiB legacy migration and exact 1 MiB graph/6 MiB notebook bounds. Native checks cover stable focus/caret during held real transactions, failed-write rollback/retry, delayed files, stale refreshes, explicit attachments and full process restart.

To reproduce the separate artifact check, start the normal production preview, then run:

```sh
STOCK_BRIEFS_BASE_URL=http://127.0.0.1:4270 \
STOCK_BRIEFS_OUTPUT_DIR=/tmp/stock-cited-briefs-check \
CHROMIUM_PATH=/usr/bin/chromium node scripts/smoke_cited_briefs.mjs
```

The original fictional fixture contains **50 briefs, 100 citations and exactly 1,048,576 UTF-8 bytes of brief data**. Real imports and downloads preserve every statement, excerpt and captured row. Fifty explicit Keep decisions retain the graph after the captured annual periods disappear; the proposed report includes all prior evidence. A complete Chromium process restart preserves byte-identical JSON and the full research report. The script writes original inputs, actual downloads, screenshots and measured results. Source links are never fetched. These checks verify processing and recovery, not issuer identity, source authenticity, claim support or investment quality. See [cited-brief verification](docs/2026-10-04-cited-briefs-verification.json).


### Damaged-record recovery verification

Issue [#72](https://github.com/twangyal/projects-monorepo/issues/72) keeps raw saved text byte-exact, including malformed or duplicate-key JSON. Structured records export only when they are losslessly representable JSON within the current 6 MiB notebook cap. Undefined values, nonfinite numbers, negative zero, exotic types, sparse/extended arrays, hidden/computed fields, cycles and nesting beyond 512 levels reject without changing storage. Shared subtrees are charged at every serialized occurrence before expansion. This backup preserves JSON values, not object reference identity; it is not a general structured-clone archive.

Database schema setup exceptions now abort the upgrade and give sanitized backup/retry guidance. Actual Chromium 153 regressions verify retained unsafe native records, compact shared graphs, exact escaped UTF-8 boundaries, rollback and same-store retry. The full schema-3 gate passes **231 unit tests and 53 browser cases**, lint/type checking/build, unchanged isolated experiment checks and maximum annual-history/refresh fixtures. [Measured red/green evidence](docs/2026-10-04-raw-recovery-verification.json) records CI commits and limits. Local browser installation was blocked; native verification ran in CI.


### Held-transaction recovery verification

Issue [#77](https://github.com/twangyal/projects-monorepo/issues/77) adds a nominal 10-second deadline to each created native transaction. A still-active or blocked transaction is aborted; its native rollback event releases the ordered queue. If a commit has already completed before the deadline callback runs, the real completion event reports that commit correctly. Timers and connections are released on success, failure and close. Previously queued operations start their own deadlines when their transactions are created; browser scheduling can delay timer callbacks in background or suspended pages.

Actual Chromium tests held a native write open and blocked load/clear behind a separate connection. Both failed against unchanged code, then passed with exact prior-record preservation, queue recovery and retry. A separate native commit/deadline-ordering fixture verifies committed data is never falsely reported as rolled back. The full gate passes **231 unit tests and all 56 browser cases**, lint/type checking/build, isolated experiment diagnostics and maximum annual/refresh probes. See [the measured verification record](docs/2026-10-04-transaction-timeout-verification.json).

Issue [#120](https://github.com/twangyal/projects-monorepo/issues/120) extends
terminal ordering to synchronous request setup errors and store close. An admitted
write waits for actual native rollback before reporting failure or releasing the
same-database queue. Closing after native commit reports the committed result;
new calls on the closed store still fail. Three original native regressions failed
before the fix and now pass with exact complete-record preservation and a separate
instance retry. The complete local gate passes **231 unit tests and 59 browser
cases**, lint/type checking/build. See [the verification record](docs/2026-10-05-terminal-outcomes.json).
