import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRefresh, reviewRefresh, type RefreshChoices } from '../src/refresh.ts';
import { createNotebook, validateNotebook } from '../src/model.ts';
import type { Company, Dataset } from '../src/types.ts';
import { company, dataset, screen, TODAY } from './model-fixtures.ts';

function incoming(rows: Company[], patch: Partial<Dataset> = {}): Dataset {
  return { ...dataset(rows), id: '33333333-3333-4333-8333-333333333333', fileName: 'new.csv', ...patch };
}
const keep: RefreshChoices = { criteria: 'keep', annotations: [] };

test('period review separates reported facts from source changes with stable complete ordering', () => {
  const base = createNotebook(dataset([
    company({ ticker: 'BETA' }),
    company({ fiscalDate: '2025-01-01', sourceLine: 3, revenue: null }),
    company({ sourceLine: 4 }),
    company({ ticker: 'GONE', sourceLine: 5 }),
  ]), TODAY);
  const next = incoming([
    company({ revenue: 130, priorRevenue: null, netIncome: -1, debt: 0, equity: -2, filingUrl: null }),
    company({ ticker: 'NEW', sourceLine: 3 }),
    company({ ticker: 'BETA', sourceLine: 4 }),
    company({ fiscalDate: '2025-01-01', sourceLine: 5, revenue: 0 }),
  ]);
  const review = reviewRefresh(base, next, TODAY);
  assert.deepEqual(review.periods.map(row => [row.ticker, row.fiscalDate, row.kind]), [
    ['ALPHA', '2025-01-01', 'changed'], ['ALPHA', '2026-01-01', 'changed'],
    ['BETA', '2026-01-01', 'unchanged'], ['GONE', '2026-01-01', 'removed'], ['NEW', '2026-01-01', 'added'],
  ]);
  assert.deepEqual(review.periods[1].factFields, ['revenue', 'priorRevenue', 'netIncome', 'debt', 'equity']);
  assert.deepEqual(review.periods[1].sourceFields, ['fileName', 'sourceLine', 'filingUrl']);
  assert.deepEqual(review.periods[2].factFields, []);
  assert.deepEqual(review.periods[2].sourceFields, ['fileName', 'sourceLine']);
  assert.equal(review.periods[0].previous!.revenue, null);
  assert.equal(review.periods[0].incoming!.revenue, 0);
  assert.equal(review.periods[3].incoming, null);
  assert.equal(review.periods[4].previous, null);
  assert.deepEqual(review.periods.slice(3).map(row => [row.factFields, row.sourceFields]), [[[], []], [[], []]]);
});

test('IDs and import dates do not manufacture period differences; signed zero compares equal', () => {
  const base = createNotebook(dataset([company({ debt: 0 })]), TODAY);
  const next = incoming([company({ debt: -0 })], { fileName: base.dataset.fileName, importedDate: '2026-10-03' });
  const review = reviewRefresh(base, next, TODAY);
  assert.deepEqual([review.periods[0].kind, review.periods[0].factFields, review.periods[0].sourceFields], ['unchanged', [], []]);
  assert.equal(review.previousDatasetId, base.dataset.id);
  assert.equal(review.incomingDatasetId, next.id);
  assert.equal(review.today, TODAY);
});

test('latest rows govern backward-date and annotation identity, ignoring source order and old aliases', () => {
  const base = createNotebook(dataset([company({ fiscalDate: '2024-01-01', name: 'Historical alias' }), company({ sourceLine: 3 })]), TODAY);
  base.watchlist = ['ALPHA'];
  const next = incoming([company({ fiscalDate: '2025-01-01' }), company({ fiscalDate: '2023-01-01', name: 'Other historical alias', sourceLine: 3 })]);
  const review = reviewRefresh(base, next, TODAY);
  assert.equal(review.companies[0].latestDateMovedBackward, true);
  assert.equal(review.companies[0].previous!.fiscalDate, '2026-01-01');
  assert.equal(review.annotations[0].policy, 'keep');
  assert.equal(review.annotations[0].previous.name, 'Alpha Tools');
  assert.deepEqual(review.annotations[0].reasons, []);
});

