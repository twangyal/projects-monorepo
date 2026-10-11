# Held-note duration quantization — issue #177

## Product contract

Melody remains ACTIVE under the revised full-DAW direction. Existing onset quantization now has a separate duration action sharing the session-only grid and strength controls. Select original note onsets on the chosen track in the section's inclusive start/exclusive end. Durations move toward the nearest positive valid grid multiple of at least 0.25 beats; midpoint ties choose longer. Strength blends from unchanged (0) to fully aligned (1). Starts do not move; later notes do not ripple. Selected whole lengths may extend past the section end. Other tracks, pitch, velocity, IDs, envelopes/filter/echo, absolute song-time volume ramps and original reference PCM remain intact. Recorded audio is not warped.

Existing strict grid/strength/range validation and complete-project validation refuse malformed settings, empty/missing selections or resulting notes ending after beat 512. No note is clamped or partially committed. The shared pointer-before-blur and keyboard raw-draft/roll-gesture guard admits one complete-project Undo/Redo/autosave edit. No-op output preserves prior Redo.

## Test-first evidence and independent review

Four initial domain cases failed explicitly on the absent API; the actual native export flow timed out on the missing duration button. These historical failures are retained. Five final domain cases cover independently authored fractional/chord durations, partial strength, positive coarse targets and ties, all supported grids at maximum duration, detached complete sound graph, single history step/no-op Redo, malformed/empty selections, atomic late timeline overflow, exact exclusive-end onsets and selected held notes crossing that end.

Independent read-only review found no important defect; its suggested explicit boundary coverage was added. Four focused actual headless-shell browser tests passed in 7.7 seconds, checking complete project and independently decoded MIDI/analytic sine WAV, Undo/Redo/reload, partial/zero/invalid settings, exact reference/other-track retention, unsent focused pointer and keyboard drafts, 390px layout and atomic overflow with preserved complete effects/reference data. The screenshot was inspected: both timing actions and shared controls fit at 390px without horizontal overflow. No test fixture used the quantization producer to generate expectations.

These are authored synthetic note/export tests, not physical-device or musician listening evidence. Official CfT153.0.8010.12 headless-shell uses the same native browser harness as the existing suite. The complete check/browser results and exact published-main CI are recorded below and in #177 before closure. Audio warping, complete automation/mixing/routing and the wider DAW direction remain unfinished.

## Final local verification

`npm run check` passed all 394 unit tests, ESLint, TypeScript and production build. The complete native browser suite passed all 210 tests in 2.4 minutes using two workers. Production/test files passed `git diff --check`; the captured missing-button failure log retains its literal trailing whitespace. Exact-main CI is pending publication and will be recorded in #177 before closure.
