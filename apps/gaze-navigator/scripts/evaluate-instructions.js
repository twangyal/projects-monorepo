// Measures the rule interpreter on the fixed spoken-instruction suite.
//   node scripts/evaluate-instructions.js          summary plus every miss
//   node scripts/evaluate-instructions.js --json   full machine-readable results
import { interpret } from '../src/web/interpreter.js';
import { HELD_OUT_SUITE, SUITE_VERSION, evaluateInterpreter } from '../src/web/instruction-suite.js';

const runs = [evaluateInterpreter(interpret), evaluateInterpreter(interpret, HELD_OUT_SUITE, `${SUITE_VERSION}-held-out`)];
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(runs, null, 2));
} else for (const { summary, results } of runs) {
  const percent = value => `${Math.round((value / summary.total) * 1000) / 10}%`;
  console.log(`${summary.suite}: ${summary.correct}/${summary.total} correct (${percent(summary.correct)}), ` +
    `${summary.unsafe} unsafe, ${summary.abstained} abstained`);
  for (const [name, category] of Object.entries(summary.categories)) {
    console.log(`  ${name.padEnd(9)} ${category.correct}/${category.total}  unsafe ${category.unsafe}  abstained ${category.abstained}`);
  }
  for (const result of results.filter(entry => entry.outcome !== 'correct')) {
    console.log(`  [${result.outcome}] (${result.context}) "${result.say}" → ${JSON.stringify(result.got).slice(0, 140)}`);
  }
}
process.exitCode = runs.some(run => run.summary.unsafe) ? 1 : 0;
