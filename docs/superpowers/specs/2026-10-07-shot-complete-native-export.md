# Shot complete native export (#128)

The retained155stage failure spends67.451s in1,794addVideo submissions, reaches
the70sdeadline beforefinalize and drainscancel normally. Original fixture/gates,
960x540,30fps,2.5Mbps and authored timestamps remain fixed.
The isolated VP9 realtime candidate locally passes26.069s/all1800frames; full155
candidate CI is mixed: PR passed, push timed out after1,670 submitted frames.
This does not establish a reliable throughput fix; do not adopt realtime.

Keep the original VP9quality then VP8quality policy. Preserve explicit complete
archives, silent takes, A/V plans, sink cap and owned cancellation/native sibling drain.
Realtime is permitted to drop frames, so every export must account for the full
known authored frame plan before publishing. Record only bounded expected/observed
integer microsecond timestamps (maximum1800); retain no chunks, samples or frames.
Reject missing, duplicate, unexpected or malformed output timestamps after all native
flushes drain. Native output callbacks record refusal instead of throwing into an
encoder callback. Clear accounting on finalization/cancellation; late callbacks retire.
A controlled omission test must show no movie publication and unchanged saved data.

Verification: pure policy tests, all existing units/syntax/native cases, actual original
maximum/restart/decode and pinnedfull155 native gates with all1800frames. Retain first
failures and exact source heads. Do not claim universal visual quality/performance or
close physicalXR. The VP8 default-decoder color discrepancy remains separately open.
