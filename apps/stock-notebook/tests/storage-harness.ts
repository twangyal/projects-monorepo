import { NotebookStore } from '../src/storage.ts';
import { createDemoDataset } from '../src/demo.ts';
import { buildReport } from '../src/exports.ts';
import { parseCsv, createDataset } from '../src/csv.ts';
import { createNotebook, serializeNotebook } from '../src/model.ts';
import { screenDataset } from '../src/research.ts';
import type { Notebook } from '../src/types.ts';

function fixture(title = 'Captured study'): Notebook {
  return {
    schemaVersion: 3, briefs: [], id: crypto.randomUUID(), title, query: '',
    dataset: { id: crypto.randomUUID(), fileName: 'supplied.csv', importedDate: '2026-10-04', basis: 'annual-12-month', units: 'currency-millions', synthetic: false,
      companies: [{ ticker: 'AAA', name: 'Original supplied fixture', sector: 'Software', currency: 'USD', fiscalDate: '2026-06-30', revenue: 120, priorRevenue: 100, netIncome: 12, debt: 40, equity: 80, filingUrl: null, sourceLine: 2 }] },
    screen: { sector: null, currency: null, filters: [], includeStale: false, sortBy: 'ticker', direction: 'asc' }, watchlist: [], comparison: [], notes: [],
  };
}
/** Explicit former-schema input, never a canonical Notebook fixture. */
function legacyFixture(title = 'Migrated legacy study'): unknown {
  return { ...Object.fromEntries(Object.entries(fixture(title)).filter(([key]) => key !== 'briefs')), schemaVersion: 1, query: 'companies with growing',
    watchlist: ['AAA'], comparison: ['AAA'], notes: [{ ticker: 'AAA', text: 'Legacy supplied note\nKeep this annotation' }] };
}
async function rawRecord(name: string, value?: unknown, write = false): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('notebooks');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('notebooks', write ? 'readwrite' : 'readonly');
      const request = write ? tx.objectStore('notebooks').put(value, 'current') : tx.objectStore('notebooks').get('current');
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}
export const harness = { NotebookStore, createDemoDataset, parseCsv, createDataset, createNotebook, screenDataset, buildReport, serializeNotebook, fixture, legacyFixture, rawRecord };
declare global { interface Window { stockStorage: typeof harness } }
window.stockStorage = harness;
