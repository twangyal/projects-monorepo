# Friendly Challenges retained image evidence — implementation contract for #87

Tracker: https://github.com/twangyal/projects-monorepo/issues/87
Status: frozen implementation contract, 2026-10-04. Implementation authorized by the autonomous goal.

## Complete small flow

A participant supplies the existing literal evidence caption and optional HTTPS link, optionally chooses one local PNG/JPEG, reviews the normalized JPEG, then appends ONE evidence entry. Both participants and a legitimately claimed arbiter can inspect the same retained bytes. Existing acceptance, deadlines, disputes and settlement remain authoritative. A photo is a supplied claim, not verified capture time, identity, authenticity or proof of a winner. Corrections are new entries; no edit/delete, remote fetch, classification, editable restore or public hosting.

Keep plain `Export record` JSON. Add `Export record with images` as one script-free self-contained HTML download containing the complete public record and all retained JPEGs. This provides usable offline reading without a new archive parser/import service. Neither export includes capability hashes, tokens, private links or filenames from the source computer.

## Actual compatibility seams

Current SQLite `challenges.sqlite3` is user_version 1 with only `challenges(id,record)`. Private records are exactly `{schemaVersion:1,state,hashes}`; `validate_record` regenerates every event through `_replay` and compares exact canonical state. Existing `evidence_added` contains exactly the six-field evidence object `{id,author,text,url,createdAt,late}`. Existing JSON requests are 16 KiB, records/responses 1 MiB, service body deadline 15 seconds and inactivity limit 5 seconds. One `BEGIN IMMEDIATE` owns every Store mutation. The server authenticates Bearer capabilities and verifies Host/Origin before routing. The frontend already captures credential/generation and never retries a failed mutation automatically.

Preserve all of these old event shapes and historical timestamps. Introduce private record schema 2, but do not rewrite JSON records at startup or on ordinary reads. Genuine schema 1 remains accepted only with old events. Existing text commands keep a schema 1 record at version 1. Only a successful image append upgrades that record to schema 2; subsequent text events retain their old shape. Newly created challenges can remain schema 1 until their first image. Older software must reject the new DB schema and schema 2 record rather than silently drop images.

Schema 2 adds only the distinct event `evidence_image_added`, details `{evidence}`, whose evidence has the old six fields plus `image:{mime:'image/jpeg',bytes,width,height,sha256}`. No separate attachment ID: `(challengeId,evidenceId)` identifies the immutable image. Descriptor bytes are integers 1..524288, dimensions 1..1024 each, SHA256 lowercase 64 hex, exact keys. Evidence remains a discriminated structural union (old entries have no `image` key). `_replay(events,id,schema_version=1)` permits the new event only in schema 2 and regenerates the same descriptor using the pure image-evidence transition. No changes to old `evidence_added` semantics or terms/consent.

Database user_version 2 adds `evidence_images(challenge_id TEXT NOT NULL,evidence_id TEXT NOT NULL,data BLOB NOT NULL,PRIMARY KEY(challenge_id,evidence_id),FOREIGN KEY(challenge_id) REFERENCES challenges(id))`, with a BLOB type/length constraint 1..524288 and foreign keys enabled. Before migrating a v1 database, validate its exact old schema and every private record. DDL plus version update is one transaction; migration leaves existing `record` text byte-for-byte intact. Failed validation leaves DB version/schema/records unchanged. V2 startup admits only these two trusted tables and validates complete descriptor/BLOB correspondence, including no missing, duplicate or orphan image, no image attached to a v1 record, length/hash agreement and legal JPEG admission. Do not import arbitrary SQL or execute untrusted schema. Ordinary Store loads check the same relationship/length/hash for the selected challenge; full decode is required at append and startup, not every poll.

## Bounds and exact media decision

