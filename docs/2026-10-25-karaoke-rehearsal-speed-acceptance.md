# Karaoke slow rehearsal — software acceptance

Issue [#328](https://github.com/twangyal/projects-monorepo/issues/328). Exact reviewed source: `dcefdbe76a2c7a3a2441053e999d415528ea5115` on canonical main. Karaoke remains ACTIVE; multilingual and real-song quality work remains #241. Project #8 stays skipped.

## User outcome

A deliberate Playback speed choice offers half speed (0.5×), three-quarter speed (0.75×) and normal speed (1×) for Original, Vocals and Backing listening, range practice and automatic-review audition. The browser is asked to preserve pitch; no acoustic-quality result is implied. Lyrics, highlighting and loop endpoints continue to use source media seconds. Speed remains session-only, survives track loads and resets on a different clip.

Changing speed retires owned practice/audition and staged manual timing capture. It preserves the paused playhead, raw cue spellings, title/pasted drafts, history, source files and saved lyrics. Manual sequential capture retains normal1× admission. Unsupported externally changed rates refuse practice and show recovery choices.

## Tests and review

Baseline159TypeScript units passed. The new rate-admission test failed for absent export, then passed; all14practice domain cases passed. Native absent-control RED was observed after correcting a test tuple typing error that had blocked server build. Initial post-implementation exact-label lookup included wrapping option text; an explicit for/id label repaired it. A six-second no-transcript fixture incorrectly attempted automatic review; that assertion moved to the existing16-second recognition fixture. Product guards, fixed clock-ratio/repeat tolerances and test deadlines stayed unchanged.

One independent review found no Critical or Minor issues and one Important: native speed selection updated the visible control but not the default used by track loads. The native regression failed with expected1/received0.5 after switching tracks. One fix pass now synchronizes supported native choices with defaultPlaybackRate and repairs an already-current custom choice. No rereview. Final160units/lint/types/build and six focused native cases passed37.0s.

Focused tests measure actual half-speed media-clock progress over a fixed one-second wall window, two real repeat boundaries and the literal instrumental gap, all three track endpoints, pause/stop, unchanged raw/Redo/SRT/audio bytes, normal-only timing capture, timing retirement,390px keyboard/reset behavior, automatic-review audition, delayed native-play completion retirement and native/control track continuity.

The earlier148-case local full run was intentionally stopped(exit130) after46observed passes before rebuilding for the review repair. It is not a complete or final-source pass. The fresh final149-case local run passed in7.8minutes with exit0; canonical acceptance follows below.

## Independent slow-choice export observation

A separate native runner against the final built source chose0.5× on a clean six-second song, exported MP4 through the production HTTP/video path, then independently inspected it with FFprobe/FFmpeg. The case passed in4.6s (runner5.4s). It verified:

- six-second video/container and six-second AAC audio,144H.264 frames at24fps and1280×720;
- original cue/gap highlighting at12 independently selected boundary frames;
- unchanged exact saved project/raw editor, SRT bytes and Original/Vocals/Backing hashes.

[Receipt](research/karaoke-rehearsal-speed/slow-export-receipt.json):202661bytes; SHA256`ab72cf251e9ed7e8cb280f600c6e77bde556549d391d7986f7812d36053b8217`. This establishes this synthetic export retained source speed/timing; it does not measure pitch fidelity or real-song quality. The temporary test used existing practice/sequential fixtures, `downloaded` and `checkTimingVideo`, plus independent six-second FFprobe container/audio assertions. No producer or ordinary CI test was modified for this observation.

## Final gate results

Final local: all149browser cases passed in7.8minutes, exit0, on the reviewed source. Node24.22.1 and portable Chromium143.0.7499.0; unchanged Python3.12.14/Pillow12.3.0 fixture server.

Exact-source canonical [run40176366602](https://github.com/twangyal/projects-monorepo/actions/runs/40176366602), job121117808882, completed **successfully** for `dcefdbe76a2c7a3a2441053e999d415528ea5115`. Completed job logs establish:

- Python3.11.17: all206tests passed in83.949s, including the RSS-limit case.
- TypeScript: all160tests passed; zero failures.
- Ruff, compileall, lint, typecheck and production build passed.
- All149production browser cases passed in7.0minutes; browser result logged2026-10-25T08:32:05Z, run completed08:32:08Z.

Both final local149-case and canonical149-case suites include the unchanged real-video workflows. The separate slow-choice export receipt above provides additional direct speed-specific evidence. The bounded software milestone is accepted and #328 closes; Karaoke remains ACTIVE, #241 open and #8 skipped. No PR was created.

## Review rulings and limits

Native preservesPitch is an API request, not an acoustic-quality guarantee. Physical phone and screen-reader use, Safari/Firefox, real-song recognition/alignment quality, measured correction effort and calibrated latency remain unverified. Chromium viewport/keyboard/native-media tests establish only their measured software behavior. Automatic/ordinary playhead marks still store source currentTime; sequential timing requires1×. Export isolation was initially inferred from unchanged paths/bytes; the independent rendered observation above now supplies direct bounded evidence. Full gates are recorded separately from focused success. Unrelated pre-existing behavior is not declared fixed.

The previous#327 full local Python205/206RSS failures and isolated retry remain in its [acceptance record](2026-10-24-karaoke-passage-fit-acceptance.md). No new local full Python suite is claimed here; this feature does not change backend code, dependencies, schema, workflow or deadlines. Canonical Python results above must not be used to erase those earlier local failures or invent a cause.
