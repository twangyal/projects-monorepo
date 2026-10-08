# All-track section arrangement verification (#141)

Baseline: section audition commit33b0e8b, owner full-DAW direction retained. Final local npm check: **325 unit tests passed**, lint/typecheck/production build passed. Final full native production-browser suite: **148 passed**, one worker, temporary Chromium153 distribution with restored local libraries. Independent fresh-context review found no Critical/Important issues and independently passed the original five transformation unit tests. Published-head CI is not yet claimed.

Six unit cases cover detached frozen input, exact fractional/adjacent boundaries, muted/all-track later-note shifts, crossing/empty refusal, late-track quota/global end refusal and eight tracks expanding to exactly2,048 notes ending at beat128. A second insertion refuses without partial modification.

Five new native cases verify:

- Complete retained reference bytes/bindings unchanged through one duplicate edit, exact Undo/Redo, actual independently parsed MIDI/scalar-WAV checks and reload.
- Boundary refusal preserves complete backup and redo.
- Focused invalid note text remains unchanged for pointer and keyboard activation.
- A valid unapplied title cannot commit by pointer blur on Duplicate section.
- Eight tracks expand to256 notes each; actual MIDI contains all2,048 notes with last onset127.5/duration0.5, actual WAV has1,412,964 frames; quota refusal and reload preserve the complete result/reference bytes. The fixture has one retained reference, not eight maximum20-second references.

Red/green evidence: missing pure-operation module first failed; six unit cases now pass. Native flow first could not build because a test download helper was called with the wrong signature; corrected the test helper, then observed the expected missing Duplicate section control failure before wiring it. Targeted final five native cases passed.

The first full148-predecessor run collected147 tests:137 passed/10 failed. Concurrent production builds removed served test-harness pages, producing nine missing-ready failures; a simultaneous Playwright run also removed a library case's recording trace, causing ENOENT at teardown. Those are retained failed outcomes, not product success. All builds/runs were then serialized and the fresh full148-case suite passed with stable served files. No application gates or test deadlines were weakened.

Notes crossing either boundary are refused rather than split. References retain original capture timing and are not editable arrangement audio regions. Current256-note/128-beat guards are prototype constraints. Melody stays ACTIVE; playlist sections, broader song/editor depth, sound design, mixing/effects/routing and musician evaluation remain major product work.
