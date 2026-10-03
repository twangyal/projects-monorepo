# Gaze Decision Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** A usable decision-model comparison slice for project #1, independent from webcam estimation and live action execution.

**Spec:** https://github.com/twangyal/projects-monorepo/issues/6

**Architecture:** Separate static decision-lab page. Native modules validate synthetic tasks, select only nearby enabled candidate IDs or abstain, run a versioned fixture suite, compare geometric and optional local System One results, and import/export reports. Keep existing navigation behavior unchanged.

**Tech Stack:** Native ES modules, Node.js 24 tests, Playwright 1.63.0 and the existing standard Ubuntu CI runner. No runtime dependency.

## Global Constraints

- Preserve project #8's explicit skip.
- No paid API calls, secrets, auto-downloads, deployment, billing changes, or browser-security relaxation.
- Optional model requests only after an explicit Run local model action, to fixed http://127.0.0.1:11434.
- Require cloud-disabled status and installed local GGUF decision capability; reject remote metadata and cloud model names. Append Ollama's :local source suffix and use /v1/systemone.
- Bound request time/body size and cancellation. Late results cannot replace a newer run.
- Only synthetic fixtures are submitted; expected labels/titles/case IDs are excluded from model input. No camera frames, real drafts, or arbitrary page content.
- Reports describe synthetic task agreement. Confidence is a model concentration score, not a calibrated correctness guarantee; browser mocks are not model-quality evidence.
- Local command execution is disconnected. Durable changes and CI verification use connected GitHub tools.

## Review Focus

- A result can select only an enabled nearby candidate or abstain; invalid output must be an error, never a successful abstention.
- Missing/failed cases must not inflate overall accuracy; duplicate/unknown imported rows are rejected.
- Model inputs exclude expected labels and fixture titles, and model/version provenance survives export.
- Cloud-disabled/local-only checks happen before inference. Network redirects, cookies, and arbitrary endpoints are disallowed.
- Cancel settles promptly even when a test adapter ignores AbortSignal; stale completion cannot update the current report.
- Offline lab has no external requests and imported text is rendered through textContent.
- Existing navigation/browser checks remain green.

### Task 1: Decision contract and comparison runner

**Files:** src/decision-contract.js, src/decision-fixtures.js, src/decision-evaluation.js; tests/decision-contract.test.js, tests/decision-evaluation.test.js.

**Interfaces:** validateTask(task), eligibleTargets(task), validateDecision(task, decision), geometricDecision(task), buildChoiceRequest(task, model), parseChoiceResponse(task, response); CASES and SUITE_VERSION; runSuite(cases, adapter, options), validateReport(report, cases), summarize(cases, results).

- [ ] Add tests for finite/bounded geometry, disabled/distant/ambiguous candidates, closed-set decisions, fixture validity, privacy of model inputs, partial/error metrics, strict imports, and cancellation.
- [ ] Commit the tests with #6 and inspect CI for the expected missing implementation failure.
- [ ] Implement bounded contracts, 14 frozen labeled synthetic cases, baseline and sequential runner.
- [ ] Verify Node tests and lint in CI; commit useful progress.

### Task 2: Local decision-model adapter

**Files:** src/local-decision-model.js; tests/local-decision-model.test.js.

**Interfaces:** createLocalDecisionModel({model, fetchImpl, timeoutMs}) returns {id, kind, digest, decide(task, {signal})}. Preflight verifies local-only server and installed GGUF decision metadata; every output is validated against the same task.

- [ ] Add tests for cloud names/status/metadata, known local requests, response validation, bounded body/time, and uncooperative cancellation.
- [ ] Inspect expected red CI before implementing; do not claim mocked transport as actual model inference.
- [ ] Implement fixed loopback, cloud-disabled/version-capable preflight, local-source references, bounded JSON responses, timeout/abort cleanup, and safe errors.
- [ ] Verify all targeted/full existing unit checks in CI and commit.

### Task 3: Usable comparison interface and native regressions

**Files:** decision-lab.html, decision-lab.css, src/decision-lab.js, browser-tests/decision-lab.spec.js; index.html, package.json, README.md, PROJECT_IDEAS.md.

**Interfaces:** choose a fixture; view goal/geometry/gaze/expected target; Run baseline offline or explicitly run a local model; cancel; compare results; export/reload reports. Report format is versioned and validates all rows.

- [ ] Add real Chromium tests for offline results, fixture selection, local mock integration/errors/cancel/retry, safe imported reports, and responsive controls.
- [ ] Inspect red CI and implement the interface without external page-load requests.
- [ ] Keep setup documentation honest about Ollama 0.35+ and local-only mode; no auto-install or hosted API keys.
- [ ] Verify all Node/browser/lint/build checks at desktop, narrow, short, and compact-boundary viewports.
- [ ] Request a fresh whole-change review, fix Important/Critical findings, record exact CI/head evidence and model/hardware limits.
- [ ] Commit documentation, update/close #6 according to actual completion; reassess repository immediately.

## Sources checked 2026-10-03

- https://docs.ollama.com/api/systemone
- https://docs.ollama.com/capabilities/decision
- https://docs.ollama.com/faq (local-only mode)
- https://ollama.com/library/tev1
- https://docs.typesafe.ai/primitives/choice
- Ollama source 42e911bc3d05798cad729cb474bf62f378cb2e26: api/types.go, server/routes.go, internal/modelref/modelref.go. /api/status reports cloud.disabled; :local forces a local model source.

## Execution rulings

- User's explicit continuous autonomy supplies authorization for routine design/commit choices; no design-confirmation pause.
- Runtime service outage prevents a fresh local worktree. Each atomic GitHub write checks main's current SHA and uses its current tree without force; concurrent changes require reconciliation.
- CI runs against the exact committed source and is the verification authority. Public standard runner; existing workflow has no artifact/cache uploads.
