# Melody Studio reference takes implementation plan

> **For agentic workers:** Use superpowers:executing-plans for assigned tasks and test-driven development for each component. Root coordinates exclusive owners and independent reviews; workers do not commit or start competing builds/services.

**Goal:** Retain a bounded audible take alongside editable notes, with reversible reference operations, complete local persistence and portable backups.

**Architecture:** Keep Composition v1 as the musical engine. New document/history APIs bind tracks to private immutable PCM assets; complete-project serialization and IndexedDB transactions preserve that graph. A separate reference panel compares fixed-speed audio with edited notes rendered at captured tempo without changing ordinary playback or exports.

**Tech stack:** Existing TypeScript/Vite, native Workers/Web Audio/OfflineAudioContext/IndexedDB/Web Crypto, Node native TypeScript tests and production Playwright Chromium. No runtime package or backend.

**Spec:** [Reviewed contract](../specs/2026-10-04-melody-reference-takes-design.md). Production implementation awaits root's written release after both reviewers finish. Read the full spec before any owned change; APIs/types/constants there are authoritative.

## Global constraints

- Scope only `apps/melody-studio` and root-owned project documentation/tooling. No unrelated project changes.
- Composition stays version1; complete backup `format:'melody-studio-project', version:1`; document `schemaVersion:1`.
- Reference PCM mono22050 signed16LE, at most441000 frames/882000 bytes; <=8 active assets;50 prior history edits and64 MiB unique history PCM; complete file12 MiB, document2 MiB; legacy input remains1 MiB. The reviewed document bound preserves accepted legacy numeric reserialization growth and wrapper overhead (actual RED before correction).
- Keep existing MIDI review receipts, continuation learner, oscillator/transcription algorithms and current musical bounds. Existing source files may change only where the assigned task explicitly owns them.
- Root owns updates to old fixture assumptions for the new backup/storage shape, README/catalog/package/workflow/docs/version/Git. Producers own their new tests only; changes to an old test require root coordination.
- No false lossless, hardware, microphone accuracy or cross-browser sample identity claims. Chromium is the measured browser target.
- Stage errors/cancel/staleness do not publish. Native source/worker/transaction callbacks cannot mutate a newer owner's state.

## Review focus

- A cancelled native decoder or offline render can continue running: preserve single admission until it drains, and prevent late sound/publication. Task2 unit seams and Task4 native deferred-operation gates.
- A save request can succeed before its transaction aborts: Task3 must observe transaction complete and preserve the old complete graph after abort, then prove it natively.
- Undo after reference replacement needs the old bytes, while duplicate tracks should share bytes: Task1 tests immutable registry reachability, branch truncation and budget rejection before mutation.
- Unsent fields and a proposal can coexist with reference playback/file import: Task4 tests raw text/focus/input-only intent, cancellation, declined consent and stale confirmation; committed backup excludes all scratch state.
- A note outside the comparison window can change full-track normalization or contribute a release inside it: Task2 and independent oracle compare full synthesized-track crop, not cropped-note re-rendering.

---

## Task 1 — Complete document and bounded shared history

**Exclusive production:** create `src/reference-types.ts`, `src/reference-project.ts`. Do not edit engine `types.ts`, `model.ts`, `history.ts`, arrangement/learner/exporters.

**New tests:** `tests/reference-project.test.ts`.

**Produces:** All spec types and `REFERENCE_LIMITS`; `notesOnly`, `validateDocument`, `validateAsset`, `validateBundle`, `withComposition`, `ReferenceHistory` with exact spec signatures.

