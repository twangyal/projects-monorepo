# JSON command recovery — 2026-10-08

Issue: [#149](https://github.com/twangyal/projects-monorepo/issues/149).

The previous JSON transport had byte bounds and caller cancellation but no connection/body deadline. Two new controlled-clock cases failed before implementation: stalled headers and a partial JSON stream did not release their pending callers. That baseline invocation was stopped while the later caller-cancellation case remained pending; it is not claimed as a complete baseline suite.

Ordinary JSON requests now race one 15-second budget across fetch and complete body reading, relay caller cancellation, cancel pending readers and ignore late completion. Invalid local requests still refuse before dispatch. RequestTimeoutError reports unknown delivery separately from caller AbortError. No command retries. A response returned by a cancellation-ignoring transport after timeout has its body canceled before parsing.

Selected-record JSON commands/invitations preserve raw drafts and release busy state on timeout. Consent controls stay blocked until an explicit successful Refresh challenge. Polling, failed reads and leaving/reopening the affected private seat cannot remove the session-local obligation. Other seats are independent. Creation/claim uncertainty retains the existing deliberate recovery warning; missing returned credentials cannot be reconstructed. Binary image transport is outside this deadline's scope.

Verification:

- 47 TypeScript tests pass, including four controlled-clock transport cases and a real Node HTTP service that sends genuine partial JSON without EOF. The real request expires in 15.05 seconds, dispatches once and closes its socket.
- 196 Python domain, HTTP, HTTPS, image and archive tests pass; no Python product source changed.
- Ruff, Python compilation, ESLint, TypeScript and production build pass.
- Three new production Chromium cases pass; the full 37-case native suite passes in 2.0 minutes. They hold responses from actual committed service commands and verify unknown delivery, new raw drafts, no replay/late activation, explicit successful/failed refresh, automatic polling and Home/reopen.
- Independent read-only review found an Important navigation bypass in the first per-selection gate. The gate was changed to retain affected record/seat identities through navigation; the native regression now covers that path. Updated review found no remaining Critical/Important blocker.
- Two existing unit assertions of caller-signal object identity were updated to check a live internal transport signal, since cancellation now composes caller input with the deadline. Existing cancellation semantics remain covered.

Chromium 153.0.8010.0 used a temporary external executable wrapper. Native deadline tests advance the browser clock; the separate real-socket test measures the actual wall-clock budget. Browser timer throttling and scheduler delay can extend elapsed waiting. This is client recovery, not proof of server rollback or persistence across reload.

Published-head CI is recorded on the issue after publication. Friendly Challenges remains ACTIVE; this is a reliability correction, not acceptance of its full product vision.
