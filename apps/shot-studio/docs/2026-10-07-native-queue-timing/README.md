# Native queue timing diagnostic (#128)

This extends the explicitly separate `--stage-timing` variation. The unchanged original maximum capture and all production export settings/deadlines remain authoritative.

Pinned Mediabunny1.61.1 waits for a native once-`dequeue` event when encodeQueueSize reaches4, then waits for its latest muxer promise. The observer forwards the exact original callback/options and adds its own bounded listener to time that native event boundary. Video/audio rows record submitted encode calls, queue maximum, wait completions, elapsed wait and overflow. Only8 active encoders and8 outstanding listeners per encoder are retained. Close/retirement removes owned listeners; method restoration respects a later owner. No samples, encoded chunks or payload/capability data are retained. Sink timing wraps the exact sink's write operation and restores it on retirement, with at most8 retained sinks.

This distinguishes once-dequeue wall waits from sink write duration. It does **not** assign exclusive encoder CPU or account for all upstream muxer scheduling, serialization, writer-ready waits or rendering synchronization. Stages overlap and must not be added or subtracted into a fabricated CPU budget. Unobserved counts disclose encoder/listener capacity overflow.

## Validation checkpoint

Missing queue instrumentation and missing sink timing fail their new regressions first. Full361 units and syntax checks pass. Independent review identifies a stale ten-stage browser assertion; updating it to the actual eleven stages preserves its bounded-observation check. The native timestamped-export and stage-diagnostic subset passes9 cases, including real finalization/cancellation ownership and saved-authoring preservation.

Retained small native receipts independently decode all30 video frames of a64x64 one-second export and all60 video frames plus approximately96,000 audio frames of an original two-second audiovisual export. Both codec boundaries retain no outstanding listeners/encoders and have no observation overflow; native method restoration is verified. These are small boundary checks, not maximum acceptance or a full155 throughput result. Source hashes and the temporary runtime limitation are in source-provenance.json. Full local project acceptance also passes **all113 native cases** (3.6minutes), alongside361 units and syntax checks. First published standard/full155 diagnostic CI remains pending at this checkpoint.

## Continue

Run the existing isolated full155 original maximum unchanged, then the separately labelled `--stage-timing` variation. Preserve paired first results and exact source/runtime before interpretation. Issue128 stays open until a safe throughput repair passes original gates or the concrete residual cause/acceptance is established. PhysicalXR and decoder interpretation remain separate.

## Corrected earlier harness head

[The four first corrected-head7e results](corrected-head7e/README.md) preserve
both full155 original and diagnostic failures with literal receipts/browser
logs and independently recomputed ZIP/file hashes. Both diagnostic attempts
complete1,800 video submissions, then finalize with an error around the product
deadline; addVideo waits consume67.435s push /67.353s PR. This extends the earlier
pre-finalize recurrence evidence. It does not establish decoded movie coverage
on these failures or attribute native CPU.

## First CI and listener-order correction

Both first standardfc819bd CI runs pass361units,113native cases and configured
original maxima. The [paired full155 results](first-fc819bd/README.md) remain
mixed: originals fail; diagnostic push passes all independently decoded gates,
PR times out. Its first queue timing includes exporter continuation work and
must not be interpreted as isolated native wait attribution. The real-UA
[listener-order regression and correction](listener-order/README.md) retain
that defect and move only the owned probe ahead of the unchanged original
callback. Production and original acceptance remain unchanged.

## Corrected native timing acceptance

At447a6f7, both first standard CI runs pass362 units/syntax and114 native cases;
all13 normal portfolio PR workflows pass. [The four first corrected full155
results](corrected-447a6f7/README.md) preserve push success and PR failure.
The failed PR diagnostic spends67.552s in native video dequeue waits within
67.676s of addVideo waits, while exact sink writes take26.8ms. This identifies
the dominant observed awaited boundary, without assigning CPU or all muxer
scheduling. Issue128 remains open; no production throughput repair is claimed.
