# Melody personal phrase continuation

Issue #42; contract ../specs/2026-10-04-melody-learned-continuation-design.md. User authorizes autonomous implementation; root owns Git/GitHub/docs/config/catalog. No source edits before independent written-contract review.

- [x] Inspect catalog, README, implementation, tests and existing issue coverage. Choose personal phrase suggestions as a bounded product milestone after the Stock experiment failed readiness.
- [x] Independently review the exact design and API, with particular attention to small-sample usefulness, existing draft preservation, source/proposal invalidation and audible preview.
- [x] Engine owner: implement pure bounded selection, joint event counts, deterministic generation, immutable apply and audition composition with meaningful tests. Keep Composition v1 and existing module ownership intact.
- [x] UI owner: add explicit seed/length controls, unsaved note overlay/support evidence, draft-safe proposal lifecycle, audition and one-step apply/discard using existing history/worker/playback.
- [x] Independent oracle owner: hand-compute counts/backoff/draws and source-dependent behavior, verify boundary cases and output invariants.
- [x] Browser owner: exercise actual proposal/worker/audition, rejection, atomic apply/history, stale work, drafts, reload and independently decoded exported MIDI/WAV.
- [x] Root: run focused/full checks and production-browser/runtime evidence; fix concrete regressions, review diffs and document measured limits without musical-quality claims.
- [ ] Commit and push durable progress, observe exact-source CI, close only after acceptance, update PR/catalog and reassess.

Local acceptance: 113 unit tests (19 engine + 11 independent continuation oracle), all 20 production Chromium tests (7 new), lint/typecheck/build. Independent maximum actual audition 48.08s, real 60.08s WAV/MIDI/JSON after Apply, nine separate FFT probes, exact native reopen and desktop/mobile visual inspection passed. No musical-quality inference. Source hashes and runtime evidence are recorded in the project docs; exact-source remote CI pending.
