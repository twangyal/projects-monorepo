# Style Studio Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans with the fixed ownership below. The user has already authorized autonomous execution; root releases implementation only after Duet is durable. Steps use checkbox syntax. Root owns commits and shipping.

**Goal:** Complete issue #24's local wardrobe → genuine preference learning → outfit feedback → personalized alternatives → saved/exported looks flow.

**Architecture:** A pure TypeScript domain and deterministic 14-feature logistic learner feed a Vite browser editor. IndexedDB and bounded history preserve validated profiles; a separate header/decode pipeline normalizes local photos and exports real Canvas outfit boards.

**Tech Stack:** Node.js 22.18+ locally, Node 24 in CI, TypeScript/Vite, native IndexedDB/Canvas, npm unit tooling, ESLint and production Playwright Chromium. No runtime ML dependency, pretrained download, account or paid service.

**Spec:** `docs/superpowers/specs/2026-10-03-style-studio-design.md` contains every shared interface, field, bound and ranking rule. Read it before implementation; do not substitute independent type definitions.

## Global constraints

- Schema 1; 36 pieces, at most 12 each top/bottom/shoes; 80 binary examples; 30 saved looks; 20 photos.
- Stored photos: 720 × 720 JPEG, at most 204,800 decoded bytes; whole UTF-8 profile at most 8,388,608 bytes.
- Source photos: JPEG/PNG/static WebP only; at most 8,388,608 bytes, 16,000,000 pixels and 8,192 pixels per side.
- History: at most 20 total snapshots and 25,165,824 serialized bytes, retaining current; session-only.
- Learner: at least 8 examples and 3 labels of each class; deterministic 600 steps, learning rate 0.2, weight-only L2 0.1 and class-balanced loss.
- Four feature groups total 14 dimensions. Tagged records are one-hot; outfit records contain only 0, 1/3, 2/3 or 1 with unit group sums.
- At most 1,728 combinations; three alternatives; maximum one shared piece between alternatives when possible, otherwise explicitly disclosed fallback.
- Model scores express taste alignment, not calibrated probability. Occasion and novelty are declared rules; photos are manually tagged references, not automatic visual input.
- No app implementation until root confirms Duet's durable milestone internally. No agent commits or cross-owner edits without coordination.

## Review focus

1. A late IndexedDB load or photo decode must not replace a user's newer edits; root tests the generation guard in Task 5.
2. A failed/corrupt import must preserve live state and persistent data; domain/header tests and browser checks pin it in Tasks 1, 3 and 6.
3. Relabeling a saved look at the example quota must update its existing example; snapshot edits/deletion must not rewrite its features; Task 1 tests both.
4. Different label balances and reordered examples must train the specified genuine deterministic model; cold start must not receive invented scores; Task 2 tests both.
5. Queue failures, full storage and large photo-bearing history must preserve usable edits and export; Task 4 tests failure recovery, Task 6 verifies UI guidance.

## File map and dependencies

- `apps/style-studio/src/types.ts`: domain owner's authoritative contracts/constants.
- `src/domain.ts`, `src/demo.ts`, `tests/domain.test.ts`, `tests/demo.test.ts`: validated profiles and coherent edits.
- `src/features.ts`, `src/model.ts`, `tests/features.test.ts`, `tests/model.test.ts`: canonical features, learned scores and bounded suggestions.
- `src/photo-header.ts`, `src/images.ts`, `tests/photo-header.test.ts`, `tests/browser/images.spec.ts`: header limits, real decode/normalization and PNG boards.
- `src/storage.ts`, `src/history.ts`, `tests/storage.test.ts`, `tests/history.test.ts`: ordered IndexedDB persistence and snapshot history.
- `src/main.ts`, `src/style.css`: next_project_assessment's editor; `index.html`, package/config/test configuration: root's production build.
- `tests/browser/style-studio.spec.ts`: independent integrated browser flow/review.
- App README and `.github/workflows/style-studio.yml`: root's usable setup and scoped CI.

Task 1 publishes `types.ts` before parallel tasks begin. Tasks 2/3/4 can then proceed independently; domain uses `features.ts` and pure `photo-header.ts` once available. These dependencies are leaf modules importing only shared contracts, so no implementation cycle is needed. Task 5 integrates stable exports; Task 6 verifies the actual built product. Temporary missing-module failures during parallel development are not shipped.

### Task 1: coherent profiles, examples and saved snapshots — git_history_review

**Files:** types/domain/demo and their tests listed above.