- [x] Publish callable signatures/types first with deliberately failing placeholders, tell Tasks2–4 owners they may import them.
- [x] Write red fixtures for one reference per existing track, missing/extra/sparse/unknown objects, normalized strict Composition, decoded frame relationships, detached bytes and colliding IDs. Run `node --experimental-strip-types --test tests/reference-project.test.ts`; capture meaningful failure.
- [x] Implement bounded validators and detached canonicalization. Keep legacy engine validation callable and unchanged.
- [x] Add red history cases: notes+reference replacement, remove/delete/duplicate sharing, one undo/redo edit, no-op preserving redo and zero orphan registration,50 prior states, normal oldest eviction, proposed branch frees redo bytes, exact64MiB cap, rejected cap/collision preserving cursor/current/redo, getters cannot mutate stored PCM.
- [x] Implement private registry and projected reachability preflight, normal trimming/GC, current-only clear. Use small generated fixtures plus an actual near-limit byte case; no unbounded snapshot copying of asset data.
- [x] Run owned tests and scoped ESLint/typecheck. Send exact commands/results and stable API checkpoint; root schedules review.

## Task 2 — Native normalized references and exact comparison windows

**Exclusive production:** create `src/reference-audio.ts`; no oscillator/transcription/worker algorithm edits.

**New tests:** `tests/reference-audio.test.ts`, native audio harness `tests/reference-audio-harness.html`/`.ts` if needed. Root adds test-build inputs only after owner identifies actual requirement.

**Consumes:** Task1 types/validators. **Produces:** `normalizeReference`, `referenceWindow`, `referenceSamples`, `comparisonComposition`, `cropComparison` exactly as spec.

- [x] Publish signatures once Task1 types exist. Write red tests for PCM quantization using admitted equal-rate input, detached source/asset copies, exact [start,end) frame rounding, nonfinite/empty/range rejection and silence padding.
- [x] Implement native OfflineAudioContext normalization at22050, equal-rate copy, clipping/asymmetric PCM16 quantizer and completed-asset UUID. Preserve the original-rate analysis buffer. Capture metadata is decoded-rate provenance, not encoded/device-rate claims.
- [x] Add bounded dependency seams solely for unit lifecycle tests if necessary, without app test globals. Write red cases for pre-abort, abort during rendering, native rejection, deadline and cancelled-native drain refusing concurrent admission; implement owner cleanup.
- [x] Test notes comparison at captured tempo with all original notes retained; sustaining note begins before window, note/release ends inside/outside, empty/inaudible track, far later loud note affects peak-limited window, zero-pad beyond render. Compare with existing renderComposition independently of UI.
- [x] Run focused unit tests/scoped lint/typecheck. Native resampling tests belong to independent acceptance; give reviewer the exact harness entry and return source freeze before any coordinated browser build.

## Task 3 — Complete backups and atomic durable storage

**Exclusive production:** create `src/reference-backup.ts`, `src/reference-storage.ts`. Existing `storage.ts` remains legacy compatibility helper.

**New tests:** `tests/reference-backup.test.ts`, `tests/reference-storage.test.ts`; an owned storage harness may be created only if independent browser owner requests it. Native transaction assertions must not be replaced solely with a mocked IDB implementation.

**Consumes:** Task1 bundle types/validation. **Produces:** `encodeProjectBackup`, `decodeProjectBackup`, `ReferenceStorage`, `REFERENCE_DB_NAME/VERSION`.

- [x] Write meaningful red independently constructed JSON/PCM fixtures: canonical base64/SHA, one/full8-asset graph, original notes-only v1, strict unknown/duplicate keys, invalid raw UTF-8/depth/nonfinite rejection and exact escaped NUL/lone-surrogate engine-string preservation, invalid padding/size/hash, missing/extra/colliding data and12MiB admission. Do not use the production encoder to author every decoder test.
- [x] Implement bounded JSON preflight, detached async hashing, canonical exact key order and output bytes; rawPCM restore never invokes arbitrary audio decoding. Legacy conversion retains engine semantics and every accepted UTF-16 string value. Test literal legacy-to-complete encode/decode with NUL/lone-surrogate titles, names and IDs, including matching binding IDs; JSON escapes preserve these values without permitting malformed raw UTF-8.
- [x] Publish storage signatures; write red IDB tests for descriptor+asset all-or-nothing publication, absent vs corrupt/read-failed distinction, immutable invocation snapshot, transaction-complete semantics, serialization failures, close/versionchange/open timeout cleanup and ordered operations.
- [x] Implement load using one readonly bounded-key transaction with immutable Blob size admission before PCM arrayBuffer/hash, and save using one readwrite transaction across projects/assets, with all hashes prepared beforehand. Never perform separate asset-GC writes. Fail safely without deleting damaged data on load.
- [x] Run focused unit tests/scoped lint/typecheck. Request independent native abort/quota/process-restart gates; tell Task4 owner load null means proven absence and save failures leave memory policy to UI.

