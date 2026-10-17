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
- Full local Node suite passes186 tests; syntax/build and packaged extension build pass. Local focused native browser gate and independent review are recorded below when finished. Source and canonical-main full Chromium gates remain pending until literal results are available; do not infer physical speech/gaze or all-browser acceptance from synthetic/native DOM checks.

## Acceptance receipts

Pending final source/main CI and review. The shared runtime is used by the extension build; new focused tests also exercise the actual page overlay using typed commands. Native DOM test cases cover exact defaults/decimals/ranges/steps/events, per-element Undo, no-op and refusal preservation, stale detached/changed-type targets, ambiguity/cancel/pause, custom widget refusal, native/ARIA/inert/shadow/frame ancestor locks, focus-handler races and site-event overrides. Physical input validation remains separately tracked in #132.
