import type { Company } from './types.ts';

/** Select detached latest annual rows from validated input; do not reorder source rows. */
export function latestCompanies(rows: readonly Company[]): Company[] {
  const latest = new Map<string, Company>();
  for (const row of rows) {
    const previous = latest.get(row.ticker);
    if (!previous || row.fiscalDate > previous.fiscalDate) latest.set(row.ticker, row);
  }
  return [...latest.values()].sort((a, b) => a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0).map(row => ({ ...row }));
}

/** Exact normalized ticker lookup; absent tickers return an empty detached catalog. */
export function periodsForTicker(rows: readonly Company[], ticker: string): Company[] {
  return rows.filter(row => row.ticker === ticker).sort((a, b) => a.fiscalDate < b.fiscalDate ? -1 : a.fiscalDate > b.fiscalDate ? 1 : 0).map(row => ({ ...row }));
}
