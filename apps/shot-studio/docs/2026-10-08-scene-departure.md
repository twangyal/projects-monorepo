# Committed scene departure protection — 2026-10-08

Issue: [#150](https://github.com/twangyal/projects-monorepo/issues/150).

Native Chromium reproduced the missing guard: save scene A, fail the real localStorage write for committed scene B, then attempt a real reload. No beforeunload dialog appeared and the test failed. Unsent-field state had already cleared; the previous durable record remained intact.

The editor now tracks a committed scene's unsuccessful persistence. Both ordinary scene commits and history restoration call persist; failures keep departure protection. Only a successful atomic DraftStore save or confirmed replacement clears it. Unreadable startup records retain their existing overwrite protection. No-op edits, discarded raw fields, backup downloads and canceled/failed replacement do not certify persistence.

Two new native cases cover ordinary quota failure with exact durable A retention, actual reload dialogs, backup-download semantics, later successful-save recovery, protected startup edits, replacement cancellation/failure and successful replacement. The existing recovery test now explicitly accepts its intended discard-on-reload warning. Product storage and file formats are unchanged.

Local verification: all 387 unit tests and syntax checks pass. The full 45-case scene/studio/camera/blocking browser selection passes in 1.4 minutes, including actual WebGL and existing decoded WebM regressions. The final two departure cases are rerun after adding failed-replacement coverage; both pass in 27.9 seconds. This selected local gate is not claimed as the complete take/sequence/media suite.

Independent read-only review found no Critical/Important finding; its minor failed-replacement coverage suggestion was added. Chromium 153.0.8010.0 used a temporary external wrapper. Browser dialogs require user activation and can be suppressed; forced termination is not protected. Starting a download does not prove the file was saved.

Published-head CI is recorded on the issue after publication. The separate Chromium 155 full-export timeout remains tracked in #128; no export policy or security guard was changed.
