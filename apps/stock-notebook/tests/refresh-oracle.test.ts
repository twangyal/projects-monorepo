import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRefresh, reviewRefresh } from '../src/refresh.ts';
import type { RefreshChoices } from '../src/refresh.ts';
import type { Company, Dataset, Notebook, Screen } from '../src/types.ts';

// Authored from the contract before reading the refresh implementation. Expected
// results below do not use any production diff, retention, or refresh helper.
const TODAY = '2026-10-04';
const BASE_ID = '10000000-0000-4000-8000-000000000001';
const OLD_ID = '10000000-0000-4000-8000-000000000002';
const NEW_ID = '10000000-0000-4000-8000-000000000003';
const DEFAULT_SCREEN: Screen = {
  sector: null, currency: null, filters: [], includeStale: false, sortBy: 'ticker', direction: 'asc',
};
function row(ticker: string, fiscalDate = '2025-12-31', change: Partial<Company> = {}): Company {
  return {
    ticker, name: `${ticker} supplied name`, sector: 'Manufacturing', currency: 'USD', fiscalDate,
    revenue: 100, priorRevenue: 80, netIncome: 12, debt: 20, equity: 40,
    filingUrl: 'https://example.com/annual', sourceLine: 2, ...change,
  };
}
function dataset(rows: Company[], incoming = false, change: Partial<Dataset> = {}): Dataset {
  return {
    id: incoming ? NEW_ID : OLD_ID, fileName: incoming ? 'new-annual.csv' : 'old-annual.csv',
    importedDate: TODAY, basis: 'annual-12-month', units: 'currency-millions', synthetic: false,
    companies: rows.map((company, index) => ({ ...company, sourceLine: index + 2 })), ...change,
  };
}
function notebook(data: Dataset, change: Partial<Notebook> = {}): Notebook {
  return {
    schemaVersion: 3, briefs: [], id: BASE_ID, title: 'Literal field notes', dataset: data, query: '',
    screen: structuredClone(DEFAULT_SCREEN), watchlist: [], comparison: [], notes: [], ...change,
  };
}
const keep: RefreshChoices = { criteria: 'keep', annotations: [] };

test('oracle separates ordered financial facts from provenance-only differences', () => {
  const old = dataset([row('AAA', '2024-12-31', { revenue: 0 }), row('AAA')]);
  const incoming = dataset([
    row('AAA', '2024-12-31', { revenue: -0, filingUrl: 'https://example.com/revised' }),
    row('AAA', '2025-12-31', {
      name: 'New supplied label', sector: 'Services', currency: 'EUR', revenue: 120,
      priorRevenue: 100, netIncome: -1, debt: 0, equity: -10,
    }),
  ], true);
  const review = reviewRefresh(notebook(old), incoming, TODAY);
  assert.deepEqual(review.periods.map(p => [p.ticker, p.fiscalDate, p.kind, p.factFields, p.sourceFields]), [
    ['AAA', '2024-12-31', 'unchanged', [], ['fileName', 'filingUrl']],
    ['AAA', '2025-12-31', 'changed', ['name', 'sector', 'currency', 'revenue', 'priorRevenue', 'netIncome', 'debt', 'equity'], ['fileName']],
  ]);
  assert.equal(review.periods[0].previous!.revenue, 0);
  assert.equal(review.periods[0].incoming!.revenue, 0);
  assert.equal(review.previousFileName, 'old-annual.csv');
  assert.equal(review.incomingFileName, 'new-annual.csv');
});

test('oracle treats null-to-zero as a fact change but IDs and import dates as header metadata', () => {
  const base = notebook(dataset([row('AAA', '2025-12-31', { debt: null })]));
  const incoming = dataset([row('AAA', '2025-12-31', { debt: 0 })], true, { fileName: base.dataset.fileName });
  const changed = reviewRefresh(base, incoming, TODAY);
  assert.deepEqual(changed.periods[0].factFields, ['debt']);
  assert.deepEqual(changed.periods[0].sourceFields, []);
  incoming.companies[0].debt = null;
  incoming.importedDate = '2026-10-03';
  const metadataOnly = reviewRefresh(base, incoming, TODAY);
  assert.equal(metadataOnly.periods[0].kind, 'unchanged');
  assert.deepEqual(metadataOnly.periods[0].factFields, []);
  assert.deepEqual(metadataOnly.periods[0].sourceFields, []);
  assert.equal(metadataOnly.previousDatasetId, OLD_ID);
  assert.equal(metadataOnly.incomingDatasetId, NEW_ID);
});

