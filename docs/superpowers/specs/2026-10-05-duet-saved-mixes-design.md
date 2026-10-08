# Duet #119 reusable named mixes — approved implementation contract

Status: approved by root on 2026-10-05 after source/catalog assessment and independent compatibility review. This new product feature is source-confirmed absent; no runtime RED is claimed before tests actually execute. Issue: https://github.com/twangyal/projects-monorepo/issues/119

## Product boundary

Each two-seat room has one current editable playlist and up to eight independent named saved mixes. A saved mix is an ordered list of existing track references with captured labels, never a second media library. Both authenticated seats may save, update, rename, delete or explicitly load it. Existing room/track/memory ownership rules remain unchanged. Names may repeat; stable IDs distinguish them. There is no durable active-saved-mix pointer: later editing/building the current playlist must never falsely imply a named copy was also updated.

Selecting or reading a saved mix does not change playback or local audio consent. Only deliberate Load changes shared transport, always paused at the first available track at position zero. Play remains a separate command and per-device audio consent remains required.

## Exact private/public shapes

Private room schema 1 retains exactly its current fields and validation. Room schema 2 retains every existing field and adds exactly:

```ts
interface SavedMixEntry { trackId: string; title: string; artist: string }
interface SavedMix { id: string; name: string; entries: SavedMixEntry[] }
interface SavedMixFields { savedMixes: SavedMix[]; savedMixesRevision: number }
```

Mix IDs and referenced track IDs use existing 32-character lowercase hexadecimal IDs. `savedMixes` is an ordered array of 0–8 distinct-ID mixes; each saved mix has 1–12 distinct-track-ID entries. New mixes append, rename/update preserve position, delete removes only that element. Names/title/artist use the existing literal `_text` 80-code-point, NUL-free, valid-Unicode policy; name/title must not be whitespace-only, artist may be empty. No trimming, HTML parsing or new normalization. Mixed/unknown schema fields reject. No per-mix timestamp, ownership field or duplicate-name rule is necessary.

`savedMixesRevision` is an integer 0..2^53-1; every successful saved-library create/update/rename/delete advances it exactly once, including an explicitly submitted identical update. Its exhaustion refuses before mutation. Saved-mix loading leaves it unchanged. Existing playlist/playback rules remain, with new load refusing exhausted active revisions before increment. Ratings, memories and unrelated credentials are never rewritten by mix commands except serialization of the same complete room.

Room snapshots add `savedMixes` and `savedMixesRevision`, including empty array/zero for legacy room1 without mutating that room. Entries have exactly the three persisted fields: availability derives from membership in snapshot.tracks. No `available` flag is persisted or appended to entries. Returned objects are detached through the existing public snapshot round trip. Private capabilities and invitation hashes remain excluded.

## Compatibility and source truth

New rooms are room2. `_validate_record` admits exact genuine room1 or room2 nonmutating and returns the same admitted record. Store constructor validation does not promote or rewrite a row. A successful explicit room mutation promotes room1 by adding only empty savedMixes/zero revision, preserving all previous field values; this includes normal existing commands, not only named-mix commands. Rejected/malformed/stale commands do not promote. Do not implement promotion unconditionally inside `_write`: existing snapshot natural-transition materialization and server startup `pause_all` are distinct existing behavior and must preserve old schema unless an explicit accepted mutation promoted it.

The service's startup pause already rewrites room anchors; this milestone does not promise byte-identical SQLite TEXT across service startup. Offline archive create/inspect must remain pinned read-only and never construct Store or run pause_all. Their source database/audio bytes stay unchanged. Existing archives canonicalize parsed room objects; they do not retain/restore original SQL TEXT whitespace/property order. Preserve exact old room values and credential hashes, not a false raw-whitespace portability claim.

## Store methods and HTTP endpoints

All routes remain participant-capability authenticated, exact JSON keys, existing64KiB body admission, Host/Origin/setup/TLS policy unchanged. Paths below extend `/api/rooms/{roomId}`. Existing JSON handler supports PUT/POST/DELETE, so no new PATCH method is needed.

| Store method | Route/body | Success |
| --- | --- | --- |
| `save_mix(room_id, token, name, playlist_revision, saved_mixes_revision)` | POST `/mixes` `{name,playlistRevision,savedMixesRevision}` | 201 `{mixId,room}` |
| `update_mix(room_id, token, mix_id, playlist_revision, saved_mixes_revision)` | PUT `/mixes/{mixId}/playlist` `{playlistRevision,savedMixesRevision}` | 200 Room |
| `rename_mix(room_id, token, mix_id, name, saved_mixes_revision)` | PUT `/mixes/{mixId}/name` `{name,savedMixesRevision}` | 200 Room |
| `delete_mix(room_id, token, mix_id, saved_mixes_revision)` | DELETE `/mixes/{mixId}` `{savedMixesRevision}` | 200 Room |
| `load_mix(room_id, token, mix_id, saved_mixes_revision, playlist_revision, playback_revision, available_only)` | POST `/mixes/{mixId}/load` `{savedMixesRevision,playlistRevision,playbackRevision,availableOnly}` | 200 Room |

