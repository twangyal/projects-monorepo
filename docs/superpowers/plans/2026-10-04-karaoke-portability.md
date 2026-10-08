# Karaoke project portability implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

Issue: [#59](https://github.com/twangyal/projects-monorepo/issues/59). Authoritative contract: [Karaoke portability design](../specs/2026-10-04-karaoke-portability-design.md). Root released implementation after independent contract review on 2026-10-04.

**Goal:** Back up one saved editable clip and restore its exact normalized audio, saved cues/title/revision into a fresh-ID library entry, without ML or overwriting the current editor; keep imported provenance permanently unverified.

**Architecture:** A stdlib archive engine validates the bounded own ZIP_STORED format through retained file descriptors. Existing global upload/job ownership serializes archive export/import, and cancellation-aware publication installs a single cache file or one complete fresh project directory. The browser uploads a native File, downloads a native pinned URL and requires explicit opening of a restored item. No schema change to ordinary projects, separate revision marker, general ZIP extraction, implicit lyric save or inference is introduced.

**Tech stack:** Existing Python 3.11+ stdlib/FFmpeg/Pillow service; TypeScript/Vite frontend; Node24 tests; existing Playwright Chromium production setup. No new dependency or model download. Root owns configuration, shared builds/ports, README/evidence, Git and tracker actions. Owners stay inside assigned paths and coordinate interfaces before parallel edits.

## Review focus before source release

- [x] Confirm EOCD/central-directory limits apply before ZipFile construction, local/central byte ranges are exact and all paths/links/descriptors/compression/ZIP64 are rejected.
- [x] Confirm fresh-ID restore never replaces an unindexed directory, cancellation is checked under publication lock, completed inode is captured before rename and no fallible post-rename file operation splits map/disk state.
- [x] Confirm saved-revision backup with invalid/dirty raw fields leaves every editor value/history intact; restore completes as an added library item only.
- [x] Confirm a canceled native upload with lost 202 can be discovered in-page without blindly retrying/canceling another job or reloading away unsaved drafts.
- [x] Confirm duplicate terminal polling/late library refresh cannot clear a newer job, imported provenance remains unverified after restart/re-export, and the independent full 300s media check does not merely compare producer hashes/toasts.

## Task 1 — bounded archive engine

**Owner:** git_runner. **Files:** `karaoke/archive.py`, `tests/test_archive.py` only, unless root explicitly reallocates. Publish exact callable stubs/constants/ArchiveResult first for service integration, then meaningful RED tests.

- [x] Test own format with independently authored binary ZIP/RIFF fixtures, strict JSON/metadata and all bounded failure cases before production implementation.
- [x] Implement exact exports from the spec: export_archive/import_archive/read_archive_project/read_archive_origin. Inputs are acquired FDs, explicit detached project/fresh ID, cancel Event and stage callback; output paths are fixed work-owned `export.karaoke.zip`/`completed`.
- [x] Stream SHA/CRC and exact PCM files in blocks at most 64 KiB; validate actual frames/duration and preserve optional recognized processing bytes. Reject unknown/private metadata without mutating source files.
- [x] Implement sidecar provenance, whole-upload archive hash, original-output-FD identity receipt and 180-second deadline; never close caller FDs or publish. Validate malformed sidecar as failure, not local provenance.
- [x] Test cancellation between stages and during blocks, failure leaves only owned partial work, supplied project is detached/unmodified, cache metadata admission reads bounded metadata rather than full WAVs.
- [x] Run focused `python3 -m unittest discover -s tests -p 'test_archive.py'` and `ruff check karaoke/archive.py tests/test_archive.py`. Send exact API and GREEN evidence to service owner/root.

## Task 2 — HTTP/jobs and atomic publication

**Owner:** recorder. **Files:** `karaoke/server.py`, `karaoke/jobs.py`, `tests/test_archive_server.py`, `tests/test_jobs.py` and narrowly necessary existing server-test adaptations. Do not change unrelated media model/pipeline.

- [x] Write real-HTTP RED tests against frozen routes, no-model callbacks, separate 160 MiB body allowance, pinning/stale revision, import quota/fresh IDs and new job kinds.
- [x] Extend job admission/exporting protection, session maxArchiveBytes and exact archive route handling. Keep existing security gates, upload reservation/deadlines/free-space ownership.
- [x] Capture source snapshot/FD identity under lock; run engine outside lock; single cache os.replace only after source and engine-output identity receipt rechecks. GET/HEAD pins cache FD/checks embedded saved snapshot before releasing lock to stream/range.
- [x] Restore with fresh ID, fully prepared completed directory and pre-acquired inode matched to the engine output_identity receipt; never adopt a replaced completed child. Test replacement between engine return and service capture for both ZIP and completed directory. Add frozen server-only _require_archive_restore_support/_rename_noreplace helpers using stdlib ctypes/Linux renameat2(RENAME_NOREPLACE); reject unsupported platforms before upload admission and test raced existing empty destinations without overwrite fallback. Recheck filesystem collision/quota/storage/cancel; rename/map publication with no fallible post-rename IO. Preserve every old project and work-parent anchoring.
- [x] Implement bounded archive-info; no imported field controls model readiness. Preserve existing APIs and prior video/cache behavior.
- [x] Test cancel/failure around publish, metadata PUT/DELETE ownership, cache failure retaining previous artifact, shutdown cleanup, moved/symlinked parents, corrupt/unindexed collision, full library and actual service restart.
- [x] Run focused Python server/jobs tests and Ruff; do not start shared production browser/build or full suite without root coordination.

## Task 3 — saved-only backup and non-destructive restore UI

**Owner:** git_reader. **Files:** `src/main.ts`, narrowly needed `src/style.css` and `src/lyrics.ts` Job/type changes if types are located there; scoped TS tests only. Root reserves all docs/config. Publish selectors/explicit job branch skeleton early.

- [x] Write meaningful frontend helper tests when logic can be isolated; coordinate real-browser RED cases with browser owner rather than duplicating implementation-shaped tests.
- [x] Add frozen controls/labels/IDs, saved-only disclosure, native File upload and native archive download anchor. Read server maxArchiveBytes; do not infer model readiness or validate/save current working fields for backup.
- [x] Keep raw controls/title/paste/history/undo/redo/audio/waveform/time/videoUrl untouched through archive busy/result/error/cancel; library refresh is the only import completion mutation.
- [x] Add explicit Open imported clip using leave guard, persistent imported provenance and no automatic selection/follow. Separate archive kinds from MP4 completion.
- [x] Implement upload cancel/uncertainty and in-page Check restore status with no silent retry or ownership takeover. Keep current credential/session behavior and beforeunload draft/pending-work protection.
- [x] Deduplicate terminal completion and recheck operation epoch/job ownership after every await; pending cancellation poll/library refresh cannot clear a new job or duplicate download/result.
- [x] Run Node tests, `npm run typecheck` and scoped ESLint. Shared-dist build/production port4188 requires root's slot; do not launch a competing server.

## Task 4 — independent archive/media oracle

**Owner:** audio_engine. **Files:** `tests/test_archive_oracle.py`, `scripts/smoke_archive.py` only, with root coordination for expensive actual encode. Never read producer archive source while deriving expected invariants.

- [x] Derive ZIP/header/directory/member bounds, RIFF frame/sample rules and SHA/CRC independently from spec plus raw fixtures. Test cross-library fresh IDs/exact title/cues/revision/audio and untrusted processing across restart/re-export.
- [x] Write a reproducible production no-model smoke runner using two distinct private directories, original 300s stereo PCM and literal late cues/nonzero revision; separator fails if called, model readiness false.
- [x] Inspect actual downloaded archive, each WAV's bytes and canonical headers, saved record, SRT timestamps/text and independently decoded real MP4 late frames/audio/video duration. Do not use a fake MP4 or success-toast-only oracle.
- [x] Record byte/time/memory/scratch/retained size and cancellation cleanup. Script supports bounded shorter fast mode and 300s acceptance; root schedules expensive run once services/UI pass.
- [x] Run independent focused stdlib tests/Ruff; report claims clearly as archive/media evidence, never separation-quality evidence.

## Task 5 — native production browser acceptance

**Owner:** git_history_review. **Files:** `tests/archive.spec.ts`, narrowly necessary `tests/browser_server.py` fixture modes only. Root coordinates port4188/build; do not change app code to match tests.

- [x] Real native File upload/archive download with no model-ready dependency; preserve invalid blank timing plus Unicode dirty title/paste/cues, focus and Undo/Redo through successful/failed/cancelled jobs.
- [x] Verify saved-only backup uses saved revision/fields, stale409 never reloads editor, new import leaves selection/audio/time intact, and only explicit Open invokes leave consent.
- [x] Pin duplicate terminal poll + delayed library refresh + newly started job, native-abort-before202 uncertainty recovery without replay, active-job exclusion and dirty editor during reconnect.
- [x] Inspect actual downloaded ZIP/SRT/media where meaningful; no full150MiB browser arrayBuffer staging for UI operations. Test responsive controls and current provenance after actual restart where fixture supports it.
- [x] Run focused production browser suite after root release, preserving traces on failure and independent assertions. Coordinate fixture server mode with root; normal browser setup must continue supporting existing waveform/full-song tests.

## Task 6 — root integration and measured acceptance

- [x] Review frozen APIs and each owner's scoped diff; resolve concrete findings and run appropriate combined Python/TS/lint/typecheck/build gates.
- [x] Run full existing Karaoke production browser tests plus new archive suite once; only broaden/repeat for changes or failures. No ML installation, checkpoint download or inference is required.
- [x] Run the actual 300s no-model cross-library smoke and real browser flow with explicit restart, sample/hash/cue/revision identity and independent late SRT/MP4 decode. Verify cancellation frees work/quota and no sibling/current draft loss.
- [x] Update README with exact format/setup/limits, one-cache disk allowance, saved-only semantics, unencrypted private archive, permanently unverified imported provenance, upload uncertainty recovery and measured limits. Keep ordinary project schema1/API labels and model-license caveats truthful.
- [x] Review diff; fetch/integrate concurrent allowed work safely; commit/push scoped verified changes and check relevant/all scoped CI. Update/close #59 only to observed completion; root handles every Git/GitHub action.
- [x] Reassess useful unblocked core work without excluded projects, concurrent tasks or frozen failed Stock trial retuning.


## Completion evidence

Completed on 2026-10-04 in engine `bed0c1b`, service `9743f5d` and complete UI `0422182`. All twelve workflows passed the complete UI commit, including 166 Python, 51 TypeScript and 44 production Chromium cases. A separate no-model run passed twelve archive cases with one intentional legacy-separation skip. Independent review and concrete native RED→GREEN cases corrected lost focus and automatic download of observed video work; previous separation recovery wording remains compatible.

The actual 158,779,475-byte archive retained three exact 52,920,044-byte WAVs, 200 saved cues and revision 7 across a fresh-ID restore, process restart and re-export. Native browser backup/upload kept invalid raw fields, input nodes, history, focus and audio; explicit opening, a late cue edit to 298.51 seconds, Undo/Redo/Save, SRT and another process restart verified revision 8. All original source files stayed byte-identical.

The already completed 8,491,153-byte MP4 was recovered after a verification-helper scratch sampling race, then independently decoded without re-encoding. It contains 7,200 H.264 frames and AAC backing for 300 seconds. Original encode timing and resource peaks were not persisted and remain unavailable. The initial broad hue counter and direct RGB glyph oracle were inadequate for codec-tinted text edges; an independently modeled yuv420p glyph reference retained fixed tolerance/coverage/spatial thresholds and rejected wrong/swapped/blank controls. The tracked smoke now uses that check, tolerates disappearing scratch entries and always reaps owned services. A final complete five-second smoke passed in 5.23 seconds with real cancellation and previous-cache preservation.

See the [permanent measured record](../../../apps/karaoke-studio/docs/2026-10-04-portability-verification.json) for exact facts and limits, including unsupported Tibetan font glyphs and missing full-run metrics. The next assessed unblocked milestone is reviewed MIDI phrase import in Melody Studio, tracked in #60; no excluded project or concurrent #48/#49 work was changed.
