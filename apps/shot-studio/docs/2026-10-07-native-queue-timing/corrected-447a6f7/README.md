# First corrected native queue timing receipts — 2026-10-07

Source447a6f708ec513a79ba60a0d3ab14413356a9e94 has tree
5ca77d9e8ff6830a0a80daef9459a804aa154b76. Actual PR checkout
341221610ba15f8a3fc05aa9995ca77bae38e813 has that same tree.
The native listener-order regression observes the owned probe before the
unchanged exporter continuation; prior invalid attribution remains preserved
in ../first-fc819bd. Production settings and original acceptance gates are unchanged.

Both first standard runs pass362 units/syntax and114 native browser cases:
[push37646547538](https://github.com/twangyal/projects-monorepo/actions/runs/37646547538)
and [PR37646555790](https://github.com/twangyal/projects-monorepo/actions/runs/37646555790).
All13 normal portfolio PR workflows pass. ci-verification.json records their exact IDs.

| Full155 first result | Original maximum | Separate stage diagnostic |
| --- | --- | --- |
| [Push37646547460](https://github.com/twangyal/projects-monorepo/actions/runs/37646547460) | Pass; click-to-download59.279s | Pass; click-to-download58.998s |
| [PR37646555563](https://github.com/twangyal/projects-monorepo/actions/runs/37646555563) | Product-deadline failure | Product-deadline failure;1,776 video submissions, no finalization |

The passing original and diagnostic movies each independently decode all1,800
video frames and2,880,648 audio frames and pass all40 original visual/audio
gates. Downloaded artifact binaries were reinspected locally using the unchanged
smoke_sequence_soundtrack.mjs --inspect command; both pass. Raw CI receipts below
are retained literally rather than replaced with local reinspection output.

| Diagnostic boundary | Push | PR |
| --- | --- | --- |
| Video once-dequeue wait |56.5078s /1,797 completed waits |67.5520s /1,773 completed waits |
| addVideo wall wait |56.6128s |67.6764s |
| Exact sink write |22.3ms /1,834 writes |26.8ms /1,802 writes |
| Finalize / cancellation |81.2ms / no cancel | No finalize /16.9ms cancel |

Both video rows have native queue maximum4 and zero pending, retired, tracked
or unobserved waits at retirement. This identifies native dequeue backpressure
as the dominant observed awaited boundary in these diagnostics. It does not
assign exclusive CPU, upstream muxer scheduling, writer-ready waits or completed
encoded packets. The [WebCodecs specification](https://www.w3.org/TR/2026/WD-webcodecs-20261007/)
describes encodeQueueSize as pending requests; a dequeue event is not an
independently decoded-frame receipt. Earlier stage.draw totals also include
fixture setup outside export. Source inspection confirms ordinary preview is
already paused while sequenceRecording is active; extra preview rendering is
not established as a throughput cause.

Four literal verification JSON files and four browser logs retain first success
and failure evidence. artifact-provenance.json records exact artifact IDs, ZIP
bytes/digests and independently recomputed hashes for every ZIP entry. All four
11,554,385-byte sequence archives are byte-identical before and after restart,
with SHA256a6137efd2434bd48dfd36aa6cf21c3d0c63f04694d14c3025458243a6bc03751.
Binary payloads are identified by hashes rather than duplicated in git.

Issue128 stays open: the original full155 gate remains intermittent, and no
production throughput repair is established. The next implementation needs a
measured native encoding/scheduling improvement that preserves production
quality/deadlines and passes the original independent media gates.