test('oracle unions ticker/date keys in sorted order while preserving source row order on apply', () => {
  const base = notebook(dataset([row('BBB'), row('AAA', '2024-12-31'), row('AAA')]));
  const incoming = dataset([row('CCC'), row('AAA'), row('AAA', '2023-12-31')], true);
  const review = reviewRefresh(base, incoming, TODAY);
  assert.deepEqual(review.companies.map(c => [c.ticker, c.previous?.fiscalDate ?? null, c.incoming?.fiscalDate ?? null, c.latestDateMovedBackward]), [
    ['AAA', '2025-12-31', '2025-12-31', false], ['BBB', '2025-12-31', null, false], ['CCC', null, '2025-12-31', false],
  ]);
  assert.deepEqual(review.periods.map(p => [p.ticker, p.fiscalDate, p.kind]), [
    ['AAA', '2023-12-31', 'added'], ['AAA', '2024-12-31', 'removed'], ['AAA', '2025-12-31', 'unchanged'],
    ['BBB', '2025-12-31', 'removed'], ['CCC', '2025-12-31', 'added'],
  ]);
  for (const period of review.periods.filter(p => p.kind === 'added' || p.kind === 'removed')) {
    assert.deepEqual(period.factFields, []); assert.deepEqual(period.sourceFields, []);
    assert.equal(period.previous === null, period.kind === 'added');
    assert.equal(period.incoming === null, period.kind === 'removed');
  }
  const applied = applyRefresh(base, incoming, keep, TODAY);
  assert.deepEqual(applied.dataset.companies.map(c => [c.ticker, c.fiscalDate, c.sourceLine]), [
    ['CCC', '2025-12-31', 2], ['AAA', '2025-12-31', 3], ['AAA', '2023-12-31', 4],
  ]);
  assert.equal(applied.id, BASE_ID); assert.equal(applied.title, base.title);
});

function annotatedPair(): { base: Notebook; incoming: Dataset } {
  const base = notebook(dataset([row('BBB'), row('CCC'), row('AAA')]), {
    watchlist: ['CCC', 'AAA', 'BBB'], comparison: ['BBB', 'AAA'],
    notes: [{ ticker: 'AAA', text: '<script>literal prior conclusion</script>\nSecond line.' }, { ticker: 'BBB', text: 'Keep the exact original research.' }],
  });
  const incoming = dataset([row('BBB', '2025-12-31', { sector: 'Utilities' }), row('DDD'), row('AAA', '2025-12-31', { netIncome: -5 })], true);
  return { base, incoming };
}

test('oracle preserves ordered selections and literal notes through automatic and chosen keep groups', () => {
  const { base, incoming } = annotatedPair();
  const review = reviewRefresh(base, incoming, TODAY);
  assert.deepEqual(review.annotations.map(a => [a.ticker, a.watchlisted, a.comparisonIndex, a.note, a.policy, a.reasons]), [
    ['AAA', true, 1, '<script>literal prior conclusion</script>\nSecond line.', 'keep', []],
    ['BBB', true, 0, 'Keep the exact original research.', 'decide', ['sector']],
    ['CCC', true, null, null, 'remove', []],
  ]);
  const applied = applyRefresh(base, incoming, { criteria: 'keep', annotations: [{ ticker: 'BBB', action: 'keep' }] }, TODAY);
  assert.deepEqual(applied.watchlist, ['AAA', 'BBB']);
  assert.deepEqual(applied.comparison, ['BBB', 'AAA']);
  assert.deepEqual(applied.notes, base.notes);
  assert.equal(applied.dataset.companies[2].netIncome, -5);
  assert.ok(!applied.watchlist.includes('DDD'));
});

