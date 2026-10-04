# Duet offline library archive

Issue: https://github.com/twangyal/projects-monorepo/issues/65. Reviewed design; implementation waits for root release. Independent review cleared the source, container, playback and publication architecture.

## Outcome and authority

Stop Duet, create a complete portable library archive, inspect it, restore into a NEW absent data directory, then start the normal service and recover the same seats using separately retained private links. This is a service-owner offline operation, not a room participant API or browser import. No HTTP routes, browser credentials, new seats, raw tokens, account recovery or automatic room merging are added. Preserve original room/track/memory IDs, profiles, ratings, playlist order and revision, both capability hashes, and exact pending invitation hash/status. Restore does not mint or reveal credentials. A used invitation stays used; an unclaimed invitation still requires its original raw invitation.

Archive integrity does not authenticate who submitted a rating/memory. A restored library is an independent continuation of stored records, not newly authenticated consent or synchronization with the source. Keep both participants' own access links separately; changing service origin changes only the origin portion of those links. Losing a raw credential remains unrecoverable through this feature. Existing token-free Export room notes is unchanged and is NOT accepted as an editable archive.

## Limits and dependencies

Linux, Python 3.11+, stdlib, existing FFmpeg/ffprobe; no new package, network, ML, re-encoding or physical-device claim. Five rooms, twelve tracks and one hundred memories per room, each private room document <=256 KiB; current names/titles/artists/dates/code-point bounds stay. Stored audio is exact stereo 48 kHz Opus/Ogg, 1–300 seconds, <=8 MiB per track. Maximum media is 60 files/480 MiB. Archive <=512 MiB, <=62 entries, central directory <=64 KiB, manifest <=32 KiB, rooms.json <=5*256 KiB+1024 bytes. Bound raw metadata bytes and scan JSON nesting/string escapes before json.loads; admit object shapes and collection counts before constructing media/staging state. Central-directory counts/sizes are admitted before constructing entry collections. No claim that ordinary json.loads admits array cardinality before allocating its bounded metadata tree. Source main SQLite file <=16 MiB. Stream blocks <=64 KiB; decoded PCM is counted, never retained in RAM.

Each create/inspect/restore has one aggregate monotonic 300-second deadline, including copying/hashing/media checks/publication. Each media subprocess also retains existing <=45 seconds, 512 MiB memory and 64 KiB diagnostic bounds; the remaining aggregate deadline can be shorter. Cancellation is an Event plus CLI SIGINT/SIGTERM; check before/after phases, each stream block, SQLite progress callbacks, media waits and immediately before publication. Slow machines fail safely; no partial success or skipped tracks.

Portable revisions are exact integers 0..2**53-1 (not bool). Reject oversized original revisions rather than truncate; a playing anchor at the maximum rejects because pausing cannot produce a safe next revision. Timestamps remain finite millisecond numbers 0..1e15; preserve their original values except the documented restored playback anchor timestamp. No filenames/person names/hash values appear in ordinary summaries or error diagnostics.

## Read-only source admission

NEVER instantiate Store or create_server for backup. They mkdir, set WAL pragmas, create schema, recover/write transactions and/or pause playback. Acquire the source directory and its existing regular .server.lock using NOFOLLOW/nonblocking opens, then LOCK_EX|LOCK_NB; hold the same lock throughout all source reads. Missing lock means reject as an uninitialized/incomplete library; do not create it. A running service must reject create before any staging. Inspect/restore never acquire or modify the original library.

Require an existing regular rooms.sqlite3; open it NOFOLLOW and retain its FD. Reject any nonempty rooms.sqlite3-wal or rooms.sqlite3-journal with explicit clean-shutdown/checkpoint guidance, preserving those bytes. Reject symlink/nonregular database sidecars. Empty regular sidecars are ignored. Recheck the complete sidecar set/identities/sizes immediately before publication, rejecting newly appeared nonempty WAL/journal or nonregular/symlink sidecars; no newly committed WAL state is silently excluded. Do NOT recover a hot journal, checkpoint the source, delete SHM/WAL, or pretend immutable SQLite includes WAL. SQLite opens only the pinned main DB through a fixed /proc/self/fd URI with mode=ro&immutable=1. No connection to a rebound user pathname. Preserve source file contents, schema, mtimes and directory entries; ordinary filesystem read-access timestamps may change. Set query_only, trusted_schema=OFF and a cancellable progress handler; enable no extensions or application SQL functions.