test('research decisions preserve literal text and selection order while dropping whole groups', () => {
  const base = createNotebook(dataset([
    company(), company({ ticker: 'BETA', sourceLine: 3 }), company({ ticker: 'GONE', sourceLine: 4 }), company({ ticker: 'DROP', sourceLine: 5 }),
  ]), TODAY);
  base.watchlist = ['DROP', 'BETA', 'GONE', 'ALPHA']; base.comparison = ['BETA', 'ALPHA', 'DROP', 'GONE'];
  base.notes = [{ ticker: 'ALPHA', text: '<script>literal</script>\nKeep\tthis' }, { ticker: 'DROP', text: 'Dropped note' }, { ticker: 'GONE', text: 'Lost note' }];
  const next = incoming([company({ name: 'New name', sector: 'New sector', currency: 'EUR' }), company({ ticker: 'BETA', sourceLine: 3 }), company({ ticker: 'DROP', name: 'Renamed', sourceLine: 4 }), company({ ticker: 'NEW', sourceLine: 5 })]);
  const review = reviewRefresh(base, next, TODAY);
  assert.deepEqual(review.annotations.map(row => [row.ticker, row.policy, row.reasons]), [
    ['ALPHA', 'decide', ['name', 'sector', 'currency']], ['BETA', 'keep', []], ['DROP', 'decide', ['name']], ['GONE', 'remove', []],
  ]);
  assert.equal(review.annotations[0].comparisonIndex, 1);
  assert.equal(review.annotations[0].note, base.notes[0].text);
  const result = applyRefresh(base, next, { criteria: 'keep', annotations: [{ ticker: 'DROP', action: 'drop' }, { ticker: 'ALPHA', action: 'keep' }] }, TODAY);
  assert.deepEqual(result.watchlist, ['BETA', 'ALPHA']); assert.deepEqual(result.comparison, ['BETA', 'ALPHA']);
  assert.deepEqual(result.notes, [base.notes[0]]);
  assert.equal(result.id, base.id); assert.equal(result.title, base.title); assert.equal(result.schemaVersion, 2);
  assert.deepEqual(result.dataset, next);
});

test('synthetic transitions require a decision for every annotated common ticker only', () => {
  const base = createNotebook({ ...dataset([company(), company({ ticker: 'BETA', sourceLine: 3 })]), synthetic: true }, TODAY);
  base.watchlist = ['ALPHA'];
  const review = reviewRefresh(base, incoming(base.dataset.companies), TODAY);
  assert.equal(review.previousSynthetic, true); assert.equal(review.incomingSynthetic, false);
  assert.deepEqual(review.annotations.map(row => [row.ticker, row.policy, row.reasons]), [['ALPHA', 'decide', ['synthetic']]]);
  assert.throws(() => applyRefresh(base, incoming(base.dataset.companies), keep, TODAY));
});

test('saved query compatibility is independent of the actual screen and clearQuery is deliberate', () => {
  const base = createNotebook(dataset(), TODAY);
  base.query = 'companies in "Industry"'; base.screen = screen({ filters: [{ metric: 'netIncome', operator: 'gt', value: 0, currency: null }] });
  const next = incoming([company({ sector: 'Software' })]);
  const review = reviewRefresh(base, next, TODAY);
  assert.deepEqual(review.criteria.map(row => row.action), ['keep', 'clearQuery', 'reset']);
  assert.equal(review.criteria[0].screenError, null); assert.ok(review.criteria[0].queryError);
  assert.equal(review.criteria[0].matchedTickers, null);
  assert.deepEqual(review.criteria[1].matchedTickers, ['ALPHA']);
  assert.deepEqual(review.criteria[1].screen, base.screen);
  assert.deepEqual(review.criteria[2].screen, screen());
  assert.throws(() => applyRefresh(base, next, keep, TODAY));
  const result = applyRefresh(base, next, { ...keep, criteria: 'clearQuery' }, TODAY);
  assert.equal(result.query, ''); assert.deepEqual(result.screen, base.screen);
});

