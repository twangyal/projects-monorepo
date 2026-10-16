# Karaoke automatic-review timing correction — #271

## Outcome

Users can correct automatic words and line times in the same review while listening. Each line retains its original recognition and exposes raw start/end seconds plus keyboard-accessible Mark-at-playhead buttons. Listen/Repeat uses the selected staged interval, independently of other invalid drafts. Apply validates every line, including hidden rows, and uses the existing one-step unsaved Undo/Redo path. Existing title, pasted words and exact prior numeric spellings remain recoverable; Save is separate. Cancel/replacement clears the review only. Timing changes retire owned audition and stale native play results.

This is a bounded extension of the current automatic-recognition correction flow, selected after reading main direction, roadmap, recent commits, project documentation/tests and open work. Owner focus includes Karaoke. No unfinished predecessor exists; #241 remains blocked on absent real-song/model evaluation inputs and actual correction-effort measurements, and no suitable implementation issue existed. #271 was created before implementation. Existing #8 skip and Shot/Composure deferral remain in force.

## Source and boundaries

Base main 6bd5acbafb8c0750e4b3c8d00dedca7bf425710c is clean, and recent CI is green. Work is isolated in autonomous/karaoke-review-timing-271. Source e5acec4aeaa52129c65e398f19c88e62ab12de35 matches local d7aa85c tree 3306dc7b734b9a2f632c32f7c5642788c635be60. No backend, persistence schema, model, dependency, workflow or security changes. Project #6 remains ACTIVE.

The pure review parser converts finite decimal/exponent strings without normalizing raw drafts or literal Unicode text. Complete Apply preserves nonoverlap, duration, text and cue limits; selected audition validates only its interval with the unchanged PracticeController. Native media clock marks have no rounding or physical output/input latency compensation. Original model confidence remains a signal, not a timing/word correctness guarantee.

## Verification and first outcomes

