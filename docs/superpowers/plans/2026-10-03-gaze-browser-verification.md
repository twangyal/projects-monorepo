# Gaze Browser Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Verify the real browser navigation flow and make every gaze keyboard key reachable without manually scrolling an overlay.

**Architecture:** Keep the static app and dependency-free Node tests. Put keyboard scrolling controls outside its scrolling key grid; add app-local Playwright tests and a path-filtered GitHub Actions workflow.

**Tech Stack:** Native browser JavaScript/CSS, Node.js 24, Playwright 1.63.0, standard Ubuntu GitHub runner.

**Spec:** https://github.com/twangyal/projects-monorepo/issues/5

## Global Constraints

- Preserve project #8's explicit skip instruction.
- No paid services, persistent CI artifact/cache uploads, credentials, deployment, or billing changes.
- CI repository token has contents: read only; pinned official actions, 15-minute timeout.
- Existing npm test remains dependency-free. Playwright is a development-only dependency.
- Physical webcam accuracy, release indicators, and TensorFlow memory measurements require separate device checks.

## Review Focus

- A short/narrow viewport must leave keyboard scrolling, case, and Close controls reachable.
- Scrolling an inner grid must clear pending dwell without repeating a held confirmation.
- Pointer simulation must make no external camera/CDN request.
- Pause must remain latched while looking at Resume, and Stop must remain reachable.
- Resizing during partial calibration must restart it before navigation resumes.

### Task 1: Reach every keyboard key hands-free

**Files:** Modify app index.html, styles.css, src/keyboard.js, existing DOM fixtures; create tests/keyboard-scroll.test.js.

**Interfaces:** setupKeyboard(document, onChange) remains unchanged. New keyboardUp/keyboardDown buttons scroll keyboardKeys; onChange clears pending navigation dwell. A fixed footer contains scroll, case, and Close controls.

- [x] Add tests that clicking keyboardDown/keyboardUp scrolls only the key grid by a useful visible-area increment, resets navigation, preserves the edited field, and opens a field at the first row.
- [x] Run node --test tests/keyboard-scroll.test.js; expect the missing handlers/reset to fail.
- [x] Implement the controls, grid-only overflow, compact layout, and required fixture updates.
- [x] Run npm test, npm run lint/build and git diff --check; expect all checks to pass. Native layout remains pending Task 2.
- [x] Commit with issue #5 reference.

### Task 2: Real-browser regression checks and CI

**Files:** Create playwright.config.js, browser-tests/navigation.spec.js, package-lock.json, .github/workflows/gaze-navigator.yml. Modify package.json, README.md and project gitignore.

**Interfaces:** npm run test:browser invokes Playwright; config serves the static app on localhost:4173. Browser helper moves the pointer onto an actual hit-tested control, advances animation frames through the 900-ms dwell, and confirms the resulting DOM state.

- [x] Add browser tests for once-per-look confirmation, pause/resume/stop/page navigation, gaze keyboard draft saving, accuracy report closing, and resize/partial calibration. Run at 1280x900, 390x740, 390x480, and 390x651; assert no external requests or page errors.
- [x] Pin the development dependency and lockfile; validate native npm run test:browser execution and existing checks. Do not report list/syntax checks as browser execution.
- [x] Add read-only, path-filtered CI on push/pull_request using standard Ubuntu, no uploads/cache. Run unit/syntax checks then install Chromium and run the browser suite.
- [x] Commit with issue #5 reference; inspect its GitHub workflow run and decoded job logs.
- [x] Fix actual failures with reproducing tests, rerun targeted/full relevant checks, and commit corrections. Record a tooling blocker if CI cannot execute.
- [x] Request a fresh whole-change review, record any fixes and limitations, then update/close issue #5 according to verified outcome.

## Verification and review record

- Native CI run [37133828209](https://github.com/twangyal/projects-monorepo/actions/runs/37133828209), source commit `06bc3d1`: 37 Node tests, 24 Chromium cases, and lint/build syntax checks passed.
- The first native run exposed short-screen overlay and scroll-settling failures; corrected in `46e592b` and verified in CI. Accuracy Close is outside its scroll content.
- Independent review prompted 390×651 target visibility, multiline preview/case controls, and fresh held-pointer samples. The expanded native regression did not reproduce the inferred compact-breakpoint clipping; no speculative layout change was added.
- The local execution service disconnected after initial successful CI. Remaining repository reads/writes and verification used connected GitHub tools; GitHub remains the durable source of progress.
- Physical webcam accuracy, release indicators, and actual TensorFlow memory remain unverified. No paid/model service, deployment, secrets, or project #8 changes.