Before SELECTing documents, admit the actual schema: one ordinary rooms table with original id TEXT PRIMARY KEY and document TEXT NOT NULL columns, no generated/hidden columns, and its ordinary automatic unique index. Reject views, triggers, virtual tables, unexpected application tables/indexes and incompatible schema. The source schema is never copied or executed in the target. Read <=5 rows using a size guard on length(CAST(document AS BLOB)) before materializing document text. Validate every row ID/document and all existing room relations, not a selected room subset. Strict JSON: UTF-8, duplicate keys rejected at every depth, nonfinite numbers rejected, depth <=32, current exact room/nested keys, dense bounded arrays and safe revisions. Preserve memories referring to deleted songs; current metadata intentionally retains their trackId/trackTitle.

Source media must contain exactly the referenced room/track Ogg files; no symlink, nonregular or unreferenced media child is silently omitted. Empty room directories are permitted for rooms with no tracks; .jobs runtime state and lock/database sidecars are excluded. Unknown media entries reject with cleanup/recovery guidance, never delete them. Open each referenced media file relative to acquired directory FDs with NOFOLLOW, pin regular-file identity/size, and keep the FD through hash/decode/copy. Check captured identities and current entries again before final publication. Directory/file replacement detected during the operation rejects. This is not a sandbox against arbitrary malicious same-UID in-place mutation; copying verifies hashes again and acquired parents prevent textual path rebound cleanup.

## Playback policy: saved anchor, paused once

Archive rooms.json stores the validated ORIGINAL private room records, including original playback anchors. Create/inspect do not call effective_playback(), snapshot(), pause_all(), or otherwise accrue wall time. The archive manifest declares playbackPolicy='saved-anchor-paused'. Last saved anchor is not necessarily the last audible position.

Restore retains each original trackId/position, sets playing=false, and sets updatedAt to the one captured restore wall clock. If original playing was true, increment its ORIGINAL playback revision exactly once; if false, keep revision unchanged. Do not advance to another track/end using archive/restore/current wall time. Playlist revision and all other room fields remain unchanged. Normal startup pause_all sees paused records and therefore does not increment again or advance position; its normal timestamp rewrite is allowed. Stale pre-backup playing commands fail against the incremented revision. A previously paused command follows existing paused revision semantics, not an invented epoch reset.

## Exact archive format

Own ZIP_STORED dialect, no general extraction. ASCII entries in this exact order: manifest.json, rooms.json, then media/<roomId>/<trackId>.ogg sorted by room ID and track ID. No directory entries. IDs are exactly32 lowercase hex characters. Fixed DOS timestamp 1980-01-01 00:00:00, flags=0, method=0, no extra fields/comments/descriptors, no encryption/ZIP64/prefix/trailing bytes. Creator system=3 (Unix), creator version=20 and version-needed=20; external attributes exactly (stat.S_IFREG|0o600)<<16, internal attributes=0; no links or special-file type. CRC32 and declared SHA256 cover exact member bytes; checksums are integrity, not authenticity or encryption.

manifest.json has EXACT keys schemaVersion=1, kind='duet-library', createdAtMs, playbackPolicy='saved-anchor-paused', members. Each member EXACT {name,bytes,sha256}, listing rooms.json then all audio in archive order, never manifest itself. bytes is an exact integer: rooms.json1..MAX_ROOMS_JSON_BYTES and each audio1..MAX_AUDIO_BYTES; zero-byte audio rejects during format admission. sha256 is64 lowercase hex. Writer JSON is exactly json.dumps(value,ensure_ascii=False,allow_nan=False,sort_keys=True,separators=(',',':')).encode('utf-8'), with no final LF/BOM. Readers accept bounded valid whitespace/key ordering but reject duplicate/nonfinite/depth violations; canonicality is writer reproducibility, not a whitespace-based import rejection. Unknown keys reject. Manifest contains no credentials/hashes of seats, titles, participant names or filesystem paths.