## Task 4 — Audible correction and complete-project UI lifecycle

**Exclusive production:** `src/main.ts`, `src/style.css`; may create `src/reference-view.ts` as the stable panel helper, with no circular imports into main. All other modules remain under their owners.

**Consumes:** Tasks1–3, existing native recorder/workers/Composition APIs. **Produces:** All frozen controls and complete-document state/save/capture/import integration.

- [x] Coordinate independent browser owner to observe original missing Reference take control RED before publishing the new shell. Publish stable selectors exactly as spec; retain original status role and old editor/MIDI selectors.
- [x] Replace app composition-only state/history with wrapper-backed state while continuing to pass only `.composition` into engine/learner/MIDI/WAV. Every transformation reconciles references; duplicate shares explicitly, deletion removes binding, new/example/MIDI replacement has none. Preflight history commit before changing selection/proposal/drafts/playback/save status.
- [x] Integrate async startup/recovery and ordered save pump: block initial mutations until read settles, absent-only legacy fallback, no automatic migration write, present-corrupt/read-failed protected mode, complete snapshot retries and post-confirmation generation guards. Saved indicator follows only matching transaction completion; native complete backup stays usable on failure.
- [x] Integrate capture as one notes+asset commit with frozen tempo/target/intent, reference normalization before transfer, exact20s cut disclosure and owning deadlines/drain. Remove premature continuation clearing; failed/cancelled captures preserve prior draft/proposal/history/reference. Existing original permission/cancel cleanup remains.
- [x] Add fixed-frame reference/edited-note comparison using existing exclusive playback generations, full solo render and crop; fixed speed/captured-vs-current BPM/mute/window/tail text; invalid window strings survive async redraws. Reference removal and explicit confirmed clear-history implement spec semantics.
- [x] Stage complete project File read/hash with independent epoch+raw-intent+document generation; preserve sound/proposal/raw drafts on cancel/error/stale completion; confirm successful replacement counts/scratch loss then commit once. Replace current Save project file with complete encoder; preserve MIDI and ordinary WAV notes-only behavior.
- [x] Run scoped syntax/type/lint. Hand off coherent source freeze with selectors, ownership invariants and any known failing tests; do not start a shared build/server. Independent browser owner owns production acceptance.

## Task 5 — Independent numerical, persistence and native acceptance

**Independent test owners assigned by root, not producer self-certification.** Numerical owner creates `tests/reference-oracle.test.ts` and optional standalone maximum-evidence script under `scripts/`; browser owner creates `tests/browser/reference-takes.spec.ts` plus original fixture helpers. Root owns compatibility updates to existing tests and config.

