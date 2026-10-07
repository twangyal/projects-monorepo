# First real local decision-model measurement

Issue: [#7](https://github.com/twangyal/projects-monorepo/issues/7).
Original [run 37138639061](https://github.com/twangyal/projects-monorepo/actions/runs/37138639061),
[job 111248268839](https://github.com/twangyal/projects-monorepo/actions/runs/37138639061/job/111248268839),
attempt 1, completed successfully on **2026-10-03** at source
`d36b8970b28ff59e694341af772c6c2ee016ccea`.

The adjacent `2026-10-03-tev1-report.json` is the original JSON from the job's
“Importable decision benchmark JSON” log group, with only GitHub's line timestamps
removed. No cases, predictions, confidence values or times were changed. It can
be imported through the decision lab. The browser validates ordinary report fields;
importing a file does not authenticate its extra benchmark metadata.

## Provenance

- Actual local GGUF: `tev1:0.8b-q8_0`, manifest digest
  `d45e875d63fed9465390a4eb9e55f51f470390a446667b55d0a075a15e0336bf`.
- Ollama release **0.35.1**; the job verifies `/api/version` and
  `/api/status` before inference: `{"runtime":"0.35.1","cloudDisabled":true}`.
- Runtime archive SHA-256:
  `9fcd79ac4575b2bd31b992eee18b1000c8ad126b451627c8f8cd091714cfbb10`.
- Ubuntu 24.04 runner image `20260927.320`, Node **v24.21.0**, Linux x64,
  AMD EPYC 7763, four logical CPUs, 16,766,414,848 reported memory bytes.
- Fixed loopback transport, temporary model storage, explicit model pull,
  read-only checkout, no report/model artifact or cache uploads.

## Results

| Measure | Tev1 local adapter | Geometry |
| --- | ---: | ---: |
| All-case agreement | 9/14 (64.3%) | 9/14 (64.3%) |
| Model-eligible agreement | 6/11 (54.5%) | 6/11 (54.5%) |
| Policy-only agreement | 3/3 | 3/3 |
| Unexpected selections when abstention was expected | 3 | 1 |
| Eligible abstentions | 2 | 6 |
| Errors or missing rows | 0 | 0 |

The three policy-only cases (off-target, disabled target and missing gaze) do
not call the model. Their successes establish the adapter's eligibility rules,
not learned inference quality.

Tev1 improves `compose-context`, `stop-context` and `swapped-context`; it
regresses `search-hit`, `ambiguous` and `unsupported-goal`. Both approaches fail
`search-context` and `conflicting-goal`. Unexpected Tev1 selections occur on
`ambiguous`, `unsupported-goal` and `conflicting-goal`.

Eligible median adapter time is **3,219.31 ms**, p95 **4,341.21 ms**, mean
**3,102.08 ms**. The first successful eligible call is **4,341.21 ms**.
These elapsed times include transport, first-call preflight and cold loading;
they are neither inference-only nor webcam-to-action latency.

## Decision and limits

Keep this candidate confined to the optional comparison lab. This finite authored
suite provides no overall improvement over geometry, more unexpected actions and
multi-second adapter time. It does not justify connecting Tev1 to live actions.
This decision does not establish that every local model is unsuitable.

All fourteen rows parse through `validateReport`; recomputing `summarizeBenchmark`
from the ordinary rows exactly matches the original logged summary. This review
retrieves and validates the original measurement; it does not rerun inference.
The suite is small and authored, not a physical webcam test or general interface
benchmark. Confidence is model output, not a measured correctness probability.
Jev, physical webcam accuracy/latency and live contextual navigation remain open.

Repeat the pinned workflow explicitly for a new measurement. Retain the original
suite and this first result when comparing another candidate; do not tune on these
outcomes and call the same cases held-out evidence.