test('oracle drops all annotation kinds as one group and retains only known incoming tickers', () => {
  const { base, incoming } = annotatedPair();
  const applied = applyRefresh(base, incoming, { criteria: 'keep', annotations: [{ ticker: 'BBB', action: 'drop' }] }, TODAY);
  assert.deepEqual(applied.watchlist, ['AAA']); assert.deepEqual(applied.comparison, ['AAA']);
  assert.deepEqual(applied.notes, [base.notes[0]]);
});

test('oracle identity decisions use latest rows rather than first or historical rows', () => {
  const base = notebook(dataset([row('AAA', '2024-12-31', { name: 'Historical old name' }), row('AAA')]), { watchlist: ['AAA'] });
  const incoming = dataset([row('AAA', '2024-12-31', { name: 'Historical replacement' }), row('AAA')], true);
  assert.equal(reviewRefresh(base, incoming, TODAY).annotations[0].policy, 'keep');
  incoming.companies[1] = { ...incoming.companies[1], name: 'Latest new name', sector: 'Services', currency: 'EUR' };
  assert.deepEqual(reviewRefresh(base, incoming, TODAY).annotations[0].reasons, ['name', 'sector', 'currency']);
  assert.equal(reviewRefresh(base, incoming, TODAY).annotations[0].previous.fiscalDate, '2025-12-31');
});

test('oracle discloses backward latest dates without forcing an unchanged identity decision', () => {
  const base = notebook(dataset([row('AAA', '2024-12-31'), row('AAA')]), { watchlist: ['AAA'] });
  const incoming = dataset([row('AAA', '2024-12-31')], true);
  const review = reviewRefresh(base, incoming, TODAY);
  assert.equal(review.companies[0].latestDateMovedBackward, true);
  assert.equal(review.annotations[0].policy, 'keep');
  assert.deepEqual(review.periods.map(p => p.kind), ['unchanged', 'removed']);
  assert.deepEqual(applyRefresh(base, incoming, keep, TODAY).watchlist, ['AAA']);
});

test('oracle synthetic transition requires common annotated decisions, never an absent ticker decision', () => {
  const base = notebook(dataset([row('AAA'), row('BBB')], false, { synthetic: true }), { watchlist: ['BBB', 'AAA'] });
  const incoming = dataset([row('AAA'), row('CCC')], true);
  const review = reviewRefresh(base, incoming, TODAY);
  assert.equal(review.previousSynthetic, true); assert.equal(review.incomingSynthetic, false);
  assert.deepEqual(review.annotations.map(a => [a.ticker, a.policy, a.reasons]), [['AAA', 'decide', ['synthetic']], ['BBB', 'remove', []]]);
  assert.deepEqual(applyRefresh(base, incoming, { criteria: 'keep', annotations: [{ ticker: 'AAA', action: 'keep' }] }, TODAY).watchlist, ['AAA']);
});

test('oracle distinguishes invalid saved query from compatible manually edited screen', () => {
  const base = notebook(dataset([row('AAA', '2025-12-31', { sector: 'Old' }), row('BBB', '2025-12-31', { sector: 'New' })]), {
    query: 'companies in "Old" with profitable', screen: { ...structuredClone(DEFAULT_SCREEN), sector: 'New', direction: 'desc' },
  });
  const incoming = dataset([row('CCC', '2025-12-31', { sector: 'New' })], true);
  const criteria = reviewRefresh(base, incoming, TODAY).criteria;
  assert.deepEqual(criteria.map(c => c.action), ['keep', 'clearQuery', 'reset']);
  assert.equal(criteria[0].screenError, null); assert.ok(criteria[0].queryError); assert.equal(criteria[0].matchedTickers, null);
  assert.equal(criteria[1].query, ''); assert.equal(criteria[1].screen.sector, 'New');
  assert.equal(criteria[1].screen.direction, 'desc'); assert.deepEqual(criteria[1].matchedTickers, ['CCC']);
  assert.deepEqual(criteria[2].screen, DEFAULT_SCREEN);
  assert.throws(() => applyRefresh(base, incoming, keep, TODAY));
  const applied = applyRefresh(base, incoming, { criteria: 'clearQuery', annotations: [] }, TODAY);
  assert.equal(applied.query, ''); assert.deepEqual(applied.screen, base.screen);
});