- Baseline TypeScript 128/lint/types/build passes. New domain module first fails missing-module import before implementation; all 3 domain cases subsequently pass. Initial numeric parser rejects a valid trailing decimal; an explicit `4.` / exponent-spelling case fails and passes after correcting the finite decimal grammar.
- First browser invocation cannot build while the intentionally absent domain module is imported by tests. After implementing the pure module, the first native case fails on the absent reviewed timing control. Following UI implementation, all 9 then-expanded focused cases pass. Final expanded 12 cases pass, including staged exact playback endpoints, hidden invalid timing/overlap, raw spelling/reopen, keyboard native playhead marks at 390px, held actual play completion retirement, one-step history, save/reload and unchanged recognition. A phone screenshot is inspected for contained stacked fields/buttons.
- Final source TypeScript 131/lint/types/build passes. Local compileall passes. Ruff cannot run locally (`No module named ruff`). Python 3.12.14 is available here instead of documented/CI3.11; no dependency pins are changed to accommodate this environment.
- Full local Python 206 completes 205 pass / 1 fail: `test_subprocess_rss_limit_is_enforced` expects “memory limit” but observes “Media subprocess timed out.” Isolated exact-main and final-candidate runs both pass 1/1. This is intermittent local observation, not a proven root-cause diagnosis. The failed full result is retained, not relabeled as a full pass; production RSS guard and timeout are unchanged. Initial source CI 38921570953 passes the full 206 Python (74.357s), Ruff and compile checks under 3.11,131 TypeScript/lint/types/build and113 browser cases (5.0min); completed job 117042533842 logs are inspected. This hosted result does not erase the local failed observation.
- Initial full local native suite passes 113/113 (5.4min). Final source cf6f210 adds the reviewed native Repeat case; final local full 114/114 passes (5.3min). Final source CI [38922743248](https://github.com/twangyal/projects-monorepo/actions/runs/38922743248) passes 206 Python (81.078s), Ruff/compile, 131 TypeScript/lint/types/build and all 114 browsers (5.3min); completed job117046506626 logs are inspected. Main integration succeeds by matching-head lease from6bd5acb to this exact source; main CI [38923941631](https://github.com/twangyal/projects-monorepo/actions/runs/38923941631) passes 206 Python, 131 TypeScript and all 114 browser cases, Ruff/compile/lint/types/build; completed job 117050567821 logs are inspected. Browser server injects deterministic separated-tone/recognized-word fixtures while exercising real HTTP/storage/WAV/native media and video paths. It does not measure real singing recognition, alignment accuracy, device output latency or intended-user correction effort.

## Independent review

One fresh read-only full-branch review of base 6bd5acb through local d7aa85c finds no Critical or Important issue. Reviewer independently runs domain3/3 and inspects main review, history, native media and timing-session lifecycle. Two Minor recommendations are addressed in local cda8153 / source cf6f210085afa3241cf4164077f8231c4db7be16 (tree d4698befe8c2ceecebc55bcb2f67f1da36d260e2): a native corrected-Repeat test observes the actual initial seek and wrap to 12.125 s, passing1/1; app documentation links this receipt concretely. Final project check remains131/lint/types/build green. No production behavior changes follow review and there is no second review.

Explicit rulings on declined judgments: (1) real-song recognition/alignment and correction effort remain #241, because synthetic fixtures cannot support those product-quality claims; (2) physical latency compensation is absent and disclosed, so manually marked time is not an acoustic-onset measurement; (3) actual phone hardware, other engines and screen readers remain unverified, and a Chromium viewport/label check does not establish them; (4) complete browser/CI readiness is a coordinator gate, not inferred from review; (5) local Python RSS and missing Ruff are retained verification limits requiring hosted full3.11/Ruff results. Incorrect rulings would respectively overclaim model usefulness, precise acoustic timing, accessibility coverage, regression safety or backend protection. No Minor recommendation is silently dropped.

## Integration

Main integrates exact source cf6f210 with a matching-head lease. The canonical checkout fast-forwards cleanly and its tree matches d4698befe8c2ceecebc55bcb2f67f1da36d260e2. Final root-only receipt/direction changes preserve the tested application/workflow/roadmap trees. #271 is complete to this software milestone, with local Python/Ruff limits and unverified real-use measurements retained above.

## Retained local log identities

| Evidence | SHA-256 |
| --- | --- |
| Baseline128 check | `02891a4f7fa6043f2641a2defba8268e70ea7c8a29d79bfa0986ba8f06e5c788` |
| Domain missing-module first failure | `eda146e6ee44ff8d1178d97c96cd1d172b4ca95e5ecbef5376ae5cec39ae6607` |
| Domain3 initial green | `32b62ae3257cec27d21c2e39909d379507636a81263ebbef35d09501aa7fd4ea` |
| Initial browser build setup failure | `6fc9e8176dbec0bff6bc5ad2060a5ee3df57acfce0a44fbcdf753b13a79e295c` |
| Native missing controls RED | `1243ea7664d0b4b6502c67f01f644ba277a076dc596b3be142321439131f13fc` |
| First9 focused native | `6889f9b6e80d6a8c7f017e0cd3e57d81474225f7d0b14334f5f9e3f555d3536b` |
| Trailing decimal RED | `6c8f5ae3da44f256fd2118e17c0019229fb9cef40cafaede9ee82863ec762119` |
| Trailing decimal GREEN | `53ca3af823c2022deac4a6d02ca34e27c6f7fd3544f8c7e345e72ebccd52284c` |
| Expanded12 native | `fd3dbc78d6c4076716c8aa6b9af0bfbfd7ccaf388d0514c48258988d52eab891` |
| Final131 check | `b8085449932b9d4179c94a5265a44793f32d0a53f5f5cbab5f5a028adecbf0ab` |
| Full local Python205 pass / 1 fail | `c5fd133bcab65285e8e49da4a8b197cc5f2fb25823104d3bacdfa879a481c3a6` |
| Exact-main isolated RSS pass | `87d5f11ec6bcb4686bd3ba16b923a5b223e642026e85914b732498d622b1cf11` |
| Unavailable local Ruff | `4b121d715eaef49e82746adcb0a5a04c3ab6c33ac12a2130411416f98ae9cadd` |
| Isolated candidate RSS pass | `87d5f11ec6bcb4686bd3ba16b923a5b223e642026e85914b732498d622b1cf11` |
| Reviewed131 check | `4a993362f31e6bbecc01d49b4fd2102422aa11d3494299ac514c63e757e3ef6c` |
| Native corrected Repeat wrap | `741ffceac6bc773741921eb3360c4bbbf5a7156aeeeaaf628be6c42c819194f9` |
| Initial full113 browser | `21266c33c1c277275d37e213381b1d0714c8d3e26aae498eef710e662275d59a` |
| Final full 114 browser | `47f17e51ee3936ca45b3d059d41c15354fb4cd28821ae0e6a32d881f6e710e6f` |