rooms.json EXACT {schemaVersion:1,kind:'duet-library-records',rooms:[...]} with rooms sorted by ID, each ORIGINAL private schema1 room object. Preserve every original record value and array ordering inside tracks/playlist/memories, not raw SQLite JSON whitespace/key ordering; do not resort these arrays. No raw token or derived blend is added. Both capability hashes and pending invite hash are necessarily private contents of this complete offline archive. Every per-room canonical UTF-8 document must stay within256 KiB. Cross-member audio names must match exactly the active tracks, with no missing/extra payload; per-room IDs/capability/profile/ratings/playlist/memory constraints must validate.

Before constructing any ZipFile/list, read the fixed22-byte EOCD at exact EOF: one disk, matching bounded counts, no comment or ZIP64 sentinels, bounded central directory and exact offsets. Walk only that bounded central directory; cross-check all local headers/names/flags/method/CRC/sizes/offsets, disallow overlap/gaps/prefix/trailing data and duplicate names. Retain offsets in immutable index tuples. Re-read/copy only admitted extents; exact SHA256/CRC checked while streaming every member. Never extractall or deserialize SQL/database files. Reject the whole archive on any discrepancy.

## Frozen module contracts

Types use frozen dataclasses; tuples/bytes make nested public state immutable. NEW archive_common.py, owned by the state owner, defines ALL shared bounds plus ArchiveError(ValueError) constructor(code:str,message:str), readonly code property; codes input, busy, format, metadata, media, limit, cancelled, timeout, destination, storage. It also exports check_archive(cancel:Event,deadline:float)->None: validate a finite numeric deadline (not bool), reject invalid input, then cancellation before expired monotonic deadline. All four modules import this shared seam, preventing circular state/format imports. Common also exports parse_json(data:bytes,maximum:int,*,cancel:Event,deadline:float)->object: admit bytes/count first, valid UTF-8/noBOM, preflight depth<=32 outside escaped strings before json.loads, unique keys/nonfinite rejection, then iterative Unicode/NUL/finite validation and cancellation checks. This helper performs no room/manifest shape admission; state/format own their exact schemas. canonical_json(value:object)->bytes uses the exact serialization rule below, and callers apply their specific byte cap. No third-party cancellation framework. Public strings are fixed bounded actionable text and contain no raw subprocess diagnostics/private room values. Unknown exceptions become a generic CLI failure.

Exact archive_common.py constants (other modules import these names; legacy room limits may alias store.py but values below are fixed):

```python
SCHEMA_VERSION = 1
ARCHIVE_KIND = 'duet-library'
RECORDS_KIND = 'duet-library-records'
PLAYBACK_POLICY = 'saved-anchor-paused'
DATABASE_NAME = 'rooms.sqlite3'
LOCK_NAME = '.server.lock'
MEDIA_DIRECTORY = 'media'
MANIFEST_NAME = 'manifest.json'
ROOMS_MEMBER = 'rooms.json'
MAX_ROOMS = 5
MAX_TRACKS_PER_ROOM = 12
MAX_MEMORIES_PER_ROOM = 100
MAX_ROOM_BYTES = 256 * 1024
MAX_ROOMS_JSON_BYTES = 5 * MAX_ROOM_BYTES + 1024
MAX_DATABASE_BYTES = 16 * 1024 * 1024
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_MEMBERS = 62
MAX_CENTRAL_BYTES = 64 * 1024
MAX_MANIFEST_BYTES = 32 * 1024
MAX_JSON_DEPTH = 32
MAX_REVISION = 2**53 - 1
SAMPLE_RATE = 48000
MIN_DURATION = 1
MAX_DURATION = 300
MAX_PCM_BYTES = MAX_DURATION * SAMPLE_RATE * 4
BLOCK_BYTES = 65536
MAX_OGG_PAGE_BYTES = 65307
MAX_OGG_PAGES = 65536
OPERATION_SECONDS = 300.0
```

