# Karaoke whole-clip timing shift — #272

## Delivered behavior

A collapsed cue-editor utility moves every current cue by an explicit signed number of seconds. Positive is later, negative earlier. A detached proposal validates the complete original graph, finite nonzero decimal/exponent offset and complete result. It preserves literal Unicode text, order, lengths and instrumental gaps without clipping or rounding. Blank/invalid offsets, invalid cue text/timing, out-of-clip results and unrepresentably small no-ops refuse before mutation, history or owner retirement. Raw utility input stays editable.

Successful shift retires practice/import review/timing capture/timeline gestures before mutation, captures exact prior numeric spellings and records one unsaved Undo/Redo edit. Title and unapplied pasted words remain; Save and current SRT/video export stay separate. Utility offset resets only after successful opening of another clip. No backend, schema, model, dependency, workflow or security change. IEEE floating-point precision still applies to numeric seconds; this is not an acoustic latency estimate or automatic alignment.

## Selection and source

After closing271, fresh main/open work is checked. Main1774473c502ede02f5ddabe35ca214f1d05c2597 is clean with206 Python/131 TypeScript/114 browser hosted gates. No matching implementation issue exists;272 is created before implementation. This coherent continuation addresses a practical correction gap for consistently early/late recognized, imported and manually timed lyrics, without claiming measured real-user gains. Owner focus includes Karaoke. #241 remains open for real-song/effort evaluation; #8 remains skipped, Shot/Composure deferred.

Initial source5a303f9f1fa3013715aa7ebbf68b48a75f095c9b matches local 9817ffbc1f3ce9270d3448bc19ad7fb1bf78c435 tree 4a1f1db3b50fcd29f4e157478e087dabe60173bb. Baseline131 TypeScript/lint/types/build passes. Final 134 TypeScript/lint/types/build and 7 focused native cue-editor cases pass. At that checkpoint, full 117 native and source/main gates were pending; final gates are recorded below.

## Retained first failures and verification boundaries

Three unit cases first fail because shiftCues is absent, then pass with literal hand-derived positive/negative/end-boundary results, source immutability and refusal cases. First native case fails on absent Shift UI, then passes complete numeric/text/history/Save/SRT behavior. First expanded native completes6 pass/1 fail: fixture starts practice before selecting an SRT; the existing capture-phase file-selection policy correctly stops practice. The fixture now establishes the pending import before starting practice and explicitly checks both preconditions. All7 pass without production policy, deadline or expectation relaxation.

Native cases exercise exact pre-shift numeric spelling, one-step Undo/Redo, literal words/title/paste, saved/reloaded SRT times, failed-offset retention of native repeat and pending SRT review, successful owner retirement,390px keyboard use, invalid title retention and incomplete time refusal without consuming Redo. Browser fixtures replace model inference with deterministic stems/recognized words but use actual HTTP/storage/WAV/media/video. They do not establish singing quality, alignment accuracy, physical device latency or user correction effort.

No fresh local Python backend run is repeated for this frontend-only diff. The unchanged backend's preceding271 full local Python 205/206 has an RSS-vs-timeout failure, isolated base/candidate 1/1 pass, local Ruff unavailable and Python 3.12.14 rather than documented/hosted3.11. These are retained in [271's receipt](2026-10-16-karaoke-review-timing-integration.md); hosted full206/Ruff must pass for272. No local full-Python success is claimed.

## Review and final integration

One fresh read-only whole-branch review finds one Important precision defect, no Critical or separate Minor: shifting [0,1],[2,3] by1e-20 moves only the zero start because later endpoints cannot represent the offset. Domain RED reports a missing expected refusal, and native RED observes altered main fields rather than the unchanged snapshot. The guard now refuses if any boundary remains unchanged. Unchanged 134 TypeScript/lint/types/build and all 7 focused native cases pass (21.1s), including preservation of native playback, pending SRT review and history after the tiny-shift refusal. No second review.

