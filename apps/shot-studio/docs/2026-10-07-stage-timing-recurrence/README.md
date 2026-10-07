# First stage-timed timeout and codec rejection — 2026-10-07 (#128)

Source head `2cfc610ec3a723fa29d4ef73898c50ef57f2e257`.
[Push37601015386](https://github.com/twangyal/projects-monorepo/actions/runs/37601015386)
fails its original maximum and separately labelled stage variation. Both first
receipts/logs, not reruns, are retained with original artifact hashes/provenance.
The [PR37601022892](https://github.com/twangyal/projects-monorepo/actions/runs/37601022892)
original maximum and stage variation pass. Both isolated VP8-first candidate jobs
fail the unchanged original visual gate. The PR compatibility workflow's overall
success includes a diagnostic-only failed candidate job; it does not mean the
candidate passed. All thirteen normal portfolio PR workflows and both standard
Shot workflows pass350 units/110 native cases at this source head.

## Stage-timed failure

Full Chromium155.0.8059.12 retains the exact11,554,385-byte archive across complete
browser restart, then the app reports its70-second timeout before the original
95-second download waiter expires. The page is open/visible and browser connected.
No page errors or external requests are recorded. No movie was published, so no
independent decode or encoded-frame-count claim applies to this failed attempt.

| Observed operation | Calls/completions | Total elapsed |
| --- | ---: | ---: |
| Video sample / addVideo | 1,794 / 1,794 each | 0.304s / 67.451s |
| Audio sample / addAudio | 2,989 / 2,989 each | 0.104s / 0.305s |
| Finalize | 0 / 0 | 0 |
| Cancel | 1 / 1 | 0.0263s |
| All renderer draws during the observation window | 3,290 / 3,290 | 1.705s |

Six of the planned1,800 video samples were never constructed. Completed native
addVideo promises are submission/backpressure observations, not decoded output
frames. Rendered progress stops at59.7667 authored seconds. After timeout, normal
UI redraws continue until the95-second waiter fails, explaining why draw count
exceeds sample count; draw timing is not export-only or GPU attribution.

This attempt exhausts the product deadline during frame submission, before
finalization/publication. AddVideo elapsed waits dominate and cancellation drains
normally. It is not a browser crash, a stalled finalization, or a download-only
failure after a completed movie. The pinned library includes native dequeue and
muxer/writer backpressure within addVideo; these counters do not separate them or
establish additive CPU time. A safe throughput repair remains unimplemented;
passing attempts and candidate experiments do not close #128.

## VP8-first candidate rejection

Both full155 candidates capture movies near69 seconds (push69.162s/PR69.134s;
addVideo66.442s/66.446s), then reject `Torso control clip2 0/27 points` under the
unchanged original inspector. Their isolated patch provenance confirms only
codec order changed; production remains VP9-first. No clear portable throughput
benefit or original acceptance is established.

Separate local153 decoder observations identify a concrete interpretation
difference in the retained VP8 movie: stream metadata declaresBT709, while FFmpeg
frame202 reportsBT470BG. Default decoding gives control RGB `[14,197,6]`; explicitly
interpreting the declaredBT709 matrix gives `[0,168,0]` versus expected `[0,169,0]`.
Actual native153 WebCodecs decoding at6.733s reportsBT709 and canvas pixel
`[1,169,1]`. That native check covers one fixed point, not every frame. An attempted
HTMLVideoElement seek returns time0, so that result is inconclusive and retained.

A separate local explicit-matrix diagnostic passes all original numeric/media
gates, including all40 motion/color samples and the1,800video/2,880,648audio-frame
gates. Only its RGB decoding interpretation changed, recorded by source hashes
and exact patch; thresholds, pixels and original failed receipt remain untouched.
This supports a decoder interpretation discrepancy in that local movie, not
universal VP8 compatibility or a new original acceptance. No production or frozen
inspector change is included. Verify native/full155 decoder behavior independently
before treating the alternative as usable.

All raw receipts/logs, original ZIP digests, archive/movie artifact hashes and
separate local observations remain durable here. Large CI movies/archives remain
one-day artifacts; text evidence retains their exact hashes. No retry, increased
timeout, dropped-frame acceptance or widened visual threshold is claimed.
