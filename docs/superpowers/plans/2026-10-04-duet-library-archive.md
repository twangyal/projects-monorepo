# Duet complete offline library archive plan

> Implement task-by-task after root releases the reviewed design. Use the existing TDD and independent verification workflow; user authorization does not require an additional approval prompt.

**Issue:** https://github.com/twangyal/projects-monorepo/issues/65

**Design:** [Frozen contract](../specs/2026-10-04-duet-library-archive-design.md).

**Goal:** Stop service → create/inspect complete library archive → restore into a new directory → recover the same private seats with separately held links. Preserve exact stored Opus, private room records and consent boundaries; no browser import/new credentials.

**Stack:** Existing Linux/Python3.11 stdlib/SQLite/FFmpeg. No new dependency, model or network. Root owns Git/docs/config/issues/shared verification. Excluded projects and concurrent work remain outside scope.

## Task 1 — Private records and source SQLite (state owner)

Files: NEW duet/archive_common.py, duet/archive_state.py, tests/test_archive_state.py.

- [ ] Publish shared ArchiveError/check_archive/parse_json/canonical_json/bounds and frozen TrackRecord/LibraryRecords and read_library/validate_rooms/paused_rooms/write_database signatures.
- [ ] Meaningful RED: exact private record retention, missing/used invitation, removed-track memories, strict schema/JSON/limits/revisions and malformed SQLite schema.
- [ ] Read ONLY admitted pinned immutable main DB, never Store or source-write transactions; callback cancellation/deadline checks.
- [ ] Create paused restore records from the stored anchor, no elapsed time, one increment only for originally playing anchors.
- [ ] Reconstruct trusted in-memory SQLite with parameterized inserts, serialize bounded complete DB, write EXCL/NOFOLLOW through stage FD and fsync; preserve original source records.
- [ ] Scoped unit/Ruff/compile; send callable contracts to other owners.

## Task 2 — Strict streamed container (format owner)

Files: NEW duet/archive_format.py, tests/test_archive_format.py.

- [ ] Publish frozen member/index/source types and read_index/read_rooms/copy_member/write_archive signatures.
- [ ] RED literal EOCD/central/local/header/name/offset/overlap/ZIP64/flags/compression/CRC/SHA/JSON fixtures before implementing.
- [ ] Enforce512MiB/62 entries/64KiB central/32KiB manifest/rooms envelope and per-member limits before allocation or copying.
- [ ] Write canonical stored-only layout; stream/hash again to detect source changes; check Event/deadline at each bounded block.
- [ ] No extractall/imported SQL/arbitrary paths or full audio allocation. Focused unit/Ruff/compile gates.

## Task 3 — Actual normalized audio validation (media owner)

Files: NEW duet/archive_media.py, tests/test_archive_media.py.

- [ ] RED whole Ogg page/CRC/sequence/BOS/EOS/continuation/trailing bounds plus codec/channel/rate/malformed/full-duration mismatch plus real Opus frames/pre-skip/end-padding expectations.
- [ ] Implement streamed whole-container Ogg checks and validate_audio on pinned FD paths with existing isolated FFmpeg helpers; full decoded frame counting, no encoding.
- [ ] Retain45s/512MiB/64KiB child bounds and aggregate remaining deadline/cancel. Test no network/URL/video paths and no PCM accumulation.
- [ ] Scoped real media tests/Ruff/compile; report measured fixture evidence.

## Task 4 — Complete offline commands and publication (orchestrator owner)

Files: NEW duet/backup.py, tests/test_backup.py.

- [ ] Publish create/inspect/restore/main and ArchiveSummary contracts, no existing service or browser changes.
- [ ] RED source file/tree immutability, regular existing lifetime lock, busy/missing lock, nonempty WAL/journal, media exact membership and outside-output rules.
- [ ] Acquire/pin all parents/source inputs; reuse lower modules with one300s deadline. Handle cancelled source decode/copy/SQLite cleanly.
- [ ] Create via synced no-clobber sibling publication; restore via fsynced owned stage and atomic RENAME_NOREPLACE into absent target.
- [ ] Test replaced child/parent/output, raced empty target, failed fsync semantics and cleanup only owned stage. No fallible content lookup after successful rename.
- [ ] CLI create/inspect/restore: safe summary, separate-link requirement, exit0/2/130, restored signal handlers; no force/merge/token minting.
- [ ] Focused CLI/real media integration gates; coordinate root for final process/browser runs.

## Task 5 — Independent complete-flow acceptance (independent owners)

Files: NEW tests/test_archive_oracle.py and tests/browser/archive.spec.ts plus separately owned fixtures.

- [ ] Hand-authored container/state/copy/checkpoint expectations BEFORE producer inspection; report first actual RED/GREEN honestly.
- [ ] Independent real service/CLI round trip preserves audio bytes, IDs, opposing votes, custom mix and both authors' memories including deleted-track memories.
- [ ] Original host/guest links restore only their own roles; wrong credentials fail, used invite stays used, original pending invite claims once. No raw credentials in archive/summary.
- [ ] Browser/native audio playback and range/whole decoded samples establish usable editable restoration; snapshots/restarts do not accrue offline time or double pause revision.
- [ ] Fault/cancel/nonempty destination/source immutability/security/resource cases preserve original and unrelated state.

## Task 6 — Root measured maximum and release

- [ ] Root creates NEW owned /workspace maximum fixtures (preserve existing evidence; avoid scarce /tmp):5 rooms/60 audio files,100 memories per room, exact archive/media limits where actual Opus validation permits.
- [ ] Verify real create/inspect/restore, hashes/full decoded media, original-tree unchanged and maximum disk/runtime/RSS evidence; separate pure byte-limit cases from actual playable audio.
- [ ] Final read-only cross-module review: no source mutation, strict admission, hash/capability/invite preservation, paused checkpoint, acquired FDs/no-replace/durability/cancel semantics.
- [ ] Run full Duet Python/Ruff/compile/TS/lint/type/build/production browser suites after integration; no concurrent shared server/builds.
- [ ] Root docs/evidence/catalog truth, commit/push/CI check and close65 only after exact accepted-source gates.