**Interfaces:** Produce the exact `Project`, `PreferenceExample`, `SavedLook`, model/result types and constants from the spec; produce `createProject`, `validateProject`, `parseProject`, `serializeProject`, `newId`, title/piece/example/look mutations, `collectUnusedPhotos` and `createDemoProject` with the specified signatures. Consume `featuresFromTags`, `averageFeatures`, `validateFeatures` and `validatePhotoAsset`; do not redefine their behavior.

- [x] Publish `types.ts` after root releases implementation; tell all owners the contract is available.
- [x] Write failing domain tests for strict shapes, all quotas, duplicate IDs/JSON keys, unknown fields, invalid feature bins, UTF-8 serialized cap, broken references and snapshot category order.
- [x] Run `npm run test -- tests/domain.test.ts`; confirm failures identify unimplemented validation/mutations.
- [x] Implement immutable validation/serialization and all spec mutations; atomically add photos with referencing objects and collect only unused assets after deletion.
- [x] Write failing tests that saved looks survive piece tag/name/photo changes and deletion; relabeling at 80 examples updates rather than adds; deleting a look retains its labeled feature snapshot.
- [x] Implement saved look snapshots and sourceLookId rating upsert; run domain tests until all pass without mutation of inputs or prior snapshots.
- [x] Implement original six-piece/twelve-example/one-look demo with no photos; test schema validity and explicit sample captions.
- [x] Run domain/demo tests and typecheck; report the verified contracts and changed files to root for its coherent commit.

### Task 2: genuine learned alignment and explicit ranking rules — git_reader

**Files:** features/model and their tests.

**Interfaces:** Consume shared types/constants; produce `featuresFromTags`, `tagsFromFeatures`, `averageFeatures`, `validateFeatures`, `trainPreferenceModel`, `scorePreference`, `assessOutfit`, `generateAlternatives` exactly as specified. No UI/storage dependencies.

- [x] Write failing tests for 14-vector order, one-hot conversion, three-piece means, illegal mixed groups/bins, reverse decoding and input immutability.
- [x] Run targeted feature tests to confirm the missing behavior; implement canonical conversions/validation and pass them.
- [x] Write failing training tests for 8/3/3 thresholds, class imbalance, zero initialization, 600 finite deterministic steps, ID-order invariance, corrected-label response and held-out synthetic preference examples.
- [x] Implement the exact class-balanced regularized objective and learned inference; explain only actual feature contributions, with no persisted model parameters.
- [x] Write failing suggestion tests for all four occasion filters, 1,728 bound, lexical ties, exact exploration formula, three-look diversity/fallback and insufficient-data null scores.
- [x] Implement bounded combination/ranking/selection; verify no implicit occasion relaxation and no fixed-rule substitute for trained preference scores.
- [x] Run feature/model tests and typecheck; report passing evidence and numeric interpretation limits to root.

### Task 3: bounded reference photos and real outfit-board export — audio_engine

**Files:** photo-header/images and their pure/browser tests.

**Interfaces:** Produce `validatePhotoAsset(value:unknown):PhotoAsset`, `normalizePhoto(source:Blob,id:string,signal?:AbortSignal):Promise<PhotoAsset>`, `validateProjectPhotos(project:Project,signal?:AbortSignal):Promise<void>` and `exportLookPng(project:Project,lookId:string,signal?:AbortSignal):Promise<Blob>`. Pure header code imports only types/constants; export can consume domain validation without creating a cycle. Coordinate browser fixtures/config with git_runner/root.

- [x] Write failing header tests for canonical base64, JPEG markers/dimensions, caps, corrupt/truncated data, spoofed MIME and animation flags/source dimensions.
- [x] Run targeted tests, implement bounded parsers and pass them before handing `validatePhotoAsset` to the domain owner.
- [x] Write production-browser tests using actual JPEG/PNG/WebP fixtures for contain-without-distortion, metadata-stripping re-encode, 720-square JPEG/200 KiB cap, corrupt decode and cancellation after a delayed decode.
- [x] Implement normalization/decode checks with bitmap/URL cleanup and cancellation after every await; pass real image tests.
- [x] Write a real board test that independently decodes PNG output, checks 1200 × 1000 and visible photo/procedural regions, then proves a saved look still exports after its wardrobe piece changes/deletes.
- [x] Implement snapshot-based Canvas export with bounded wrapped text and no download on abort/failure; run image/export checks and report verified limitations.

### Task 4: ordered durable snapshots and bounded undo — recorder

**Files:** storage/history and their tests.

**Interfaces:** Consume validated Project and domain validation/serialization; produce `openProjectStore():Promise<ProjectStore>` and the exact ProjectHistory constructor/getters/apply/undo/redo contract. Root owns stale-startup and DOM generations.

