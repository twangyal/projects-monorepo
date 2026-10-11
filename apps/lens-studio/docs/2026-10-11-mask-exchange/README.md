# Reviewed depth-mask exchange — issue #175

## User outcome and scope

Users can export the current three-plane mask, edit complete assignments in another local image editor and review/import them as one undoable edit. This closes a manual correction/reuse gap without declaring the depth baseline in #172 ready. Lens remains ACTIVE; scene-depth estimation and generated fill are unfinished. Shot #128 remains unresolved; inspection of existing queue/CPU/media evidence did not justify a safe production throughput change.

The contract is exact normalized photo dimensions, three opaque RGB8 palette colors and a static 8-bit PNG up to 7 MiB. No resizing, thresholding, inferred depth or external services. Preview shows the proposed image, each plane count and exact changed-label count. Apply preserves photo/settings and existing raw drafts; identical masks preserve Redo. Every actual newer input or editor action retires the pending read/review. An unchanged already-reviewed raw field's delayed blur/change may still Apply; it is not newer input.

The decode worker owns its cancellation and unchanged 30-second deadline. Chunk CRC/header validation precedes strict complete zlib decompression/checksum, exact filtered-row length (including Adam7), row-filter and image-data/palette/transparency ordering checks. Only then does native decoding produce pixels; every decoded pixel must use the exact opaque palette. Output is a lossless PNG directly from committed labels. Applied masks retain existing complete autosave/CAS/recovery and portable project semantics.

## Failures preserved

- `missing-ui-first.log`: actual native test-first missing Import depth mask UI.
- `first-apply-failure.log`: first new three-flow run, two pass and Apply fails with original all-subject labels. Native blur/change from a pre-existing blank numeric draft retired the proposal before clicking Apply. The narrow reviewed raw-value guard fixes this; every input still retires.
- `checksum-first-failure.log`: actual native corrupt-Adler32 regression incorrectly receives a review instead of rejection. Browser decoding is permissive even when PNG chunk CRC is valid. Strict decompression precedes native decoding now.
- Independent reviewer also reproduced RGBA16 opacity 65534 and an off-palette 16-bit red sample both rounding to the valid opaque subject pixel. The 8-bit pre-decode requirement prevents this. Valid complete PNG16 native rejection fixtures retain work/Redo.
- `strict-stream-first-red.log`: strict stream API absent before implementation.
- `intermediate-overlap.log`: five native passes, maximum reload-preview waiter failure and a small setup render failure while overlapping builds rewrote shared `dist`. Final validation runs builds and browser suites sequentially.
- `first-full-84.log`: 83 passes and the new maximum test's 5-second reload-preview waiter fails after pixel exchange. The new maximum case now explicitly waits up to 25 seconds for preview within the unchanged 30-second worker deadline and has a 90-second overall test budget. Older acceptance gates and product deadlines are unchanged.

Standard browser installation returned invalid/truncated ZIPs. Full Chrome could not start its process-singleton socket in the runtime. A separately downloaded official Chrome for Testing 153.0.8010.12 headless-shell ZIP passed complete ZIP validation and enables real browser tests. This does not establish physical-device or full Chromium 155 performance. No retry erases a first failure.

## Verification coverage

Pure tests check every palette byte, complete graph preservation and one-edit history, malformed/off-palette/transparency/dimension rejection, strict compressed checksum/stream/order/row budget and owned worker retirement/deadlines. Browser coverage checks deliberate Apply, raw drafts, cancellation/newer-input/pagehide with a real owned worker held at its message boundary, no-op Redo, malformed streams, native precision conversion refusal, maximum all-pixel exchange, mobile keyboard Apply and complete ordinary-study retention across a full browser process restart. Controlled pagehide is not physical OS suspension. Synthetic authored masks are not a scene-depth quality evaluation or a human external-editor study.

## Final local result

- `full-86-browser.log`: all 86 real headless-shell browser cases pass together in 3.9 minutes, including all nine new mask cases.
- `final-check.log`: after the final pixelated review presentation and test-admission assertion, all 91 unit tests pass; lint, TypeScript and the production build pass.
- `final-mobile.log`: the final production build passes native keyboard Apply on a 390px viewport. Visual inspection confirms discrete palette boundaries and no horizontal overflow. The full 86-case result preceded only this presentation adjustment and the extra unit assertion; exact published-head CI is tracked in #175.

The maximum 1280×1280 exchange checks all 1,638,400 labels and every exported RGBA pixel. Its PNG is 6,555,448 bytes, decoded raster 6,553,600 bytes, and complete project backup 10,925,488 bytes. Photo pixels and settings remain unchanged, and the complete study survives reload. A separate ordinary study survives terminating and restarting the entire browser with its private profile. Neither case establishes physical mobile suspension behavior or learned-depth quality.
