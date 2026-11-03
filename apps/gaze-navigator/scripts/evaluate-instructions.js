// Measures interpreters on the fixed spoken-instruction suite.
//   node scripts/evaluate-instructions.js          rule interpreter: summary plus every miss
//   node scripts/evaluate-instructions.js --json   full machine-readable results
//   node scripts/evaluate-instructions.js --misheard
//       also scores the suite's commands as speech recognition often mishears them ("quick" for click, "school" for
//       scroll), as heard and with every "Did you mean …?" offer accepted
//   node scripts/evaluate-instructions.js --watersheep DIR
//       also scores rules + WaterSheep target choice, from a local copy of the model repository
//       (https://huggingface.co/samratduttaofficial/WaterSheep). Needs, outside package.json:
//       npm install --no-save onnxruntime-node@1.23.0 @huggingface/tokenizers@0.2.0
import { readFile } from 'node:fs/promises';
import { interpret } from '../src/web/interpreter.js';
import { createAssistedInterpreter } from '../src/web/assisted-interpreter.js';
import { HELD_OUT_2_SUITE, HELD_OUT_SUITE, SUITE, SUITE_VERSION, evaluateInterpreter, evaluateInterpreterAsync } from '../src/web/instruction-suite.js';

const runs = [evaluateInterpreter(interpret), evaluateInterpreter(interpret, HELD_OUT_SUITE, `${SUITE_VERSION}-held-out`),
  evaluateInterpreter(interpret, HELD_OUT_2_SUITE, `${SUITE_VERSION}-held-out-2`)];
// A misheard command word in place of each instruction's own, where one is common.
const MISHEARINGS = [[/^click\b/, 'quick'], [/^scroll\b/, 'school'], [/^type\b/, 'tight'], [/^press\b/, 'dress'], [/^choose\b/, 'chews'],
  [/^go back$/, 'go bag'], [/^close\b/, 'clothes'], [/^uncheck\b/, 'and check']];
if (process.argv.includes('--misheard')) {
  const suite = SUITE.flatMap(test => {
    const match = MISHEARINGS.map(([pattern, word]) => [pattern.exec(test.say.toLowerCase()), word]).find(([found]) => found);
    return match ? [{ ...test, say: match[1] + test.say.slice(match[0][0].length) }] : [];
  });
  const offersTaken = (say, context) => {
    const got = interpret(say, context);
    if (got.type !== 'unknown' || !got.alike) return got;
    const { heardAs: _as, heardName: _name, ...offered } = got.alike;
    return offered;
  };
  runs.push(evaluateInterpreter(interpret, suite, `${SUITE_VERSION}-misheard`), evaluateInterpreter(offersTaken, suite, `${SUITE_VERSION}-misheard-offers-accepted`));
}
const modelAt = process.argv.indexOf('--watersheep');
if (modelAt > 0) {
  const directory = process.argv[modelAt + 1];
  if (!directory) throw new Error('Give the WaterSheep model directory after --watersheep.');
  const [ort, { Tokenizer }, { loadWaterSheepFromDirectory }] = await Promise.all([
    import('onnxruntime-node'), import('@huggingface/tokenizers'), import('../src/web/watersheep.js')]);
  const model = await loadWaterSheepFromDirectory(directory, { ort, Tokenizer, readFile });
  const calls = [];
  const timed = name => async (...args) => { const started = performance.now(); try { return await model[name](...args); } finally { calls.push(performance.now() - started); } };
  const assisted = createAssistedInterpreter({ model: { decide: timed('decide'), yes: timed('yes') } });
  for (const [suite, name] of [[SUITE, `${SUITE_VERSION}+watersheep`], [HELD_OUT_SUITE, `${SUITE_VERSION}-held-out+watersheep`],
    [HELD_OUT_2_SUITE, `${SUITE_VERSION}-held-out-2+watersheep`]]) {
    const run = await evaluateInterpreterAsync(assisted, suite, name);
    const sorted = [...calls].sort((a, b) => a - b);
    run.summary.modelCalls = calls.length;
    run.summary.modelMedianMs = sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : null;
    calls.length = 0;
    runs.push(run);
  }
}
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(runs, null, 2));
} else for (const { summary, results } of runs) {
  const percent = value => `${Math.round((value / summary.total) * 1000) / 10}%`;
  console.log(`${summary.suite}: ${summary.correct}/${summary.total} correct (${percent(summary.correct)}), ` +
    `${summary.unsafe} unsafe, ${summary.abstained} abstained` +
    (summary.modelCalls !== undefined ? `; ${summary.modelCalls} model calls, median ${summary.modelMedianMs} ms` : ''));
  for (const [name, category] of Object.entries(summary.categories)) {
    console.log(`  ${name.padEnd(9)} ${category.correct}/${category.total}  unsafe ${category.unsafe}  abstained ${category.abstained}`);
  }
  for (const result of results.filter(entry => entry.outcome !== 'correct')) {
    console.log(`  [${result.outcome}] (${result.context}) "${result.say}" → ${JSON.stringify(result.got).slice(0, 140)}`);
  }
}
process.exitCode = runs.some(run => run.summary.unsafe) ? 1 : 0;
