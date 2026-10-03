import { cpus, totalmem } from 'node:os';
import { runLocalBenchmark } from '../src/decision-benchmark.js';

const usage = 'Usage: node scripts/benchmark-local.js [--model NAME]\nUses an already installed local GGUF decision model at http://127.0.0.1:11434 with cloud disabled.\nPrints one decision-lab-importable JSON report. Does not install or download models.\nWhole run limit: 5 minutes; each local request: 60 seconds.';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  if (args.length && (args.length !== 2 || args[0] !== '--model' || !args[1] || args[1].startsWith('--'))) {
    throw new Error(usage);
  }
  const controller = new AbortController();
  const stop = () => controller.abort(new DOMException('Benchmark interrupted', 'AbortError'));
  const timer = setTimeout(() => controller.abort(new DOMException('Benchmark exceeded five minutes', 'TimeoutError')), 300000);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const report = await runLocalBenchmark({
      model: args[1],
      signal: controller.signal,
      onProgress: (rows, fixture) => {
        const row = rows.at(-1);
        console.error(fixture.id + ': ' + (row.error || (row.decision.targetId ?? 'abstain')));
      },
    });
    const processors = cpus();
    const sha = process.env.GITHUB_SHA;
    const run = process.env.GITHUB_RUN_ID;
    const repository = process.env.GITHUB_REPOSITORY;
    const release = process.env.GAZE_BENCHMARK_OLLAMA_RELEASE;
    report.benchmark.environment = {
      node: process.version, platform: process.platform, arch: process.arch,
      cpuModel: processors[0]?.model ?? null, logicalCpus: processors.length, memoryBytes: totalmem(),
      declaredOllamaRelease: /^v\d+\.\d+\.\d+$/.test(release ?? '') ? release : null,
      sourceCommit: /^[a-f0-9]{40}$/.test(sha ?? '') ? sha : null,
      workflowRun: /^\d+$/.test(run ?? '') && /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repository ?? '')
        ? 'https://github.com/' + repository + '/actions/runs/' + run : null,
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.benchmark.summary.complete) {
      console.error('Benchmark incomplete: inspect cancellations, failed cases, missing results, and model provenance.');
      process.exitCode = 1;
    }
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