Each method uses one existing BEGIN IMMEDIATE transaction. Authenticate first, admit exact primitive shapes, compare revisions inside the transaction before changing state. Invalid primitives/duplicate IDs/invalid names return400; unknown well-formed mix ID404; full library, empty current playlist, stale revision, missing-entry consent, all-unavailable mix or exhausted revision409. No automatic conflict replay. Return private-safe actionable messages and existing bounded error envelopes.

Save and Update read the current playlist only after both expected playlistRevision and savedMixesRevision match. They require a nonempty playlist and capture exact live track title/artist in its current order. Caller-supplied captured labels or arbitrary saved entry arrays are never accepted. Update retains ID/name, replaces only entries and advances the library revision once; it does not create a new mix. Rename retains entries exactly. Delete never deletes audio, changes current playlist or stops a mix that was previously loaded.

These four metadata commands do not call `_anchor`, set playback, start audio or mutate playlistRevision. Existing `_snapshot` can still materialize an honest automatic end/next transition if wall time elapsed; do not claim that such an existing observed transition is caused by saving a name.

### Explicit load and stale transport

Under the same transaction, read the selected saved mix and current tracks; compare savedMixesRevision and playlistRevision; compute `effective_playback(room, now)` and compare the supplied playbackRevision to its effective revision (not merely the saved anchor revision). All comparisons and required revision headroom precede the command's changes.

An observed automatic transition during a stale load is materialized monotonically using the existing `set_playback` conflict pattern: commit only that automatic transition, then raise409 outside the transaction. Never rollback a materialized natural transition and allow a backwards clock to revive its older revision. Invalid payloads do not acquire new mutation authority.

Find entries absent from current tracks by ID. `availableOnly` must be an actual boolean. If any are missing and false, refuse409; UI must disclose all original captured labels and obtain explicit available-only consent before resubmission. If true, use only currently available entries in their saved order. All missing always refuses409. No missing entries means either boolean succeeds. Do not rewrite the saved mix or its labels/revision, manufacture audio or interpret a deleted reference as an orphan archive audio member.

On success, set current playlist to the resolved nonempty list and increment playlistRevision once. Set playback `{trackId:first,playing:false,position:0.0,revision:effective.revision+1,updatedAt:now*1000}`. This happens even if IDs already equal the current list or player was paused at zero. Old Play/Seek/Next commands based on the prior revision must fail. No implicit consent enablement.

### Current playlist membership

Preserve existing PUT `/playlist` body `{trackIds,revision}` and Store.set_playlist semantics:0–12 unique currently available IDs, playlistRevision CAS. UI Add appends an absent library track; Remove filters a present ID; Up/Down change order. Capture the displayed entire list and displayed revision in each action, not a mutable later poll. Removing a song from the current playlist does not delete audio or change its taste vote. Existing behavior preserves the effective anchored selected track/position, including a selected track outside the newly edited list; it stops at that track's end rather than silently seeking another. Build and membership edits never update saved copies. Any stale named-load request is invalidated by playlistRevision.

## Exact byte budgets and archives

Existing accepted core room compact JSON remains <=262144B. For room2, validate the corresponding room1-shaped core (schemaVersion1 and the two new fields omitted) against that same legacy core byte budget. Do not use a larger aggregate cap to silently allow oversized legacy/core values. The new schema2 aggregate byte cap is365429B. Schema1 retains262144B. Read SQL length gates use the maximum before allocation, then apply the per-version/core bound after admission.

Worst-case valid 80-code-point strings can take480 JSON bytes (U+0001 escapes six bytes). Fixed exact shapes give:

- one entry:1029B;
- one twelve-entry mix:12903B;
- eight-mix array:103233B;
- new compact root fields plus leading commas, including16-digit savedMixesRevision:103285B;
- new spaced root fields with default JSON separators:103904B.

The longer `savedMixesRevision` spelling adds5B to the earlier `mixesRevision` arithmetic. Producer and independent reviewer calculations agree. Compact room1→2 changes a one-digit version without adding bytes. Therefore262144+103285=365429B. Separate array bound103233B is optional redundant admission; exact structural quotas already establish it.

