import type { Company, Dataset } from '../../src/types';
import { dataset, header } from './fixtures.ts';

export const annualCsv = `${header}\r\n` + [
  'alfa,Original annual ALFA,Software,USD,2026-03-31,150,120,30,40,100,https://example.com/alfa-2026',
  'BRAVO,Old BRAVO name,Historical sector,EUR,2024-12-31,500,400,100,0,100,https://example.com/bravo-2024',
  'ALFA,Original annual ALFA,Software,USD,2024-03-31,80,64,4,80,100,https://example.com/alfa-2024',
  'BRAVO,Current BRAVO name,Hardware,USD,2026-03-31,,100,-10,300,100,https://example.com/bravo-2026',
  'ALFA,Original annual ALFA,Software,USD,2025-03-31,100,80,10,60,100,https://example.com/alfa-2025',
  'CHARLIE,One supplied period,Software,USD,2026-06-30,120,100,12,0,80,https://example.com/charlie-2026',
  'DELTA,Zero base annual company,Software,USD,2024-06-30,0,0,0,0,0,https://example.com/delta-2024',
  'DELTA,Zero base annual company,Software,USD,2025-06-30,10,0,-1,5,10,https://example.com/delta-2025',
  'DELTA,Zero base annual company,Software,USD,2026-06-30,20,10,-1,5,10,https://example.com/delta-2026',
].join('\r\n') + '\r\n';

export function annualDataset(): Dataset {
  const base = { ticker: 'ALFA', name: 'Original annual ALFA', sector: 'Software', currency: 'USD',
    fiscalDate: '2026-03-31', revenue: 150, priorRevenue: 120, netIncome: 30, debt: 40,
    equity: 100, filingUrl: 'https://example.com/alfa-2026', sourceLine: 2 };
  const rows: Company[] = [
    { ...base },
    { ...base, ticker: 'BRAVO', name: 'Old BRAVO name', sector: 'Historical sector', currency: 'EUR',
      fiscalDate: '2024-12-31', revenue: 500, priorRevenue: 400, netIncome: 100, debt: 0,
      filingUrl: 'https://example.com/bravo-2024', sourceLine: 3 },
    { ...base, fiscalDate: '2024-03-31', revenue: 80, priorRevenue: 64, netIncome: 4, debt: 80,
      filingUrl: 'https://example.com/alfa-2024', sourceLine: 4 },
    { ...base, ticker: 'BRAVO', name: 'Current BRAVO name', sector: 'Hardware', revenue: null,
      priorRevenue: 100, netIncome: -10, debt: 300, filingUrl: 'https://example.com/bravo-2026', sourceLine: 5 },
    { ...base, fiscalDate: '2025-03-31', revenue: 100, priorRevenue: 80, netIncome: 10, debt: 60,
      filingUrl: 'https://example.com/alfa-2025', sourceLine: 6 },
    { ...base, ticker: 'CHARLIE', name: 'One supplied period', fiscalDate: '2026-06-30', revenue: 120,
      priorRevenue: 100, netIncome: 12, debt: 0, equity: 80, filingUrl: 'https://example.com/charlie-2026', sourceLine: 7 },
    { ...base, ticker: 'DELTA', name: 'Zero base annual company', fiscalDate: '2024-06-30', revenue: 0,
      priorRevenue: 0, netIncome: 0, debt: 0, equity: 0, filingUrl: 'https://example.com/delta-2024', sourceLine: 8 },
    { ...base, ticker: 'DELTA', name: 'Zero base annual company', fiscalDate: '2025-06-30', revenue: 10,
      priorRevenue: 0, netIncome: -1, debt: 5, equity: 10, filingUrl: 'https://example.com/delta-2025', sourceLine: 9 },
    { ...base, ticker: 'DELTA', name: 'Zero base annual company', fiscalDate: '2026-06-30', revenue: 20,
      priorRevenue: 10, netIncome: -1, debt: 5, equity: 10, filingUrl: 'https://example.com/delta-2026', sourceLine: 10 },
  ];
  return { ...dataset(rows), fileName: 'annual-original.csv' };
}