test('invalid screen remains visible and reset never silently salvages individual predicates', () => {
  const base = createNotebook(dataset(), TODAY); base.screen = screen({ sector: 'Industry', currency: 'USD' });
  const next = incoming([company({ sector: 'Hostile <img>', currency: 'EUR' })]);
  const review = reviewRefresh(base, next, TODAY);
  for (const preview of review.criteria.slice(0, 2)) {
    assert.ok(preview.screenError); assert.equal(preview.queryError, null); assert.equal(preview.matchedTickers, null);
    assert.deepEqual(preview.screen, base.screen);
    assert.ok(preview.screenError!.length < 500); assert.ok(!preview.screenError!.includes('Hostile'));
  }
  assert.deepEqual(applyRefresh(base, next, { ...keep, criteria: 'reset' }, TODAY).screen, screen());
});

test('new mixed-currency money sorting fails operational preview even when vocabulary validates', () => {
  const base = createNotebook(dataset(), TODAY); base.screen = screen({ sortBy: 'revenue', direction: 'desc' });
  const next = incoming([company(), company({ ticker: 'BETA', currency: 'EUR', sourceLine: 3 })]);
  const review = reviewRefresh(base, next, TODAY);
  assert.ok(review.criteria[0].screenError); assert.ok(review.criteria[1].screenError);
  assert.equal(review.criteria[0].queryError, null);
  assert.deepEqual(review.criteria[2].matchedTickers, ['ALPHA', 'BETA']);
});

test('successful previews use canonical sector spelling, actual sort order and explicit date staleness', () => {
  const base = createNotebook(dataset(), TODAY); base.screen = screen({ sector: 'Industry', sortBy: 'revenue', direction: 'desc' });
  const next = incoming([company({ sector: 'INDUSTRY' }), company({ ticker: 'BETA', sector: 'INDUSTRY', revenue: 200, sourceLine: 3 })]);
  const review = reviewRefresh(base, next, TODAY);
  assert.equal(review.criteria[0].screen.sector, 'INDUSTRY'); assert.deepEqual(review.criteria[0].matchedTickers, ['BETA', 'ALPHA']);
  const dated = incoming([company({ fiscalDate: '2025-01-01' })], { importedDate: '2025-01-01' });
  const old = createNotebook(dated, '2026-07-03');
  assert.deepEqual(reviewRefresh(old, dated, '2026-07-03').criteria[0].matchedTickers, ['ALPHA']);
  assert.deepEqual(reviewRefresh(old, dated, '2026-07-04').criteria[0].matchedTickers, []);
});

test('choices reject missing extra duplicate noncanonical and accessor-backed decisions atomically', () => {
  const base = createNotebook(dataset(), TODAY); base.watchlist = ['ALPHA'];
  const next = incoming([company({ name: 'Renamed' })]);
  const good: RefreshChoices = { criteria: 'keep', annotations: [{ ticker: 'ALPHA', action: 'keep' }] };
  assert.deepEqual(applyRefresh(base, next, good, TODAY).watchlist, ['ALPHA']);
  let invoked = false;
  const getter = Object.defineProperty({}, 'criteria', { enumerable: true, get() { invoked = true; return 'keep'; } });
  Object.assign(getter, { annotations: [] });
  const invalid = [keep, { ...good, criteria: 'salvage' }, { ...good, extra: true }, { ...good, annotations: [good.annotations[0], good.annotations[0]] },
    { ...good, annotations: [{ ticker: 'alpha', action: 'keep' }] }, { ...good, annotations: [{ ticker: 'ALPHA ', action: 'keep' }] },
    { ...good, annotations: [{ ticker: 'MISSING', action: 'keep' }] }, { ...good, annotations: [{ ticker: 'ALPHA', action: 'clear' }] },
    { ...good, annotations: [{ ...good.annotations[0], extra: 1 }] }, { ...good, annotations: new Array(1) }, getter];
  const original = JSON.stringify([base, next]);
  for (const choices of invalid) assert.throws(() => applyRefresh(base, next, choices as RefreshChoices, TODAY));
  assert.equal(invoked, false); assert.equal(JSON.stringify([base, next]), original);
  assert.throws(() => applyRefresh(base, incoming([company()]), good, TODAY));
});