Output ancestry admission must reject every descendant of the acquired source root, including normalized `.`/`..`, nested not-yet-existing parents, lexical aliases and resolved symlink ancestry; output parent must already exist and is acquired component-by-component without following symlinks. Resolve only for admission comparison, never for subsequent source reads/copies or cleanup. Source-root inode/ancestry receipts are rechecked before publication. Destination/output paths remain CLI-only, never interpreted as archive names.

`archive_state.py` owns:

```python
@dataclass(frozen=True)
class TrackRecord:
    room_id: str
    track_id: str
    duration: float
@dataclass(frozen=True)
class LibraryRecords:
    rooms_json: bytes
    room_ids: tuple[str, ...]
    tracks: tuple[TrackRecord, ...]  # sorted room/track IDs, not playlist order
    memory_count: int
    paired_rooms: int
    pending_invites: int

def read_library(database_fd: int, *, cancel: Event, deadline: float) -> LibraryRecords: ...
def validate_rooms(data: bytes, *, cancel: Event, deadline: float) -> LibraryRecords: ...
def paused_rooms(records: LibraryRecords, restored_at_ms: float,
                 *, cancel: Event, deadline: float) -> bytes: ...
def write_database(directory_fd: int, rooms_json: bytes,
                   *, cancel: Event, deadline: float) -> None: ...
```

read_library is called only after orchestrator lock/WAL admission; it reads pinned immutable SQLite and validates all original records. validate_rooms accepts the exact archive envelope and returns canonical bytes. paused_rooms returns NEW validated envelope bytes; it never mutates the supplied records. write_database creates a trusted SQLite connection in MEMORY, uses the fixed original rooms schema and parameter-bound INSERTs in one transaction, commits, then Connection.serialize() produces the complete main DB (<=16 MiB). Write those bounded bytes into rooms.sqlite3 opened EXCL/NOFOLLOW relative to directory_fd and fsync before return. SQLite never opens a writable source/stage pathname or creates journal siblings; this avoids SQLite pathname canonicalization defeating a /proc directory spelling. Feature-test serialize availability before admission; unavailable runtimes fail explicitly. The current environment provides it (SQLite3.53.1; original empty schema serialized to12,288 bytes). No imported SQL, Store constructor, hot journal/WAL or source writes.

`archive_format.py` owns:

```python
@dataclass(frozen=True)
class ArchiveMember:
    name: str
    size: int
    sha256: str
@dataclass(frozen=True)
class ArchiveEntry:
    name: str
    offset: int  # payload offset after admitted local header
    size: int
    crc32: int
@dataclass(frozen=True)
class ArchiveIndex:
    created_at_ms: float
    entries: tuple[ArchiveEntry, ...]  # includes manifest first
    members: tuple[ArchiveMember, ...]  # manifest-declared rooms/audio
@dataclass(frozen=True)
class ArchiveSource:
    name: str
    fd: int
    size: int
    sha256: str

def read_index(fd: int, *, cancel: Event, deadline: float) -> ArchiveIndex: ...
def read_rooms(fd: int, index: ArchiveIndex,
               *, cancel: Event, deadline: float) -> bytes: ...
def copy_member(fd: int, index: ArchiveIndex, name: str, output_fd: int,
                *, cancel: Event, deadline: float) -> None: ...
def write_archive(output_fd: int, created_at_ms: float, rooms_json: bytes,
                  media: tuple[ArchiveSource, ...],
                  *, cancel: Event, deadline: float) -> None: ...
```

