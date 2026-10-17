# PPF tensile response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Independently measure normalized membrane stiffness and density response in a real pinned native CPU experiment (#285).

**Architecture:** A frozen explicit 20×3cm vertical strip with its upper row clamped, no collision, runs three coefficient/density cases. Standard-library metrics and archive replay consume actual rest topology and float32 saved frames. A dedicated source-branch workflow retains all native evidence even on failure.

**Tech Stack:** Python standard library oracle; upstream NumPy/frontend and locked Rust CPU; GitHub Actions.

**Spec:** `docs/PRODUCT_DIRECTION.md` section 5 and issue #285.

## Global Constraints
- Upstream pinned to6b30976f86e6b94d68d459e5237d59704c7d1384; CPU only; no paid compute.
- Shipping app unchanged; no measured-fabric/physical-fit/garment-runtime acceptance claim.
- Strip 21rows×4columns,120triangles, y0..0.2m, x−.015...015m; top4 vertices clamped.
- Cases soft(young500,density1),stiff(young2000,density1),density(young500,density.18). Model baraff-witkin,Poisson.3,bend1,strain-limit0,deformation-damping.02s; gravity100m/s²,dt.01s,fps100,frames150.
- Gates: finite exact151frames/case; clamp drift≤1µm; final20-frame maximum adjacent displacement≤10µm; positive extension<.15; soft extension>1.5×stiff; density-only per-frame maximum coordinate difference≤.1mm. Failed gates stay failures.

## Review Focus
- Rest reorder must map bijectively; row selection cannot use displaced coordinates.
- Gauge uses row means, not extremes (avoid rest offset).
- Final completion cannot imply settling; every saved frame retains finite checks.
- Density control differs only density; effective stiffness is normalized, not textile Pa.
- Archive replay must verify actual native inputs/maps and complete manifest, not trust summary JSON.

### Task 1: Independent measurement
**Files:** create `docs/research/ppf-cpu/tensile_metrics.py`, `test_tensile_metrics.py`.
**Interfaces:** `strip() -> (vertices,faces)`; `measure(frames,rest) -> dict`; `admit(cases) -> None`.
- [ ] Write analytical affine-stretch, rest-zero, clamp-drift, missing/nonfinite frame, moving-final-window and reversed-stiffness tests; watch stub assertions fail.
- [ ] Implement explicit mesh, row-mean gauges and local row-segment strains, coordinate drift and final-window movement. Refuse malformed state and wrong cardinality.
- [ ] Run all standard-library harness tests and commit.

### Task 2: Native experiment and evidence
**Files:** create `tensile_probe.py`, `tensile_audit.py`, `test_tensile_audit.py`, `.github/workflows/clothing-ppf-tensile.yml`; extend `collect.py` with explicit case paths.
**Interfaces:** probe writes receipt/case geometry and151 actual frames/case; audit replays ZIP and asserts equality to receipt metrics.
- [ ] Add missing-input/map/manifest corruption regressions; confirm refusal before valid acceptance.
- [ ] Reuse pinned build/supervisor/collector; isolate synthetic sessions; preserve exact native buffers and parameters.
- [ ] Run harness suite; commit through connector to source branch; execute native CI and inspect all failures.

### Task 3: Review and canonical evidence
**Files:** create `TENSILE_RESPONSE.md`, durable result ZIP/JSON/audit under `results/`; update direction and roadmap with actual outcomes.
- [ ] Replay real artifact independently, record source/run/hash/resources and all gate results without relabelling failed admission.
- [ ] Request read-only whole-branch review; resolve important findings with regressions.
- [ ] Verify app unchanged, tests green, source/main equality; integrate via GitHub tools; update/close #285 only as evidence permits.
