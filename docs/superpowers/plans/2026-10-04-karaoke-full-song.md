# Karaoke full-song implementation

Issue #33; authoritative reviewed contract: `../specs/2026-10-04-karaoke-full-song-design.md`. Root coordinates Git, issues, integrations and expensive verification. Existing autonomous authorization applies.

## Parallel work with explicit ownership

- [x] **git_history_review:** publish `karaoke/limits.py` first; update `model.py`, `server.py`, `tests/test_model.py`, `tests/test_server.py` and new owned server tests. Shared 300s/64MiB/200cues/20k code-point/256KiB JSON/resource constants, session capabilities, 1GiB free-space admission and absolute60s upload deadline. Bounded cancellation-aware publication copying and preserved descriptor ownership. Verify old project compatibility, actual limit boundaries, Unicode/escaped JSON, slow uploads, disk failure and cleanup.
- [x] **audio_engine:** `karaoke/chunks.py`, `worker.py`, `tests/test_chunks.py` and worker-owned tests. Stdlib streaming overlap assembly with independently testable interfaces; exact shape/frames, little-endian float32 scratch, one global gain/PCM16 conversion, sequential real model calls, bounded progress metadata and cleanup. No expensive model run before root coordination.
- [x] **recorder:** `karaoke/pipeline.py`, `tests/test_pipeline.py`, `scripts/smoke_model.py`. Bounded complete decoding/conversion/validation, current UTC-independent audio limits, frequent cancellation, new worker deadlines, bounded progress publication and new scratch cleanup. Extend actual smoke runner to180/300s without multiplying retained full-song buffers or pretending synthetic audio establishes singing quality.
- [x] **next_project_assessment:** `src/lyrics.ts`, `src/main.ts`, `tests/lyrics.test.ts` and scoped additional TS tests. 300s/64MiB/200cues/20k code points, full-song copy and capability limits, exact Python Unicode/whitespace parity, preserved drafts/history/request generations. Avoid changing established accessible labels without necessity.
- [x] **git_reader:** `karaoke/video.py`, `tests/test_video.py`. One600s export deadline, bounded cancellation-aware backing validation,64MiB distinct cards/401 states/7200 hardlinks,128MiB encoded output, atomic exports and inherited media descriptors. Fast maximum-structure tests plus existing real short FFmpeg tests; root coordinates maximum real encoding.
- [x] **git_runner:** `tests/browser_server.py`, `tests/workflow.spec.ts`, `tests/test_independent_chunks.py`. Independent stdlib signal oracle, explicit fake-separator60s production workflow with late cues/seek/save/reload, downloaded WAV/SRT/MP4 and independently decoded frames. Existing browser suite remains green. Shared build/server4188 only when root releases it.
- [x] **root:** docs/catalog/config as needed, measured evidence, independent review, real model/service/browser gates, all GitHub/Git. Scope excludes unrelated projects. No concurrent shared-dist builds, heavy inference or long encodes without coordination.

## Integration and acceptance

- [x] Publish exact constant/API names to owners; write meaningful failing tests before implementation. Keep fast verification independent of ML dependencies/checkpoint downloads.
- [x] Run targeted Python/TS tests, lint/type/build and full production browser suite; owners fix reproduced regressions. Review inherited descriptor safety, cancellation, finite samples, shared gain, upload/disk bounds and Unicode parity independently.
- [x] Run actual verified offline model on180s and300s original audio. Record exact sample counts,11-window maximum metadata, global peak/gain, time, peak RSS, scratch/published size and offline attempts0. Test cancellation during a later window and cleanup, including child reaping.
- [x] Complete one real300s production service/browser flow, saved supplied lyric cues across a chunk boundary and near the end, actual full-duration video export and independently decoded timeline/codec checks. Reopen completed project after restart. Record lack of subjective boundary listening/reference-stem quality measurements if unavailable.
- [x] Update README and catalog with delivered limits, setup, precise measured evidence and honest quality/platform limitations. Preserve original model/licensed-example provenance.
- [ ] Fetch concurrent Astra state; review scoped diff; commit/push verified durable progress without force. Check CI and update/close#33 only to actual completion, keep draftPR12 current.
- [ ] Immediately reassess and continue useful unblocked work under the user's goal.
