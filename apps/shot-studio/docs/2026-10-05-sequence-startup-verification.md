# Healthy sequence fixture startup admission (#129)

The original [push CI run 37324080813](https://github.com/twangyal/projects-monorepo/actions/runs/37324080813)
at `63e2e72` passed 345 unit cases and 104/105 browser cases. Its complete-sequence
restart test imported before the actual initial IndexedDB load was admitted.
Import retired that pending load and protected the browser record, correctly
keeping the imported sequence in memory. The independent stored-row oracle then
aborted its own accidental database creation. The original CI failure excerpt is
retained in `failures/2026-10-05-sequence-startup/original-ci-failure.log`.

The healthy `openSequence` fixture now waits for the positive **Sequence saved
in this browser** state before importing. The fresh-profile portability leg also
waits for readiness and verifies the actual stored imported text before export.
No production code, storage-protection behavior, original source/clip expectations,
transaction assertions, retries or acceptance thresholds changed.

A new native regression gates delivery of one real IndexedDB open-success event.
Its healthy import must wait while startup owns that operation. A bounded 300 ms
negative observation checks that no import occurs; it is not a sleep that assumes
storage has finished. The test then explicitly delivers native success, imports,
independently reads the saved complete archive and verifies byte-identical storage
after reload. With the old fixture it fails because an import occurs before
readiness; that first meaningful failure is retained in
`failures/2026-10-05-sequence-startup/fixture-before-readiness.log`.

Fresh local verification after the fix:

- `npm test`: **345 passed**, zero failures/skips.
- `npm run check`: passed all production syntax checks.
- New delayed-startup and original complete-process restart cases: **2 passed**.
- Complete `npm run test:browser -- --reporter=line`: **106 passed**, zero retries,
  3.2 minutes. Existing input cancellation, protected recovery, stale-tab refusal,
  native encoders, decoded audio/video and original complete-restart cases remain.
- `git diff --check`: passed.

Local Node is v24.19.0 and the available native browser is Sparticuz Chromium
153.0.8010.0, with its actual packaged SwiftShader runtime. The pinned Playwright
browser download returned a truncated archive; it was not used for these checks.
Configured GitHub CI must still establish the pinned-browser result on the exact
published commit. This fixture repair does not resolve the separate full Chromium
compatibility investigation #128, physical WebXR acceptance, or universal browser
compatibility. The unchanged 60-second maximum exporter was not rerun locally for
this test-only repair.
