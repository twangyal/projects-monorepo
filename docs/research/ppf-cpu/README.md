# PPF CPU contact feasibility — #279

Question: does pinned PPF `6b30976f86e6b94d68d459e5237d59704c7d1384` build and execute its small real cloth/cloth contact fixture on a standard Linux CPU runner? This is a research probe outside the shipping app, following [the owner's candidate investigation](../../2026-10-17-clothing-ppf-contact-solver-research.md).

The research workflow builds the real CPU backend with the upstream Cargo.lock and runs the original `tools/cpu_contact_fixture.py` source. Both the mesh cache argument and the patchable App.get_data_dirpath storage hook are redirected to an explicit empty synthetic root; the resolved session root is checked before simulation. Geometry, materials, solver calls and all assertions stay unchanged. Two crossed 5×5-vertex sheets produce 13 frames each: contact enabled and contact disabled. Upstream assertions measure actual output segment/triangle crossings, wrong-side vertex frames, motion and the contact-disabled free-fall control. The probe does not replace those gates or claim they independently validate physical fabrics. An initial receipt is written before native execution. The Linux supervisor adopts detached native descendants with PR_SET_CHILD_SUBREAPER and stops/reaps them at the wall limit before collection; a real detached-writer regression checks this boundary. A separate always-run collector retains the native cache, including complete solver stdout/stderr and frames, after a bounded timeout as well as normal completion. Timeout exit codes remain failures, and a successful fixture with missing raw frames fails evidence collection. Forced runner teardown can still prevent cleanup. The JSON receipt records raw held/control measurements, elapsed time, exact revision, fixture checksum and retained synthetic vertex-frame checksums. Logs and process resource receipts remain available even on failure; setup/build success is not contact success.

Reproduce on a CPU host with Rust, a C++ compiler and Python 3.12: check out that exact upstream commit; install `warmup.py`'s `python_packages() + tetra_packages()`; run `CARGO_TARGET_DIR=/absolute/upstream/target/cpu cargo build --locked --release --features cpu` in the source tree. With the same target environment, run `python docs/research/ppf-cpu/probe.py --upstream /absolute/upstream --out /absolute/report --cache /absolute/empty-synthetic-cache`. This local workspace has no Rust/CMake toolchain, so actual native execution is delegated to ordinary public Linux CI. No GPU, paid compute, secrets, user garments or remote user uploads are used.

The workflow can be started manually from GitHub Actions; its research-branch push trigger also records this first attempt. It does not run the native probe on every application commit. Dependencies are read from the pinned upstream recipe and their resolved versions are retained; they are not fully hash-locked Python wheels. Stable Rust's actual version and the runner CPU baseline are recorded rather than claimed timeless. `/usr/bin/time` maximum RSS is a per-process maximum, not aggregate concurrent memory.

Initial native run 39015923759 built successfully and passed the original fixture, but its implicit-cache search retained no raw frames and only the frontend-truncated native logs. It is preliminary execution evidence, not accepted complete evidence. A source trace then found that App.create(cache_dir) controls mesh caching, while native session outputs use App.get_data_dirpath. The final corrected run redirects both data and mesh paths and checks the resolved session root, an always-run collector and a tested detached-process bound. The next native run passed physics and retained complete outputs, but CI failed because the collector counted two vertex-index maps as frames. The exact per-case output-frame fix passes seven regressions and a replay of that SHA-256-verified archive. Fresh end-to-end run39017488693 now passes the native build, original contact fixture and complete collection; the accepted archive contains26 frames and220 checksum-verified native files. See [the evidence report](results/evaluation.md) for original failed receipts, measurements and limits. No PPF engine selection or app integration has occurred. CPU's upstream fixture deliberately uses a dynamic pinned lower sheet; it does not establish static-body collider admission. Coupons/material-unit equivalence, static body and garment/seam admission, one garment/two materials, resolution/timestep studies and independent physical references remain prerequisites before a backend decision. Clothing remains ACTIVE.

## Retain the same bounded evidence locally

After the pinned build and dependency installation above, run from this repository, with an empty dedicated cache and an output directory outside it:

```sh
export CARGO_TARGET_DIR=/absolute/upstream/target/cpu
python3 -m unittest discover -s docs/research/ppf-cpu -p 'test_*.py'
python3 docs/research/ppf-cpu/supervise.py --seconds 300 --out /absolute/report -- python3 docs/research/ppf-cpu/probe.py --upstream /absolute/upstream --out /absolute/report --cache /absolute/empty-synthetic-cache
fixture_code=$?
printf '%s\n' "$fixture_code" > /absolute/report/fixture-exit-code.txt
outcome=failure
if [ "$fixture_code" -eq 0 ]; then outcome=success; fi
python3 docs/research/ppf-cpu/collect.py --out /absolute/report --cache /absolute/empty-synthetic-cache --outcome "$outcome"
```

The collector command must run after failure as well as success; do not use a surrounding `set -e` shell that skips it. The workflow adds `/usr/bin/time -v` resource receipts, complete build/frontend logs and an always-upload artifact around these steps. Treat either a nonzero fixture or collector exit as failure. The supervisor requires Linux procfs and subreaper support; it fails closed elsewhere.

Actual garment native admission: [protocol, strict refusal, durable archive and controlled initialization](GARMENT_NATIVE.md).

Actual native garment motion: [detached sewing geometry, complete raw replay, measured strain/seam and mass limitations](GARMENT_SEWING.md).

Captured inertia follow-through: [per-face adapter, source preservation, validation and pending native gate](GARMENT_INERTIA.md).

Cleared browser-prepared native motion: [complete triangle-surface gate, two-material actual motion, retained archive/replay and limits](GARMENT_CLEARANCE.md).

Same-material native control: [frozen one/four-thread pairs, whole-trajectory replay and ordering investigation](GARMENT_REPEATABILITY.md).

Repaired native material response: [controlled Young500/2000 cohort, full archives, source-derived geometry and independent replay](GARMENT_MATERIAL_COHORT.md).

Longer native observation: [explicit three-second duration protocol and evidence](GARMENT_DURATION_STUDY.md).

Native construction localization: [per-part signed strain, original triangle/edge and seam provenance, exact saved geometry](GARMENT_CONSTRUCTION_DIAGNOSTICS.md).

Separate bounded material sessions: [four completed three-second jobs, full official archives and exact prefix replay](GARMENT_FIXED_MATERIAL_STUDY.md).