- Existing 20 challenges and 40 total evidence entries/challenge remain. At most 8 image entries/challenge; one image/entry. Maximum retained JPEG data is therefore 80 MiB, derived from limits, without silent eviction.
- Browser input: PNG or JPEG only, native File at most 8 MiB and header dimensions at most 16,000,000 pixels, positive dimensions. Reject APNG/multiple-frame input rather than choosing one silently. No WebP/HEIC/GIF/SVG or remote image URL in this slice.
- Browser normalize once: honor native decoded JPEG orientation, fit within 1024×1024 without upscaling, flatten transparency onto visibly disclosed white on an explicit sRGB canvas, reencode RGB JPEG. Strip APP1..APP15 and COM metadata from the generated canvas output before constructing the reviewed Blob; Chromium actually emits an ICC APP2 segment. This occurs before preview and never changes already reviewed/uploaded bytes. Try a fixed descending quality list `[0.9,0.8,0.7,0.6,0.5]`, retaining the first output at most 512 KiB; otherwise reject visibly. Do not shrink again or silently alter the already reviewed bytes during upload.
- Show the exact normalized JPEG bytes, dimensions and byte count before posting. Source filenames/EXIF/location/device metadata are not persisted. Disclose resize/reencode/white background and that the original is not retained. Native color management may affect normalized pixels; do not claim forensic original-pixel equality.
- Authoritative server independently admits exact JPEG bytes: cap bytes before materialization/decode; a bounded JPEG marker/extent preflight requires SOI, valid segment lengths, baseline/progressive 8-bit three-component frame, one terminal EOI at exact EOF, no concatenated image/trailing bytes, no COM or APP1..APP15 metadata. Permit only conventional bounded JFIF APP0 without embedded thumbnail. Then Pillow 12.3.0 must identify JPEG, RGB mode, one frame, positive dimensions <=1024, and fully decode with truncated-image admission disabled. Reject unsupported framing/metadata, not silently strip/reencode. Keep admitted exact bytes and SHA256, so all seats see the reviewed copy.
- The framing scan is narrowly JPEG-only metadata/extent admission, not a new image decoder; Pillow remains decode authority. Establish one actual Chromium canvas JPEG fixture against this dialect before release, especially APP0/progressive behavior. Server decode errors are fixed public messages without raw Pillow paths or supplied content.

## APIs and wire format

Python domain owner (also `src/types.ts`):

- `validate_image_descriptor(value) -> dict` validates/detaches exact descriptor.
- `apply_image_evidence(state,role,payload,image,now,entity_id=None) -> None`; payload exact `{revision,text,url}`, descriptor separate; same participant/status/revision/40-entry rules, extra 8-image quota, server receipt-time late rule, appends new event exactly once.
- `validate_record(record)` accepts private versions 1/2 with version-gated replay. Existing `apply_command` and existing text HTTP body stay unchanged.

Python image-format/server owner:

- New `challenges/images.py`: `validate_jpeg(data:bytes) -> dict` returns exact descriptor, independent of client fields. Limits exported here for Python consumers. Decoder handles only normalized JPEG, no original normalization.
- `POST /api/challenges/ID/evidence/image`, Bearer, `Content-Type: application/octet-stream`. Header exactly 16 bytes: ASCII `FCEVID01` (8), u32LE metadata length, u32LE JPEG length; then exact UTF-8 JSON `{revision,text,url}` <=16384 bytes; then JPEG <=524288 bytes, exact EOF. Total <=540688 bytes. Reject duplicate JSON fields/nonfinite/depth/unknown keys through existing strict admission; reject inconsistent Content-Length, framing or short body. Separate body cap; unchanged 15-second total/5-second inactivity deadlines. No multipart/base64/chunked bodies.
- Success 200 is the ordinary bounded Snapshot. All known public DomainError envelopes remain. Invalid bytes 400, too-large 413, stale/quota/terminal 409; missing/wrong seat follows existing auth behavior. Admission/auth checks precede Pillow where practical; validate outside SQLite lock, then reauthenticate/recheck state/revision inside commit transaction.
- `GET /api/challenges/ID/evidence/EVIDENCE_ID/image`, Bearer only, returns exact immutable JPEG, no-store/nosniff. Unknown evidence and non-image evidence return fixed not_found only after valid seat auth. No query credentials/public routes. New route match must precede existing `[a-z/]+` action matcher.
- `GET /api/challenges/ID/export/images`, Bearer, returns bounded complete HTML attachment. Keep existing `/export` JSON endpoint; schemaVersion 1 for v1 record, 2 for v2 record with image descriptors, no binary inline in JSON. Existing `/api/status` version stays 1 (service wire status, not record version); optionally expose image limits explicitly without conflating versions.

