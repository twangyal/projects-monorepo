# Gaze: exact native slider commands — #283

## Intended outcome and implementation

The extension should let a person adjust real website controls by gaze context and instruction. Native range inputs were discoverable but activation only focused them; text editing does not implement their numeric semantics. This milestone adds explicit `set [name] slider to <number>` / `set slider to <number>` and `undo [name] slider` / `undo slider` through the existing shared extension/page interpreter and controller.

The word slider makes the target/action unambiguous relative to ordinary text and option commands. Signed decimal numbers are preserved from the raw instruction; percentages and spoken number words are refused rather than converted. Named ties and multiple gazed sliders use existing numbered clarification; Cancel, Pause and a newer instruction retire pending intent. An unknown/invalid slider command does not become a guessed model action or text write.

Only actual native `input[type=range]` is supported. A detached native clone validates exact numeric survival and validity, including default/entered min/max/step and `step=any`, before any live focus or edit event. Values that the browser would clamp or snap refuse. Current native type, connection, native/ARIA read-only or disabled state and inert/ARIA ancestors across open shadow roots and same-origin frame chains are checked. Focus handlers changing value/limits/default step base, replacing/locking the element or redirecting focus refuse before native writes/events.

Successful changes invoke the native value setter and ordinary bubbling input/change events. Website handlers remain free to react; if the observed value differs from the request, feedback reports the website's value instead of success. The per-element slider history retains up to20 changed prior values, independent from text history. No-op/refused/locked/invalid-old-value Undo does not consume it. It is session-only and does not migrate to a replacement element. The navigator does not claim atomic rollback of arbitrary website event effects.

No permission/model/provider changes, PR or physical input acceptance are introduced. Custom ARIA widgets, broad framework behavior, real speech/camera quality and intended-user task completion remain unverified. Gaze remains ACTIVE against the extension-first destination.

## Verification history

- Parser tests first fail on actual missing behavior (`unknown` instead of `range`, and `unknown` instead of slider clarification); they pass after implementation.
- Actual native browser behavior first fails at expected performed `range` versus undefined before implementing execution. Then all24 initial focused cases pass across desktop/narrow/short/compact-boundary;32 pass after adding actual shared-overlay typed discovery/set/Undo and invalid-old-value recovery. Final coverage adds website override/recovery and successful nested shadow/frame operations before lock refusal.
- Initial local command setup failed at a root-level npm invocation (app has its own package.json), missing Gaze dependency path and missing unpacked portable Chromium. Corrected app-prefix commands, the existing matching Playwright1.63 dependencies and package-owned browser extraction before exercising assertions. These are setup failures, not product passes. No network or browser-security setting was weakened.
- Full local Node suite passes186 tests; syntax/build and packaged extension build pass. Local focused native browser gate passes all44 cases across four viewports after the review repairs below. Source review and actual browser reproductions are recorded below. Corrected complete source Chromium acceptance is recorded below; canonical-main remains pending until its literal results are available; do not infer physical speech/gaze or all-browser acceptance from synthetic/native DOM checks.

## Review-driven repairs

Independent review found two important real integration defects after the first source launch. A native keyboard range gesture in an open shadow root produces composed input (visible to document/component hosts) and non-composed change. The first generated input was non-composed, so host listeners missed it. Separately, a site event replacing the range with a fresh value50 left the detached original at70; the first executor incorrectly reported success from that detached value.

Both actual browser assertions failed before repair: native/synthetic propagation arrays differed, and replacement expected error but received success. [Original failing console log](2026-10-17-gaze-native-sliders-review-red.txt) retains the failures. The repair sets input composed:true while preserving native change semantics, rechecks current native availability after input before emitting change and again after change, and reports a retired control instead of success. The new replacement receives no inherited Undo. The complete focused gate now passes44 cases across desktop/narrow/short/compact-boundary, including these unchanged regressions. Original source `28306935186451ac053110cd921cbfc73dd25428` launched CI39057509461 before these repairs; its result does not establish the newly covered behavior.

## Complete CI coverage and wall time (#284)

Gaze now has368 browser cases including the injected-extension slider flow. To shorten the serialized full gate without changing test behavior, the hosted workflow uses three Playwright shards on isolated runners, each retaining one worker. Every runner still performs the original install, all186 units, syntax and extension build; all four browser projects remain, with no retries, skips, filters or deadline changes. Matrix fail-fast:false preserves all shard outcomes. Literal per-shard counts must sum to368 before acceptance; no measured speedup is claimed until full receipts exist. This avoids running concurrent extension fixture builds inside one shared workspace.

## Acceptance receipts

[Corrected source CI39057945653](https://github.com/twangyal/projects-monorepo/actions/runs/39057945653) passes at `6675ca2f7ecbb203c1110a4bcd747a9e4bd2bc0b`. Each runner passes all186 Node tests, syntax and extension build. Browser shards pass132/133/103 cases: all368 collected cases exactly once, including56 full-Chromium extension cases and the new strict-CSP slider flow. Independent source/repair/workflow re-review has no remaining important/critical findings. App subtree `0eada41ad5b82e472fff42283f4cdd158c9e5b9f` is the reviewed and source-verified implementation.

| Source shard | Job | Browser result | Browser wall |
| --- | --- | ---: | ---: |
| 1/3 | 117469708069 | 132 pass | 4.4m |
| 2/3 | 117469708229 | 133 pass | 2.7m |
| 3/3 | 117469708175 | 103 pass | 2.4m |

Job1 ran18:24:36–18:29:40UTC; job2/3 ran18:24:32–18:27:47/18:27:31UTC. These are observed public-runner costs, not a controlled performance guarantee. Original serial source39057509461 passes186/356 and8.7m browser time; it omits later review cases and is not acceptance of the repairs. Corrected serial source39057731821 is retained separately; the complete matrix uses its unchanged app/test subtree. No retries, skips, filters or deadlines were changed.

Local acceptance: all186 Node tests and syntax/extension build pass; all44 focused native cases pass in12.3s. The broader portable-browser run passes all312 page-runtime cases in4.3m, including those44, with extension.spec.js deliberately excluded because that shell cannot establish extension acceptance. The hosted gate supplies all56 extension cases. No local full-extension claim is made.

Canonical-main full matrix acceptance is pending. The shared runtime is used by the extension build; new focused tests also exercise the actual page overlay using typed commands. Native DOM test cases cover exact defaults/decimals/ranges/steps/events, per-element Undo, no-op and refusal preservation, stale detached/changed-type targets, ambiguity/cancel/pause, custom widget refusal, native/ARIA/inert/shadow/frame ancestor locks, focus-handler races and site-event overrides. Physical input validation remains separately tracked in #132.
