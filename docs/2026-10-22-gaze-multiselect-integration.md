# Native multi-select integration — 2026-10-22 (#304)

Implementation on canonical main: `a739c7b86edf6b5885840b26578dbd99d12db4c8`, path `apps/gaze-navigator`.

Explicit “add option Jazz to Genres” and “remove option Jazz from Genres” commands change one native multi-select option while preserving other selected states. The same interpreter serves speech, typed instructions and Alt+Shift+G. Ambiguous choices clarify; consequential labels require confirmation naming add/remove intent. Ordinary implicit choose retains its single-choice semantics and refuses multi-selects. Quoted option labels preserve literal “to”/“from”.

Execution captures and rechecks list/option identities, grouping, labels/values, complete selected states and frame ownership; unavailable controls, stale captures and focus redirects refuse. No-ops send no events. A native per-option setter dispatches input/change and checks retained state after site handlers/microtasks. It reports overrides without retry or forced rollback. README and portfolio roadmap describe the flow and limits.

## Canonical acceptance

[Run 39854802607](https://github.com/twangyal/projects-monorepo/actions/runs/39854802607) succeeds on all three shards, each with **201 unit tests**, syntax and extension build. Browser shards pass **181 + 154 + 185 = 520 cases**, including the real built Chrome extension. Jobs: `120090104808`, `120090105043`, `120090104413`.

Independent read-only review has no material findings. Test-first development exposed and fixed quoted-label parsing; no existing acceptance bounds were changed. Focused local four-viewport selection coverage passes80 cases, followed by4 direct frame/optgroup-retirement cases. These include visible instruction-panel and focus-preserving shortcut use. Local lint/build pass.

## Retained local failure and scope

The broader local non-extension run passes451/452 cases in7.9minutes. The unchanged desktop test `navigation.spec.js:310`, “twenty maximum session drafts retain full text and refuse a new record without losing fields”, reaches its original20-second case limit during the **second** simulation calibration after reload, while clicking calibration point3 (`calibrate`, line25; call at329). That local run used Chromium143 and ran alongside other browser verification; this does not establish the timeout's cause.

One unchanged focused replay passes the entire case in13.4seconds (14.8seconds including setup). The canonical full source run also passes this original case. No test timeout, calibration gate or unrelated simulation code was changed. Local headless Chromium cannot establish real extension acceptance; canonical full Chromium provides that separate coverage. The local broad run preceded the final direct frame/optgroup test; that addition passes independently and in canonical CI.

Observed local full-log SHA256: `3b5a29eeb3de92b177aa5960d8456d81ded9bbd219f2e7e381aa0d47ee30f055`.
Observed unchanged replay-log SHA256: `2ba6baf279201ca044121b3ca0b8f30ed6ac4f19824264e27c6fd3a0ccdaa88b`.
These identify the observed local logs; their full transient byte streams are not retained in this repository. Canonical logs remain linked above.

Gaze remains ACTIVE. Software checks do not establish physical gaze accuracy, microphone/speech-service behavior or intended-user usability; those remain open in#132. Custom ARIA listboxes are outside this native-control milestone. Project#8 stays skipped. No PR was opened.
