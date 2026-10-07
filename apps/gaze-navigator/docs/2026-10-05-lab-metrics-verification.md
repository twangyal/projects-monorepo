# Decision lab report breakdown (#130)

The browser now separates the eleven model-eligible cases from three policy-only
cases, compares eligible agreement with geometry, and shows errors, untested cases,
unexpected selections and reported eligible median/p95 adapter time. It recomputes
these values through the existing benchmark summary from validated ordinary rows;
imported `benchmark` metadata cannot provide the displayed scores or times.

Partial/error/cancelled reports keep all cases in each subset's denominator.
The policy explanation limits rule-based abstention to the local adapter. Geometry
timing is explicitly unmeasured. Eligible times include adapter checks, transport
and possible cold loading and are explicitly distinguished from webcam latency.
Progress rendering supplies the complete report metadata required for validation.

Two new native scenarios run at all four existing viewport sizes (1280×900,
390×740, 390×480 and 390×651): the retained actual Tev1 report with forged summary
metadata, followed by geometry selection; and a cancelled partial report with an
eligible transport error plus one policy abstention. They verify original 6/11,
3/3 and reported timing, full 11/3 denominators, unavailable eligible timing,
baseline timing wording and layout containment. The first test failed before the
implementation because the eligible breakdown was absent. A subsequent run caught
incomplete progress metadata; that rendering regression was fixed before acceptance.

Fresh local verification:

- All eight added native cases pass.
- Full existing plus added browser suite: **56 passed**, zero retries, 2.0 minutes.
- `npm test`: **61 passed**, zero failures/skips.
- `npm run lint` and `npm run build`: syntax checks passed; the static app has no compilation step.
- `git diff --check`: passed.
- Narrow 390×740 screenshot inspected: scores and explanations wrap within the
  panel, with the existing horizontally scrollable per-case table retained.
- Independent source review: no Critical, Important or actionable Minor findings.

Local Node v24.19.0, Sparticuz Chromium 153.0.8010.0. Playwright uses the original
project configuration with only the local executable and static-server working
directory overridden in a temporary configuration. Pinned GitHub CI remains the
source for published-head browser acceptance. No live contextual actions, camera
measurements or new inference are included in this change.