test('oracle invalid applied latest-sector vocabulary requires reset, not silent predicate removal', () => {
  const base = notebook(dataset([row('AAA', '2025-12-31', { sector: 'Old' })]), { screen: { ...structuredClone(DEFAULT_SCREEN), sector: 'Old' } });
  const incoming = dataset([row('AAA', '2024-12-31', { sector: 'Old' }), row('AAA', '2025-12-31', { sector: 'New' })], true);
  const criteria = reviewRefresh(base, incoming, TODAY).criteria;
  for (const candidate of criteria.slice(0, 2)) {
    assert.ok(candidate.screenError); assert.equal(candidate.queryError, null); assert.equal(candidate.matchedTickers, null);
    assert.equal(candidate.screen.sector, 'Old');
    assert.throws(() => applyRefresh(base, incoming, { criteria: candidate.action, annotations: [] }, TODAY));
  }
  assert.deepEqual(criteria[2].matchedTickers, ['AAA']);
  assert.deepEqual(applyRefresh(base, incoming, { criteria: 'reset', annotations: [] }, TODAY).screen, DEFAULT_SCREEN);
});

test('oracle newly matching second currency blocks a previously computable monetary sort', () => {
  const screen: Screen = { ...structuredClone(DEFAULT_SCREEN), sortBy: 'revenue', direction: 'desc', filters: [{ metric: 'netIncome', operator: 'gt', value: 0, currency: null }] };
  const base = notebook(dataset([row('AAA'), row('BBB', '2025-12-31', { currency: 'EUR', netIncome: -3 })]), { screen });
  const incoming = dataset([row('AAA'), row('BBB', '2025-12-31', { currency: 'EUR', netIncome: 3 })], true);
  const criteria = reviewRefresh(base, incoming, TODAY).criteria;
  assert.ok(criteria[0].screenError); assert.ok(criteria[1].screenError);
  assert.equal(criteria[0].matchedTickers, null); assert.equal(criteria[1].matchedTickers, null);
  assert.deepEqual(criteria[0].screen, screen);
  assert.throws(() => applyRefresh(base, incoming, keep, TODAY));
  assert.deepEqual(applyRefresh(base, incoming, { criteria: 'reset', annotations: [] }, TODAY).screen, DEFAULT_SCREEN);
  // A ratio sort can compare these supplied currencies, with dates unchanged.
  base.screen.sortBy = 'marginPct';
  assert.deepEqual(reviewRefresh(base, incoming, TODAY).criteria[0].matchedTickers, ['AAA', 'BBB']);
});

test('oracle zero matches is compatible and descending financial order is preserved', () => {
  const base = notebook(dataset([row('AAA'), row('BBB')]), {
    screen: { ...structuredClone(DEFAULT_SCREEN), filters: [{ metric: 'netIncome', operator: 'gt', value: 0, currency: null }], sortBy: 'marginPct', direction: 'desc' },
  });
  const incoming = dataset([row('AAA', '2025-12-31', { netIncome: -2 }), row('BBB', '2025-12-31', { netIncome: -1 })], true);
  const candidate = reviewRefresh(base, incoming, TODAY).criteria[0];
  assert.equal(candidate.screenError, null); assert.equal(candidate.queryError, null); assert.deepEqual(candidate.matchedTickers, []);
  assert.deepEqual(applyRefresh(base, incoming, keep, TODAY).screen, base.screen);
  incoming.companies[0].netIncome = 10; incoming.companies[1].netIncome = 20;
  assert.deepEqual(reviewRefresh(base, incoming, TODAY).criteria[0].matchedTickers, ['BBB', 'AAA']);
});

