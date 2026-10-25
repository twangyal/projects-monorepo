# Terminal clock diagnostic — #300

Outcome: identify the exact continuity guard and native frame/arm boundary when the existing refusal recurs, preserving the old take. Existing traces lack this metadata. Chosen approach: temporary terminal-only collector/worklet patch plus original controller observer; repeated output-route/warmup sweeps do not distinguish these branches, while shipping telemetry would prematurely expand production protocol. No audio scanning or sample export, graph rerouting, clock warming, altered acceptance bounds, dependency or workflow changes.

Protocol fixed before collection:10 fresh-page repetitions of the exact original Stop/pagehide case (20 startup sessions if all reach the second begin); normal five-source route, one worker, no retries. Begin original backing, await elapsed>.2seconds under the existing5-second assertion, stop audio, verify release and complete backup equality, then repeat startup with controlled pagehide/pageshow and verify the same. Two separate invalid-command native protocol controls at44100/48000Hz prove receipt/error ordering. Retain every receipt/error before assertions. A terminal-only receipt captures guard site, previous end/incoming start/length, planned start/limit, captured count, processor ready/armed and currentFrame/sampleRate before cancellation clears state. Observe bounded ready/arm/ack/source-start/context state ordering, without changing original messages. Any failure remains a failed case. Observer receipt delivery changes scheduling; no small-cohort or physical-input causality claim.

Restore shipping source after collection; archive exact patch, probe, model receipt controls, runtime/source hashes, all receipts and replay. No recurrence still leaves#300open. Next product work follows only after this coherent investigation is durable.

## Observed result

The fixed run completes12/12browser assertions in1.2minutes:10original Stop/pagehide cases and2protocol controls. This is **not20successful recording starts**. Independent replay finds20arm/ack and20five-source schedules,19observed recording-phase transitions, and1native refusal. Row1's second session reaches ready/arm/ack/all5source starts, then refuses at the clock-continuity guard during count-in: previousEnd139008, incomingStart/currentFrame138880, incomingLength128, plannedStart181374, captured0. The incoming start is128frames behind the previous end. The prior block start/length and PCM were not captured; this is consistent with an overlapping/repeated quantum but does not prove an identical payload or a particular browser/source defect.

The refusal occurs before the planned recording start and before the test's later pagehide cancellation. The original fixture's elapsed function follows the scheduled backing buffer's AudioContext clock, and continues to advance after recording retires. Thus its `awaitElapsed(.2)` can pass despite this count-in refusal; exact old-project equality and released streams still pass. Preserve both facts: the browser assertions pass and one native session refuses. The observer did not loosen those assertions or turn the refused attempt into a successful recording. No samples were admitted by the refused collector.

Both native invalid-command controls retain ready/armedtrue, the correct native sample rate, a null continuity receipt, then the original unchanged error message, with no PCM and closed graph. Four collector controls first fail because the receipt API is absent, then pass with the temporary patch; the original478units plus4controls pass482/482. Eight independent replay/corruption tests pass; their initial missing-verifier import is the recorded RED. Shipping source is restored to exact manifest hashes; final restored unit/lint/types/build and focused native results are recorded below after observation.

This distinguishes a reproduced armed pre-start clock overlap from downstream normalization and from the separate retained#323trace that never recognized a backing start. It does not prove the historical uninstrumented failures had this exact boundary, establish incidence, show a reliable production fix, or evaluate physical microphone quality. Observer port messages/prototype wrappers can change scheduling; only this bounded synthetic portable-Chromium143cohort was observed. Context events describe the recorder/source-start graph contexts reached by the observer, not a complete source-stream context lifecycle trace. #300 remainsOPEN; do not pad, ignore or reschedule discontinuous input to manufacture success.

## Reproduction and replay

`manifest.json` pins baseline commit/tree, original source hashes, exact temporary patch/probe/observer/model controls, runtime and every receipt. `replay.json` is independently computed metadata only. `native-run.log.gz` retains the original complete browser runner log; it is not a claim that the physical recording experience passes.

From an isolated checkout of manifest.sourceCommit, with locked Melody dependencies and Chromium installed:

```sh
git apply docs/research/melody-backed-recording/terminal-clock/observer.patch
cp docs/research/melody-backed-recording/terminal-clock/model-probe.test.ts apps/melody-studio/tests/terminal300-model.test.ts
cp docs/research/melody-backed-recording/terminal-clock/observer.ts apps/melody-studio/tests/terminal300-observer.ts
cp docs/research/melody-backed-recording/terminal-clock/probe.spec.ts apps/melody-studio/tests/terminal300-probe.spec.ts
node --experimental-strip-types --test apps/melody-studio/tests/terminal300-model.test.ts
CHROMIUM_PATH=/path/to/chromium MELODY_TEST_PORT=4196 npm --prefix apps/melody-studio run test:browser -- terminal300-probe.spec.ts --workers=1 --output=/tmp/terminal300-cohort
```

Keep every native output before cleanup. Reverse only this exact owned patch with `git apply -R` and remove the three temporary copied tests after checking for conflicting edits. Do not change shipping protocol or commit those temporary app files. Replay the retained cohort without any browser:

```sh
python docs/research/melody-backed-recording/terminal-clock/verify_terminal_clock.py
python -m unittest discover -s docs/research/melody-backed-recording/terminal-clock -p 'test_*.py'
```

This verifier is for the fixed retained cohort, with strict metadata/hash checks; it is not an acceptance policy for arbitrary future runs or a substitute for the unchanged original gates. No new cohort, retry, observer-overhead control or physical measurement is claimed beyond the fixed run above.

## Restored-source verification and review

Restored shipping source passes478/478unit tests, ESLint, TypeScript and production build; all20focused original backed-recording/actual-worklet browser tests pass48.6s. Those later passes do not erase the instrumented cohort refusal or establish physical quality; a fresh full270-browser run was not performed for this docs-only artifact.

Fresh read-only review independently replays all receipts/hashes and all8corruption tests, checks the original predicates/protocol and exact app restoration, and reports no Critical/Important/Minor findings. No fix pass is needed. Review boundaries retained: physical quality/historical identity/incidence/root cause/fix efficacy are unverified; this fixed retained-cohort verifier is not arbitrary future-run acceptance; the reviewer did not run browsers or independently rerun app validation; this final verification text is the executor's observed record. No PR or shipping change is authorized by the review. #300 staysopen.