- [x] Author original known PCM with leading/internal silence, mono/stereo opposite-phase tracks,44100/48000 source rates, known tones and tail-boundary fixtures. Determine frequency/RMS/frame tolerances before inspecting producer output. Verify equal-rate PCM byte identity and native resampling passband/timing without claiming cross-engine byte identity.
- [x] Decode complete backup bytes independently and verify checksums/metadata/each PCM sample; independently inspect actual AudioBuffer source contents for both windowed auditions, tempo edit behavior and full-render normalization outside window. Confirm exported MIDI/WAV contain only committed synthesized notes.
- [x] Native successful capture/import/demo → edit → both auditions → duplicate/remove/Undo/Redo → complete download → Open → true persistent-browser process restart. Include maximum8 distinct20-second assets and keep native reference audio identical across save/load/backup, while original-rate transcoding has disclosed quantization.
- [x] Native failed/cancelled decode/worker/resume/stale source.onended, input-only edits before blur, newer file/project/selection/Undo, invalid raw fields/focus/proposal, held native confirmation, shared-capacity rejection and explicit clear-history. Confirm no late sound or wrong save status.
- [x] Native IDB transaction abort/quota, delayed/coalesced saves, corrupted/missing asset, IDB read failure, absent-only legacy migration, stale legacy suppressed, explicit recovery Retry/Replace and closing during save. Test actual store records plus native complete UI, not storage injection as a substitute for persistence success.
- [x] Run original+new full unit/lint/typecheck/build/native suites in a root-coordinated fresh port. Root runs independent max-assets/process-restart/audio artifact gate and captures desktop/390px accessibility/layout evidence.
- [x] Review source with audio/timing and storage/lifetime reviewers; resolve concrete findings with red regressions. Root updates README/catalog/verification evidence, commits coherent changes, checks CI and closes issue only after verified gates. No worker commits or external messages.

## Handoff

Root assigns the four exclusive producer roles and two independent acceptance roles after spec/plan review; roles may run sequentially to fit available agent slots. Publish shared signatures first, then meaningful red tests, implementations and focused green checkpoints. A completed producer task does not authorize a shared browser build: use explicit root coordination. Final reports separate exact measurements, limitations and any unverified hardware/browser behavior.

## Assigned owners and baseline

- Shared types/document/history: `git_reader`.
- Reference audio: `audio_engine`.
- Backup/IndexedDB: `recorder`.
- UI integration: `git_runner`.
- Independent numerical oracle: `git_history_review`.
- Independent native acceptance: `next_project_assessment`.
- Root owns legacy-test compatibility updates, shared builds/ports, docs/catalog/version, Git/issues/CI and final measured evidence.

Unchanged baseline: **173 unit cases**, ESLint/typecheck/production build, **35 Chromium151 native cases** in27.6seconds. Test/config/package hashes unchanged; fresh ephemeral37253 server stopped. Evidence `/tmp/melody66-baseline-evidence.json`. Existing4173/4237/4239andother owned servers are preserved. No implementation was released before this reviewed contract.

## Initial core checkpoint

The four producer modules are callable. The root first combined check passed 232 tests, lint, type checking and the production build; an additional connection-lifetime regression was then added. The final focused core gate covers 60 cases (17 project/history, 16 audio, 13 backup/storage, 14 independent numerical cases). Native UI acceptance is still in progress: the first compatibility run passed 28 of 35, exposing a structural redraw error after project replacement and missing contextual error prefixes. The issue remains open; no complete workflow claim is made at this checkpoint.

Two reviewed contract clarifications preserve correctness: cancelled OfflineAudioContext work retains admission until native rendering drains, and the document bound is 2 MiB while legacy raw imports remain 1 MiB. The latter follows a real RED accepted-legacy numeric serialization-growth fixture and a conservative 1,612,877-byte engine/document maximum. Strict duplicate-key/depth rejection applies to legacy file syntax too; compatibility preserves prior saved/exported engine values, not arbitrary ignored extension or duplicate-key syntax.

## Final local acceptance

All233 unit cases, full ESLint/typecheck/normal production build and58 native Chromium151 cases pass against frozen `index-uXq5OLeU.js`. The combined browser run took58.4seconds. The independent reference artifact probe passed in30.510seconds and the adapted original MIDI artifact probe passed against the same final production entry. Their source fixtures and numerical thresholds remain original. Actualmaximum8×20s reference PCM/complete JSON survived native reopen and full Chromium process restart; delayed/coalesced real transactions, abort/retry, corrupt stored PCM, startup Cancel/pagehide and trusted pointer/focus regressions all pass. Evidence is in the project verification record. All twelve repository workflows passed commit6169ade9a15fcb412223326e95fad3c565615392. Melody CI passed233 unit cases in4.746seconds and58 native Chromium153 cases in40.4seconds, plus lint/typecheck/build. The complete milestone is verified; issue closure is recorded in GitHub.