test('oracle removed currency vocabulary cannot silently reinterpret monetary criteria', () => {
  const screen: Screen = {
    ...structuredClone(DEFAULT_SCREEN), currency: 'USD', sortBy: 'revenue', direction: 'desc',
    filters: [{ metric: 'revenue', operator: 'gte', value: 50, currency: 'USD' }],
  };
  const base = notebook(dataset([row('AAA')]), { screen });
  const incoming = dataset([row('AAA', '2025-12-31', { currency: 'EUR' })], true);
  const criteria = reviewRefresh(base, incoming, TODAY).criteria;
  for (const candidate of criteria.slice(0, 2)) {
    assert.ok(candidate.screenError); assert.equal(candidate.queryError, null);
    assert.deepEqual(candidate.screen, screen); assert.equal(candidate.matchedTickers, null);
    assert.throws(() => applyRefresh(base, incoming, { criteria: candidate.action, annotations: [] }, TODAY));
  }
  assert.deepEqual(applyRefresh(base, incoming, { criteria: 'reset', annotations: [] }, TODAY).screen, DEFAULT_SCREEN);
});

test('oracle rejects missing, extra, duplicate and malformed retention decisions atomically', () => {
  const { base, incoming } = annotatedPair();
  const originals = structuredClone({ base, incoming });
  assert.doesNotThrow(() => applyRefresh(base, incoming, { criteria: 'keep', annotations: [{ ticker: 'BBB', action: 'keep' }] }, TODAY));
  const bad: unknown[] = [
    { criteria: 'keep', annotations: [] },
    { criteria: 'keep', annotations: [{ ticker: 'BBB', action: 'keep' }, { ticker: 'BBB', action: 'drop' }] },
    { criteria: 'keep', annotations: [{ ticker: 'BBB', action: 'keep' }, { ticker: 'AAA', action: 'keep' }] },
    { criteria: 'keep', annotations: [{ ticker: 'BBB', action: 'keep' }, { ticker: 'CCC', action: 'drop' }] },
    { criteria: 'keep', annotations: [{ ticker: 'BBB', action: 'keep' }, { ticker: 'DDD', action: 'drop' }] },
    { criteria: 'keep', annotations: [{ ticker: 'BBB', action: 'keep' }, { ticker: 'ZZZ', action: 'drop' }] },
    { criteria: 'keep', annotations: [{ ticker: 'bbb', action: 'keep' }] },
    { criteria: 'keep', annotations: [{ ticker: ' BBB ', action: 'keep' }] },
    { criteria: 'keep', annotations: [{ ticker: 'BBB', action: 'merge' }] },
    { criteria: 'keep', annotations: [{ ticker: 'BBB', action: 'keep', note: 'extra' }] },
    { criteria: 'keep', annotations: [{ ticker: 'BBB' }] },
    { criteria: 'salvage', annotations: [{ ticker: 'BBB', action: 'keep' }] },
    { criteria: 'keep', annotations: [{ ticker: 'BBB', action: 'keep' }], extra: true },
    { criteria: 'keep' }, null, [],
    { criteria: 'keep', annotations: new Array(1) },
    { criteria: 'keep', annotations: [Object.assign(Object.create({ inherited: true }), { ticker: 'BBB', action: 'keep' })] },
  ];
  for (const choices of bad) {
    assert.throws(() => applyRefresh(base, incoming, choices as RefreshChoices, TODAY));
    assert.deepEqual({ base, incoming }, originals);
  }
  let accessorReads = 0;
  const accessorChoices = Object.defineProperty({ annotations: [{ ticker: 'BBB', action: 'keep' }] }, 'criteria', {
    enumerable: true, get() { accessorReads++; return 'keep'; },
  });
  assert.throws(() => applyRefresh(base, incoming, accessorChoices as RefreshChoices, TODAY));
  assert.equal(accessorReads, 0);
});

