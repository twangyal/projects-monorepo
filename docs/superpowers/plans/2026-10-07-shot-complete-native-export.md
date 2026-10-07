# Complete native export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Refuse incomplete native video publication; retain mixed throughput evidence.
**Architecture:** Pure native video policy owns bounded timestamp accounting. The native adapter feeds packet observations and verifies after owned flushes; the existing driver passes its immutable authored frame plan.
**Tech Stack:** JavaScript modules, pinned Mediabunny1.61.1, WebCodecs, Node tests/Playwright.
**Spec:** docs/superpowers/specs/2026-10-07-shot-complete-native-export.md

## Global Constraints

- Existing960x540/30fps/2.5Mbps,70s product/95s maximum waiter and frozen media gates remain unchanged.
- Realtime is not adopted: its first full155 push timed out despite a PR pass.
- No packet/sample/frame retention, retries, automatic quality substitution or production infrastructure changes.

## Review Focus

- Original quality/VP9-first preference remains unchanged.
- Reordered packet delivery must accept complete expected timestamp sets.
- Dropped/duplicate/unexpected native output must never publish a movie.
- Failure/cancellation must drain native siblings and preserve saved data.
- Retired late callbacks must release bounded accounting without callback exceptions.

### Task 1: Native video policy

**Files:** Create src/export-video-policy.js and tests/export-video-policy.test.js under apps/shot-studio; export policy through timestamped-export.js; add syntax check.
**Interfaces:** createFrameCompleteness(plan) returns observe(seconds),verify(),retire().
- [x] Write exact/missing/duplicate/unexpected/reordered/1800-bound/retired timestamp tests.
- [x] Run Node tests; confirm expected missing policy failure (RED).
- [x] Implement bounded pure policy without packet retention; export it.
- [x] Run full npm test and npm run check (GREEN); include policy in the coherent integrated commit referencing#128.

### Task 2: Native integration

**Files:** Modify timestamped-export.js and timestamped-native-lifecycle.test.js; create browser/complete-native-export.spec.js.
**Interfaces:** Native create(sink,codec,pcm,plan) receives immutable frame plan; existing controlled backends may ignore added plan. Manual native lifecycle fixtures supply their one-frame plan.
- [x] Write real native controlled output-omission test: failure/no download/exact stored scene+sequence/native encoders closed; run RED before integration.
- [x] Preserve codec policy; pass plan, observe packet timestamps, verify after all flushes; retire on cancel/finalize.
- [x] Run all units/syntax and targeted actual native success/omission/cancellation; fix regressions.
- [x] Inspect first full155 realtime results; mixed outcome rejects production adoption.
- [x] Run all native cases and unchanged original maximum/restart/decode; independent review; commit integrated change.

### Task 3: Published acceptance

**Files:** README/PROJECT_IDEAS.md, exact-head receipts and compatibility workflow.
- [x] Retire isolated candidate patch jobs when their constructors no longer match production; preserve historical results and original/pinned155 maximum jobs.
- [x] Inspect first published push/PR units/native/maximum and pinned155original/diagnostic runs; retain any first failures.
- [x] Record exact counts/heads and limits; update#128 with actual completion or remaining blocker. Keep decoder/physical work separate.


First published771e17b results: all13normal PR workflows pass; PR357unit/111native
and all original configured153/full155 media gates pass. Push357unit/110native
pass, one new omission harness assertion expires at5s before completion, and
153/155maximum product timeouts recur. Raw paired first outcomes are retained.
The harness correction pins a legal one-second shot and waits through its11s
product deadline, with all safety/preservation assertions unchanged. Focused
native correction passes locally; corrected published CI is pending. Throughput
repair remains explicitly unfinished in#128, without realtime adoption/retries.
