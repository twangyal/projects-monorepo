import type { Company, Dataset, Screen } from '../src/types.ts';
export const TODAY = '2026-10-04';
export function company(patch: Partial<Company> = {}): Company {
  return { ticker: 'ALPHA', name: 'Alpha Tools', sector: 'Industry', currency: 'USD', fiscalDate: '2026-01-01',
    revenue: 120, priorRevenue: 100, netIncome: 12, debt: 40, equity: 80,
    filingUrl: 'https://example.com/filing', sourceLine: 2, ...patch };
}
export function dataset(companies = [company()]): Dataset {
  return { id: '11111111-1111-4111-8111-111111111111', fileName: 'annual.csv', importedDate: TODAY,
    basis: 'annual-12-month', units: 'currency-millions', synthetic: false, companies };
}
export function screen(patch: Partial<Screen> = {}): Screen {
  return { sector: null, currency: null, filters: [], includeStale: false, sortBy: 'ticker', direction: 'asc', ...patch };
}
