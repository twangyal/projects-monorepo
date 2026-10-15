# Motion focused workspace (#263)

The first screen prioritizes the stage and current drawing tools. Contextual sections and an actual expanded view reuse mounted editor nodes, without schema, export-format, backend or trust-policy changes. Back/Escape return keyboard focus; global stop/export cancellation remain reachable. Phone controls span the panel, with readable pressed-hover navigation.

Raw valid/blank pose and selected-stroke drafts, reviewed geometric in-betweens, selected artwork, history and owned image reads survive navigation. Pose change handling waits for native focus transfer and refuses a callback after its captured operation loses authority. Actual worker completion held past cancellation cannot download late output.

## Local evidence

- Fresh pinned dependencies; `npm run check`: 273 unit tests, ESLint, TypeScript and production build pass. No new dependency.
- Nine focused native Chromium cases pass: desktop 1440 / phone 390 creation, posed playback/stop, real independently decoded PNG/GIF exports (12 frames), editable backup reload, all sections/expanded/Back/Escape, raw pose/stroke and review retention, delayed image import, late real-worker cancellation, phone geometry/hover contrast and suspended-page queued blur.
- Desktop and phone screenshots inspected after the full-span/hover repair. Read-only independent review reports no remaining Critical or Important findings.
- Full existing native regression execution and exact published-source/main CI are recorded in the root integration receipt when complete; do not infer those from the focused result.

## Retained first failures

The initial focused run exposed a valid raw pose committing during navigation; deferring until native focus transfer repaired it. A later RED case exposed a queued blur committing after pagehide; capturing editor authority repaired it. Phone review found wrappers retaining half-width grid cells and unreadable active-hover styling; actual geometry/hover regressions pass after repair. Initial test-only parseGIF argument/import errors and an incorrect Pause label expectation were corrected. A fast export completed before the cancellation click in one intermediate test; the final case holds the actual worker completion for late delivery. An overlapping local output directory removed an intermediate failure trace; final focused output is isolated. These intermediate outcomes are not passing verification claims.

## Limits

Portable local Chromium 143 uses machine-specific launch configuration; repository CI uses its pinned Playwright browser. Screen-size emulation is not physical touch hardware or real-person usability acceptance. AI assistance and live synchronization remain future work. Motion remains ACTIVE; project #8 remains skipped.