test('oracle choice order is irrelevant and both review and applied outputs are detached', () => {
  const base = notebook(dataset([row('AAA'), row('BBB')]), { watchlist: ['BBB', 'AAA'], comparison: ['AAA', 'BBB'], notes: [{ ticker: 'AAA', text: 'Original text' }] });
  const incoming = dataset([row('BBB', '2025-12-31', { name: 'Changed B' }), row('AAA', '2025-12-31', { sector: 'Changed A' })], true);
  const decisions: RefreshChoices['annotations'] = [{ ticker: 'AAA', action: 'keep' }, { ticker: 'BBB', action: 'drop' }];
  const original = structuredClone({ base, incoming, decisions });
  const first = applyRefresh(base, incoming, { criteria: 'keep', annotations: decisions }, TODAY);
  const second = applyRefresh(base, incoming, { criteria: 'keep', annotations: [...decisions].reverse() }, TODAY);
  assert.deepEqual(first, second); assert.deepEqual(first.watchlist, ['AAA']);
  const review = reviewRefresh(base, incoming, TODAY);
  review.periods[0].incoming!.revenue = 999; review.periods[0].previous!.name = 'Mutated result';
  review.annotations[0].previous.name = 'Mutated annotation'; review.criteria[0].screen.direction = 'desc';
  first.dataset.companies[0].equity = 0; first.notes[0].text = 'Mutated candidate'; first.watchlist.push('BBB');
  assert.deepEqual({ base, incoming, decisions }, original);
  assert.deepEqual(applyRefresh(base, incoming, { criteria: 'keep', annotations: decisions }, TODAY), second);
});

function universe(prefix: string, tickers: number, periods: number): Company[] {
  return Array.from({ length: tickers }, (_, index) => Array.from({ length: periods }, (_, period) => row(`${prefix}${String(index).padStart(3, '0')}`, `${2025 - period}-12-31`))).flat();
}

test('oracle accepts full 500-row/five-period replacements and returns all 1000 union periods', () => {
  const base = notebook(dataset(universe('A', 100, 5)));
  const incoming = dataset(universe('B', 100, 5), true);
  const review = reviewRefresh(base, incoming, TODAY);
  assert.equal(review.companies.length, 200); assert.equal(review.periods.length, 1000);
  assert.equal(review.periods.filter(p => p.kind === 'removed').length, 500);
  assert.equal(review.periods.filter(p => p.kind === 'added').length, 500);
  assert.deepEqual(review.periods[0] && [review.periods[0].ticker, review.periods[0].fiscalDate], ['A000', '2021-12-31']);
  assert.deepEqual([review.periods[999].ticker, review.periods[999].fiscalDate], ['B099', '2025-12-31']);
  const applied = applyRefresh(base, incoming, keep, TODAY);
  assert.equal(applied.dataset.companies.length, 500); assert.equal(applied.dataset.companies[499].sourceLine, 501);
  assert.deepEqual(applied.dataset.companies, incoming.companies);
});

test('oracle rejects a sixth annual period or 501st raw row without partial output or mutation', () => {
  const base = notebook(dataset([row('AAA')]));
  assert.doesNotThrow(() => reviewRefresh(base, dataset(universe('A', 1, 5), true), TODAY));
  for (const incoming of [dataset(universe('A', 1, 6), true), dataset([...universe('A', 100, 5), row('EXTRA')], true)]) {
    const original = structuredClone({ base, incoming });
    assert.throws(() => reviewRefresh(base, incoming, TODAY));
    assert.throws(() => applyRefresh(base, incoming, keep, TODAY));
    assert.deepEqual({ base, incoming }, original);
  }
});

test('oracle retains the full 204 distinct annotation union within separate annotation limits', () => {
  const old = dataset(universe('A', 204, 1), false, { synthetic: true });
  const base = notebook(old, {
    watchlist: old.companies.slice(0, 100).map(c => c.ticker).reverse(),
    comparison: old.companies.slice(200, 204).map(c => c.ticker).reverse(),
    notes: old.companies.slice(100, 200).map(c => ({ ticker: c.ticker, text: `Literal note for ${c.ticker}` })),
  });
  const incoming = dataset(universe('A', 204, 1), true);
  const review = reviewRefresh(base, incoming, TODAY);
  assert.equal(review.annotations.length, 204);
  assert.ok(review.annotations.every(a => a.policy === 'decide'));
  const annotations: RefreshChoices['annotations'] = Array.from({ length: 204 }, (_, index) => ({ ticker: `A${String(index).padStart(3, '0')}`, action: 'keep' }));
  const applied = applyRefresh(base, incoming, { criteria: 'keep', annotations: annotations.reverse() }, TODAY);
  assert.deepEqual(applied.watchlist, base.watchlist); assert.deepEqual(applied.comparison, base.comparison); assert.deepEqual(applied.notes, base.notes);
});
