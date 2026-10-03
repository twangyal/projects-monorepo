# Eye detector initial version

Build the first priority backlog item as an isolated browser application under
`apps/eye-detector`. The goal is a usable portfolio demonstration of looking at
a control, seeing an explained recommendation, and explicitly confirming it.
Repository instructions authorize independent product and architecture decisions.

Use TypeScript and Vite without a backend or accounts. Bundle MediaPipe Face Mesh
assets locally through npm; webcam frames and calibration samples stay in memory
in the browser. Fit normalized eye features to screen coordinates using nine
calibration points and regularized linear regression. Show calibration error as
a training fit estimate, not an independent accuracy measurement. Recalibrate
after viewport changes. Tracking loss clears recommendations and prevents actions.

Separate gaze estimation, calibration, target decisions, browser actions, and
the demo workspace. A deterministic local decision baseline ranks visible enabled
controls by gaze proximity, rejects ambiguous nearby choices, and waits for a
stable dwell. Highlighting alone never clicks. Confirmation uses an accessible
button, Enter/Space, or optional browser speech recognition ("confirm"). Only
controls inside the demo workspace are actionable. No external browser control,
remote LLM, or accessibility/medical reliability claim is part of this version.

Provide explicit pointer simulation, pause/stop, camera permission recovery,
calibration instructions, a decision log, navigation/selection/scroll controls,
responsive layout, and keyboard access. Optional speech may use the browser
vendor's service; explain that before enabling it. No automatic retry of denied
permissions. Stop all media resources when paused, switched, hidden, or closed.

Verification: unit tests for calibration and target selection, lint/type checks,
a production build, and Chromium end-to-end tests of simulation, confirmation,
scrolling, stopping, camera failure, and mobile layout. Real gaze quality requires
a person with a webcam; automated tests do not establish that quality.
