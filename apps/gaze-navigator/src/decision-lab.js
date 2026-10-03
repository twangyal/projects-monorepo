import { CASES, SUITE_VERSION } from './decision-fixtures.js';
import { geometricDecision, eligibleTargets, targetDistance } from './decision-contract.js';
import { runSuite, summarize, validateReport } from './decision-evaluation.js';
import { createLocalDecisionModel } from './local-decision-model.js';

const node = id => document.querySelector(`#${id}`);
const reports = [];
let reportKey = 0;
let selected = null;
let active = null;
let busy = false;
const localPage = ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname);
const baseline = { id: 'Geometric baseline', kind: 'baseline', digest: null, decide: async task => geometricDecision(task) };

function targetLabel(fixture, id) {
  if (id === null) return 'Abstain';
  const target = fixture.task.targets.find(t => t.id === id);
  return target ? `${target.label} (${id})` : 'Unavailable target';
}

function selectedCase() {
  return CASES.find(c => c.id === node('caseSelect').value) ?? CASES[0];
}

function renderCase() {
  const fixture = selectedCase();
  const task = fixture.task;
  const eligible = eligibleTargets(task).map(t => t.id);
  node('caseGoal').textContent = task.goal || 'No goal supplied.';
  node('expectedTarget').textContent = targetLabel(fixture, fixture.expected);
  node('gazeDescription').textContent = task.gaze ? `x ${task.gaze.x}, y ${task.gaze.y} in a ${task.viewport.width} × ${task.viewport.height} viewport` : 'No gaze sample available.';
  const board = node('scenarioBoard');
  board.replaceChildren();
  board.setAttribute('aria-label', `${fixture.title}. ${node('gazeDescription').textContent} Expected: ${targetLabel(fixture, fixture.expected)}.`);
  const observed = selected?.report.results.find(row => row.caseId === fixture.id);
  for (const target of task.targets) {
    const card = document.createElement('div');
    card.className = 'scenario-target';
    card.classList.toggle('is-disabled', target.disabled);
    card.classList.toggle('is-expected', target.id === fixture.expected);
    card.classList.toggle('is-selected', !observed?.error && observed?.decision?.targetId === target.id);
    card.textContent = target.label;
    const rect = target.rect;
    card.style.left = `${rect.x / task.viewport.width * 100}%`;
    card.style.top = `${rect.y / task.viewport.height * 100}%`;
    card.style.width = `${rect.width / task.viewport.width * 100}%`;
    card.style.height = `${rect.height / task.viewport.height * 100}%`;
    board.append(card);
  }
  if (task.gaze) {
    const gaze = document.createElement('span');
    gaze.className = 'scenario-gaze';
    gaze.setAttribute('aria-hidden', 'true');
    gaze.style.left = `${task.gaze.x / task.viewport.width * 100}%`;
    gaze.style.top = `${task.gaze.y / task.viewport.height * 100}%`;
    board.append(gaze);
  }
  const details = node('targetDetails');
  details.replaceChildren();
  for (const target of task.targets) {
    const item = document.createElement('li');
    const distance = task.gaze ? `${targetDistance(task.gaze, target.rect).toFixed(1)} px from gaze` : 'no gaze';
    item.textContent = `${targetLabel(fixture, target.id)}: ${target.disabled ? 'disabled' : eligible.includes(target.id) ? 'eligible' : 'outside nearby range'}; ${distance}.`;
    details.append(item);
  }
}

function cellText(fixture, row) {
  if (!row) return 'Untested';
  if (row.error) return `Error: ${row.error}`;
  const label = targetLabel(fixture, row.decision.targetId);
  if (row.decision.targetId === null && !eligibleTargets(fixture.task).length) return label + '\nNo eligible target';
  return row.decision.confidence === null ? label : `${label}\nConfidence score: ${row.decision.confidence.toFixed(2)}`;
}

