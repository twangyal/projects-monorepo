import { validateDecision } from './decision-contract.js';
import { SUITE_VERSION } from './decision-fixtures.js';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const boundedText = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit;

function validateRows(cases, rows) {
  if (!Array.isArray(rows) || rows.length > cases.length) throw new Error('Invalid report row count');
  const seen = new Set();
  return rows.map(row => {
    if (!record(row) || seen.has(row.caseId)) throw new Error('Duplicate or invalid report row');
    const fixture = cases.find(c => c.id === row.caseId);
    if (!fixture) throw new Error('Unknown report case');
    seen.add(row.caseId);
    if (!finite(row.elapsedMs) || row.elapsedMs < 0 || row.elapsedMs > 3600000) throw new Error('Invalid elapsed time');
    if (row.error !== null) {
      if (!boundedText(row.error, 240) || row.decision !== null) throw new Error('Invalid failed result');
      return { caseId: row.caseId, decision: null, elapsedMs: row.elapsedMs, error: row.error };
    }
    return { caseId: row.caseId, decision: validateDecision(fixture.task, row.decision), elapsedMs: row.elapsedMs, error: null };
  });
}

export function summarize(cases, input) {
  const rows = validateRows(cases, input);
  let correct = 0, valid = 0, errors = 0, abstained = 0, unexpectedSelections = 0;
  const times = [];
  for (const row of rows) {
    if (row.error) { errors++; continue; }
    valid++;
    times.push(row.elapsedMs);
    const expected = cases.find(c => c.id === row.caseId).expected;
    if (row.decision.targetId === expected) correct++;
    if (row.decision.targetId === null) abstained++;
    if (expected === null && row.decision.targetId !== null) unexpectedSelections++;
  }
  return { total: cases.length, attempted: rows.length, valid, errors, correct, incorrect: valid - correct,
    abstained, unexpectedSelections, missing: cases.length - rows.length,
    accuracy: cases.length ? correct / cases.length : 0, coverage: cases.length ? valid / cases.length : 0,
    meanElapsedMs: times.length ? times.reduce((sum, n) => sum + n, 0) / times.length : null };
}

export function validateReport(value, cases) {
  if (!record(value) || value.format !== 'gaze-decision-report' || value.version !== 1 || value.suite !== SUITE_VERSION) {
    throw new Error('Report format or suite version does not match');
  }
  if (!record(value.model) || !boundedText(value.model.id, 120) || !['baseline', 'local', 'external'].includes(value.model.kind) ||
      (value.model.digest !== null && (typeof value.model.digest !== 'string' || !/^[a-f0-9]{64}$/i.test(value.model.digest)))) {
    throw new Error('Invalid model provenance');
  }
  if (typeof value.cancelled !== 'boolean' || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error('Invalid report metadata');
  }
  return { format: 'gaze-decision-report', version: 1, suite: SUITE_VERSION,
    model: { id: value.model.id, kind: value.model.kind, digest: value.model.digest },
    createdAt: value.createdAt, cancelled: value.cancelled, results: validateRows(cases, value.results) };
}

// Race cancellation at the runner boundary too, so an adapter cannot hold the UI hostage.
async function awaitDecision(adapter, task, signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Cancelled', 'AbortError');
  let abort;
  const canceled = new Promise((_, reject) => {
    abort = () => reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(() => adapter.decide(task, { signal })), canceled]); }
  finally { signal?.removeEventListener('abort', abort); }
}

export async function runSuite(cases, adapter, { signal, onProgress = () => {}, now = () => performance.now() } = {}) {
  const results = [];
  let cancelled = false;
  for (const fixture of cases) {
    if (signal?.aborted) { cancelled = true; break; }
    const start = now();
    let decision = null, error = null;
    try { decision = validateDecision(fixture.task, await awaitDecision(adapter, fixture.task, signal)); }
    catch (failure) {
      if (signal?.aborted) { cancelled = true; break; }
      error = String(failure?.message || 'Decision failed').slice(0, 240);
    }
    if (signal?.aborted) { cancelled = true; break; }
    const elapsedMs = Math.max(0, now() - start);
    results.push({ caseId: fixture.id, decision, elapsedMs, error });
    onProgress(results.slice(), fixture);
  }
  return validateReport({ format: 'gaze-decision-report', version: 1, suite: SUITE_VERSION,
    model: { id: adapter.id, kind: adapter.kind, digest: adapter.digest ?? null },
    createdAt: new Date().toISOString(), cancelled, results }, cases);
}