Store owner:

- `Store.add_image(challenge_id,token,payload,jpeg) -> Snapshot` admits JPEG and derives descriptor before transaction; then load/authenticate, validate command, apply detached mutation, encode bounded response/private record, INSERT BLOB and UPDATE schema-2 record in one `BEGIN IMMEDIATE`. Any exception rolls BOTH back. Recheck 8-entry quota inside transaction, not only during decode. No independent BLOB commit/cleanup job.
- `Store.image(challenge_id,token,evidence_id) -> bytes` returns detached verified BLOB after auth; bound SQL length before Python allocation.
- `Store.export_images(challenge_id,token) -> tuple[public_export, list[tuple[evidence_id,descriptor,bytes]]]` captures ONE consistent immutable record and its <=4 MiB images under transaction. Render outside Store lock. Existing `get/command/export` use cross-table validation where necessary.

Client media/API owner:

- New `src/evidence-image.ts`: `normalizeEvidenceImage(file,signal?) -> Promise<{blob:Blob,width:number,height:number}>`, admitted output JPEG <=512 KiB; owned normalization lifetime/decode cleanup, no project mutation.
- Extend `src/api.ts` with `postImageEvidence(id,token,payload,jpeg,signal?) -> Promise<Snapshot>` and `fetchEvidenceImage(id,evidenceId,token,descriptor,signal?) -> Promise<Blob>`; existing `request<T>` stays JSON-only/no retries. Binary response is length/type bounded and errors use existing ApiError. `fetchImageExport(id,token,signal?) -> Promise<Blob>` has separate 12 MiB HTML cap.
- Client reads must verify returned SHA256/bytes against authenticated snapshot descriptor before display, preventing stale/wrong pair rendering. Abort/revoke all Blob URLs on seat/challenge/page retirement. Add `blob:` to service page `img-src` CSP; no other CSP relaxation.

Export owner seam (can share domain owner slot): `challenges/image_export.py: render_image_export(public_export,images) -> bytes`. Exact complete snapshot, all eight images embedded with `data:image/jpeg;base64,`; literal caption/author/receipt/late/dimensions/hash, accepted terms, resolution and complete audit via escaped readable record section. Script-free, no supplied HTML, no external media fetch, metadata-safe fixed ID filename, maximum 12 MiB UTF-8. Public associations are supplied/unverified. Validate pairing/count/hash and bound output before transmission. This is readable evidence export, not reconstruction of private seats.

## UI lifetime and review

Keep existing evidence caption/link labels and Add evidence behavior for text-only drafts. New controls: `Choose evidence image`, `Remove selected image`, normalized preview/status, and `Add evidence with image` only when ready. Display image quota 0/8 in addition to 0/40 evidence. Picking/removing/replacing is a draft action: no server write, no winner inference. Image draft contributes to beforeunload/navigation guards. Existing leave consent may discard draft only deliberately.

Normalization captures image epoch plus challenge/seat identity and input intent. Late completion cannot overwrite a newer chosen image, restore a removed draft or normalize into another seat. Caption/link input must not be erased by asynchronous status or preview changes; preserve raw DOM/focus. Store-ready preview is independent of polling revision, so a poll can update the record without discarding unsent media.

Post captures exact revision, caption/link, JPEG and image draft identity. Lock navigation/seat switches as existing busy command; never automatically retry or queue a lost-response append. Failure/stale/abort retains raw text and exact JPEG preview. Refresh authoritative record; clearly state unknown success when response is lost and require user review before an explicit retry. Do not deduplicate by hash or pretend uncertainty is solved by a similar caption. On confirmed success clear only the exact submitted draft if no newer edit exists; show image only from authoritative returned event. Terminal views preserve readable images, no append actions.