Token-free exports become schema2 and include all saved mixes plus derived blend without private credentials. Keep legacy schema1 export fixtures accepted as historical evidence; there is still no room-JSON import route. Use MAX_EXPORT_BYTES=393216 (384KiB) for new output while preserving a separately named MAX_LEGACY_ROOM_BYTES=262144 and MAX_ROOM_BYTES=365429. Default spaced serialization/derived blend add <8192B above a compact private room after excluding private fields, so365429+8192<393216. Do not conflate export cap with private core/read cap. Report actual maximum exported bytes; do not claim all8 mixes are8 additional audio sets.

New complete archive output has manifest schema2 and rooms envelope schema2; room objects can be genuine1 or2. Accept old manifest1/envelope1 with room1 only. Reject crossed1/2 envelopes/manifests, a room2 inside old envelope1, future versions and mixed room field shapes. Keep physical ZIP_STORED dialect, names/member count62, sorted IDs/audio paths, SHA/CRC, all-media validation, original seats/invite hashes, no-clobber restore,500+MiB media capacity and saved-anchor-paused policy unchanged.

Publish distinct archive-current-version and accepted-version checks; a global SCHEMA_VERSION bump alone is insufficient. Carry admitted outer version in ArchiveIndex so orchestrator can compare manifest/envelope version; carry envelope version in LibraryRecords for validating forged direct records/restore. New read_library produces envelope2 without promoting old room objects. validate_rooms retains the admitted envelope version when inspecting old input; new archive writer uses2. New restore preserves room versions/values apart from established pause/updatedAt/revision changes. Summary schema_version reflects the actual input for inspect/restore and new2 for create. Optionally append saved_mixes count without exposing identities.

Set MAX_ROOM_BYTES=365429 for maximum SQL/archive member room admission but retain legacy262144/core check. Set MAX_ROOMS_JSON_BYTES=5*365429+1024=1828169; old envelope1 independently remains5*262144+1024=1311744. 512MiB archive cap stays unchanged: sixty8MiB audio members consume503316480B, leaving>31MiB for<2MiB records,32KiB manifest and unchanged bounded ZIP headers. Saved missing refs are metadata only; declared media membership is still exactly room.tracks.

## UI ownership integration

Use static mix-name and current/saved hosts; no poll should recreate focused raw fields. Saved rows keyed by ID with preview-only selection; preserve local name/selection/raw edit intent through polls and409. Success may clear a submitted name only if identity, room generation and raw input watermark still match, including changed-back edits. New room/back/pagehide retire pending owners; stale callbacks never change a newer room or audio consent. Current-playlist buttons bind displayed list/revision; save/update bind displayed playlist and saved revisions; load binds all three revisions shown for the preview plus explicit consent. A third-party deletion during confirmation conflicts through playlistRevision rather than silently changing the agreed subset.

## Disjoint ownership/verification suggestion

1. Backend domain owner: store.py, optionally new mixes.py for exact shapes/limits/helpers, new test_saved_mixes.py. No server/UI/archive source edits.
2. Routes owner: server.py and new test_saved_mix_http.py, using exact methods above; no Store edits.
3. Archive compatibility owner: archive_common.py/archive_state.py/archive_format.py/backup.py and new version/mix compatibility tests; no Store edits. Coordinate imported room/core admission helpers early; preserve literal archive1 fixtures.
4. UI owner: main.ts/style.css and focused draft/selection tests; no sync.ts changes absent separately proven defect.
5. Independent scalar/backend/archive oracle: original literal rooms/ties/limits/CAS and cross-version archives, plus read-only source review. Freeze expected values before producer reads.
6. Independent native owner: actual two seats, original three short audio files, saved alternatives, votes/bytes, membership, stale transport, deleted refs, restart/complete archive. Root handles full shared checks, maximum fixture, config/docs/version/Git/CI.

Required meaningful gates: preserve any actual first failure without inventing a baseline; 8/+1 mixes,12/+1 entries, literal80/+1/Unicode/control and exact byte bounds; save/update snapshot binding; independent revision CAS under two Store connections; rollback/quota preserves raw records; natural-transition stale load revision remains monotonic across backwards clock; empty/all-missing refusal, missing-consent available-order load; save/build/edit/delete independence; old raw source DB unchanged during archive operations; old1/1 and new2/2/mixed-room archives, crossed/future refusal; real60-track/40-mix/480-reference maximum with actual labels/500 memories and measured JSON/export/archive bytes; exact Opus bytes and original seats through archive/restart. No new model, download, audio duplication, paid service or physical synchronization claim.
