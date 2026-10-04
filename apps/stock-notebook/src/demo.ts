import type { Company, Dataset } from './types.ts';
import { validateToday } from './validation.ts';
import { createDataset } from './csv.ts';

/** Original fictional records, never presented as companies or filings from the real world. */
export function createDemoDataset(today: string): Dataset {
  const date = validateToday(today);
  const day = new Date(`${date}T00:00:00.000Z`).getTime();
  const minimum = Date.UTC(2000, 0, 1);
  const ago = (days: number) => new Date(Math.max(minimum, day - days * 86_400_000)).toISOString().slice(0, 10);
  const row = (ticker: string, name: string, sector: string, currency: string, age: number,
    revenue: number | null, priorRevenue: number | null, netIncome: number | null, debt: number | null, equity: number | null, sourceLine: number): Company => ({
    ticker, name, sector, currency, fiscalDate: ago(age), revenue, priorRevenue, netIncome, debt, equity, filingUrl: null, sourceLine,
  });
  return createDataset({ fileName: 'synthetic-demonstration.csv', companies: [
    row('AURE', 'Aurelian Circuit Works', 'Hardware', 'USD', 96, 120, 100, 12, 40, 80, 2),
    row('BRKM', 'Bramble Kiln Materials', 'Materials', 'EUR', 300, 90, 80, -9, 150, 40, 3),
    row('CDRW', 'Cedarwave Learning', 'Services', 'USD', 160, 0, 0, -2, 0, 0, 4),
    row('DUSK', 'Dusk Lantern Research', 'Software', 'USD', 549, 34237.026104, 32000, 1200, 0, 10000, 5),
    row('ECHO', 'Echo Orchard Systems', 'Software', 'EUR', 220, 543113052.487179, 500000000, 54311305.248718, 1000000, 80000000, 6),
    row('FOLD', 'Foldstone Transit', 'Transport', 'USD', 400, null, 40, null, 25, -4, 7),
    row('GLNT', 'Glint Harbor Foods', 'Consumer', 'USD', 548, 50, 70, 2.5, 20, 25, 8),
    row('HUSH', 'Hush Meadow Instruments', 'Healthcare', 'JPY', 120, 200, 180, 35, null, 100, 9),
  ] }, date, true);
}
