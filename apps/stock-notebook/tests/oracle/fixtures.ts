import type { Company, Dataset, Screen } from '../../src/types';

export const today = '2026-10-04';
export const header = 'ticker,name,sector,currency,fiscal_date,revenue,prior_revenue,net_income,debt,equity,filing_url';
export const originalCsv = `${header}\r\n` + [
  'alfa,"<img src=x onerror=window.bad=true>",Software,USD,2026-03-31,120,100,12,40,80,https://example.com/alfa',
  'BRAVO,"Original, quoted company",Software,EUR,2025-12-31,240,200,24,300,100,https://example.com/bravo',
  'CHARLIE,Zero denominator company,Software,USD,2026-03-31,100,100,0,0,0,',
  'DELTA,Six decimal company,Hardware,USD,2026-06-30,34237.026104,30000,543.123456,0,80,https://example.com/delta',
  'ECHO,Missing facts company,Software,USD,2026-03-31,,0,,10,-5,',
  'FOXTROT,An old annual period,Software,USD,2024-01-01,120,100,12,40,80,https://example.com/foxtrot',
].join('\r\n') + '\r\n';

export function company(patch: Partial<Company> = {}): Company {
  return {
    ticker: 'ALFA', name: 'An original annual fixture', sector: 'Software', currency: 'USD',
    fiscalDate: '2025-04-04', revenue: 120, priorRevenue: 100, netIncome: 12,
    debt: 40, equity: 80, filingUrl: 'https://example.com/annual-report', sourceLine: 2,
    ...patch,
  };
}

export function dataset(rows: Company[]): Dataset {
  return { id: '01234567-89ab-4cde-8f01-23456789abcd', fileName: 'original-research.csv', importedDate: today, basis: 'annual-12-month', units: 'currency-millions', synthetic: false, companies: rows.map((row, index) => ({ ...row, sourceLine: index + 2 })) };
}

export function screen(patch: Partial<Screen> = {}): Screen {
  return { sector: null, currency: null, filters: [], includeStale: false, sortBy: 'ticker', direction: 'asc', ...patch };
}
