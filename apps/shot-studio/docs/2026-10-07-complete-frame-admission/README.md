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
has no actionable correctness/lifecycle findings. Published-head CI is pending.

Both paired full155 realtime candidate artifacts from6e8432d are preserved in
../2026-10-07-realtime-candidate: PR passes all1,800frames, push times out before
finalization after1,670 submissions. Neither realtime nor VP8 is adopted. Their
inconclusive source-copy jobs are retired after retaining first evidence;
original155 acceptance and separate stage timing remain and now trigger on source
and test changes. #128 remains open for a safe throughput repair/further native
backpressure isolation. PhysicalXR and independent VP8 decoder interpretation
remain separate; no hardware completion is claimed.