read_index admits physical layout and strict manifest, not room authenticity or media decoding. read_index allocates only its bounded manifest/central metadata; read_rooms is the only larger JSON payload read and enforces the rooms bound; it verifies CRC/hash. copy_member verifies exact extents/hash/CRC while copying into a separately opened owned output. write_archive builds declared metadata from validated rooms bytes and admitted source tuples, recomputes stream hashes/CRC, refuses source changes, and writes the one canonical dialect. Orchestrator validates all declared media relationships through LibraryRecords; parser/writer never interpret arbitrary filesystem names.

`archive_media.py` owns `validate_audio(fd:int,expected_duration:float,*,cancel:Event,deadline:float)->int`, returning exact decoded stereo frame count. Before decoder admission, walk the COMPLETE bounded Ogg page container: capture OggS/version0, valid header-type bits0..2, exact segment-table/body extents, one logical-stream serial, first-page BOS/sequence0, strictly successive sequence values, continuation/lacing consistency, one final EOS at exact EOF and no unfinished packet, page CRC with checksum bytes zeroed (polynomial0x04c11db7, initial0, non-reflected). No multiplex/chained stream/trailing garbage/truncated terminal page. Each page <=65,307 bytes and <=65,536 pages overall; check cancellation/deadline per page and bounded block. Retain no more than one page; no full file/packet allocation. This supplements full decoder validation, which alone may accept a file missing its EOS page. Use pinned /proc/<parentPID>/fd paths with existing bounded _probe/_run/_decode_args/_pcm_args helpers; no normalization or resolve() rebound. Require one Opus audio stream, stereo48kHz, whole decoded PCM within1..300s, and abs(frameCount-round(expected_duration*48000))<=1; finite duration and existing1..300s admission precede multiplication. Inspect decodes every track just like restore; header/probe alone cannot report a valid archive. Limits apply to children and aggregate remaining time.

`backup.py` owns the CLI, filesystem orchestration and final API:

```python
@dataclass(frozen=True)
class ArchiveSummary:
    schema_version: int  # 1
    rooms: int
    tracks: int
    memories: int
    paired_rooms: int
    pending_invites: int
    media_bytes: int
    archive_bytes: int
    playback_policy: str  # saved-anchor-paused

def create_archive(data_dir: Path, output: Path, *, cancel: Event | None = None) -> ArchiveSummary: ...
def inspect_archive(archive: Path, *, cancel: Event | None = None) -> ArchiveSummary: ...
def restore_archive(archive: Path, data_dir: Path, *, cancel: Event | None = None) -> ArchiveSummary: ...
def main(argv: list[str] | None = None) -> int: ...
```

`python -m duet.backup create --data-dir DIR --output FILE`, `inspect --archive FILE`, `restore --archive FILE --data-dir NEWDIR`. No force/merge/credential rotation. Existing python -m duet invocation remains unchanged. CLI prints only summary counts/bytes/playback policy and explicit separate-link requirement; no private names, hashes, packet data, tokens or source documents. Exit0 complete,2 rejected/error,130 cancelled. Main installs/restores signal handlers only on the main thread; API None creates its own cancellation Event. All three APIs capture one aggregate deadline and do full structural/metadata/media validation. inspect may use private temporary staging for bounded decodes; it never writes beside the input archive or mutates source data.

## Filesystem, publication and cleanup

Acquire source/archive/output/target-parent FDs without following symlink components. Require regular files; pin identities and sizes. Create output outside the source library by BOTH lexical path and acquired/resolved ancestry checks. Existing output rejects; write a private0600 temporary sibling under the pinned output-parent, fsync, check receipt/current entry/cancel/deadline, then atomic no-clobber link publication and parent fsync. No replace or source overwrite. Remove only the owned temporary child.

