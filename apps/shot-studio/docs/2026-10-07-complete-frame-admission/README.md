# Native complete-frame publication admission — 2026-10-07 (#128)

The retained realtime candidate does not reliably repair the155 timeout. Keep
production quality mode/VP9-first selection. Independently, native output coverage
must match the entire authored frame plan before movie publication: bounded
expected/observed integer microsecond timestamp sets (maximum1,800), no retained
packets/samples/frames. Missing, duplicate, unexpected or invalid output refuses;
reordered complete output accepts. Observation does not throw into native output
callbacks. Verification follows native finalization and sibling flush drain;
accounting retires on both success/failure and owned cancellation.

The real-native controlled omission regression first withheld exactly one output
callback at33,333us; the old app still downloaded the incomplete sequence (RED
receipt retained). The guard now refuses the movie, closes every native encoder,
and preserves the exact ordinary local scene and complete saved IDB sequence.
This is controlled admission coverage, not a claim of naturally dropped frames
or real encoder overload. Existing native cancellation/startup/sibling-flush
ownership tests remain unchanged except explicit one-frame authored plans.

Local verification passes357 unit cases, syntax, eight focused native cases and
all111 browser cases in a full3.8-minute run. The unchanged original maximum
captures/downloads in27.392s on software-WebGL Chromium153.0.8010.0; independent
inspection passes actual VP9/Opus, all1,800 decoded video/2,880,648 audio frames,
all40 original color/motion samples, stereo timing/pitch/gain/silence, exact
11,554,385-byte complete archive restart and unrelated scene/take preservation.
This is not a controlled speed benchmark. Original resolution/bitrate/frame plan,
70-second product/95-second download deadline and independent media gates remain.
Packet coverage does not replace independent decoding or prove universal fidelity.

The local raw maximum receipt and source/artifact hashes are retained. Native
result logs omit only HTTP request boilerplate; provenance records original and
saved digests. The omission RED log is unfiltered. Independently reviewed code
has no actionable correctness/lifecycle findings. First published maximum results at771e17b are mixed; raw paired receipts and
artifact provenance are retained here. Both357-unit/syntax jobs pass; PR111native pass and push110pass/1new harness
assertion failure are retained. PR checkoutaef3ef1 has the exact published guard
tree1682685. All13normal portfolio PR workflows pass; push maxima remain failed.

Both paired full155 realtime candidate artifacts from6e8432d are preserved in
../2026-10-07-realtime-candidate: PR passes all1,800frames, push times out before
finalization after1,670 submissions. Neither realtime nor VP8 is adopted. Their
inconclusive source-copy jobs are retired after retaining first evidence;
original155 acceptance and separate stage timing remain and now trigger on source
and test changes. #128 remains open for a safe throughput repair/further native
backpressure isolation. PhysicalXR and independent VP8 decoder interpretation
remain separate; no hardware completion is claimed.

## First published maximum receipts (771e17b)

| Environment / event | Result | Export/download | Evidence |
| --- | --- | --- | --- |
| Configured Chromium153 / PR | Pass |32.964s |1,800 video/2,880,648 audio frames; original gates |
| Configured Chromium153 / push | Product timeout | No movie | Last DOM progress0.999444; alive page/browser |
| Full155 original / PR | Pass |58.854s |1,800 video/2,880,648 audio frames; original gates |
| Full155 diagnostic / PR | Pass |58.415s |56.073s addVideo waits; original gates |
| Full155 original / push | Product timeout | No movie | Last DOM progress0.990556; alive page/browser |
| Full155 diagnostic / push | Product timeout | No movie |1,796 submissions;67.456s addVideo; no finalize;20.7ms cancel |

Every complete archive survives restart with original exact bytes before any
export attempt. All listed capture artifact hashes and restart archive hashes are
independently verified after download. Both original failed jobs remain failed;
a separate diagnostic pass cannot clear them. Failed submission counts are not
decoded frame counts. The standard153 DOM-only timeout cannot locate its exact
last stage. These results neither establish that guard overhead caused the
recurrences nor prove the residual native-wait timeout repaired. No retries.

Next diagnosis should separately observe native WebCodecs dequeue waits and
muxer/writer backpressure with bounded test-only aggregates and restored original
methods/callback behavior. Do not infer CPU attribution from elapsed addVideo
waits. Preserve original acceptance and every first failure. #128 stays open.


## First native harness timing failure and correction

Push run37605499998 fails the new omission assertion after its default5-second
wait while the ordinary four-second shot is still encoding. PR111native passes;
push110native passes/one test fails. The first DOM context/trace and artifact
hash are preserved, and filtered GitHub verification excerpts retain counts.
The trace excerpt is a diagnostic record, without screenshot/resource payloads.
This does not demonstrate wrong publication or a production guard defect.

The corrected admission fixture explicitly authors a legal one-second shot, then
waits12seconds for the refusal, through the existing11-second product deadline.
All no-download/native-closed/exact-saved-authoring assertions remain. Focused
native correction passes locally. Production source, original maximum fixture,
70/95second maximum limits and independent media gates are unchanged.
Corrected-head CI remains pending; no rerun erased the first failed artifact.
