# Bounded native process CPU diagnostic (#128)

The labelled `--stage-timing` variation reads native
`SystemInfo.getProcessInfo` immediately before and after the export observation
window. It records CPU counter deltas only for matching process IDs and types;
lifetime CPU, new/missing processes, regressed counters and zero-only counters
are not silently attributed to export. At most64 process rows per snapshot are
admitted; malformed, duplicate and overflowing counters refuse measurement.
Process IDs are used only to pair observations and are omitted from the receipt.
Protocol admission/read/detach waits have one-second bounds. Late session
creation is detached; repeated finish returns the same memoized result.

[The native protocol](https://chromedevtools.github.io/devtools-protocol/tot/SystemInfo/#type-ProcessInfo)
defines CPU seconds across all threads since process start. The result includes
all work by the observed browser processes, parallel threads and diagnostic
protocol/harness overhead. It is not exclusive encoder CPU, codec output
completion, or time to subtract from overlapping stage timers. Process churn or
unreadable zero-only counters marks coverage incomplete. An all-zero observation
is explicitly unavailable rather than a claim that the export consumed no CPU.

## Failure-first verification

The missing accounting API fails first. The overflow regression independently
fails before validation: finite native counters could become Infinity/null in a
measured JSON receipt. After correction, deltas and their aggregate must remain
finite. Zero-only-counter regressions fail before their explicit exclusions.
The full373-unit suite passes, including eleven diagnostic arithmetic/ownership
cases; source and diagnostic syntax checks pass. Independent review found the overflow and unavailable-churn disclosure edges; both have failure-first regressions and corrections.

The first temporary local browser cannot create a page because its Vulkan ICD
is unavailable. `first-runtime-failure/` retains its context and trace ZIP hash.
Selecting the extracted runtime's owned SwiftShader ICD allows actual native
exports. A second native test then fails the original positive-CPU assertion:
the browser returns all zero counters, even across an independent500ms busy
loop. `first-zero-counter-failure/` retains that context. This is insufficient
CPU availability evidence and must not imply an idle encoder. The native test
now requires either real positive measured counters, or specifically disclosed
zero-only unavailability; generic protocol failures still fail. The real
one-second export submits all30 authored frames and produces a WebM. The literal
local-native-receipt.json retains four zero-only pairs and unavailable CPU.
No environment wrapper, rendering library or browser binary is committed.

The full local native suite passes115 cases. Published normal Shot PR CI passes373 units and115 native cases at `4a5222d040828fb19c2b7acb62cf2ba6c80ecc94` ([run37687493850](https://github.com/twangyal/projects-monorepo/actions/runs/37687493850)). Its one-second native receipt measures6529.999999999998 process CPU ms over1679.121285000001 wall ms, with one zero-only pair excluded (incomplete coverage). This confirms observable counters in full CI Chromium, not codec-only attribution.

First maximum receipts are retained verbatim in `first-ci`, with verified archive/entry hashes. Push run37687485937 fails both unchanged original and separately labelled stage variation at the original95000ms download deadline. The latter measures315390 process CPU ms over95022.619323 wall ms, including285580 GPU-process CPU ms and29480 renderer CPU ms; one zero-only pair makes coverage incomplete. Queue wait67266.4ms overlaps the observation and cannot be subtracted from CPU. The first PR original passes; its stage variation captures successfully but CI is cancelled before independent decode, so that workflow is not declared green. Separate local inspection of both exact PR media copies passes the unchanged gates:1800 video frames and2880648 decoded stereo audio frames each. These independent inspections are retained separately and do not rewrite first CI outcomes. Normal push CI is cancelled; no pass is claimed for it.
Original maximum fixture/media inspection/production settings/deadlines are
unchanged. Issue128 remains open; adding a CPU observation is not a throughput
repair. First CI must preserve both original acceptance and separate diagnostic
results, including failures, before interpreting CPU coverage.

A fresh targeted native invocation on the final helper passes the actual one-second/30-frame export. final-local-native-receipt.json retains the current unavailable receipt with four zero-only pairs, zero churn/invalid pairs and no fabricated CPU delta. The earlier local receipt is retained unchanged.