Restore requires absent target at admission and publication. Build a random0700 sibling staging directory under an acquired parent; create trusted database/media directories and0600 audio files through fd-relative EXCL/NOFOLLOW opens. Verify all media hashes/whole decodes, database and output directory identities; close SQLite, fsync each audio/database, all relevant directories and stage, then check cancel/deadline and publish using Linux renameat2(RENAME_NOREPLACE). Feature-test that syscall before admission; unsupported platform fails without staging. File/directory receipt checks detect replacement; rename strictly prevents destination overwrite but does not sandbox arbitrary same-user source races. No fallible content/identity lookups after successful rename; parent fsync follows for durability. The same durability outcome applies to both archive file and restored directory publication: if final parent fsync fails, report clearly that the COMPLETE target was published but durability is unconfirmed; do not delete it or claim rollback. Cancellation after publication is completion, not removal.

Startup uses the restored normal service lifetime lock creation and existing paused-record behavior. Restore does not merge into any existing destination, even empty. Failed validation/copy/transaction/rename/cancel removes only its still-owned stage through acquired parent/identity checks; replaced stage/name is never blindly recursively deleted. Source files and existing outputs/destination remain untouched. Archive input remains pinned throughout inspect/restore; no automatic retry of partially completed commands.

## Exclusive ownership and independent gates

1. State owner: NEW archive_common.py, archive_state.py and tests/test_archive_state.py; source SQLite schema/readonly admission, private records, safe revisions, checkpoint and trusted database reconstruction. No store.py changes needed.
2. Format owner: NEW archive_format.py and tests/test_archive_format.py; exact ZIP/manifest/bounds/CRC/hash streaming. Publish dataclasses/signatures early.
3. Media owner: NEW archive_media.py and tests/test_archive_media.py; reuse existing media guards without changing media.py or encoder contracts.
4. Orchestrator owner: NEW backup.py and tests/test_backup.py; source lifetime lock, FD ownership, CLI/API, full validation, no-replace/fsync/cancellation/cleanup. Other owners do not edit server.py/jobs.py/main.ts or existing CLI entry point.
5. Independent owner: NEW tests/test_archive_oracle.py and tests/browser/archive.spec.ts with independent fixture helpers; root may split these files across independent agents. Hand-created malformed containers/state/media expectations before producer reads.
6. Root docs/config/Git/issues/shared gates and measured maximum evidence; design author final read-only review. No producer test edits by oracle owner.

Native acceptance: build a real two-participant room with original normalized audio, opposing votes/custom order, both authors' dated memories and a deleted-song memory. Retain original private links outside archive; stop process, create/inspect/restore into a fresh directory, start new service, recover each seat independently, verify exact media hashes/native decoded playback/range responses, unchanged IDs/ratings/order/authorship, no tokens minted, used invite remains unusable. Separate unclaimed-invite fixture must still claim exactly once with its original raw invitation. Paused saved position/revision must remain stable across later wall clocks/restarts and old playing commands reject.

Source immutability tests hash ALL original files/tree before/after create and failed create, including already-present empty sidecars. Running lock, missing lock, nonempty WAL/hot journal, hostile schema/view/trigger, corrupt/oversized/duplicate room data and symlink/replaced media all reject without repair or artifacts. Strict archive tests cover physical header/footer/member overlap/duplicate/traversal/ZIP64/compression/bounds/metadata relations/hash/CRC and malformed Opus/full-duration mismatch. Cancel each phase; retain unrelated directories and preexisting outputs; race an empty target into existence immediately before rename and verify no overwrite. Inspect/restore failures do not alter archive bytes.

Root maximum gate uses NEW owned /workspace fixture directories, not scarce /tmp or existing evidence:5 rooms/60 tracks/100 memories each, exact8MiB legal Opus members when constructible without changing decoded content, <=512MiB archive, actual restore/decoded validation and unchanged hashes. Distinguish pure exact byte-bound format tests from verified normalized-media maximum fixtures; do not label padding/noncanonical media valid without actual decoder admission. Record real runtime/disk/RSS evidence and aggregate timeout limits. Existing Duet Python/TS/native suites remain intact. No claim of encrypted backups, network sharing, original-upload losslessness, participant-authenticated history or arbitrary same-UID sandboxing.
