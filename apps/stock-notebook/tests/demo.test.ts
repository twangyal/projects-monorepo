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
  assert.equal(new Set(dataset.companies.map(company => company.ticker)).size, 8);
  assert.ok(dataset.companies.length > 8);
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


test('synthetic annual history preserves latest facts and uses genuine distinct prior dates/source lines', () => {
  const dataset = createDemoDataset('2026-10-04');
  const aure = dataset.companies.filter(company => company.ticker === 'AURE').sort((a,b) => a.fiscalDate.localeCompare(b.fiscalDate));
  assert.equal(aure.length,3);
  assert.deepEqual(aure.map(company => company.fiscalDate), ['2024-06-30','2025-06-30','2026-06-30']);
  assert.deepEqual(aure.map(company => company.revenue), [90,100,120]);
  assert.deepEqual(aure.map(company => company.priorRevenue), [80,90,100]);
  assert.equal(aure[2].netIncome,12);
  assert.equal(aure[2].debt,40);
  assert.equal(aure[2].equity,80);
  assert.equal(aure[2].sourceLine,2);
  assert.deepEqual(dataset.companies.map(company => company.sourceLine), dataset.companies.map((_,index) => index+2));
  assert.equal(new Set(dataset.companies.map(company => `${company.ticker}/${company.fiscalDate}`)).size,dataset.companies.length);
});

test('earliest dates never duplicate a clamped minimum period and leap anniversaries remain real', () => {
  for (const today of ['2000-01-01','2000-06-01','2001-01-01','2099-12-31']) {
    const dataset = createDemoDataset(today);
    assert.equal(new Set(dataset.companies.map(company => `${company.ticker}/${company.fiscalDate}`)).size,dataset.companies.length);
    for (const ticker of new Set(dataset.companies.map(company => company.ticker))) {
      assert.ok(dataset.companies.filter(company => company.ticker === ticker).length <= 5);
    }
  }
  assert.equal(createDemoDataset('2000-01-01').companies.length,8);
  const aure = createDemoDataset('2004-06-04').companies.filter(company => company.ticker === 'AURE');
  assert.deepEqual(aure.map(company => company.fiscalDate).sort(),['2002-02-28','2003-02-28','2004-02-29']);
});
