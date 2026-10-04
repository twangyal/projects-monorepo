# Color Context Lab implementation and experiment plan

Issue [#70](https://github.com/twangyal/projects-monorepo/issues/70); authority is [the reviewed design](../specs/2026-10-04-color-context-lab-design.md). New path `apps/color-context-lab`. Reviewed and frozen; root releases the named implementation owners after this design commit. The later dataset-manifest freeze is a separate prerequisite before any protocol-model fit. No other project or frozen experiment may be modified.

## Ownership and dependency order

Four disjoint producers, two independent reviewers; root owns package/Vite/TypeScript/ESLint/Playwright/CI configuration, README/catalog/version, production build/port4290 coordination, docs/Git/issues and final evidence. No shared runtime imports from other apps. Matching patterns may be implemented locally without expanding neighboring projects.

1. State producer publishes exact shared types/constants and callable throwing signatures first. Media and experiment producers publish their public signatures at the same early checkpoint. Consumers do not treat stubs as working features.
2. Each producer records meaningful failing tests before implementation and scoped green afterward. Independent numerical/protocol/browser fixtures are authored against the design rather than producer algorithms.
3. Native owner captures a real missing-UI RED before the UI shell appears. Root grants exclusive shared build/server ownership; others may run pure tests/lint/typecheck without launching a competing build.
4. Complete browser vertical slice and preregistration validations may proceed in parallel. **Do not fit the declared protocol models while implementing/debugging the generator.** Generate manifests/fixtures, run pre-fit checks, obtain root/independent review and commit their hashes first. Root then releases one actual experiment run.

## Producer 1 — Validated project, exact backup, history and storage

Own `src/types.ts`, `src/model.ts`, `src/history.ts`, `src/storage.ts`; new `tests/model.test.ts`, `tests/history.test.ts`, `tests/storage.test.ts`, native storage harness HTML/TS and its scoped browser test if needed. Publish the design's exact API promptly.

Implement immutable base64 raw-RGBA asset admission before byte allocation, PNG ratio/procedural metadata consistency, canonical settings and literal strings, strict bounded duplicate-safe JSON. No native image decoding on complete backup or IDB load. History shares one immutable image, preserves detached edit states, no-op redo and failure atomicity, and enforces exact30-state/128 KiB limits. A new asset/project requires reset, never an implicit history swap.

Store complete canonical JSON in one real IDB value. Validate/snapshot before queuing; bound ordered pending operations and open/transaction deadlines. Resolve only on transaction completion; close/cancel/timeout cannot let a late open/write supersede clear or newer state. Stored undefined is corrupt presence. Raw recovery never silently replaces or erases data. State APIs do not decide user confirmation or startup gating; UI owns those explicit policies.

Meaningful gates: malformed/base64/count/byte/Unicode/accessor inputs; alpha0/low-alpha arbitrary bytes survive JSON; max720² payload; native load/save/abort/quota/order/clear/reopen; closed/timed-out queue and late open; immutable image sharing, detached current, invalid commit/no-op preserving redo, oldest trimming. Run owned tests/lint/typecheck; native harness only in coordinated build slot.

## Producer 2 — PNG/normalization, surround kernel, exact artifacts and jobs

Own `src/png.ts`, `src/images.ts`, `src/render.ts`, `src/report.ts`, `src/jobs.ts`, `src/image.worker.ts`; matching new unit files and own image/jobs native harness files/tests. Root supplies pngjs as test-only independent decoder.

Implement the exact small supported PNG subset and dimension/CRC/framing admission, then actual browser decode with documented normalization. Close native resources and never reuse presentation Canvas as export pixels. Create the specified procedural demo. Implement direct RGBA center copy, solid/checker frame geometry and both encoded-RGB/linear-Y metrics from the frozen formulas. Own lossless stored-DEFLATE PNG checksums/chunks, bounded HTML with independently computed raw-pixel SHA-256 and exact embedded baseline/result PNGs. All metadata renders literally/escaped.

Implement single active worker job across normalization/preview/exports, snapshot/pre-abort admission before supersession, aggregate30-second deadline, output byte caps, transferred-owned buffers and termination/listener/timer cleanup. Failed invalid calls preserve a valid active job; valid replacement/Stop prevents late publication. Report API is asynchronous and computes its own digest/metrics; it does not accept unverifiable caller-supplied values.

RED/GREEN cases: tiny odd geometry, border0/max, every checker parity, unchanged hidden/low-alpha center bytes, analytical RGB RMSE and independent sRGB-Y reference; exact PNG independent decoding across DEFLATE boundaries; malformed PNG and native decode failure; real max output/report; late worker events, timeout/pre-abort/supersession and cancelled normalization/export cleanup. Native Canvas normalization assertions distinguish first normalized pixels from raw encoded-source pixels honestly.

## Producer 3 — Complete accessible artist workspace

Own `index.html`, `src/main.ts`, `src/style.css`, optional private `src/workbench.ts`. No state/media/experiment implementation overlap. Preserve frozen selectors and explicit product wording.

Build responsive synchronized neutral/result views, transparent checkerboard presentation, raw parameter/title forms with explicit Apply/Discard, history, current/stale metrics, exact source/result/project/report downloads and save/recovery controls. Artist uploads never receive the procedural classifier's scores. Render actual experiment report with status/readiness, every arm/bypass and limitations, plus inspectable/downloadable full data and the fixed procedural example images.

Gate startup mutations until actual storage result. Protected recovery allows explicitly chosen memory-only editing without automatic writes; Save current project and Clear saved project have the exact durable-only policy, preserving current history/raw drafts. Retry load/save need generation/intent receipts and native confirmation rechecks. Existing incomplete/pending work must not erase raw fields, focus or newer status. Source/project replacements validate fully before confirmation/publication and keep current state on failure. Input-only changes invalidate stale exports/reads before blur. Apply is one history commit; ordinary status renders do not recreate focused controls. Pagehide/BFCache and blob lifetime cleanup remain usable.

UI tests/lint/typecheck scoped; independent native owner owns main acceptance cases and root owns the shared build. Report coherent API/source checkpoints early rather than hiding temporary failures with mocks.

## Producer 4 — Original generator, real learner and bounded evidence artifact

Own `experiments/protocol.json`, `experiments/generate.py`, `experiments/run.py`, `experiments/report.py`, `experiments/tests/`, `experiments/requirements.txt`, `src/experiment.ts`, `tests/experiment.test.ts`, and `public/experiment-report.json`. Keep production Python experiment logic in the explicit source fingerprint files named in the design; an extra helper file requires root review and fingerprint-list amendment before manifest freeze. Published APIs/report shape remain frozen. Initial artifact explicitly not-run. No fit of protocol data until the manifest-freeze release.

Use installed pinned Python dependencies in a separate experiment environment; no pretrained checkpoints/downloads/corpus or other-project experiment data. Implement exact mathematical renderer, family assignment, duplicate admission, color marginals/distortion, masks, fixed sample order and manifests. Run pure generation checks, publish actual hashes/parameters and independent review package before fitting. Literal test fixtures verify transfer function independence, class labels and equal foregrounds; tiny separately authored learner unit data may verify real fit plumbing after implementation release, never protocol development/test data.

After root freezes generator/manifest, run all18 fixed fits and development diagnostics under declared10-minute/output limits. Readiness gates every test prediction; if it fails, preserve inconclusive artifact and all development data without tuning. If it passes, emit all108 evaluations and predictions, recompute all confusion/accuracy/flip/baseline values, serialize bounded exact artifact and revalidate using independent TypeScript/Python checks. Repeat once in a clean pinned process to compare manifests/discrete predictions. No effect-size/sensitivity-success gate; null and bypass-success outcomes are first-class complete results. Errors keep truthful referentially complete records, not zeros/placeholders.

Implement strict browser report parser and procedural-only example raster helper. Fixed same-origin report failure is independent of artwork use. Record exact command/software/thread settings/config/data/model hashes, runtime and limitations. Root decides Git artifact publication after independent review; no producer silently replaces a frozen result with a tuned run.

## Independent reviewer 1 — Scientific protocol, controls and result oracle

Own a new independent Python oracle under `experiments/oracle/` and `tests/experiment-oracle.test.ts`; no production writes. Before reading implementation, derive shape masks/coverage, balanced family assignment counts, equal576 squared-color distance and full-image RMSE sqrt84, disjoint-family/paired foreground invariants and center-mask equivalence. Review genotype/sample collision handling and independent split RNG use. Require entire assignments/manifests frozen before fit.

Independently recompute every published confusion matrix, development readiness, accuracy/paired flip/baseline subtraction and seed aggregate from literal ordered prediction arrays. Check complete108-condition matrix, missing/duplicate/error blocks, no held-out prediction before readiness, all failed/negative/null outcomes retained. Real small learner behavior verifies fit/predict against controlled fixtures; do not infer art quality or generative transfer. Review the measured artifact and reproducibility rerun only after root authorizes actual fitting.

## Independent reviewer 2 — Numerical artifacts and native user flow

Own new `tests/render-oracle.test.ts`, `tests/browser/workbench.spec.ts` and isolated fixture helpers. Coordinate with media/state owners on their native harnesses; no competing builds. Derive PNG/kernel/metric expectations independently, including low/zero alpha, odd/checker edges, maximum dimensions, complete backup and exact embedded report images. Use pngjs only as independent decoder; no production renderer as expected-value source.

Capture native missing-control RED. Then verify real PNG import→raw parameter edit→Apply→original/result views→Undo/Redo→source/result/project/report exports→persistent process restart. Assert literal hostile metadata, active focus/invalid spelling, cancelled/stale file/worker/export publication, startup mutation gate and protected failed load, explicit durable replacement/clear, native transaction abort/order/timeout, pagehide/BFCache, Stop/retry and390px keyboard flow. Inspect actual reports and source/result screenshots without treating display appearance as scientific human-perception evidence. No browser test may claim learned results from injected fake model output.

## Root final gate and release

Root records source-frozen unit/lint/typecheck/build and native results, independently checks maximum rawRGBA/backup/report bounds and actual output decode/reopen. Root reviews protocol + generator + data manifest before releasing fitting, then validates truthful actual results/repeatability before changing production not-run artifact. Document setup, supported PNG subset, normalized-original versus original-file distinction, context-only scope, exact finite experiment/no protection claims, storage recovery and complete backup. Add path-scoped CI and catalog path/status only for delivered scope. No release claim based solely on scaffolding, mocked learned results or uninspected exports.

## Root review and implementation release

The complete design and plan were read by root. Independent numerical/media/persistence review and independent scientific protocol review both cleared the final contract. Startup recovery, stored-undefined presence, actual-pixel digest ownership, fatal UTF-8 File decoding, raw-input export receipts, exact report conditions and canonical hash recipes were resolved before implementation. No application code, dataset generation or fitting existed at this checkpoint.

Assignments: git_reader owns state/model/history/storage; audio_engine owns PNG/media/kernel/jobs/report; git_runner owns the UI after its narrow Melody issue76 verification; recorder owns the experiment implementation and browser artifact parser. git_history_review owns the independent scientific oracle; next_project_assessment owns independent numerical artifacts and native acceptance. Root owns configuration, shared builds/ports, documentation/catalog, evidence and Git/CI/issues. The initial new-app shell supplies no implemented controls and is used only for the missing-control acceptance checkpoint. Existing applications and their servers remain outside this ownership.

The fixed protocol models must not be fitted until root separately commits the protocol, complete generator source fingerprint, ordered manifest and independent pre-fit verification receipt. Tiny unrelated learner unit fixtures are allowed as specified. No favorable result is required.
