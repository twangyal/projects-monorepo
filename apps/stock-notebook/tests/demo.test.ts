import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoDataset } from '../src/demo.ts';

test('original demo is always synthetic with varied inputs and no invented filing links', () => {
  const dataset = createDemoDataset('2026-10-04');
  assert.equal(dataset.synthetic, true);
  assert.equal(dataset.importedDate, '2026-10-04');
  assert.equal(dataset.basis, 'annual-12-month');
  assert.equal(dataset.units, 'currency-millions');
  assert.ok(dataset.fileName.includes('synthetic'));
  assert.ok(dataset.companies.length >= 6);
  assert.ok(new Set(dataset.companies.map(company => company.currency)).size >= 2);
  assert.ok(dataset.companies.some(company => company.revenue === null));
  assert.ok(dataset.companies.some(company => company.equity !== null && company.equity < 0));
  assert.ok(dataset.companies.some(company => company.equity === 0));
  assert.ok(dataset.companies.some(company => company.debt === 0));
  assert.ok(dataset.companies.every(company => company.filingUrl === null && company.fiscalDate <= dataset.importedDate));
  assert.equal(new Set(dataset.companies.map(company => company.ticker)).size, dataset.companies.length);
});

test('demo dates respect earliest/latest allowed today and instances never share mutable data', () => {
  for (const today of ['2000-01-01', '2099-12-31']) {
    const first = createDemoDataset(today);
    const second = createDemoDataset(today);
    assert.notEqual(first.id, second.id);
    first.companies[0]!.name = 'Edited in one instance';
    assert.notEqual(second.companies[0]!.name, first.companies[0]!.name);
    assert.ok(first.companies.every(company => company.fiscalDate >= '2000-01-01' && company.fiscalDate <= today));
  }
});

test('demo rejects impossible dates without echoing supplied text', () => {
  for (const today of ['2026-02-29', '1999-12-31', '2100-01-01', 'private invalid date']) {
    assert.throws(() => createDemoDataset(today), error => error instanceof Error && !error.message.includes(today));
  }
});
