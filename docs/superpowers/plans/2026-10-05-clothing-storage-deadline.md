# Clothing transaction recovery implementation plan

Goal: complete issue #101 without changing portable projects or cross-tab ownership.

Architecture: each native transaction owns its ten-second timer and terminal result. Abort pending work at expiry; resolve/reject and close the connection only after native completion/abort. If abort reports InvalidState, wait for the real terminal callback instead of claiming rollback. Request errors record a cause; synchronous object-store failures abort before returning failure.

Execution: native implementation under the standing autonomous instruction.

- [x] Inspect policy, open work, UI save queue and existing storage patterns.
- [x] Preserve the four test-first regressions from #102; inspect published baseline CI (three deadline failures, delayed actual commit passes).
- [x] Add independent native clear and synchronous partial-write rollback coverage, including original photo/sketch retention.
- [x] Implement transaction-local deadline/terminal ordering in src/storage.ts, keeping load/save/clear APIs.
- [x] Run the full unit/lint/type/build/browser suite; review the diff and publish a coherent commit on Astra.
- [x] Verify exact published-head CI; document limits, close #101 only when acceptance is established.
