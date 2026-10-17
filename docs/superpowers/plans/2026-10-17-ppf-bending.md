# Native cantilever Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Distinguish settled bending response at two normalized coefficients (#287).
**Architecture:** Reuse the pinned CPU/supervisor/collector infrastructure, with a separate frozen horizontal strip, independent edge/tip/clamp/settling metrics and actual-input ZIP audit.
**Tech Stack:** Python standard-library oracle/replay, upstream NumPy/frontend and locked native Rust CPU, Actions.
**Spec:** Issue #287 and `docs/PRODUCT_DIRECTION.md` section5.

## Global Constraints
- Fixed protocol and gates exactly as #287; no app/backend adoption, paid compute or calibration claims.
-44vertices/60triangles;401frames/case; two cases differ only normalized bend1/1000.
- Preserve all native inputs/logs/frames and unsuccessful evidence; no post-result gate relaxation.

## Review Focus
- Explicit rest coordinates/order, zero UV/velocity, hard stationary eight-vertex clamp.
-401finite frames and final20-frame movement, not process completion as settling.
- Maximum tensile edge strain across every saved state, not a final-only scalar.
- Only bending buffer differs; normalized values do not imply textile SI calibration.
- Actual retained inputs/maps/ordered topology/parameters and checksums must replay independently.

### Task 1: Measurement and native run
**Files:** create `bending_metrics.py`, `test_bending_metrics.py`, `bending_probe.py`, `.github/workflows/clothing-ppf-bending.yml`; extend explicit collector prefixes.
**Interfaces:** `strip()->vertices,faces`; `measure(frames,rest)->dict`; `admit(cases)`.
- [x] Write analytical rest/affine/bent/moving/clamp/malformed/state-order tests; watch stub fail.
- [x] Implement frozen measurements/probe using current native conventions; run harness and publish source for native CI.

### Task 2: Independent evidence
**Files:** create `bending_audit.py`, `test_bending_audit.py`, `BENDING_RESPONSE.md`, retained result archive/receipt/audit; update root direction/roadmap.
**Interfaces:** `audit(path,sha256)->verified metrics`; never unpickle evidence.
- [x] Reuse manifest verification and independently verify frozen actual native input/output buffers, pins and parameters; test corruption refusal.
- [x] Replay actual archive, compare controls, request read-only review and fix important findings with regressions.
- [x] Commit evidence, integrate into latest canonical main, update #287 according to actual gates. Preserve app unchanged.


Post-acceptance validation follow-up: `.github/workflows/clothing-ppf-harness.yml` runs the existing standard-library oracle/collector/replay regressions on relevant main/PR changes without a native rebuild. This adds durable automated coverage for the reviewed metadata corrections; numerical protocol and shipping applications are unchanged. Its actual hosted outcome is recorded in the issue and final integration receipt.
