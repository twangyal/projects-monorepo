import { eligibleTargets, geometricDecision } from './decision-contract.js';
import { CASES } from './decision-fixtures.js';
import { runSuite, summarize, validateReport } from './decision-evaluation.js';
import { createLocalDecisionModel } from './local-decision-model.js';

function subsetSummary(cases, rows) {
  const ids = new Set(cases.map(fixture => fixture.id));
  return { ...summarize(cases, rows.filter(row => ids.has(row.caseId))), caseIds: [...ids] };
}

export function summarizeBenchmark(input, cases = CASES) {
  const report = validateReport(input, cases);
  const eligible = cases.filter(fixture => eligibleTargets(fixture.task).length > 0);
  const policy = cases.filter(fixture => eligibleTargets(fixture.task).length === 0);
  const overall = summarize(cases, report.results);
  const baselineRows = cases.map(fixture => ({
    caseId: fixture.id, decision: geometricDecision(fixture.task), elapsedMs: 0, error: null,
  }));
  const untimed = value => ({ ...value, meanElapsedMs: null });
  const baseline = {
    overall: untimed(summarize(cases, baselineRows)),
    modelEligible: untimed(subsetSummary(eligible, baselineRows)),
    policyOnly: untimed(subsetSummary(policy, baselineRows)),
  };
  const comparison = { improved: [], regressed: [], unchangedCorrect: [], unchangedIncorrect: [], errors: [], missing: [] };
  const rows = new Map(report.results.map(row => [row.caseId, row]));
  for (const fixture of cases) {
    const row = rows.get(fixture.id);
    if (!row) { comparison.missing.push(fixture.id); continue; }
    if (row.error) { comparison.errors.push(fixture.id); continue; }
    const actualCorrect = row.decision.targetId === fixture.expected;
    const baselineCorrect = geometricDecision(fixture.task).targetId === fixture.expected;
    const key = actualCorrect ? (baselineCorrect ? 'unchangedCorrect' : 'improved')
      : (baselineCorrect ? 'regressed' : 'unchangedIncorrect');
    comparison[key].push(fixture.id);
  }
  const eligibleIds = new Set(eligible.map(fixture => fixture.id));
  const validTimes = report.results.filter(row => eligibleIds.has(row.caseId) && row.error === null).map(row => row.elapsedMs);
  const sorted = [...validTimes].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = !sorted.length ? null : sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    complete: !report.cancelled && report.model.kind === 'local' && report.model.digest !== null &&
      overall.valid === cases.length && overall.errors === 0 && overall.missing === 0,
    overall,
    modelEligible: subsetSummary(eligible, report.results),
    policyOnly: subsetSummary(policy, report.results),
    baseline,
    comparison,
    timing: {
      firstSuccessfulEligibleElapsedMs: validTimes[0] ?? null,
      eligibleMedianElapsedMs: median,
      eligibleP95ElapsedMs: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : null,
    },
  };
}

export async function runLocalBenchmark({ model, fetchImpl, signal, onProgress, now } = {}) {
  const adapter = createLocalDecisionModel({ model, fetchImpl });
  const report = await runSuite(CASES, adapter, { signal, onProgress, now });
  return { ...report, benchmark: { format: 'gaze-decision-benchmark', version: 1, summary: summarizeBenchmark(report) } };
}
