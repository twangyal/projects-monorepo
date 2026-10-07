# Session confirmation timing — issue #134

The live demo offers explicit 0.9, 1.5 and 2.5 second hold choices. Native pressed
buttons work with pointer, keyboard and gaze; the selected duration is announced.
The setting is held in memory only and refresh returns to 0.9 seconds. It applies
to all navigation/safety targets; Escape still pauses immediately. It does not
change gaze estimation or establish a physical accuracy improvement.

A changed duration retires partial progress without releasing a confirmed-target
latch. Looking away is still required to confirm that target again. Selecting the
same duration preserves pending progress. Unsupported values refuse before any
state mutation. The existing 250 ms sample-gap limit still applies to slow holds.

Two new domain tests first fail because setDwellMs is absent; the native regression
first fails because no timing control exists. All 65 Node tests, lint/build syntax
checks and four focused native cases now pass. The native flow selects both slow
holds through gaze, verifies no premature/repeated activation, returns to the
original duration through gaze, selects with Space and verifies refresh resets
selection. Viewports: 1280×900, 390×740, 390×480 and 390×651.
Independent read-only review found no actionable issues.

Native verification uses Playwright 1.63.0, explicit Sparticuz Chromium
153.0.8010.0, pointer simulation and a controlled clock. It does not measure webcam
behavior, personal usability or arbitrary browser control. A fresh complete suite on 2026-10-07 passes all 76 native cases with no retries.
Published CI observations are recorded in issue #134.
