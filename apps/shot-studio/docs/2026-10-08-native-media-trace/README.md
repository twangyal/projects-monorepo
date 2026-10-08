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
are unchanged. First full155 CI outcomes are retained below, including failed diagnostic variations.
Issue128 stays open: tracing is diagnosis, not a demonstrated throughput repair.

To reproduce, prepare the original fixture with
`node scripts/smoke_sequence_soundtrack.mjs --prepare --output NEW_FIXTURES`;
serve this app and run
`node scripts/smoke_sequence_soundtrack.mjs --capture --media-trace --fixtures NEW_FIXTURES --output NEW_CAPTURE --origin http://127.0.0.1:4176`,
then `node scripts/smoke_sequence_soundtrack.mjs --inspect --output NEW_CAPTURE`.
Use a separate capture directory for each original/stage/media variation.

## First full Chromium155 push/PR evidence

At source165efad5e8f5506e161a430e705a40daeaf85e7a, normal Shot
[push37717777898](https://github.com/twangyal/projects-monorepo/actions/runs/37717777898)
and [PR37717782206](https://github.com/twangyal/projects-monorepo/actions/runs/37717782206)
pass387 units, syntax and116 native cases. All13 ordinary portfolio PR
workflows pass on that source. Native event tests therefore pass on the final
collector, including the independent-clock and bounded-cleanup corrections.

The six first compatibility receipts remain verbatim in `first-ci`, alongside
verified artifact ZIP/per-entry hashes and raw browser logs. Artifact transfer
initially returned403 using Python urllib; curl retrieves the same first ZIPs
without any CI rerun or alteration.

| First run | Original maximum | Stage diagnostic | Media diagnostic |
| --- | --- | --- | --- |
| [Push37717777750](https://github.com/twangyal/projects-monorepo/actions/runs/37717777750) | Passed,69.561s | Failed,95000ms download deadline | Failed,95000ms download deadline |
| [PR37717782106](https://github.com/twangyal/projects-monorepo/actions/runs/37717782106) | Passed,43.013s | Passed,43.660s | Passed,44.186s |

Both first workflows have successful job conclusions because diagnostic steps
explicitly allow errors. That conclusion does not override the raw failed push
receipts. The workflow now prints a separate capture/inspection table for every
variation in its job summary; running that summary against these exact six
receipts reproduces the table above (`push-summary.md`/`pr-summary.md`). Missing
or malformed receipts show unavailable, not passed. Known capture-awaiting-decode
and decode-failed states separately disclose capture success and incomplete/failed
inspection; a controlled state check is retained in `controlled-incomplete-summary.md`.
Original gates remain intact.

Independent local reinspection of all four successful exact media files passes
unchanged gates:1800 video frames,2880648 decoded stereo audio frames and original
visual/audio landmarks. Those separate inspection receipts do not rewrite first
CI outcomes. Failed diagnostic captures have no decoded-output acceptance.

PR media tracing observes1800 codec events,10.766s inclusive event wall and5.238s
emitting-thread CPU; separate process counters observe168.06 CPU seconds over
43.769 wall seconds,151.72s in the GPU process. Failed push media tracing
observes1771 codec events,15.183s inclusive wall and8.196s emitting-thread CPU,
with310.23 total process CPU seconds over95.793 wall seconds (282.75 GPU). Selected
event counters have no reported loss; `complete` describes selected trace
counter coverage, not1800 authored frames, successful export, worker-thread CPU
or an exclusive codec/GPU partition. Process coverage is incomplete on both.
These observations do not identify a safe production throughput repair. Issue128
remains open, and original successes do not erase prior or current failures.
