# Gaze spoken phrase selection — #275

## User outcome and design

Users can select interior words without first dragging a pointer range, then use existing exact insertion/replacement and text Undo. `select text Tuesday` requires one literal case-insensitive match; `select second occurrence of Tuesday` or first/last chooses a repeated phrase deliberately. No matching phrase, an unavailable occurrence or an ambiguous unqualified phrase refuses without navigator selection/value/event/history changes. Ordinary target clarification, current writability, native selection restrictions and pause/cancel remain.

Matches are nonoverlapping, counted from the beginning. Original UTF-16 offsets come from escaped Unicode case-insensitive regular-expression matches, not a lowercased copy; punctuation is literal and quoted spaces are retained. This does not normalize Unicode or fold accents. A post-focus value/writability/ownership check rejects offsets if the website changed, locked or redirected focus away from the field, following enclosing shadow roots and same-origin frames. Website callbacks themselves remain outside the navigator's transaction control.

The shared rule parser and native executor serve both the practice site and the isolated MV3 extension. Help and README expose the new flow. No rich-text selection, permission expansion, dependency change, paid service, physical speech/gaze quality or intended-user acceptance is claimed. Gaze remains ACTIVE; #132 remains separate. Owner-deferred projects and skipped #8 are untouched.

## Source and review

Base main: `c7401164acfff39b5eeb2e8a52d70a0741adc884`. Task branch: `autonomous/gaze-phrase-selection-275`. No PR requested or created.

Initial source `589d4b82f9d1d193c52cf21f55169d3660f0a015` / run `38993495082` was cancelled after the reviewed replacement source was published; it is superseded, not accepted as the final gate. Six added Node cases fail against base for missing parser/range behavior, then all 182 units pass. A native spoken-flow case fails against base with “No control called text tuesday”; after implementation all 12 new practice cases pass across four viewports.

A fresh reviewer identified two important issues before integration: post-focus checks did not detect redirected focus, and trailing command politeness was removed from literal phrase payloads. Both are reproduced by added failing Node cases; the focus problem also fails in native Chromium. Corrected source `89e609fe0f162afdd963b0d6d6db0b3a8afdf596`, tree `65f5c0fe6d463aa3ada35a3d7ebcc2078e3a37bd`, reads the original payload and checks the complete focus chain. The reviewer cleared both findings without further findings, independently rerunning 184 unit tests and eight relevant native cases across four viewports. An intermediate Node run failed in the new frame-focus test because its frame double omitted `closest`; the double was corrected to expose the native methods already used by the write guard. The expected focus-refusal assertion was retained, and the subsequent complete suite passes.

## Verification

Local final checks pass all 184 Node tests, 16 focused native cases, syntax (90 files) and test-extension packaging. The focused cases include normal and redirected focus in light DOM, shadow roots and same-origin frames. The instruction evaluator retains 120/120 tuned, 34/50 and 18/50 held-out, with zero unsafe results on those authored suites. These authored measurements do not establish broad real-site accuracy.

The earlier full local practice run was intentionally stopped when review changed the source; it is not a complete gate. The complete current-tree local practice run passes all 268 cases across four viewports in 6.8m, with no skips. [Complete hosted source CI 38993638148](https://github.com/twangyal/projects-monorepo/actions/runs/38993638148), job `117281267739`, passes **184 unit tests and all 320 native browser cases** (9.0m), syntax and test-extension build. This includes the actual isolated extension on strict-CSP content. The exact reviewed source was integrated to main with expected-head protection; [canonical main CI 38994334175](https://github.com/twangyal/projects-monorepo/actions/runs/38994334175) is pending and #275 stays open. Subsequent receipt edits change only root documentation, leaving the tested application/workflow tree unchanged. Local portable Chromium is 143; actual isolated-extension verification comes from supported hosted Chromium, not inferred from practice-page coverage.
