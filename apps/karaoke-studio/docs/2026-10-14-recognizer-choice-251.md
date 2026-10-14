# Deliberate lyric-recognizer retry — #251

The intended automatic upload → synchronized lyrics → correction → export loop needs a way to recover when the language heuristic selects poorly. This bounded milestone adds Automatic / English / Multilingual to the existing retry flow. Automatic upload behavior is unchanged. An explicit choice skips detection, uses that installed model for all phrases, and never falls back. The choice is captured in the request and the control is disabled during work.

The server accepts legacy `{}` and `{ "modelChoice": "auto" | "english" | "multilingual" }`. Other keys/types/values are rejected. The parent checks checksum-verified installed models and passes the choice to the network-denied, resource-limited worker. Existing transcript publication and cancellation ownership are retained: saved lyrics are not replaced, and failed/cancelled work does not replace an earlier transcript. Applying recognized cues remains deliberate and undoable. No saved schema, archive or model pin changes.

## Evidence

- Starting point: owner-merged main `fe473a2`; its hosted Karaoke run [38508483884](https://github.com/twangyal/projects-monorepo/actions/runs/38508483884) passed 198 Python / 128 TypeScript / 100 browser cases.
- Test-first HTTP request failed 400 vs expected 202; worker-choice tests exposed the missing parameter. After implementation all 22 lyric tests passed, including independent reviewer execution.
- New native test first failed for the absent control, then exposed an implicit-label lookup failure. An explicit associated label repaired that failure. All three automatic-lyrics browser cases passed locally using portable Chromium 143 with web security enabled. They check captured request choice, disabled state during work, multilingual transcript identity, retained unsaved corrections, deliberate apply/undo, and reset on another clip.
- Full local TypeScript suite: 128 passed; ESLint, typecheck and production build passed. Python compileall passed.
- Full local Python run after the cache follow-up: 206 tests, one failure in the same unchanged RSS test.
- First full local Python run: 201 tests, one failure in unchanged `test_subprocess_rss_limit_is_enforced` (timeout instead of memory-limit error). It also fails in isolation. This runtime does not reliably expose child `/proc/<pid>/status` (a direct child probe returned FileNotFoundError); no memory-limit behavior was relaxed. A final hosted Linux gate is required. Local Python is 3.12 / Pillow 12.3, versus supported CI Python 3.11 / pinned Pillow 11.3. Ruff is unavailable locally.

- First hosted source gate [38527247997](https://github.com/twangyal/projects-monorepo/actions/runs/38527247997): 202 Python tests (including real RSS enforcement), 128 TypeScript tests, Ruff/ESLint/typecheck/build passed; browser result 99 passed / 2 failed. The new test left two fixture uploads behind and exhausted the unchanged shared 20-project quota, failing later one-MiB title/cue upload cases. The test now deletes only its own newly created fixture IDs in `finally` and asserts that pre-existing IDs remain. The repaired native test and full TypeScript checks pass; a fresh hosted full gate is required before integration.
- The wider portable Chromium run also encountered existing playback timing/cancellation failures; it is not a passing full-browser gate. Hosted standard Chromium remains the integration gate. First failures and resulting fixture repair are retained in issue #251.

## Limits and remaining work

Browser/service recognizers are explicit test fixtures, not real inference. No model was downloaded and no real-song quality result was rerun for this change. The 59-song multilingual report remains supplied evaluation evidence; it lacks the per-language timing measurements requested by #241. Selecting Multilingual does not force one language inside v3, and singing recognition still needs review. This milestone does not complete the wider automatic-karaoke quality/correction-effort evaluation.