Reviewed local 6191e941dcfdf97dcc931a2606cace205ce67044 / source 0d585d133cdbb29c75b0b38e7537e6f8b39ed97e has tree 1f03adc2857482618b349081e48079ab345b392e. Final local full 117/117 passes (5.8min) on that frozen source; source CI [38926438662](https://github.com/twangyal/projects-monorepo/actions/runs/38926438662) passes 206 Python (72.233s), 134 TypeScript and 117 browser cases (5.2min), Ruff/compile/lint/types/build. Completed job 117059329065 logs are inspected. Main advances1774473→0d585d1 by matching-head lease; main CI [38927703765](https://github.com/twangyal/projects-monorepo/actions/runs/38927703765) passes 206 Python, 134 TypeScript and 117 native browser cases plus Ruff/compile/lint/types/build. Completed job 117063382222 logs are inspected. The earlier local full run overlapped review-time builds serving the same dist directory and is diagnostic only, not exact-source acceptance; its outcome is retained separately. Initial source CI 38925978251 is cancelled by the review-fix branch update, not reported as a pass. The earlier local diagnostic full run completes 117/117 (5.7min) across overlapping builds and is not exact-source acceptance. Neither substitutes for final gates.

Rulings on declined judgments: ordinary IEEE rounding is disclosed and is distinct from the fixed partial no-op; finite exponent notation is deliberate; title validity remains independent and raw title preservation is tested; snapshot deduplication plus one-step native Undo covers the two history record calls; invalid/valid native cases cover pre-mutation owner retirement; source inspection establishes reset after successful different-ID admission, without claiming untested physical transitions; native details/labels and 390px tests establish software containment/activation only. Real mobile minus-key/IME availability and other device/assistive-technology behavior remain unverified. The prior local backend/Ruff limitations are retained and hosted206/Ruff are required. Incorrect acceptance would respectively overclaim numerical exactness, redefine supported input, lose user drafts/history/owners, clear utility state on a failed open, or claim unmeasured accessibility/backend protection. No declined behavior is silently dropped.

Exact-source main integration and final completed-log gates are complete. Canonical main fast-forwards cleanly to reviewed source 0d585d1, matching tree 1f03adc2857482618b349081e48079ab345b392e. Final root-only evidence/direction publication preserves the tested app/workflow/roadmap trees. #272 is complete to this software milestone. Karaoke remains ACTIVE; real-song quality/effort and device acceptance remain unverified.

## Retained log identities

| Evidence | SHA-256 |
| --- | --- |
| Baseline131 check | `ed76446a410dc12acedba3097e76d3544d4bbaaa795aab917bbd3f19be66346b` |
| Missing shift function RED | `cd6f1d4d48f64d6ea9d6d30b89a6c8922f7834bfd0323c3c02f367c92cc9d3b8` |
| Cue-edit domain GREEN | `87a6dc1abfd6cf1544df974041be484c7a751372b29531e706a93eacf0769b59` |
| Missing native shift UI RED | `d1b9ed865d4cf39c3a0d2547b670bf731a99d943cd756991188762709b877ed7` |
| First6 pass/1 fixture fail | `9b12f6f92142062e320eceb440ffe2baa45aaff637c413393cb7d3b4fd3811d2` |
| Final 134 check | `ac58a11a3782ae3a9dce5b7901f13aa797f441c0ffce544ee51af1e7759f8213` |
| Final7 focused native | `9cbbe69bec97a329182c17d51a7fdeccbc9d2965ad1accea6da24ace8414f496` |
| Precision refusal domain RED | `1bb96e9b0235f94c946ac11d5ee5a6aecd712f5a2517f2cbca98966b93ebe931` |
| Precision refusal native RED | `5282644d99a9cd228995c89f0d8349cd0425a4e94957329b44d52506544e35a8` |
| Reviewed134 check | `503c68c565bdfea14b4e866055a57d7988b7c6a08e3a61792d86de70e16e1882` |
| Reviewed7 focused native | `6f31835b4a711a43cc42e5be13612c5553a9b431550842a69df2293dbf2b2e92` |
| Initial overlapping-build117 diagnostic | `fdd23e0618a21dc3c76b5d718664712abd23c8c7f6b7781f03e825889a0482b0` |
| Final reviewed full 117 browser | `df048ce0e2d60e9d0d83189e112efecb84a490b3aed9129e9b46c4cacfc5a09c` |