function renderResults(report = selected?.report) {
  const latestBaseline = reports.find(item => !item.imported && item.report.model.kind === 'baseline')?.report;
  const body = node('caseResults');
  body.replaceChildren();
  for (const fixture of CASES) {
    const row = document.createElement('tr');
    const current = report?.results.find(result => result.caseId === fixture.id);
    row.dataset.outcome = !current ? 'untested' : current.error ? 'error' : current.decision.targetId === fixture.expected ? 'correct' : 'mismatch';
    const title = document.createElement('th');
    title.scope = 'row';
    title.textContent = fixture.title;
    row.append(title);
    for (const value of [targetLabel(fixture, fixture.expected),
      cellText(fixture, latestBaseline?.results.find(result => result.caseId === fixture.id)), cellText(fixture, current)]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
  if (!report) return;
  const summary = summarize(CASES, report.results);
  node('summary').textContent = `${summary.correct}/${summary.total} correct (${(summary.accuracy * 100).toFixed(1)}%) · ${summary.valid}/${summary.total} valid · ${summary.errors} errors · ${summary.missing} untested · ${summary.abstained} abstentions · ${summary.unexpectedSelections} unexpected selection${summary.unexpectedSelections === 1 ? '' : 's'}.` +
    (summary.meanElapsedMs === null ? '' : ` Mean decision time: ${summary.meanElapsedMs.toFixed(1)} ms (includes adapter checks and transport).`);
}

function setBusy(value, cancelable = active !== null) {
  busy = value;
  for (const id of ['runBaseline', 'localModel', 'importReport']) node(id).disabled = value;
  node('runLocal').disabled = value || !localPage;
  node('reportSelect').disabled = value || reports.length === 0;
  node('exportReport').disabled = value || selected === null;
  node('cancelRun').disabled = !value || !cancelable;
}

function renderSelection() {
  const select = node('reportSelect');
  select.replaceChildren();
  for (const item of reports) {
    const option = document.createElement('option');
    option.value = item.key;
    const summary = summarize(CASES, item.report.results);
    option.textContent = `${item.imported ? 'Imported · ' : ''}${item.report.model.id} · ${summary.correct}/${summary.total} correct${item.report.cancelled ? ' · cancelled' : ''}`;
    select.append(option);
  }
  if (selected) {
    select.value = selected.key;
    const report = selected.report;
    node('reportProvenance').textContent = `${selected.imported ? 'Imported file data · ' : ''}${report.model.id} · ${report.model.kind} · ${report.suite} · ${report.createdAt}` +
      (report.model.digest ? ` · Model digest: ${report.model.digest}` : ' · No model digest (baseline or unavailable).');
    node('selectedColumn').textContent = `Selected: ${report.model.id}`;
  }
  renderResults();
  renderCase();
  setBusy(busy);
}

function addReport(report, imported = false) {
  if (report.model.kind === 'baseline' && !imported) {
    const index = reports.findIndex(item => item.report.model.kind === 'baseline' && !item.imported);
    if (index >= 0) reports.splice(index, 1);
  }
  const item = { key: String(++reportKey), report, imported };
  reports.push(item);
  while (reports.length > 8) reports.splice(reports.findIndex(row => row.imported || row.report.model.kind !== 'baseline'), 1);
  selected = item;
  renderSelection();
}

async function run(adapter) {
  if (busy) return;
  const job = { controller: new AbortController() };
  active = job;
  setBusy(true);
  node('runStatus').textContent = `Running ${adapter.id}: 0/${CASES.length} cases.`;
  node('selectedColumn').textContent = `Running: ${adapter.id}`;
  node('reportProvenance').textContent = `Running ${adapter.id}. Completed results will become a new report.`;
  try {
    const report = await runSuite(CASES, adapter, { signal: job.controller.signal, onProgress: rows => {
      if (active !== job) return;
      node('runStatus').textContent = `Running ${adapter.id}: ${rows.length}/${CASES.length} cases.`;
      renderResults({ results: rows });
    } });
    if (active !== job) return;
    addReport(report);
    const summary = summarize(CASES, report.results);
    node('runStatus').textContent = report.cancelled ?
      `Cancelled: ${report.results.length}/${CASES.length} cases completed. Partial report retained.` :
      `Complete: ${report.results.length}/${CASES.length} cases; ${summary.errors} errors.`;
  } catch (error) {
    if (active === job) node('runStatus').textContent = `Run failed: ${String(error?.message || 'Unknown error').slice(0, 240)}`;
  } finally {
    if (active === job) { active = null; setBusy(false); }
  }
}

for (const fixture of CASES) {
  const option = document.createElement('option');
  option.value = fixture.id;
  option.textContent = fixture.title;
  node('caseSelect').append(option);
}
node('caseSelect').addEventListener('change', renderCase);
node('reportSelect').addEventListener('change', () => {
  selected = reports.find(item => item.key === node('reportSelect').value) ?? null;
  renderSelection();
});
node('runBaseline').addEventListener('click', () => run(baseline));
node('runLocal').addEventListener('click', () => {
  if (busy || !localPage) return;
  try { void run(createLocalDecisionModel({ model: node('localModel').value.trim() })); }
  catch (error) { node('runStatus').textContent = `Local model refused: ${error.message}`; }
});
node('cancelRun').addEventListener('click', () => active?.controller.abort());

node('exportReport').addEventListener('click', () => {
  if (busy || !selected) return;
  const blob = new Blob([JSON.stringify(selected.report, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${SUITE_VERSION}-${selected.report.model.id.replace(/[^a-z0-9_-]/gi, '-')}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
});
node('importReport').addEventListener('change', async () => {
  if (busy) return;
  const file = node('importReport').files?.[0];
  if (!file) return;
  setBusy(true, false);
  try {
    if (file.size > 262144) throw new Error('File exceeds 256 KiB');
    const report = validateReport(JSON.parse(await file.text()), CASES);
    addReport(report, true);
    node('runStatus').textContent = 'Imported report. Results describe unverified file data.';
  } catch (error) {
    node('runStatus').textContent = `Report rejected: ${String(error?.message || 'Invalid report').slice(0, 240)}`;
  } finally {
    node('importReport').value = '';
    setBusy(false);
  }
});
window.addEventListener('beforeunload', () => active?.controller.abort());
node('localAvailability').textContent = localPage ?
  'Local runs contact only 127.0.0.1:11434 after you start them. Cloud-disabled status is required; nothing is sent to a hosted provider.' :
  'Open this page from http://127.0.0.1:4173 to enable local-model requests. The offline baseline remains available.';
setBusy(false);
renderCase();
renderResults();
