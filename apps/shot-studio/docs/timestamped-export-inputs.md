# Timestamped export input contract (#124)

`src/export-timeline.js` supplies the timestamped production exporter. The
separate native candidate passed the first push and PR gates; integrated
production and full-minute acceptance remain pending. Earlier MediaRecorder
failures remain retained as historical evidence.

`planExportFrames(duration)` accepts a finite duration from one microsecond
through 60 seconds. `frameCount` is at most 1,800. `frame(index)` supplies
`time` in original authored seconds and integer `timestamp`/`duration` in
microseconds. Source draw time is index/30. End time rounds to the nearest
microsecond; the last frame is shortened. No frame samples the terminal
endpoint and no browser clock controls source time. A scheduling stall must
delay completion while retaining every input frame and timestamp.

`prepareExportPcm(asset, plan, {signal})` requires the original admitted WAV and
its bound soundtrack plan. It reads exact original bytes under an absolute
ten-second deadline and cancellation. Its frozen result exposes `frameCount`,
`blockCount` and `block(index)`. Every block supplies an integer microsecond
`timestamp`, `numberOfFrames`, `numberOfChannels`, `sampleRate:48000` and a new
planar Float32 `data` array suitable for an AudioData input. Blocks have at most
960 frames (20 ms); the final one is shorter. Mutating a returned array cannot
modify the original or subsequent blocks. The retained input stays bounded by
the existing 12 MiB original WAV limit; no full converted minute is allocated.

PCM16 samples divide by 32768. At each output-frame time, explicit linear
interpolation uses the original sample rate and fractional source phase,
multiplies by authored gain, and excludes source samples outside In/Out.
The last retained source sample clamps interpolation at Out. Leading/trailing
silence covers the entire sequence. PCM covers ceil(duration*48000) frames,
adding less than one sample interval of represented coverage when the source
duration is fractional. Native Opus/WebM padding and millisecond quantization
remain separate output-level acceptance questions.

The unchanged Mediabunny1.61.1 release is now locally served under `vendor`,
with a matching locally verified SHA256, license and unchanged source archive
(including shared source dependencies). The source/release pin and checksum
tests preserve provenance. No runtime CDN or handwritten container is used.

The integration must probe native VP9/VP8 and, for soundtracks, Opus support
before admitting work; copy each genuine draw into its timestamped VideoFrame;
feed planar audio on the same authored origin; close each native frame/sample;
bound queues with backpressure; enforce 32 MiB before retaining output; and
retain abort, absolute deadline and actual encoder/muxer cleanup ownership.
Unsupported devices should keep complete backups and existing rehearsal.
Rehearsal remains on its owned AudioContext; offline export must not start
audible playback or depend on that context's live clock.

Production acceptance must preserve all existing independent temporal/pixel/
audio gates, test a deliberate350ms JavaScript stall without losing a frame,
decode ordinary films, saved silent takes, trimmed/repeated sequences and
soundtracks, exercise native cancellation, and repeat the existing full-minute
maximum plus exact restart/recovery. Preserve first failures instead of
retrying to manufacture acceptance. Original push and PR captures from the
deadline commit are retained in `failures/2026-10-05-deadline-ci/` with decoded
PTS and hashes. Their opening gaps are378ms and355ms respectively; neither is
repaired by the deadline guard or this input module.

## Native pipeline candidate

`src/timestamped-export.js` now implements a separately callable
`exportTimestampedFilm`. It uses the locally verified pinned bundle, probes actual
native codec support, copies each draw into a timestamped VideoFrame, and feeds
original planar PCM through AudioData on the same origin. Awaited source adds
respect Mediabunny's writer/encoder backpressure. Every sample closes, cancellation
drains output ownership, and the absolute deadline guards asynchronous boundaries,
container writes and final Blob publication. A bounded seekable sink handles WebM
metadata patches and refuses any write beyond the configured limit before copy.

The application now uses this pipeline for all three export flows; integrated
native acceptance remains pending.
Native tests independently decode all 60 frames through a deliberate350ms stall,
check original red/blue pixels and authored timestamps, exercise real Opus silence/
tone/tail output and real encoder cancellation. Local Chrome154 executable acquisition
succeeded, but launch is blocked by socket permissions (`process_singleton_posix.cc`,
`socket() failed: Operation not permitted`); these native cases must run in CI.
No acceptance is inferred from executable presence or controlled backend tests.
