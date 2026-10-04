# Stock Notebook

An offline workspace for turning supplied annual financial data into an understandable research shortlist. Import a company universe, inspect a supported-language interpretation, apply editable filters, compare the underlying figures and keep notes. Download a research report or an editable notebook backup. Data stays in this browser.

This is the first, deterministic screening milestone for catalog idea #13. The parser and observations follow documented rules; they are not AI analysis. The initial milestone is tracked in [issue #32](https://github.com/twangyal/projects-monorepo/issues/32). Broad language understanding, generated outlooks and live financial coverage remain future work.

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
| `ticker`, `name`, `sector` | A unique ticker in this universe, company name and sector label. |
| `currency` | Three uppercase letters supplied by the importer; no exchange-rate conversion. |
| `fiscal_date` | Actual fiscal year-end date in `YYYY-MM-DD`, from 2000-01-01 through the current UTC date. |
| `revenue`, `prior_revenue` | Nonnegative current and prior annual revenue, in currency millions. |
| `net_income` | Signed annual net income, in currency millions. |
| `debt` | Nonnegative **gross debt**, in currency millions; not net debt after cash. |
| `equity` | Signed equity, in currency millions. |
| `filing_url` | Optional supplied HTTPS source link. It is displayed, never fetched or authenticated by the app. |

An empty numeric cell means **not supplied**, never zero. Use ordinary decimal notation with at most six decimal places and magnitude at most 1,000,000,000 million. Do not include separators, currency symbols, percent signs, exponent notation or `N/A`. A file may contain different currencies, but each row must use one consistent currency and scale.

Import supports UTF-8, a leading BOM, LF/CRLF, quoted commas and escaped quotes. Fields must be single-line. The complete file is rejected on malformed syntax, inconsistent columns, duplicate tickers, future/invalid dates or invalid values. CSV is bounded at 2 MiB and 500 companies. Exact source filename and physical row are retained with the facts.

Choose **Load synthetic demo** to explore original fictional companies. Its synthetic label persists through views, backup and research report; its figures are not real company information.

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

## Understand the evidence

Each company keeps reported facts separate from derived ratios and fixed-rule observations. Growth is `100 × (revenue − prior revenue) / prior revenue`, margin is `100 × net income / revenue`, and leverage is `gross debt / equity`. Missing inputs or a nonpositive denominator leave the ratio undefined with an explanation. A negative equity value is never turned into misleading negative leverage.

Thresholds, filtering and sorting use unrounded numbers. Displayed details and reports retain the full computed values and inputs; very small nonzero values use scientific notation rather than displaying as zero. Arithmetic uses IEEE754 numbers and does not claim accounting-ledger precision.

By default, fiscal periods more than 548 days old are excluded. **Include stale** is explicit. Age is measured from the supplied annual period end, not filing publication, and is reevaluated against the displayed UTC date. Watchlist and comparison selections remain visible even when their periods become stale.

Money filters identify their currency; monetary sorting refuses mixed-currency matches. Ratio sorting supports mixed currencies with dates and assumptions visible. Missing sort values come last in either direction. Comparison shows up to four companies, warns about currency and fiscal-date differences, and computes no invented exchange rates or monetary ranks across currencies.

Rule-based strengths, risks and uncertainties cite only the row's supplied fields and visible formulas. They do not establish investment quality, fair value, future returns or a complete financial outlook. Supplied source links remain unverified.

## Keep and recover work

One notebook is autosaved locally after committed edits. It includes the dataset, applied screen, watchlist, comparisons and notes. Up to 30 edit states fit within an 8 MiB history budget; the immutable dataset is held once. Replacing the universe starts a new history and clears its old annotations only after successful staging and confirmation.

JSON backups are bounded at 4 MiB and validated atomically on import. A plain UTF-8 research report includes effective criteria, source provenance, facts, formulas, observations, comparisons and notes. The report is a readable snapshot; use JSON to reopen an editable notebook.

Save failures leave work usable in memory with backup/retry actions. Corrupt or incompatible saved records are retained for raw backup or explicit reset, not replaced by a demo. A raw record that cannot be safely serialized within the bound produces an error rather than an empty backup. Keep downloaded backups for data you need to retain.

## Verify

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

For system Chromium use `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`. The browser suite reserves port 4271 and uses the production app, real IndexedDB and actual downloaded files. Its storage harness is built only for tests.

Verified locally with **67 unit tests**, ESLint, TypeScript, the production build and **15 production Chromium tests**. Independent arithmetic, source parsing, interpretation, ordering, persistence and full workflow checks verify the tool's processing; they do not verify uploaded financial facts. Browser checks cover native IndexedDB transactions and recovery, real CSV and downloaded reports/backups, import races, unsupported criteria, keyboard and mobile use.

A single Chromium 151 production-build measurement on Debian 13 used 500 original fictional companies in a 55,529-byte CSV: parsing 13.8 ms, screening 9.9 ms and report creation 54.1 ms. The actual UI rendered all 500 rows in 274 ms and downloaded a 593,257-byte report retaining source line 501. These are local sample measurements, not a worst-case 2 MiB benchmark or a device-performance guarantee. See [runtime-verification.json](docs/runtime-verification.json) for exact measurements and limitations.