- [x] Write failing history tests for input/getter/undo snapshot isolation, rejected/no-op edits, redo invalidation, boundaries, 20-snapshot count and 24 MiB serialized trimming while preserving current.
- [x] Run targeted tests to establish failures; implement bounded detached snapshots and pass them.
- [x] Write failing storage tests using controlled IndexedDB transactions for captured-at-call saves, queue ordering, save/clear ordering, failed-write recovery, close waiting, rejected post-close work and corrupt load preservation.
- [x] Implement `style-studio` v1 / `profiles` / `current` persistence; resolve on transaction completion, propagate failure, and keep later queued writes functional.
- [x] Run storage/history tests and typecheck; report failure semantics to root before UI integration.

### Task 5: usable local preference-to-look workspace — next_project_assessment + root

**Files:** next_project_assessment owns main.ts/style.css; root owns package/config/index, integration tests and later README/CI/catalog.

**Interfaces:** Consume the frozen module APIs. Instantiate history/store; root owns operation AbortControllers, generation tracking, autosave feedback and actual Blob downloads.

- [x] Establish scoped Node 24 npm tooling with scripts `test`, `lint`, `typecheck`, `build`, `check`, `test:browser`, and `dev`; integrate the actual dependencies/test runners rather than empty commands.
- [x] Implement wardrobe add/edit/delete forms and optional normalized photos, tagged Like/Pass examples and label correction with preserved drafts.
- [x] Integrate real training, counts/contribution/limits display, manual assessment, mode/occasion suggestions and explicit insufficient-data/diversity states.
- [x] Implement immutable saved looks, name/notes edits, saved-look ratings, confirmed selected-object deletion and genuine PNG/JSON export/import.
- [x] Write failing integration checks for delayed startup load, competing photo/import operations and intervening edits; implement generation/cancellation so stale operations cannot publish or autosave.
- [x] Add undo/redo, explicit sample-profile replacement and storage failure/retry/export guidance; never overwrite corrupt saved data with the empty default automatically.
- [x] Run `npm run check` and production-browser smoke; resolve owner integration mismatches before final review.

### Task 6: independent production-browser review and durable completion — git_runner + root

**Files:** integrated browser tests; root owns README, scoped CI/catalog and Git.

**Interfaces:** Consume stable action labels and built app. Use real native image decode, Canvas PNG and IndexedDB; mocks may control failures/races but cannot replace acceptance image/export behavior.

- [x] Write production-browser acceptance for empty startup → real pieces/examples → learned assessment → filtered alternatives → saved look/notes/rating correction → board/JSON export → reload/import → undo/redo.
- [x] Add cold-start/no-score, no eligible occasion, limited-wardrobe diversity, selected deletion, snapshot photo survival/GC, malformed import preservation and accessible desktop/mobile checks.
- [x] Add delayed load/decode/import/export, IndexedDB unavailable/quota failure and write recovery checks; verify the UI preserves newer edits and offers usable explicit export.
- [x] Run `npm run check`, `npm run typecheck`, and `npm run test:browser` against the production build; independently decode downloaded board and normalized photos.
- [x] Review all changed app files for contract drift, unjustified model claims, stale async publication, data loss and unbounded input; fix findings and rerun affected checks.
- [x] Root writes factual setup/limits/backup/ML docs and path-scoped Node 24 CI, updates only the allowed Style catalog entry/table row, and records actual verification counts without guessing.
- [ ] Root commits/pushes coherent reviewed work, updates issue #24 only with measured results, and marks the core app maintenance once the complete flow passes. Reassess independent work instead of adding unverified vision or cosmetic extensions.

## Plan self-review

The shared types and signatures are defined once in the spec and consumed by explicit owners. Tasks cover every schema/model/filter/snapshot/photo/persistence/UI/verification requirement. All five review-focus failures have named test owners. The plan freezes decisions without prescribing implementation bodies; no pretrained download or remote image service is implicit. The authorized execution method is fixed ownership under root; there is no outstanding approval question and no app code was created while preparing this plan.

## Verified implementation

The final combined `npm run check` and production `npm run test:browser` run passed: 51 unit tests, ESLint, TypeScript, Vite build and 29 Chromium checks. Independent reviews found and resolved EXIF orientation handling and replacement/recovery races. A separate 48-case JPEG/PNG/WebP orientation pixel oracle passed. Root visually inspected desktop/mobile views and an actual 1200 × 1000 exported board. Issue #24 records the durable commit and remote CI separately.
