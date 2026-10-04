import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRefreshReport } from '../src/refresh-report.ts';
import { serializeNotebook } from '../src/model.ts';
import type { Company, Dataset, Notebook } from '../src/types.ts';
import { LIMITS } from '../src/types.ts';
import type { RefreshChoices } from '../src/refresh.ts';

const today = '2026-10-04';
function fixtures(): { base: Notebook; incoming: Dataset; choices: RefreshChoices } {
  const first: Company = {
    ticker: 'AAA', name: 'Original <literal> company', sector: 'Software', currency: 'USD',
    fiscalDate: '2026-06-30', revenue: 100, priorRevenue: 90, netIncome: 10, debt: 20, equity: 40,
    filingUrl: 'https://example.com/old-a', sourceLine: 2,
  };
  const base: Notebook = {
    schemaVersion: 2, id: '00000000-0000-4000-8000-000000000001', title: 'Retained study',
    dataset: {
      id: '00000000-0000-4000-8000-000000000002', fileName: 'previous.csv', importedDate: '2026-10-03',
      basis: 'annual-12-month', units: 'currency-millions', synthetic: false,
      companies: [first, { ...first, fiscalDate: '2025-06-30', revenue: 90, sourceLine: 3 },
        { ...first, ticker: 'BBB', name: 'Removed B', sourceLine: 4, filingUrl: null },
        { ...first, ticker: 'CCC', name: 'Changed C', sourceLine: 5 }],
    },
    query: 'companies with profitable', screen: { sector: null, currency: null, filters: [], includeStale: false, sortBy: 'ticker', direction: 'asc' },
    watchlist: ['BBB', 'AAA', 'CCC'], comparison: ['CCC', 'AAA'],
    notes: [{ ticker: 'AAA', text: '=retained <b>literal</b>\nEmoji 😀' },
      { ticker: 'BBB', text: 'Full lost note\nDo not truncate 😀' }, { ticker: 'CCC', text: 'Explicitly dropped note' }],
  };
  const incoming: Dataset = {
    ...base.dataset, id: '00000000-0000-4000-8000-000000000003', fileName: 'incoming.csv', importedDate: today,
    companies: [
      { ...first, ticker: 'CCC', name: 'New C issuer', currency: 'EUR', sourceLine: 2, filingUrl: 'https://example.com/new-c' },
      { ...first, ticker: 'DDD', name: 'Added D', sourceLine: 3 },
      { ...first, revenue: 120, priorRevenue: 100, sourceLine: 4, filingUrl: 'https://example.com/new-a' },
    ],
  };
  return { base, incoming, choices: { criteria: 'keep', annotations: [{ ticker: 'CCC', action: 'drop' }] } };
}

test('report_retains_every_endpoint_under_its_own_filename', () => {
  const { base, incoming, choices } = fixtures();
  const before = JSON.stringify({ base, incoming, choices });
  const report = buildRefreshReport(base, incoming, choices, today);
  const section = report.split('Annual period changes begin\n')[1]!.split('Annual period changes end')[0]!;
  assert.deepEqual(section.split('\n').filter(line => line.startsWith('Refresh period: ')), [
    'Refresh period: AAA — 2025-06-30', 'Refresh period: AAA — 2026-06-30',
    'Refresh period: BBB — 2026-06-30', 'Refresh period: CCC — 2026-06-30', 'Refresh period: DDD — 2026-06-30',
  ]);
  const changed = section.split('Refresh period: AAA — 2026-06-30')[1]!.split('Refresh period: BBB')[0]!;
  for (const evidence of ['previous.csv:2', 'incoming.csv:4', 'https://example.com/old-a', 'https://example.com/new-a',
    'revenue: 100 -> 120', 'priorRevenue: 90 -> 100', 'fileName: "previous.csv" -> "incoming.csv"', 'sourceLine: 2 -> 4',
    'Previous endpoint', 'Incoming endpoint', 'fiscalDate: 2026-06-30', 'currency: USD', 'equity: 40']) {
    assert.ok(changed.includes(evidence), evidence);
  }
  assert.equal(JSON.stringify({ base, incoming, choices }), before);
});

test('full_literal_annotations_and_explicit_resolution_are_retained', () => {
  const { base, incoming, choices } = fixtures();
  const report = buildRefreshReport(base, incoming, choices, today);
  for (const text of ['Research group: AAA', 'Outcome: keep', '=retained <b>literal</b>\nEmoji 😀',
    'Research group: BBB', 'Outcome: remove', 'Full lost note\nDo not truncate 😀',
    'Research group: CCC', 'Outcome: drop', 'Explicitly dropped note', 'name, currency',
    'Previous watchlist order: BBB, AAA, CCC', 'Proposed watchlist order: AAA',
    'Previous comparison order: CCC, AAA', 'Proposed comparison order: AAA',
    'Selected criteria resolution: keep', 'Previous saved interpretation: "companies with profitable"',
    'Proposed saved interpretation: "companies with profitable"', `Proposed applied screen: ${JSON.stringify(base.screen)}`]) {
    assert.ok(report.includes(text), text);
  }
});

test('report_is_proposed_not_an_applied_transaction_and_discloses_all_metadata', () => {
  const { base, incoming, choices } = fixtures();
  base.dataset.synthetic = true;
  choices.annotations.push({ ticker: 'AAA', action: 'keep' });
  const report = buildRefreshReport(base, incoming, choices, today);
  assert.ok(report.startsWith('Proposed CSV refresh review — not an applied or saved transaction\n'));
  for (const text of [today, base.id, base.dataset.id, incoming.id, '2026-10-03', 'currency-millions', 'annual-12-month',
    'Synthetic demonstration', 'User-supplied', 'not independently verified', 'fresh history', 'JSON backup', 'not investment']) {
    assert.ok(report.includes(text), text);
  }
  const repeated = buildRefreshReport(base, incoming, choices, today);
  assert.equal(repeated, report);
});

