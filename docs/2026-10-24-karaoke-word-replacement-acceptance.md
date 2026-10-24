# Repeated lyric-word correction acceptance — #317

Application source: `ac2617851dfaf1e15821cefa99d695f300e28196`, integrated directly into canonical main. [Issue #317](https://github.com/twangyal/projects-monorepo/issues/317) tracks this milestone; no PR was created.

“Replace lyric words” previews the complete before/after result for every changed current cue. Matching is case-sensitive and literal, including Unicode, punctuation and replacement strings such as `$&`. The complete original/proposed cue graph must satisfy existing timing and word limits. Fragment removal is supported; empty output lines, invalid times and exceeded caps refuse atomically. Apply revalidates current work and makes one unsaved Undo/Redo edit. Every cue time, unrelated numeric spelling, title and pasted draft remain; recognition and saved revisions stay separate. Save lyrics is deliberate.

No-match, identical replacement and invalid proposals return before changing history or retiring playback. Successful Apply uses ordinary owned-edit retirement for practice, import/automatic review and timing capture. Preview refreshes with current edits; there is no asynchronous stale proposal. Query/replacement fields clear after Apply and clip changes; the fields themselves remain session utilities outside lyric history. Before/after paragraphs preserve whitespace, wrap long fragments and display user text through textContent.

## Verification

- Baseline: 150 TypeScript units passed. Four new pure cases first failed on the missing batch API, then passed for exact case/literal Unicode and `$&`, nonoverlapping matches, detached inputs, no-op/no-match, fragment deletion and complete graph/character limits.
- Final local frontend check: 154 units, ESLint, TypeScript and Vite build passed. Python compileall passed. No backend or dependency changes were made.
- Native RED: both original desktop/phone cases timed out reaching the absent tool. Final focused cohort passed 4/4 in 14.9 seconds. It verifies review-before-Apply, exact raw times/title/paste/history, actual saved/reopened words, phone keyboard/containment, refreshed previews/refusals, native practice retention/retirement, timing-session retirement and cross-clip utility reset.
- Fresh independent review found no concrete blocker and independently passed all four pure cases; its requested native ownership/reset coverage was subsequently supplied by the added passing cases.
- A separate phone visual check passed once in 6.8 seconds using isolated output. A long replacement wrapped and HTML-like text produced no HTML child element. This is a supplementary software/visual observation, not measured user correction effort.
- Canonical full gate: [run 40081186134](https://github.com/twangyal/projects-monorepo/actions/runs/40081186134), exact source `ac261785`, passed all 206 Python cases in 84.677 seconds, all 154 TypeScript cases, Python compile/Ruff, ESLint, typecheck/build and all 139 browser cases in 6.3 minutes. The existing full commands and deadlines were retained.
- Local complete isolated browser cohort: all 139 cases passed in 6.8 minutes with output isolated at `/tmp/karaoke317-full-isolated` and no concurrent visual invocation. Both previously failing trace-teardown cases passed. A transient exec transport disconnect recovered while the same run continued; no source or test changes were made.

## Failed attempts retained

Local Python ran 206 tests in 70.341 seconds: 205 passed and `test_subprocess_rss_limit_is_enforced` failed because it received “Media subprocess timed out.” instead of the expected memory-limit exception. This is the previously recorded local resource-test limitation; it is not a passing Python suite. The independent canonical result is recorded above without relaxing this test.

The first complete local browser run finished with 137 passes and two failures in 6.9 minutes: `sequential-timing.spec.ts:29`, “natural ended leaves the final open line pending until explicit exact clip-end action,” and `sequential-timing.spec.ts:33`, “natural end with unmarked remaining lines refuses partial review and never infers an endpoint.” The completed errors were browserContext.close ENOENT trace files, not failed timing assertions. A concurrent one-off visual runner had shared the default test-results directory; its original test also failed at trace teardown. It additionally collected an inherited recognition-cache project, which passed. These failed runs remain failed. The supplementary visual check was then restricted to its intended project/output, and the full isolated cohort was run once separately with no concurrent visual test.

[Retained attempt summaries and the temporary visual reproducer](2026-10-24-karaoke-word-replacement-local-attempts.json) distinguish these outcomes. Original full log/trace bytes are not committed or claimed reproducible from their summaries. [The source checkpoint](../apps/karaoke-studio/docs/2026-10-24-word-replacement.md) records earlier status. No shipping workflow allowance, application deadline or test tolerance was changed.

Karaoke remains ACTIVE against automatic transcription/alignment and real-song usefulness. This milestone supplies correction tooling; it does not measure recognizer accuracy or real-user correction effort and does not close #241. Project #8 remains skipped.
