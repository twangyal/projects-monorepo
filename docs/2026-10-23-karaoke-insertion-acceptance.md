# Karaoke missed-line insertion acceptance — #309

Corrected canonical source `2e72ef70f76d580521564471e41be26c4bc5612c` passes [run 39917925355](https://github.com/twangyal/projects-monorepo/actions/runs/39917925355), job 120296350767:

- All 206 Python service, HTTP and real-video tests (84.240 seconds).
- All 146 TypeScript units, Ruff, syntax compilation, ESLint, types and production build.
- All 131 native Chromium browser cases (6.1 minutes), including saved/reopened SRT, invalid raw-field/draft/Redo preservation, empty-clip phone keyboard insertion, accepted-number normalization and the original phone passage screenshot.

Implementation is `34aea70d2ebf4499e91e71d1d75e050858e96368`; follow-through `2e72ef7` gives the new panel its own class after an unchanged screenshot selector correctly caught the duplicate timing-panel identity. Review's numeric-field sanitization defect was reproduced RED and fixed before the implementation commit. The four feature flows and original failed phone case also pass together locally (5/5).

## Local failures remain retained

The final corrected-source local suite completed **130 passes and one failure** in 9.7 minutes: `automatic review listens to captured recognized timing while invalid raw corrections remain untouched` exceeded its unchanged six-second native pause predicate. A fixed three-case cohort on pre-insertion source `45a7fbb` also failed all three times. An earlier local broad attempt additionally failed the reviewed-interval pause case; that case passed in the final full run. These observations neither prove a physical audio problem nor identify a particular browser/runtime cause. Hosted Chromium passes both original cases; no audio implementation or timing bound was changed.

Two ordinary complete local Python runs failed the existing RSS-limit case, although it passed in isolation. A diagnostic complete run also failed only that case; all 99 status reads for its live child returned `FileNotFoundError`, while the unchanged monitor returned zero until the normal timeout. This establishes unavailable child procfs status in this local process, not a particular namespace mechanism or effective RSS enforcement here. Hosted Linux passes the original enforcement case. [Pinned observation, baseline log and reproduction](research/karaoke-runtime-checks/README.md) preserve these facts. No thresholds were weakened and no failure was discarded.

## Completion boundary

Users can add missed supplied words without rebuilding all cues, retain corrections and raw unrelated timing spellings, undo/redo the insertion, save it and reopen/export the same SRT. Entry fields are session utilities and clear on successful insert/open/delete. Recognition quality, multilingual real-song acceptance and physical listening remain separate work in #241. Karaoke remains ACTIVE toward the complete product vision. Project #8 remains skipped.
