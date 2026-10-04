import test from 'node:test';
import assert from 'node:assert/strict';
import type { Company } from '../src/types.ts';
import { company } from './model-fixtures.ts';
import { NOTEBOOK_SCHEMA_VERSION, LIMITS } from '../src/types.ts';
import { latestCompanies, periodsForTicker } from '../src/periods.ts';

test('annual history publishes canonical v2 and a five-period limit', () => {
  assert.equal(NOTEBOOK_SCHEMA_VERSION, 2);
  assert.equal(LIMITS.periodsPerTicker, 5);
});

test('latest selection is ticker sorted and independent of input date/source order', () => {
  const rows: Company[] = [company({ ticker: 'BETA', fiscalDate: '2026-06-30' }), company({ ticker: 'ALPHA', fiscalDate: '2025-06-30', sourceLine: 3 }), company({ ticker: 'BETA', fiscalDate: '2024-06-30', sourceLine: 4 }), company({ ticker: 'ALPHA', fiscalDate: '2026-06-30', sourceLine: 5 })];
  const original = structuredClone(rows);
  const result = latestCompanies(rows);
  assert.deepEqual(result.map(row => [row.ticker, row.fiscalDate, row.sourceLine]), [['ALPHA', '2026-06-30', 5], ['BETA', '2026-06-30', 2]]);
  result[0].name = 'Detached'; result.pop();
  assert.deepEqual(rows, original);
  assert.deepEqual(latestCompanies([]), []);
});

test('period lookup uses exact ticker and returns detached chronological rows', () => {
  const rows = [company({ fiscalDate: '2026-06-30' }), company({ ticker: 'BETA', sourceLine: 3 }), company({ fiscalDate: '2024-06-30', sourceLine: 4 }), company({ fiscalDate: '2025-06-30', sourceLine: 5 })];
  const result = periodsForTicker(rows, 'ALPHA');
  assert.deepEqual(result.map(row => row.sourceLine), [4, 5, 2]);
  result[0].revenue = 999;
  assert.equal(rows[2].revenue, 120);
  assert.deepEqual(periodsForTicker(rows, 'alpha'), []);
  assert.deepEqual(periodsForTicker(rows, 'UNKNOWN'), []);
});
