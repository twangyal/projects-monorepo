# Accuracy receipt verification — 2026-10-06

Issue #131 adds explicit, completed-only local JSON downloads to the existing
held-out accuracy check. The measurement algorithm and original metrics remain
unchanged. Mode, viewport, device pixel ratio, measurement bounds, start/end
timestamps and protocol make the aggregate receipt interpretable. No raw camera
frames or prediction stream are included or persisted.

The original native regression fails before implementation because the download
control is absent. Eight focused cases now pass across 1280×900, 390×740,
390×480 and 390×651. Real downloaded JSON exactly matches displayed JSON;
five target centers and both gaze footer controls remain reachable. Starting or
cancelling another check clears the old report and disables downloading.

All 61 Node tests and all 60 native Chromium cases pass locally, with lint/build
syntax checks. The expanded view test verifies null error/sample-interval metrics
for no samples, contextualized output, simulation/camera labels and URL retirement.
Existing camera lifecycle, safety, keyboard and decision-lab regressions pass.
Independent review found no actionable issues.

Browser: Playwright1.63.0 with explicit Sparticuz Chromium153.0.8010.0.
The native navigation fixtures use pointer simulation and a controlled clock;
unit camera receipts use an adapter harness. Neither establishes physical webcam
accuracy, latency, camera release indicators or assistive-device performance.
Published-head CI is recorded in the issue after publication.
