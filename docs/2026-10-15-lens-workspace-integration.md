# Lens focused workspace integration — #262

Lens remains ACTIVE. This milestone delivers the owner-requested comparison-first import/edit/export experience, not calibrated scene reconstruction, generated disocclusion, physical camera validation or intended-user acceptance.

Delivered: Open, Compare, Depth, Mask exchange, Project & export and Help; real expanded view; direct phone framing shortcut; mounted raw fields/proposals/history retained across navigation; intentional source painting; visible operation cancellation and saved-copy feedback/recovery even before a photo loads.

## Evidence

- Implementation: [b7a6a0c](https://github.com/twangyal/projects-monorepo/commit/b7a6a0c961698cca7778c2b6e9c9961e8eb243c1). Framing follow-up: [3681849](https://github.com/twangyal/projects-monorepo/commit/36818491c6dfaa56511af6875ec82c1061faf752).
- First source CI [38750461942](https://github.com/twangyal/projects-monorepo/actions/runs/38750461942):95 units and101 native browser cases, lint/types/build pass.
- Final source CI [38751286355](https://github.com/twangyal/projects-monorepo/actions/runs/38751286355):95 units and102 native browser cases, lint/types/build pass.
- Local final focused13 cases pass; prior20-case focused/region/color gate passes12 focused +8 existing selection cases.95 units/lint/types/build pass after both checkpoints.
- Isolated final full local gate: **99/102 pass** in6.9 minutes on Chromium143.0.7499.0. Only the three independently reproduced baseline Canvas-display cases below fail; all focused, selection, image, storage and recovery cases pass.
- Integrated main CI [38752090497](https://github.com/twangyal/projects-monorepo/actions/runs/38752090497): **95 units and102 native browser cases**, lint/types/build pass on3681849. The final receipt changes root documentation only; the app tree is unchanged. Issue262 is completed.

## Retained failures and corrections

The first local full checkpoint passed89/96. Three region failures exposed sticky navigation covering native source hit coordinates; static expanded navigation and scroll clearance restore the unchanged rectangle/polygon and perspective assertions. The new desktop prominence bound found a490.25px photo top against its450px limit; compact controls/status spacing passes the same bound. Two worker-display cases (40/85mm) and the authored-perspective Canvas comparison fail by one displayed byte in local Chromium143.0.7499.0; all three independently reproduce on unchanged main3498b1e. Exact PNG/scalar assertions are unchanged, and hosted source CI passes every case.

Independent read-only review found one Important recovery-before-photo regression and two Minor phone-touch/pre-photo-Escape gaps. Each had a failing focused native test before its fix; all pass. Re-review also found no new issue in the framing shortcut and confirmed draft/gesture/operation ownership by inspection; the reviewer did not rerun tests.

A subsequent normal-dist local full run was invalidated and interrupted: a concurrent production check removed its test-harness pages. Four later storage harness cases timed out waiting for readiness (round-trip, queued saves, aborted save and corrupt/undefined records). This was a verification-process mistake, not evidence those product behaviors failed; the outcomes are not erased or counted as passes. The replacement full run uses its own build directory. Earlier harness/setup failures and security-preserving corrections are recorded in the app receipt.

## Limits

Browser depth tests execute real ONNX fixture inference to validate integration/ownership, not production learned-photo quality. Desktop and emulated390px phone geometry/screenshots and actual PNG/project/reload cover software behavior. Physical touch/camera and intended-person correction effort remain unverified. Raw drafts are memory-only; exports retain committed work. Renderer/model weights, schema, dependencies and infrastructure were unchanged. Project8 remains skipped; owner-deferred apps untouched.