test('reviews and applications are detached and invalid inputs fail before publication', () => {
  const base = createNotebook(dataset(), TODAY); base.watchlist = ['ALPHA'];
  const next = incoming([company()]); const original = JSON.stringify([base, next]);
  const review = reviewRefresh(base, next, TODAY), result = applyRefresh(base, next, keep, TODAY);
  review.periods[0].incoming!.name = 'Edited review'; review.annotations[0].previous.name = 'Edited annotation';
  review.criteria[0].screen.filters.push({ metric: 'revenue', operator: 'gt', value: 1, currency: 'USD' });
  result.dataset.companies[0].name = 'Edited result'; result.watchlist.length = 0;
  assert.equal(JSON.stringify([base, next]), original);
  assert.throws(() => reviewRefresh(base, { ...next, units: 'ones' } as unknown as Dataset, TODAY));
  assert.throws(() => applyRefresh(base, next, keep, '2026-02-30'));
  assert.throws(() => reviewRefresh({ ...base, watchlist: ['MISSING'] }, next, TODAY));
  assert.throws(() => reviewRefresh(base, next, '2025-01-01'));
});

test('maximum disjoint universes produce exactly 1000 periods and 204 annotation groups', () => {
  const rows = Array.from({ length: 500 }, (_, i) => company({ ticker: `A${String(i).padStart(3, '0')}`, sourceLine: i + 2 }));
  const base = createNotebook(dataset(rows), TODAY);
  base.watchlist = rows.slice(0, 100).map(row => row.ticker); base.comparison = rows.slice(100, 104).map(row => row.ticker);
  base.notes = rows.slice(104, 204).map(row => ({ ticker: row.ticker, text: 'Research' }));
  const next = incoming(rows.map(row => ({ ...row, ticker: `B${row.ticker.slice(1)}` })));
  const review = reviewRefresh(base, next, TODAY);
  assert.equal(review.periods.length, 1000); assert.equal(review.companies.length, 1000); assert.equal(review.annotations.length, 204);
  assert.ok(review.annotations.every(row => row.policy === 'remove'));
  const result = applyRefresh(base, next, keep, TODAY);
  assert.deepEqual([result.watchlist, result.comparison, result.notes], [[], [], []]);
});

test('combined replacement byte cap rejects without truncating otherwise-valid inputs', () => {
  const rows = Array.from({ length: 400 }, (_, i) => company({ ticker: `C${i}`, sourceLine: i + 2 }));
  const base = createNotebook(dataset(rows), TODAY);
  base.notes = rows.slice(0, 100).map(row => ({ ticker: row.ticker, text: '📈'.repeat(4000) }));
  const validated = validateNotebook(base, TODAY);
  const next = incoming(rows.map(row => ({ ...row, filingUrl: 'https://example.com/' + '📈'.repeat(1800) })));
  createNotebook(next, TODAY); // The incoming universe alone fits the backup cap.
  const original = JSON.stringify([validated, next]);
  assert.throws(() => applyRefresh(validated, next, keep, TODAY), /4 MiB|backup limit/);
  assert.equal(JSON.stringify([validated, next]), original);
});
