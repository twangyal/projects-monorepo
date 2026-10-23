# Gaze radio selection acceptance — #308

Canonical main implementation `45a7fbb82130177a69c964333a526d28cd39105d` passes all three jobs in [run 39916453895](https://github.com/twangyal/projects-monorepo/actions/runs/39916453895): **203 Node tests, syntax/extension build and all 572 full Chromium browser cases**. Browser shards pass 195/198/179 cases, including actual MV3 injection on a strict-CSP third-party fixture across four viewports. Final local focused radio acceptance passes 48 cases. Fresh independent review findings about visibility and custom group/form ownership were reproduced with failing tests and fixed before integration.

This closes the explicit radio-selection milestone. The implementation receipt at `apps/gaze-navigator/docs/2026-10-23-radio-selection.md` retains local unsupported-extension fixture failures and the interrupted broad-run draft-capacity timeout; those are not full local passes. No gates were relaxed. This root receipt adds the completed canonical result after the implementation commit's pending status.

Speech and typed entry share deterministic interpretation. Physical gaze/speech quality, broad real-site usability and intended-user task completion remain unverified in #132; Gaze remains ACTIVE. Project #8 remains skipped.
