# Selected-track phrase timing scale — issue #176

## Outcome and contract

Melody’s ACTIVE full-DAW direction requires useful arrangement editing. Stretch ×2 and Compress ×0.5 develop a phrase without changing the song tempo or manually editing every note. The existing section range selects whole intervals on the chosen track. Starts/durations and rests scale around the section start; later notes on that track ripple by the section-length change. Before-section notes and all other tracks remain at their original positions. Exact start/end adjacency is supported; unrelated crossing voices do not block the edit.

Sound envelopes, filters, echo spacing and song-time volume ramps remain anchored. Complete references and original PCM are untouched. This edits synthesized notes, not recorded-audio warping. Crossing selected-track notes, empty/invalid bounds, durations outside 0.25–16 and resulting notes past beat 512 refuse atomically without clamping. The timeline is note-defined; expanded trailing silence is not a separately retained region. Enter new section bounds when transforming the resulting phrase again. Existing pointer-before-blur/keyboard draft and roll-gesture admission, commit/Undo/Redo and complete autosave/conflict protection are reused.

## Test-first failures and review

The first four domain tests failed on the absent API (three failures; one generic refusal test passed vacuously before the API existed). The first native test timed out on the missing Stretch control. Both failures are retained rather than presented as completed implementation checks. First implementation had three passes and one incorrect expected error: the late note’s start exceeded 512 before its end was checked. Separate start/end overflow fixtures now exercise both unchanged production guards. No acceptance predicate or product limit was relaxed.

Independent read-only review found no critical/important issue. Its optional adjacency coverage was added: before-note ending exactly at start remains, after-note starting exactly at end ripples, and another track’s crossing remains untouched. Six domain cases cover fractional anchors, chords/rests, detached graph/one-edit history, reversal of an exactly representable scaled phrase, malformed/empty/crossing selections, min/max durations, late timeline refusal with preserved Redo, and all 2,048 notes across eight tracks with a muted selected part. This capacity result is a domain check, not a physical browser maximum-performance receipt.

Three actual headless-shell browser cases pass: independently authored complete project expectations and decoded MIDI/analytic sine WAV, full Undo/Redo/reload, compression/reversal, intact other tracks/reference assets/automation/effects and prior Redo on rejection, focused raw title/note draft protection and 390px keyboard/layout. Native source/export fixtures are synthetic authored data, not musician listening evaluation. Standard Playwright browser installation failed; an official CfT153.0.8010.12 headless-shell ZIP passed full-archive CRC validation.

Final complete check/browser results and published-main CI are recorded below and in #176. Melody remains ACTIVE; audio warping, full automation/mixing/routing and actual musician/physical-device evaluation remain unfinished.

## Final local verification

`npm run check` passed 389 unit tests, ESLint, TypeScript and production build. The complete native suite passed 206 tests in 2.4 minutes using `CHROMIUM_PATH` and two workers. The final adjacency addition changed only unit tests; the browser receipt exercises the identical production source. The mobile screenshot was inspected: both timing buttons fit without horizontal overflow. Exact-main CI is pending publication and will be recorded in the issue before closure.
