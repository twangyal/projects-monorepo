# Karaoke review-exclusion checkpoint — #313

Implementation is on canonical main at `c8009efa62a43971efd4759c5967f7e8b84f106d`. The feature is implemented and independently reviewed; full hosted acceptance is **pending**. [CI run 39995712975](https://github.com/twangyal/projects-monorepo/actions/runs/39995712975) was still in **Install local video tools**, with setup steps passed and all application verification steps pending, at the final check on 2026-10-23. Do not treat this checkpoint as a full CI pass. Issue #313 stays open.

## Actual local verification

- `npm run check`: **150/150 TypeScript tests**, ESLint, TypeScript and production Vite build passed. Python compilation and staged diff check also passed.
- Four new focused native cases: **4/4 passed** in 37.6 seconds. All four also passed within the full browser run.
- Full browser command, `CHROMIUM_PATH=/tmp/chromium312-run KARAOKE_TEST_PORT=4318 node_modules/.bin/playwright test --output=/tmp/karaoke313-full-browser`: **133 passed / 2 failed** in 11.2 minutes. Failed existing automatic-audition cases were `automatic review listens to captured recognized timing while invalid raw corrections remain untouched` (six-second paused predicate) and `reviewed timing auditions the staged interval and applies words and times in one recoverable edit` (five-second paused predicate). The failures match the previously retained local native-audio observations; no playback predicate, timeout or implementation was relaxed. The rest included complete clip-to-real-MP4, archive, saved SRT, recognition-cache, editing, practice and narrow-layout workflows.
- `python3 -m unittest discover -s tests -v`: **206 run, 205 passed, one failed** in 109.948 seconds. Existing `test_subprocess_rss_limit_is_enforced` expected a memory-limit error but received `Media subprocess timed out.` No Python source or gate changed. [Prior diagnostic captures](research/karaoke-runtime-checks/README.md) retain unavailable child procfs observations and pre-change native pause reproductions. Those observations do not establish effective memory enforcement in this runtime.
- Fresh independent source review found no blocking defects and independently passed seven review/exclusion domain tests. README wording and the Save fixture were corrected before the final check.

[Implementation receipt](../apps/karaoke-studio/docs/2026-10-23-review-exclusion.md) retains test-first failures and the initial Save fixture timeout. That fixture now asserts the unchanged pasted-draft guard and explicitly discards the paste only after Undo/Redo assertions. The new successful flow independently compares exact exported SRT and unchanged recognition JSON after save/reload.

## Remaining acceptance

Inspect the linked canonical run on the exact source SHA, record the Python/Ruff/TS/build/native results, and investigate actual regressions without bypassing gates. Close #313 only after its implemented scope is verified as far as available tooling permits and that result is recorded. If dependency installation fails or times out, retain that infrastructure outcome and rerun the unchanged gate when available. Source and roadmap progress are durable; no PR was created.

Karaoke remains ACTIVE. Real multilingual singing quality and intended-user acceptance remain #241. Gaze #312 was separately accepted and closed after 205 Node tests and 620 canonical browser cases. Project #8 remains skipped.

## Continuation — first hosted outcome and unchanged retry

Attempt 1 on c8009ef reached the original 20-minute job boundary during Playwright system dependency installation and was cancelled before any browser case ran. Full logs confirm **all 206 Python tests**, including original RSS enforcement, and **all150 TS tests**, Ruff/ESLint/typecheck/build/compilation passed. FFmpeg fetched 62.8 MB in 15min26s (reported 67.9 kB/s), consuming most of the job allowance; Playwright dependencies then needed another25.9MB. This is an incomplete gate, not browser acceptance or an established application failure. The runner manifest did not guarantee FFmpeg, so its installation was retained.

The unchanged job was rerun as attempt2 of [the same run](https://github.com/twangyal/projects-monorepo/actions/runs/39995712975/attempts/2). At the latest check it remains in Install local video tools. No workflow, product deadline, test predicate or shipping source was changed. Inspect attempt2 before closing #313; if slow provisioning again exhausts the aggregate allowance, record it and address CI provisioning separately from application/media acceptance. The local failure evidence above remains intact. Unblocked repository work continued as Git History #314, now canonically accepted.
