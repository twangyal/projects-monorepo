# Room deletion completion ownership — 2026-10-08

Issue [#148](https://github.com/twangyal/projects-monorepo/issues/148). Parent `a692e1d9e6fc29c85c747cad38f53cbbf80340a2`, branch `Astra`.

The asynchronous room-delete handler used to call home and notify unconditionally. Its native baseline held an actual successful DELETE reply after the isolated synthetic server deleted A, left A, opened B and entered new drafts. The old handler replaced B's notice with the deletion result and reset its room/drafts.

The handler now captures room ID and UI generation. Successful deletion still removes only that room's saved credential even after navigation; late success refreshes the saved list but cannot close a newer room or overwrite its notice. Only the original current owner may return home and show success/failure. The generation fence also protects a new session in the same room. No server mutation, consent or retry semantics changed.

Five native cases cover late success in B, late failure in B, late failure after returning to A under a new generation, late success on the home list, and current-session successful deletion. All rooms and credentials are synthetic, inside a fresh temporary service data directory; cleanup targets only owned test rooms. Tests hold native network responses and use the real production service rather than an extracted handler. Fresh read-only review found no Critical/Important blocker.

## Local verification limitation

Local TypeScript gate passes all 12 units, lint, type checking and production build. The first native baseline reached the real service and failed on the incorrect deletion notice. The subsequent native run could not start the unchanged service: its Linux PID-based /proc requirement failed. A diagnostic observed /proc/self status with host PID while os.getpid() returned the inner namespace PID; a PID-named directory can be absent. Python discovery ran 219 tests with 23 failures and 17 errors, including unchanged descriptor/media processing/restart paths. These are retained as failed local verification, not reclassified as passes. Ruff was unavailable locally. No safety check was weakened or bypassed, and no server/media code was changed.

The issue remains open until the published commit's normal Linux CI verifies the five regressions and existing Python/native gates. Exact-head outcome is recorded in the issue. This bounded fix supports reliable editing; Spotify integration, automatic listening events and physical two-device acceptance remain separate unfinished work.
