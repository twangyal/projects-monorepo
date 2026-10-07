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
original maximum failure. First full155 results remain pending; #128 stays open.