test('source_only_changes_and_backward_latest_dates_are_explicit_without_fact_invention', () => {
  const { base } = fixtures();
  base.watchlist = []; base.comparison = []; base.notes = [];
  const oldest = base.dataset.companies[1]!;
  const incoming: Dataset = { ...base.dataset, id: '00000000-0000-4000-8000-000000000003', fileName: 'reordered.csv',
    companies: [{ ...oldest, sourceLine: 2, filingUrl: null }] };
  const report = buildRefreshReport(base, incoming, { criteria: 'keep', annotations: [] }, today);
  const first = report.split('Refresh period: AAA — 2025-06-30')[1]!.split('Refresh period: AAA — 2026-06-30')[0]!;
  assert.ok(first.includes('Period status: unchanged'));
  assert.ok(first.includes('Fact changes: None'));
  assert.ok(first.includes('sourceLine: 3 -> 2'));
  assert.ok(report.includes('Backward latest-date warning: AAA; 2026-06-30 -> 2025-06-30'));
});

test('invalid_choices_or_incompatible_criteria_publish_no_report_and_leave_inputs_unchanged', () => {
  const { base, incoming } = fixtures();
  const before = JSON.stringify({ base, incoming });
  assert.throws(() => buildRefreshReport(base, incoming, { criteria: 'keep', annotations: [] }, today), /decision|retention|annotation/i);
  assert.equal(JSON.stringify({ base, incoming }), before);
  base.query = 'companies in "Software"';
  incoming.companies.forEach(company => { company.sector = 'Materials'; });
  const choices: RefreshChoices = { criteria: 'keep', annotations: [{ ticker: 'AAA', action: 'keep' }, { ticker: 'CCC', action: 'drop' }] };
  const editedBefore = JSON.stringify({ base, incoming, choices });
  assert.throws(() => buildRefreshReport(base, incoming, choices, today), /quer|interpret|criter|sector/i);
  assert.equal(JSON.stringify({ base, incoming, choices }), editedBefore);
  choices.criteria = 'clearQuery';
  const clearedBefore = JSON.stringify({ base, incoming, choices });
  const report = buildRefreshReport(base, incoming, choices, today);
  assert.ok(report.includes('Selected criteria resolution: clearQuery'));
  assert.ok(report.includes('Proposed saved interpretation: ""'));
  assert.equal(JSON.stringify({ base, incoming, choices }), clearedBefore);
});

test('legal_bounded_inputs_that_expand_over_the_report_byte_cap_fail_without_truncation', () => {
  const { base, incoming } = fixtures();
  const row = base.dataset.companies[0]!;
  base.query = '';
  base.dataset.companies = Array.from({ length: 500 }, (_, index) => ({ ...row,
    ticker: `X${index}`, name: '😀'.repeat(100), sector: '😀'.repeat(60), fiscalDate: '2026-06-30',
    filingUrl: 'https://example.com/' + '😀'.repeat(1700), sourceLine: index + 2,
  }));
  base.watchlist = base.dataset.companies.slice(0, 100).map(company => company.ticker);
  base.comparison = base.watchlist.slice(0, 4);
  // Keep each complete notebook under 4 MiB while duplicated endpoint/annotation
  // provenance can expand the complete report beyond its separate 8 MiB cap.
  base.notes = [];
  incoming.companies = base.dataset.companies.map(company => ({ ...company }));
  const choices: RefreshChoices = { criteria: 'keep', annotations: [] };
  const before = serializeNotebook(base, today);
  assert.ok(new TextEncoder().encode(before).length < LIMITS.notebookBytes);
  assert.throws(() => buildRefreshReport(base, incoming, choices, today), /8 MiB.*(report|backup)|report.*8 MiB/i);
  assert.equal(serializeNotebook(base, today), before);
});

test('explicit_reset_preserves_literal_research_and_reports_null_zero_and_exact_amounts', () => {
  const { base, incoming } = fixtures();
  base.screen.sector = 'Software';
  incoming.companies.forEach(company => { company.sector = 'Materials'; });
  const latest = incoming.companies[2]!;
  latest.revenue = null; latest.priorRevenue = 0; latest.netIncome = -0.000001;
  latest.debt = 543113052.487179; latest.equity = 0;
  const choices: RefreshChoices = { criteria: 'clearQuery', annotations: [
    { ticker: 'AAA', action: 'keep' }, { ticker: 'CCC', action: 'drop' },
  ] };
  assert.throws(() => buildRefreshReport(base, incoming, choices, today), /screen|criter|sector/i);
  choices.criteria = 'reset';
  const before = JSON.stringify({ base, incoming, choices });
  const report = buildRefreshReport(base, incoming, choices, today);
  const endpoint = report.split('Refresh period: AAA — 2026-06-30')[1]!.split('Refresh period: BBB')[0]!.split('Incoming endpoint')[1]!;
  for (const text of ['revenue: Not supplied', 'priorRevenue: 0 million USD', 'netIncome: -0.000001 million USD',
    'debt: 543113052.487179 million USD', 'equity: 0 million USD']) assert.ok(endpoint.includes(text), text);
  assert.ok(report.includes('Selected criteria resolution: reset'));
  assert.ok(report.includes('Proposed saved interpretation: ""'));
  assert.ok(report.includes('Proposed applied screen: {"sector":null,"currency":null,"filters":[],"includeStale":false,"sortBy":"ticker","direction":"asc"}'));
  assert.ok(report.includes('=retained <b>literal</b>\nEmoji 😀'));
  assert.equal(JSON.stringify({ base, incoming, choices }), before);
});
