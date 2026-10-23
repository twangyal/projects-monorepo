# Karaoke automatic-review exclusion — #313

Autonomous inline execution; direct main integration, no PR. Outcome: reject falsely recognized lines while reviewing automatic lyrics, without first applying them to the main editor. Current review requires every source line. Add an optional excluded boolean to session ReviewedCue rows; keep source recognition, original row numbers/text/times and all raw drafts. UI checkbox per automatic row, explicit included/excluded count, reversible before Apply. Excluded rows remain inspectable/auditionable; changing inclusion stops current review audio. Filter still uses original uncertainty and included hidden lines still validate. Apply may deliberately produce an empty list, as existing Remove-all edits can. Save is separate.

Domain: strict boolean marker; skip excluded rows while validating only included cues and remap validation errors to original source numbers. Entire reviewed graph remains bounded. Existing single-row audition remains independent of inclusion. No backend/schema/dependency change.

- [x] RED exclusion/restore/error-number/capacity marker and all-excluded tests, then domain implementation.
- [x] RED missing checkbox in actual automatic review, then owned UI/count/retirement integration.
- [x] Native exact Apply/Undo/Redo/Save/reopen/SRT and immutable source, hidden validation, phone keyboard/Cancel/stale controls and playback retirement.
- [x] Project checks, independent review, documentation/roadmap, GitHub commit/CI acceptance and issue closure based on actual evidence.

Source c8009ef integrated; fresh review and local checks complete. Full local browser 133/135 and Python 205/206 retain known runtime failures. Canonical run39995712975 still installing system video dependencies at final check. Last acceptance checkbox stays open: see `docs/2026-10-23-karaoke-exclusion-checkpoint.md`; finish CI verification before issue closure.

Final acceptance: run40000133169 at b112c65 passes206Python/150TS/all135browser and all static/build gates. See `docs/2026-10-23-karaoke-exclusion-acceptance.md`, which supersedes the pending checkpoint.
