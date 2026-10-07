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

Full native suite and first published CI remain pending at this checkpoint.
Original maximum fixture/media inspection/production settings/deadlines are
unchanged. Issue128 remains open; adding a CPU observation is not a throughput
repair. First CI must preserve both original acceptance and separate diagnostic
results, including failures, before interpreting CPU coverage.
