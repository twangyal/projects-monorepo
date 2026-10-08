# Motion Studio lossless PNG frame archive (#127)

Add a local export alongside GIF and single-frame PNG in the editor and private
snapshot viewer. Capture one validated committed project/title, render integer
frames 0 through frameCount−1 with the existing opaque 640×360 renderer, and encode
one PNG at a time in a disposable module worker. Preserve full color, held cels,
image layers, paint order and poses. Never include editor overlays, access links
or credentials. ZIP is an export only, not a project backup or import format.

Use a dependency-free stored ZIP with CRC32, fixed DOS date 1980-01-01, no comments,
extras, compression, descriptors, encryption or ZIP64. First entry manifest.json;
then frames/frame-0001.png through frames/frame-NNNN.png. Manifest is UTF-8 JSON:
format motion-studio-png-frames, version 1, title, width 640, height 360, frameCount,
fps {numerator:12,denominator:1}, and ordered frames names. PNG paths never use title.
Frame n represents time (n−1)/12 seconds; duration is frameCount/12 seconds.

Keep existing 12–96 timeline frames; max PNG 1 MiB, manifest 16 KiB and complete
ZIP 96 MiB. Before retaining each entry, admit its signature, IHDR dimensions and
projected complete archive size including central directory. A missing frame or
overflow refuses the whole result. No partial download. Main-thread admission
checks the exact expected manifest, fixed entry names/order, headers, central
directory, lengths and CRCs before creating the download Blob.

Worker owns decoded assets and canvas. Main owner has monotonic bounded progress,
30-second deadline, abort/worker error handling and one terminal cleanup. Release
the worker on success/failure/cancellation; ignore late replies. UI reuses current
export locks/epochs/raw-draft admission. Cancel/pagehide retires work without late
download or status replacement. No schema, storage, library or network change.

Verification: independent ZIP reader (not production admission) checks real local
and central headers, CRCs, exact manifest and PNG decode. Original multicolor image
and held-cel/pose fixtures verify full color, geometry and timing. Native editor
and private-viewer downloads, genuine worker cancellation and departure ownership
are required. Unit checks cover caps, invalid replies, errors and deadline.
Exercise 96 frames with eight layers, four images, 100 strokes/10,000 points.
Keep first failures and report actual environment/check limitations.
