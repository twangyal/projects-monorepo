# Gaze Local Model Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Measure a real open-weight model on the exact shared gaze suite, keeping geometry, eligibility policy, model decisions, and webcam evidence distinct.

**Spec:** https://github.com/twangyal/projects-monorepo/issues/7

**Architecture:** A native ES-module benchmark helper reuses CASES, runSuite, and the local-only adapter. A Node CLI prints one lab-importable report with benchmark metadata. A separate bounded public-runner workflow installs a checksum-verified, pinned Ollama release and explicitly pulls one GGUF model. Logs supply the measured JSON; reviewed results and exact provenance are committed to git.

**Tech Stack:** Node.js 24, existing dependency-free tests, Ollama v0.35.1 Linux amd64, tev1:0.8b-q8_0 GGUF. No hosted or paid API, secrets, app-side installation, persistent CI artifacts or caches.

## Task 1: Honest benchmark summaries and optional CLI

Files: src/decision-benchmark.js; scripts/benchmark-local.js; tests/decision-benchmark.test.js; package.json.

- [x] Add tests separating eleven eligible cases from three deterministic policy cases, fixed denominators, failures/missing rows/cancellation, timing, real-adapter routing, and CLI validation.
- [x] Commit tests first and verify the expected missing implementation failure in exact-source CI.
- [x] Implement complete/partial metrics, baseline comparison, median/p95 adapter timing, and the optional CLI using the existing strict adapter.
- [x] Bound the CLI to five minutes, handle SIGINT/SIGTERM, keep stdout importable JSON, and fail exit status for infrastructure/incomplete reports rather than ordinary incorrect labels.
- [ ] Verify all existing unit, lint/build, and native browser checks; commit useful progress.

## Task 2: Actual free-runner inference

File: .github/workflows/gaze-decision-benchmark.yml.

- [ ] Add a read-only standard Ubuntu job with a 15-minute limit, pinned actions, no artifact/cache uploads, explicit cloud-disabled loopback server and temporary model storage.
- [ ] Verify the official Ollama v0.35.1 Linux archive SHA-256 before extraction; do not curl-pipe an installer or execute unverified binaries.
- [ ] Pull exactly tev1:0.8b-q8_0, run the CLI once, log its bounded JSON and runtime/model provenance, and stop the server on exit.
- [ ] Inspect actual CI evidence. Fix adapter/protocol/runtime failures, or record a concrete infrastructure blocker if unavoidable.
- [ ] Preserve the actual report in git with exact source commit/run/runtime/model digest and a per-case comparison. Do not relabel fixtures or tune the prompt to make the score look better.

## Task 3: Verification, documentation, and review

Files: benchmarks/measured JSON; README.md; PROJECT_IDEAS.md; this plan.

- [ ] Explain installation/CLI/repeatable workflow and separate eligible-case quality from policy-only results. Note cold first-call timing, CPU runner limits, tiny author-labeled suite, no Jev or webcam evidence.
- [ ] Request a fresh whole-change review, resolve Critical/Important findings, and record exact-source unit/browser/benchmark evidence.
- [ ] Commit final durable progress; update/close #7 based on actual completion; reassess immediately.

## Execution rulings

The user's continuous autonomous instruction authorizes design and main-branch commits without routine approval pauses. Local command service remains disconnected. GitHub writes check main's current SHA and update without force. CI is the execution authority. Project #8 remains explicitly skipped.

## Primary sources checked 2026-10-03

- https://docs.ollama.com/api/systemone
- https://docs.ollama.com/faq
- https://ollama.com/library/tev1:0.8b-q8_0
- https://github.com/ollama/ollama/releases/tag/v0.35.1
- Official release asset ollama-linux-amd64.tar.zst: SHA-256 9fcd79ac4575b2bd31b992eee18b1000c8ad126b451627c8f8cd091714cfbb10; 1,439,658,961 bytes. Model download is approximately 812 MB.
- Public standard GitHub-hosted runners are free for public repositories. No persistent artifacts or caches will be uploaded.

## Verification

Tests-first CI 37137825462 at ea057e0 failed on the missing decision-benchmark.js module, as intended. Actual model inference remains pending.
