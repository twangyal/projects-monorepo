# Bounded native media tracing (#128)

`--media-trace` is a separate diagnostic variation of the unchanged maximum
soundtrack probe. It observes native `media` events with a 4MiB record-until-full
buffer, a 100,000-event collector cap, and one-second protocol admission,
completion and disposal bounds. Only fixed allowlisted complete event aggregates
survive collection. Raw event arguments, URLs, IDs, timestamps and media are
never retained. The receipt discloses missing/invalid thread counters, unsupported
phases, buffer fullness/loss and event-cap truncation. No observed selected event
or overflow yields unavailable, rather than a fabricated measurement.

`vpx_codec_encode` includes only the emitting thread's reported CPU duration;
codec workers are outside that counter. Named event durations can overlap.
Native wall and thread clocks are retained independently and are not an additive
CPU budget. Whole-process CPU observations remain separate. The native event
name `VideoEncoder::Ouput` preserves Chromium's observed spelling. GPU event
names are allowlisted for parsing, but recording enables only media to avoid
high-volume general GPU activity. This is not an exclusive codec/GPU partition.
[CDP Tracing](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/)
defines recording and completion; native events are empirical browser evidence.

## Verification and retained first outcomes

The missing API failed first. Review then identified a stalled start that left
its owned session/listeners retained. A failure-first regression reproduces it;
retirement now disposes the known session even when start never settles. The
idempotent disposal guard also prevents a late start from ending another trace.
A real native positive thread duration exceeded its wall duration slightly;
rejecting that cross-clock relationship also failed a literal regression before
its correction. Both red outputs are retained. Fourteen deterministic collector
and protocol tests cover arithmetic, sanitization, overflow, bounds, unavailable
counters, refusal, late admission/start settlement, completion/end/detach stalls,
invalid batches, fullness, and repeated finish. The full387-unit suite and syntax
checks pass. Independent review reports no remaining important finding.

The full native suite passes116 cases before the final lifecycle/clock
corrections. A fresh targeted final-source native export passes30 authored
frames, with its literal sanitized receipt retained separately. The first local
maximum passes unchanged capture and independent media inspection:1800 video
frames and2880648 decoded stereo audio frames. Its media trace records1800
`vpx_codec_encode` events,7578.963ms inclusive wall and5429.78ms emitting-thread
CPU, with no selected counter loss. Zero-only process CPU counters in this
stripped Chromium153 environment are explicitly unavailable. This is not
Chromium155 acceptance evidence. A one-second targeted native export overlapped
that local maximum; the throughput is not a controlled benchmark. Provenance
retains exact media hashes and raw first receipts/logs; no generated media or
browser binary is committed.

The compatibility workflow preserves the original acceptance and existing stage
variation, then runs a separately labelled media variation with its own artifact.
Production export settings, original fixture, media gates and95000ms deadline
are unchanged. First full155 CI outcomes remain pending at this checkpoint.
Issue128 stays open: tracing is diagnosis, not a demonstrated throughput repair.

To reproduce, prepare the original fixture with
`node scripts/smoke_sequence_soundtrack.mjs --prepare --output NEW_FIXTURES`;
serve this app and run
`node scripts/smoke_sequence_soundtrack.mjs --capture --media-trace --fixtures NEW_FIXTURES --output NEW_CAPTURE --origin http://127.0.0.1:4176`,
then `node scripts/smoke_sequence_soundtrack.mjs --inspect --output NEW_CAPTURE`.
Use a separate capture directory for each original/stage/media variation.
