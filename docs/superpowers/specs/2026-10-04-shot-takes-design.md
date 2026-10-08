# Shot Studio retained takes — issue #86

Approved implementation contract, 2026-10-04. A take pairs one actual silent
WebM recording with the immutable schema-3 film captured before recording.
Existing film JSON, scene history, local draft recovery, renderer and XR behavior
remain authoritative. No recorded-clip splicing or physical headset acceptance
is implied.

## Complete user flow

Finish or explicitly discard unsent scene edits, enter a take name, then record
the committed film. Keep at most four alternatives in a separate local browser
library. Replay a selected recording, rename its library label, confirm deletion,
or deliberately open its editable film as one ordinary reversible scene edit.
Playback and library operations preserve current scene fields and history.

Each take exports as one complete `.shot-take` backup containing its manifest and
exact WebM bytes. Import appends under a fresh local ID, never replaces another
take or the current film. Imported film/video associations and timestamps are
supplied, unverified metadata; hashes establish integrity only. A full library
refuses an append rather than evicting data.

## Bounds and data

- Four takes, each video 1–33,554,432 bytes; aggregate video at most 134,217,728
  bytes, plus bounded metadata. One additional finished memory-only take may be
  retained after a failed save. Discarding it is explicit.
- Capture canonical schema-3 film through existing `validateProject`, enforce
  its 65,536-byte UTF-8 serialized limit. Existing 60-second film limit remains.
- Names contain 1–80 UTF-16 units, matching film-title bounds, without malformed
  Unicode/NUL. No silent rewriting of accepted values. Local ID is a UUID and
  timestamp canonical UTC ISO. Renaming never changes film title or media.
- Metadata: `{schemaVersion:1,id,name,recordedAt,origin,film,
  video:{mime,bytes,sha256}}`. Origins are `recorded-here` and
  `imported-declared`. Supported MIME values are `video/webm` and VP8/VP9 variants.
- Library snapshot: `{schemaVersion:1,revision,records:[{metadata,video:Blob}]}`.
  Revisions are bounded nonnegative safe integers; IDs unique; shapes strict.

## Backup framing and media admission

A 16-byte header has ASCII `SHOTTAK1`, little-endian uint32 manifest length and
little-endian uint32 video length. Manifest length is 1–81,920 bytes. Its JSON
contains exactly the metadata fields above except local `id`. The remainder is
exactly the declared WebM payload, with no trailing bytes. Validate file/header
lengths before large reads, strict UTF-8/JSON shapes and duplicate keys, bounded
depth, film shape/size, video length and SHA-256. Export uses compact canonical
JSON and Blob parts, without base64 or compression. Import permanently forces
`imported-declared` and mints its local ID only for the appended take.

Video admission checks the bounded EBML header signature and `webm` DocType,
then requires an actual browser-decoded first frame at 960×540 within ten seconds.
Use an owned detached video and Blob URL; abort/error/success releases listeners,
timer, source and URL. Native MediaRecorder can omit Duration/Cues; infinite or
unknown container duration and lack of seeking do not reject our own recordings.
This does not establish full-stream codec validity or film/video correspondence.
Playback failures remain visible while preserving original bytes for backup.

Recording requests 2.5 Mbps, nominally 18.75 MB at 60 seconds. Actual chunk bytes
are capped before retention at 32 MiB; bitrate is no bound. Cancellation stops
recorder/tracks/RAF/timer and ignores late chunks. Existing direct WebM export
uses the same bound and remains available.

## Module contracts and ownership

- `takes.js`: `TakeError`, `TAKE_LIMITS`, `validateTakeMetadata`,
  `createTakeMetadata`, `validateLibrary`; strict detached pure admission.
- `take-archive.js`: `sha256Blob`, `encodeTakeBackup(metadata,video,{signal})`,
  `decodeTakeBackup(file,{signal})` returning `{metadataWithoutId,video}`.
- `take-video.js`: `inspectTakeVideo(blob,{signal})`, bounded native admission.
- `take-store.js`: `TakeStore(factory=()=>indexedDB)`, `read({signal})`,
  `save(candidate,{expectedRevision,signal})`, terminal `close()`.
- `app.js`/optional `take-ui.js`: UI publication, operation ownership, player,
  captured recording, library candidates and deliberate scene restoration.

IndexedDB `shot-studio-takes`, version 1, store `state`, key `library`, stores one
bounded snapshot atomically. A genuinely absent row reads as revision 0 with no
records. Distinguish absence from a present invalid value. First save is revision
1; each candidate revision equals expected revision plus one. In one readwrite
transaction, read and validate current state, compare the expected revision, and
put the candidate. Publish saved status only on transaction completion. Async
hash/video checks happen before opening the write transaction. Another tab's
change is a conflict requiring explicit reload, never an automatic merge.

Failed/corrupt reads protect library writes and offer retry; never reinterpret
them as empty or reset storage. No destructive reset in this milestone. Failed
writes preserve the previous row and retain the completed in-memory pair for
retry/backup. Retry uses the same ID, inspecting committed state if necessary
rather than duplicating a late successful save. Open/transaction waits are bounded
to ten seconds; abort, version change and close retire owned work.

Every async UI operation captures its immutable inputs and an operation/page
epoch. Late reads, hashing, decoding or transaction completion cannot overwrite
new raw input, selection or a newer operation. Pagehide aborts owned work and
releases player URLs; a transaction that already committed remains discoverable
on reload. Raw input changes count even when text changes back. Scene restore
uses existing raw guards, native confirmation, post-dialog ownership checks and
one existing history commit. Library status changes never rebuild scene fields.

## Verification and completion

Meaningful domain tests cover exact bounds, invalid shapes/Unicode, framing,
hashes, cancellation, immutable pairing, duplicate IDs and CAS. Native tests use
actual MediaRecorder/Blob/IndexedDB and file downloads, with controlled delay or
failure only at real browser boundaries. Cover two distinct recordings, replay,
reversible restore, rename/delete, failed write with memory recovery, late file
completion and raw focus, pagehide/cancel, corruption protection and two-tab CAS.
Compare complete backups and media across a whole browser-process restart and
fresh-profile import. Independently decode actual exports and measure captured
film landmarks/duration. Exercise a real 60-second film separately; distinguish
actual encoded size from synthetic exact byte-cap tests. Inspect desktop and
narrow layout. Run existing 43 browser cases, all unit/syntax checks and CI.

Root owns docs, package/config/check commands, Git and GitHub. Disjoint owners
implement domain/archive, video/exporter, storage, UI and independent native
verification. Commit finished progress and close #86 only on actual completion;
physical WebXR #21 remains open.
