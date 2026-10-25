# Stock Notebook

An offline, in-browser workspace for turning supplied annual financial data into a research shortlist. Import a company universe from CSV, describe a screen in a small structured query language, review and edit the resulting filters, compare figures and history, and write company briefs with explicitly attached citations. Interpretation and observations follow fixed, documented rules; there is no AI analysis and no live market data.

**Status:** DEFERRED (2026-10-25) — paused while the portfolio focuses on Gaze Navigator, Clothing Studio and Karaoke Studio. Direction: [docs/PRODUCT_DIRECTION.md](../../docs/PRODUCT_DIRECTION.md)

## What works today

- CSV import of up to five annual periods per ticker (blank template and a synthetic demo of fictional companies included), with whole-file validation and an assumptions review.
- Screening text such as `companies in "Software" with revenue above 100 million USD and debt to equity at most 1` is parsed into visible, editable filters before you apply them. Unsupported text is rejected rather than partly applied.
- Metrics: revenue, net income, gross debt, equity, revenue growth, profit margin and debt to equity, always taken from each ticker's latest period; stale periods are excluded unless **Include stale** is chosen.
- **Excluded companies** explains every failed rule per ticker.
- Annual history per company with conservative period-to-period changes (withheld when periods are not comparable).
- Watchlist, side-by-side comparison of up to four companies, and free-text notes.
- Company briefs (Business, Risks, Open questions) whose statements cite supplied excerpts or captured snapshots of annual fields; citations flag drift or missing periods after data changes.
- **Refresh financial data**: stage a replacement CSV, review every change, decide which research to keep, then apply.
- Downloads: plain-text research report, company brief, refresh review and an editable JSON notebook backup; IndexedDB autosave with Undo/Redo and damaged-record recovery.

## Known gaps

- The direction calls for an AI model (free access only) to interpret natural-language requests into validated filters, with clarification. Today only the fixed grammar works. An offline learned-paraphrase trial (see `experiments/`) did not work well enough and is not used.
- No live or fetched financial data; filing links are shown but never fetched or verified.
- No generated research summary or outlook; observations are rule-based.
- No currency conversion; monetary sorting across currencies is refused.

## Run locally

Requires Node.js 22.18 or newer (CI uses Node 24). No backend, account, API key or model download.

```sh
cd apps/stock-notebook
npm ci
npm run dev                 # http://localhost:4270
```

Production build and preview:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 4270 --strictPort
```

CSV header (amounts in millions of the row's currency; empty means not supplied):

```csv
ticker,name,sector,currency,fiscal_date,revenue,prior_revenue,net_income,debt,equity,filing_url
```

Browser storage is tied to the exact origin; download a JSON backup before changing host/port or clearing browser data.

## Verify

```sh
npm run check            # unit tests + ESLint + typecheck + production build
npx playwright install chromium
npm run test:browser     # Playwright against the production build on port 4271
```

Individual steps: `npm run test`, `npm run lint`, `npm run typecheck`, `npm run build`. Set `CHROMIUM_PATH` to use an existing Chromium. Test builds set `STOCK_NOTEBOOK_TEST_HARNESS=1` to include a storage harness page.

Maximum-size data smoke tests (write fictional fixtures and reports to a new temporary directory; also run in CI):

```sh
node --experimental-strip-types scripts/annual-history-smoke.ts
node --experimental-strip-types scripts/refresh-smoke.ts
```

Optional brief-capacity smoke against a running preview: `node scripts/smoke_cited_briefs.mjs` with `STOCK_BRIEFS_BASE_URL`, `STOCK_BRIEFS_OUTPUT_DIR` and `CHROMIUM_PATH` (or `STOCK_BRIEFS_CHROMIUM`).

Experiment checks (Python 3, standard library only; also run in CI):

```sh
python3 -S -B -m unittest discover -s experiments/paraphrase -p 'test_*.py'
```

CI: `.github/workflows/stock-notebook.yml`.

## Project layout

- `src/main.ts` — UI and app wiring.
- `src/csv.ts`, `src/validation.ts`, `src/periods.ts` — CSV parsing, validation and period selection.
- `src/query.ts` — screening grammar and interpretation.
- `src/model.ts`, `src/research.ts`, `src/annual-history.ts` — metrics, screening, observations and history comparisons.
- `src/brief.ts`, `src/brief-view.ts`, `src/brief-report.ts` — cited company briefs.
- `src/refresh.ts`, `src/refresh-view.ts`, `src/refresh-report.ts` — reviewed data refresh.
- `src/exports.ts` — research report and JSON backup.
- `src/storage.ts`, `src/raw-backup.ts`, `src/history.ts` — IndexedDB autosave, raw recovery and Undo/Redo.
- `src/demo.ts` — synthetic demo data.
- `scripts/` — maximum-data and brief smoke tests.
- `experiments/paraphrase/` — archived, failed offline learned-paraphrase trial (Python). The app does not import it; CI runs its tests and diagnostic only.
- `tests/*.test.ts` — unit and independent-oracle tests; `tests/browser/` — Playwright specs.

## Data & privacy

All data stays in the browser. Supplied source links are displayed, never requested. The synthetic demo contains fictional companies and is labeled as such in views, backups and reports.
