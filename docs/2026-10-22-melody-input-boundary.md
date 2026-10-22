# Incoming native zero blocks — #300

## Result

Thirty original selected-track repetitions on canonical source `1bc71780b19c8a522fb355d6c26a18bc4338edbe` pass27/30 in332.889seconds using portable Chromium143.0.7499.0, Node24.19 and one worker. All original assertions remain; three fail the unchanged2Hz microphone frequency window at436/436/435Hz. No startup refusal occurs. Six completed captures contain native zero runs; five have exact incoming-versus-retained interval agreement. The sixth incoming observation misses six edge frames because the observer messages only runs of at least8frames within each128-frame block.

For these synthetic MediaStream observations, incoming input already contains the zero gaps before the collector copies/averages samples and before reference normalization. This localizes the reproduced silence upstream of the collector. It does not establish which source/MediaStream/browser subsystem causes it, whether physical microphones behave this way, or the cause of the original pre-count-in refusal. No production audio fix is justified by these observations alone.

The separate silent-stream control passes11.2seconds, observes1,027zero-block envelopes, retains ordinary no-clear-notes refusal and releases the owned stream. The constructor-installed first listener intercepts diagnostic messages before the unchanged strict production protocol. Computation and messages may change timing; this is an instrumented cohort, not unmodified acceptance.

## Captured interval comparisons

Frames below are relative to each capture's retained start. All native samples are44,100Hz; normalized PCM is22,050Hz.

| Repetition (zero-based) | Native zero intervals | Incoming observed intervals | Original window |
| --- | --- | --- | --- |
| 5 | [8948,9389) | exact | FAIL436Hz |
| 7 | [41212,41653) | [41218,41653), six unobserved edge frames | FAIL436Hz |
| 8 | [100178,100619) | exact | PASS440Hz |
| 11 | [142955,143396) | exact | PASS440Hz |
| 17 | [63319,63760), [78754,85810) | exact | PASS440Hz |
| 22 | [15506,15947) | exact | FAIL435Hz |

Repetition17 includes a7,056-frame (160ms) gap outside the original frequency window and still passes every original flow gate. A passing one-second window therefore does not establish whole-capture quality. Do not erase or move that window, pad samples, reject legitimate musical pauses or weaken the gate to make the cohort pass.

## Reproduction and retained evidence

[The cohort](research/melody-backed-recording/2026-10-22-input-boundary-cohort.json) records all30statuses, original errors, native/PCM hashes and zero summaries, all incoming zero-block messages, merged/clipped relative intervals, native start/end and the full compressed silent-control message list. Four selected comparisons retain complete normalized PCM and exact native zero regions with64neighboring frames on each side: first exactly observed failure, six-frame-edge failure, first passing-with-gap and the longer-gap case. Complete native capture bytes are represented by hashes/summaries; only the declared regions are embedded. [Raw reporter structure](research/melody-backed-recording/2026-10-22-input-boundary-reporter.json) retains first results; configuration paths are omitted and the original complete reporter's hash remains in the cohort.

Apply [the diagnostic patch](research/melody-backed-recording/input_boundary_cohort.patch) on the declared source in an isolated checkout. Copy the existing `original_flow_silent_control.spec.ts` into Melody tests and run that control first. Then run Melody's normal production browser command with `--workers=1 tests/backed-recording.spec.ts -g 'selected-track backing' --repeat-each=30 --reporter=json`. Preserve test-results before subsequent runs clear them. Failure-only finalization retains allowlisted error/notice/capture state if a startup refusal occurs; it did not here. All temporary app instrumentation was removed afterward.

```
python -m unittest discover -s docs/research/melody-backed-recording -p test_input_boundary.py
python docs/research/melody-backed-recording/verify_input_boundary.py
```

The independent standard-library verifier checks bounded gzip/base64, byte hashes, finite native regions, exact zeros, original PCM RMS/frequency outcomes and absolute-to-relative merged/clipped incoming intervals. Seven synthetic interval/metadata/compression tests first fail against stubs, then pass;42existing collector/controller cases also pass. After removing all app instrumentation, the complete448-unit Melody suite passes in6.245seconds. Physical input remains unverified. Issue300 stays OPEN: retain the categorized original startup refusal if it recurs, and compare a bounded independent input source/graph path to distinguish synthetic source transport from collector behavior without substituting that path for original acceptance.

Independent read-only review independently verified all30reporter statuses/durations/errors, all merged/clipped incoming intervals and the four retained PCM/native-region comparisons; no Critical/Important findings. The prior completion-boundary verifier also passes unchanged. A follow-up attempt to inspect pinned upstream Chromium source was unavailable through the connected GitHub fetch (429/network) and official-source web retrieval; no unverified source explanation is adopted.
