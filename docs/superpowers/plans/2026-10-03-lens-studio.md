# Lens Studio implementation plan

Issue #31 · `apps/lens-studio` · Astra. The user authorizes autonomous implementation; root reviewed the written contract and releases the work below. Root owns Git, issue updates and integration.

## Goal and contract

Deliver photo import → declared focal framing → side-by-side comparison → optional authored depth → undo/redo → exact PNG/project export → durable reopen. The authoritative types, limits, equations, sampling rules and failure behavior are in `../specs/2026-10-03-lens-studio-design.md`. No owner substitutes a different schema or numerical convention.

This is a local TypeScript/Vite application using native image decoding, a deterministic worker pixel kernel, a pure lossless PNG encoder and IndexedDB. Perspective remains explicitly manual and experimental, and ships only after an independently derived synthetic reference passes. Unknown regions stay transparent; original transparency is retained. No learned depth, optical blur, hidden reconstruction or calibrated camera result is claimed.

## Ownership and sequence

1. **git_history_review:** `src/types.ts`, `src/model.ts`, `src/history.ts`, matching pure `tests/*.test.ts`. Publish types and limits first, then strict detached validation, canonical masks/JSON, bounded stroke painting and compact history. Input rejection must be atomic. Use meaningful failing tests for malformed/deep/duplicate JSON, precision/range boundaries, same-photo history identity, branching and byte/count limits.
2. **audio_engine:** `src/photo-header.ts`, `src/images.ts`, image/header tests and `tests/images-harness.{html,ts}`, `tests/browser/images.spec.ts`. Verify actual PNG/JPEG/WebP decoding, animation rejection, all eight orientations including square/mirrored cases, malformed data, dimensions and abort cleanup. Own image fixture generation; coordinate fixture paths with the browser owner. No cross-app runtime imports.
3. **git_reader:** `src/render.ts`, `src/png.ts`, `src/jobs.ts`, `src/render.worker.ts`, matching pure tests and `tests/jobs-harness.{html,ts}`, `tests/browser/jobs.spec.ts`. Implement the exact inverse bilinear premultiplied kernel, sampled coverage, module-wide latest-valid-job supersession, abort/timeout cleanup and raw-byte PNG export. PNG uses stored DEFLATE, Adler-32 and CRC-32 with independent decoder verification. Invalid/pre-aborted requests must preserve an existing job.
4. **recorder:** `src/storage.ts`, `src/demo.ts`, matching pure/storage tests and `tests/storage-harness.{html,ts}`, `tests/browser/storage.spec.ts`. Export `createDemoProject(signal?:AbortSignal):Promise<Project>`: generate an original three-plane illustration locally, normalize the image and attach known source-pixel masks. Storage uses ordered writes, transaction-complete success and full decoded restore validation. Corrupt/quota/unavailable storage retains current work and supports backup/retry. Also independently review the numerical kernel after it lands; do not edit the renderer owner's files.
5. **next_project_assessment:** `src/main.ts`, `src/style.css`. Implement the full accessible workspace against the frozen interfaces. Publish a coherent import/demo/fixed-mode shell early, then integrate painting/history/perspective/export/storage. Preserve invalid numeric drafts and stage replacements atomically. Explicit generation/cancellation guards protect edits from late restore/import/render; export locks edits until completion/cancel. Brush gestures commit once and pointercancel rolls back. No settings or depth controls imply inferred geometry.
6. **git_runner:** `tests/browser/workflow.spec.ts`, `tests/numerical-oracle.test.ts`, and independent fixture/oracle files under `tests/oracle/`. Own independent geometry/PNG acceptance, actual downloaded backups/PNGs and complete production UI flows. Do not derive expected pixels through production geometry helpers. Coordinate accessible selectors with the UI owner. Test real workers, two focal ratios around one, identity, masks/occlusion/holes/alpha, reload, invalid import preservation, keyboard and mobile/no-external-request behavior.
7. **root:** package/lock/config/index, README, CI, catalog, runtime-verification evidence, design/plan, integration and all GitHub/Git actions. Establish Node 24-compatible tooling and independent `pngjs` test decoder. Development port 4260, production browser port 4261; browser harness entries only in test builds. Root inspects visual outputs and measures maximum-size render/export and cancellation.

Owners run tests they own and report exact outcomes. Before building or starting the shared production browser server, coordinate through root so builds do not overwrite another running suite. Pure tests and edits may run concurrently. Review findings go to the file owner, who adds an appropriate regression before correction. No agent commits independently.

## Acceptance and durable completion

- [x] Model, media, history, storage, renderer/PNG/jobs and editor modules complete with scoped tests.
- [x] Independent scalar reference confirms RGBA maximum error ≤1 and coverage error ≤1e-9 in both perspective directions; exact subject anchoring and identity hold.
- [x] Independent PNG decoder confirms exact raw kernel RGBA, including low alpha; Canvas visual comparison acknowledges presentation quantization.
- [x] Real source formats/orientations and atomic failure/cancellation paths pass production Chromium checks.
- [x] Complete UI workflow, real downloads, reload, blocked/corrupt storage recovery and desktop/mobile layout pass.
- [x] Root records actual maximum-size worker/export timings and visually checks synthetic edges/holes; document hardware/browser limits without extrapolating.
- [x] Combined unit, lint, TypeScript, build and production-browser checks pass; independent review findings resolved.
- [x] README/run instructions, scoped CI, catalog and verification evidence reflect delivered scope and limitations.
- [ ] Review diff, fetch concurrent Astra state, commit and push without force. Check remote CI, update #31 based on evidence and update draft PR #12.
- [ ] Reassess the next meaningful unblocked work, preserving both excluded projects.

## Review focus

The chief risks are orientation applied twice, canvas corruption of low-alpha export bytes, premultiplied edge errors, a continuous-area claim substituted for sampled coverage, painting in projected coordinates, worker completion publishing stale state, and an old save/restore replacing newer work. Each has an owner and a separate actual-behavior acceptance check above. Numeric fields, public modules, source headers and persisted payloads enforce the same bounds. The project is usable without any model download, network API, payment or external service.

## Verified local milestone

Root final `npm run check` passed 67 unit tests, ESLint, TypeScript and a normal production build. Local production browser evidence is 29/30 combined, followed by 2/2 corrected checks; the only final failure was a fixture comparing pre-normalization low-alpha colors rather than the canonical native raster. All 30 cases individually pass. Remote CI will run the complete suite together. The 24-case independent geometry oracle observed max RGBA error 0 and coverage error 1.11e-16; all 48 format/orientation/aspect fixtures matched every expected normalized pixel. Separate independent model/storage/renderer/UI reviews found no outstanding material defect after fixes.

An actual 1280×1280 high-entropy source normalized in 1263.9 ms, rendered in 2976.6 ms and exported in 3396.2 ms in production Chromium 151 on this container; output was 6,555,448 bytes. Cancellation returned AbortError in 604.4 ms including synchronous preflight. Desktop1440×1040 and mobile390×844 views were inspected with no errors, external requests or horizontal overflow. Exact scope and limitations are in the project runtime-verification JSON.