Use an explicit `View retained image` per evidence entry to fetch authenticated bytes rather than eager-fetching eight images on every poll. Returned BlobURL belongs to captured credential, generation and descriptor hash. Close/seat switch/pagehide removes visible source and revokes it immediately. Arbiter can view/export but cannot post. Inline image caption states normalized unverified copy; no capture-time inference. Image/export actions should not refresh/rebuild forms or silently discard raw inputs.

## Ownership plan (six independent implementation slots)

1. Domain + TS types + image export and focused pure tests; audit/version compatibility and script-free complete report.
2. Store/schema migration + transactional/corruption tests; no image decoder implementation.
3. Server + `images.py` + authoritative JPEG/HTTP tests; existing framing/security/deadline checks retained.
4. Client image normalization + API binary helpers + focused tests/native media harness only if needed.
5. Main UI/style + lifecycle/accessible selectors; consumes actual APIs, preserves existing selectors.
6. Independent native acceptance/oracle: original images, real two-party/arbiter contexts, exact DB/restart/export pixel/hash evidence, delayed media and upload responses, raw draft/focus/mobile flows. Derive fixtures before production inspection.

Root owns spec/plan, dependency pin (`Pillow==12.3.0`, actual installed default Python), version/README/Git/build scheduling and compatibility test coordination. Parent can move report into server owner's slot if domain slot grows; do not split edits within existing large files.

## Release evidence and highest risks

- Genuine old SQLite fixture opens under v2 DB without changing record bytes, state/events/timestamps/hashes; every old event replays exactly. First real image mutation upgrades only that record. Future/private malformed schemas, unknown image fields/events, BLOB missing/orphan/hash/length mismatch fail protected, not repaired/dropped.
- Hand-authored malformed JPEG marker/metadata/EOI/dimension/CMYK/decode fixtures; actual browser PNG transparency and oriented JPEG inputs. Full exact 512 KiB legal fixture plus 1-byte rejection; original source 8 MiB/16 MP boundaries independently tested. Fixed normalization output reproducibility is per actual browser, not claimed cross-browser bytes.
- Real stale final-slot concurrent commands and transaction abort: neither orphan BLOB nor partial event/revision. Full 8×512 KiB challenge and derived directory80 MiB separately measured; do not claim all source/max dimensions/content coexist unless actual fixtures satisfy both.
- Actual participant upload, opposing evidence/result dispute, independent arbiter viewing and decision; late server-time receipt, terminal reads and restart retain exact JPEG bytes. Wrong seat/challenge/no Bearer cannot fetch images; no secret in paths, logs or exports.
- Native chosen-file/normalization failure/cancel/delayed decode/newer intent, stale revision/lost upload response/no replay, selected draft retained, challenge/seat switch abort+URL retirement. Native screenshot390px plus desktop and keyboard inspection.
- Independently decode exported self-contained HTML images, compare exact JPEG hashes and public complete audit/terms/resolution, scan capabilities absent. Plain JSON export descriptors accurately disclose that image bytes are in the separate HTML export.

Highest risks are actual canvas-JPEG dialect versus strict server admission, transactional migration retaining exact v1 audit, cross-table consistency under quota/concurrent commands, and async capability-owned BlobURLs. This milestone avoids broad original-format server normalization and binary archive restore complexity. No new tests have been executed in preparing this design; existing suite counts are documentation, not fresh verification.

## Root integration decisions

The HTML export is the complete portable readable artifact; there is no ZIP or restore importer in this milestone. Its record section contains escaped JSON as literal text, never an executable script. Navigation uses the existing explicit unsent-draft guard: deliberately leaving discards this seat-owned draft, while poll, refresh, errors and delayed operations preserve it. No scratch state is shared across seats. Store.add_image authenticates before expensive JPEG decode, then reauthenticates and checks revision/quota inside the atomic commit. Pillow 12.3.0 is a pinned runtime dependency. The UI API verifies media length and SHA-256 against the authenticated descriptor before any retained image is displayed.
