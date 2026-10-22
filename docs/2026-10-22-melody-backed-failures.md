# Backed-recording failure evidence — #300

## Purpose and current boundary

A user should learn why a backed recording refused while retaining their complete prior take. During #299 acceptance, all worklet/frame errors converged to one static exception and the recorder discarded the worklet message. This prevented distinguishing invalid samples, a channel change, lost input, discontinuous graph frames, an invalid recording interval or an invalid native command. The diagnostic change carries only one of six allowlisted reason strings; recorder feedback is locally authored static text. Unknown/extra-field envelopes stay generic. No exception text, audio samples or arbitrary native payload is forwarded as guidance.

The collector keeps exactly the same admission and mutation rules: pre-arm forward gaps may precede scheduling, but armed count-in/capture must be contiguous. Bounds, finite-sample validation, channel identity, exact retained interval, native setup/capture deadlines, cancellation and resource draining remain. There is no retry, padding, rescheduling, relaxed threshold or automatic admission after failure. Diagnostics do **not** fix or explain the original intermittent refusal; #300 remains open.

## Retained evidence

Canonical #299 source `e7145eaea86a67766532631a906bf39f9b26d5a4`, run39670574675/job119467059566 first passes436units/lint/types/build and252/253browser cases. Original artifact12380460611 SHA256`4528e33837e6cc33758eec4b16ba32c35245a204c064038310e3cf59f587c610` was independently hash-verified before trace inspection. All five sources were scheduled, then capture refused and stopped the synthetic microphone before count-in. Generic inactive “Finding the notes…” text was the failed assertion's observed value, not an established cause. The trace cannot distinguish which old combined validation refused.

An unchanged local Chromium143 replay passes2/3; its other case reaches capture but fails the original frequency gate (5Hz versus the2Hz limit). A temporary diagnostic replay passes9/10 with the same frequency failure and no startup refusal; instrumentation was removed. No frequency tolerance changed. One unchanged full canonical rerun, job119578652077, passes436units and all253browser cases in4.0minutes with lint/types/build. That closes chord milestone299, not the recording investigation. See [the chord receipt](2026-10-21-melody-chord-construction.md).

## Development checks

Before implementation, seven new collector/controller expectations fail for missing reason preservation and generic feedback; all35existing focused cases pass. The42focused cases pass after implementation. Four actual-worklet reason expectations then fail against the old worklet protocol; this confirms the native boundary requires the change. The new worklet passes these same four cases in the full local run. Full local model/lint/type/build passes448unit cases.

Final browser, independent review and canonical verification are recorded below as they finish. No unrun check is claimed. Physical microphones, arbitrary browser/device reliability and real singing remain unverified. Melody stays ACTIVE toward the full DAW destination; project8 stays skipped and owner-DEFERRED projects remain untouched.

A deterministic temporary admission-equivalence audit compares the original and diagnostic collectors across200sessions/8,000push/arm/finish/cancel operations, including invalid samples, channel changes and frame offsets. Returned samples, refusal/admission and retained channel/cursor/terminal state match exactly (initial seed300, final seed3237721889). This supports the unchanged-admission boundary; it does not reproduce or explain native scheduling failures. Read-only review finds no Critical/Important findings and independently passes42focused cases. The new editor regression uses an actual disconnected MediaStreamAudioSourceNode, without injecting an error message.

A [compact original trace extraction](2026-10-22-melody-backed-startup-evidence.json) preserves the first failed native probe, five schedule summaries, original artifact/trace hashes and interpretation limits in git without raw audio or transient download URLs.

## Local acceptance of diagnostic step

The full local Chromium143 invocation passes all254collected cases in6.5minutes, including the original selected-track recording and all ten actual-worklet cases. Collection preceded the additional editor regression. That editor case then fails against the old recorder's generic notice and passes against the new recorder in3.0seconds (8.4seconds including server setup): disconnecting the real microphone graph produces missing-input guidance, releases owned capture, keeps exact complete backup and IndexedDB PCM, performs no automatic retry and preserves actual prior/current complete-document Undo/Redo. This is staged passing coverage of255distinct cases, not one local255-case invocation. Final lint and type checks pass after the new case; its production build also succeeds. The full model/check gate passes448units plus lint/types/build.

Read-only review approves the collector/protocol and incremental real-history/artifact checks without Critical/Important findings. Capture JSON/PCM are now written before the original numerical oracle, so future frequency failures retain the measured signal without changing any assertion or tolerance. Canonical source/full-suite verification is pending. The intermittent startup refusal and synthetic-stream frequency instability are **not fixed or accepted** by this diagnostic milestone.
