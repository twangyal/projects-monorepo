# Isolated VP9 realtime-latency candidate — 2026-10-07 (#128)

The stage-timed155 failure exhausts its deadline in addVideo waits before
finalization. This separately labelled experiment changes only the native encoder
latency mode in an archived served source copy. Production retains quality mode,
VP9-first selection, all existing deadlines and original acceptance gates.

The first local software-WebGL153 candidate captures/exports in26.069s, observing
24.295s addVideo waits. Independent original media inspection passes exact
11,554,385-byte archive restart,1,800 decoded video/2,880,648 decoded audio frames,
all40 original motion/color samples, stereo timing/pitch/gain/silence and unchanged
unrelated original scene/take bytes. Raw receipt and exact patch hashes are retained.
The candidate adds an exact1,800-frame requirement beyond the existing minimum.
It is not a controlled benchmark against earlier concurrent-load quality captures.

Realtime latency mode is permitted to drop frames on overloaded encoders. This
successful fixture does not establish general completeness. A faster capture must
never qualify on its own; production adoption would require bounded complete-frame
accounting and rejection before publication if any planned frame is missing,
duplicated or unexpected, plus real native cancellation/failure verification.
No such production change is included in this experiment.

The separate full155 realtime-candidate CI job uses the same pinned browser,
frozen fixture, bit rate/resolution/frame plan/deadlines/original media inspector,
with source patch provenance and separately named artifacts. It additionally
requires actual VP9 and all1,800 decoded frames. A candidate pass cannot clear an
original maximum failure. First full155 results are mixed at6e8432d. PR run37603173373 passes the original
media gates with all1,800 video/2,880,648 audio frames and46.439s click-to-download;
44.216s is observed in addVideo. Push run37603167624 times out with1,670 completed
video submissions,67.666s addVideo waits, no finalization and15.9ms drained cancel.
The page remains alive, with no page errors/external requests; no movie is published.
Submission counts do not establish decoded frame counts on a failed export.

Both raw receipts/browser logs/source patches are retained here. Artifact IDs,
ZIP digests and byte lengths are in155-artifact-provenance.json; every listed
capture artifact was independently rehashed after download. The candidate fails
to establish reliable throughput repair, so production is not switched to realtime.
The VP8 and realtime source-copy jobs are retired after retaining their first
results; original155 acceptance and separately labelled stage timing remain.
The normal13portfolio PR workflows and both Shot350unit/110native workflows pass
at6e8432d; the separate compatibility workflows fail. #128 stays open.
