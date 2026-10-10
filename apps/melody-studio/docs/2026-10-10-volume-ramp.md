# Song-time track volume ramps — 2026-10-10

Issue: https://github.com/twangyal/projects-monorepo/issues/173

Melody's ACTIVE full-DAW direction includes mixing and automation. Static track volume and onset velocity edits could not fade a held phrase or its echo. This milestone adds one editable linear volume ramp per track, applied to every synthesized voice at its absolute song-time beat. Endpoint levels hold outside the interval and multiply ordinary track volume. Release and echo share that clock; other tracks and captured reference PCM stay independent. Whole-song playback, solo, backing, comparison and WAV/stem/section rendering use the shared mixer. Continuation audition adjusts the ramp when its ending is shifted to zero.

Explicit Apply/Discard retains raw drafts, protects unrelated focused fields before blur, supports keyboard activation and commits one Undo/Redo edit. Both composition and strict complete-reference-document validation retain and validate the optional field. Autosave, portable complete backups, saved composition copies and track duplication preserve it. Unknown fields, invalid bounds/levels, accessors and nonfinite values still refuse. Bypass removes the field. Legacy synthesis, peak limiting and the existing frame/allocation budgets remain unchanged.

## Fresh local evidence

All commands ran in the required attached Cloud runtime, from `apps/melody-studio` in the owned `/workspace/projects-cycle-2026-10-10` worktree, based on canonical main `c32b00fbb9470e99f0dd90ce910613f2ffaac841`. GitHub origin matched `twangyal/projects-monorepo`; API push permission, authenticated transport and a non-mutating push dry run succeeded through documented command-scoped network permission. Inherited proxies and TLS trust were preserved.

Runtime: Node v24.19.0, npm 11.9.0, system Chromium 151.0.7922.173. Locked install: `npm ci --ignore-scripts --cache /tmp/projects-cycle-2026-10-10-npm-cache` (124 packages; exit 0). The unchanged lockfile emits an ESLint 9.39.5 deprecation notice; no dependency or security setting was changed.

| Fresh command | Actual result |
| --- | --- |
| `npm run check` before implementation | 376 units pass, 0 fail; ESLint, TypeScript and Vite build pass |
| `CHROMIUM_PATH=/usr/bin/chromium MELODY_TEST_PORT=4194 npm run test:browser -- tests/sound-echo.spec.ts --workers=2` before implementation | 4 production-browser cases pass, 11.4 seconds |
| `CHROMIUM_PATH=/usr/bin/chromium MELODY_TEST_PORT=4194 npm run test:browser -- tests/volume-ramp.spec.ts --workers=2` | 6 new production-browser cases pass, 13.9 seconds |
| `npm run check` on final source/tests | 382 units pass, 0 fail; ESLint, TypeScript and Vite build pass |
| `CHROMIUM_PATH=/usr/bin/chromium MELODY_TEST_PORT=4194 npm run test:browser -- --workers=2` on final source/tests | All 203 production-browser cases pass, 3.6 minutes, exit 0 |
| `git diff --check` | Pass |

The six domain cases cover fractional complete-project retention; continuous sustained-note gain; malformed/accessor refusal; complementary ramps on identical overlapping voices with echo; legacy/unity/mute PCM; and continuation audition before, within and after a ramp. The six native cases use authored synthetic polyphonic notes and original synthetic reference PCM in the actual production app. Independent analytical sine/envelope/echo/gain calculations check decoded 22,050 Hz WAV samples within two int16 units. Actual composition/solo AudioBuffer samples agree with decoded WAV within one unit. Full/section/aligned-stem outputs, exact post-fade echo silence, unchanged MIDI/note/reference bytes, Undo/Redo, autosave reload, library download/open, portable import, malformed-import preservation, retained invalid drafts, before-blur protection and 390px keyboard/layout are verified.

## Failures retained

Test-first probes failed for the missing behavior: project validation dropped the field and synthesis ignored it (2 failures); the production UI lacked the control (1 failure). A later domain probe exposed continuation's shifted automation clock (1 failure), fixed by retaining the original song-time gain. The first six-case native implementation run passed 2 and failed 4: complete-reference-document validation rejected `volumeRamp` as an unknown track field. The whitelist was extended only for this validated optional property; unknown/malformed fields remain refused. Native audio/library cases now explicitly require successful Apply to avoid checking an unchanged project. A direct complete-document regression also reproduced that rejection before the fix. The final full suites pass without retries, exclusions or weakened assertions.

## Scope and remaining limits

This is one linear gain ramp, without multiple points, curves, effect automation or mixer routing. MIDI omits automation. A ramp does not extend notes or effect tails. Section note transformations leave automation anchored at its entered song beats. Real musician listening, physical microphones and other browser/device evaluation were not performed in this cycle; native headless Chromium signal checks establish the measured behavior, not full DAW completion. Melody stays ACTIVE.

Fresh all-state inventory exhausted issue pages (100,72,0 records: 148 issues and 24 PRs), PR pages (24,0; all closed) and branch pages (1,0; only main). No duplicate volume-ramp issue existed. The host's chat inventory tool is unavailable; the parent's activity check and current GitHub/history evidence were used. Lens research #172 remains separate. Yesterday's unpublished duplicate `ec32f28` was not included or republished. This record contains today's local evidence only; historical CI is not validation of this change. Published-head CI belongs in the draft PR's current checks.
