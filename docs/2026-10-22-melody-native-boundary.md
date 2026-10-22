# Original-flow native completion boundary — #300

## Outcome and limit

The exact selected-track backing test now has observed paired native Float32 completion and normalized PCM evidence. Twenty repetitions preserve every original assertion/tolerance and pass17/20 in4.4minutes; three fail the original2Hz frequency gate with5/4/4Hz errors. Six captures contain native zero runs; three lie inside the measured one-second PCM window. This establishes that normalization is not the first source of every observed silent gap. It does **not** distinguish upstream input silence from collector behavior, explain the original pre-count-in refusal or establish physical microphone quality. Production source and acceptance rules are unchanged.

Source is canonical `9754dbc97b166e2198faee2a2bca1b9960363fdb`, local portable Chromium143.0.7499.0/Node24.19. The original flow retains its initial complete backup, request poll, count-in assertion, real Finish, exact other assets, history/reload and independent MIDI/WAV gates. A constructor-installed passive listener copies actual completed Float32 samples; summaries/bytes are written before the unchanged frequency assertion. This observer and post-capture serialization can alter timing, so these are instrumented observations, not an unmodified all-green gate.

## Reproducible evidence

[Completion observation](research/melody-backed-recording/2026-10-22-original-flow-completion.json) contains all20 native/PCM summaries and hashes. Two comparisons retain full normalized PCM plus native zero regions with64 neighboring frames on each side, in bounded gzip/base64 data:

- Passing window440Hz: native `[3969,4410)` is441zero frames; normalized `[1985,2205)` is220zero frames, immediately before the measured window.
- Failed window435Hz: native `[19774,20215)` is441zero frames; normalized `[9887,10108)` is221zero frames, inside the measured window.

The complete native files are represented by hashes and summaries; only the declared regions are embedded. [Independent verifier](research/melody-backed-recording/verify_original_flow_completion.py) checks bounded decompression, exact retained-byte hashes, all native-region zeros/neighbors, normalized zero intervals and original frequency outcomes. Both pairs reproduce, including the FAILED gate. Run:

```
python docs/research/melody-backed-recording/verify_original_flow_completion.py
```

Apply [the completion-listener patch](research/melody-backed-recording/original_flow_completion.patch) in an isolated checkout of the declared source. From Melody's directory run its normal browser command with `--workers=1 tests/backed-recording.spec.ts -g 'selected-track backing' --repeat-each=20`. Collect artifacts before another Playwright run clears the output. Reverse the diagnostic patch afterward. A local source build is required; no API, paid service or physical input is used.

## Input-boundary controls and non-reproduction

An attempted worklet-console observer failed its silent-input control: Playwright did not expose those console messages. Its empty logs cannot establish absence of zero input. This discarded observation channel must not be used for attribution.

The replacement [input-block patch](research/melody-backed-recording/original_flow_input_blocks.patch) sends zero-block metadata over the real port. The constructor-installed first test listener intercepts only the diagnostic envelope with `stopImmediatePropagation`; the production recorder sees its original messages and unchanged strict protocol. No audio is modified. The [silent control](research/melody-backed-recording/original_flow_silent_control.spec.ts), temporarily copied into app tests after applying the patch, supplies actual silent MediaStream audio, observes native zero-block messages and verifies ordinary no-clear-notes refusal with owned release. Its summary and patch hashes are retained in [the input observation](research/melody-backed-recording/2026-10-22-original-flow-input-blocks.json).

That control passes. The following ten original-flow tone cases also pass all original gates in2.3minutes, but do **not** reproduce a retained native/PCM gap. Only pre-arm input zeros are observed, outside the retained interval. Additional observer computation/messages may alter timing. This cohort does not clear the earlier17/20 result, and cannot attribute its gap to input or collection. The temporary app test/worklet instrumentation was removed; only research patches remain.

## Durable state and next work

Issue300 stays OPEN. The proven boundary is native completion before reference normalization. To distinguish input and collection, reproduce the gap with the validated input observer and compare absolute incoming zero intervals to the captured start/end. Retain any categorized pre-count-in refusal. Do not pad or repair samples, loosen frequency/RMS/frame/deadline gates, ignore silence in the assertion or reject legitimate musical pauses. The original capture can contain waveform defects outside its measured window even when that window passes. Physical input and full capture quality remain unverified; Melody remains ACTIVE and project8 remains skipped.
