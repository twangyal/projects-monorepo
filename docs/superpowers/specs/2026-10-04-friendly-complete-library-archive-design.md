# Friendly Challenges #103: complete offline private library archives

Frozen implementation contract, 2026-10-04, for issue #103. Root reviewed the current repository and prior archive conventions before authorizing implementation. The existing service on 4291 remains untouched. The current code uses `challenges.sqlite3`, `.server.lock`, SQLite schema 1/2, private record schema 1/2 and JPEG BLOBs in `evidence_images`. Unlike Duet, there are no media directories, playback anchors or runtime jobs to checkpoint.

## Complete usable operator flow

Stop the service cleanly, run `python -m challenges.backup create --data-dir DIR --output FILE`, optionally `inspect --archive FILE`, then `restore --archive FILE --data-dir NEW_ABSENT_DIR`. Start the ordinary service on the restored directory and use the separately retained original seat/invitation links. Existing claimed seats, pending invitations, IDs, revisions, terms, evidence, receipt-time lateness, arbiter nomination and resolution semantics remain unchanged. No merge, force, overwrite, HTTP archive endpoint, token rotation, lost-token recovery, new public record-import route or new browser UI.

The archive preserves each SQLite `record` TEXT value exactly as UTF-8 bytes, including whitespace/key order. Do not call `Store(...)`, its migration, `snapshot`, a command, current-clock consent checks or `domain.encode_json` to replace raw records during create/inspect. Use `domain.parse_json`/`validate_record` only for admission, with historical event-time replay unchanged. JPEGs remain exact reviewed bytes. Restore rebuilds trusted current SQLite schema 2; a legacy private schema-1 record remains exactly schema 1, with no new event or revision. Normal service startup subsequently validates these rows without rewriting them. Original source SQLite file bytes need not equal the rebuilt database; original record TEXT and JPEG bytes must.

The backup contains private capability/invitation **digests**, never newly minted raw links. The archive is not encrypted, signed, participant-authenticated evidence or proof that a photo is genuine. CRC/SHA identify retained bytes and detect accidental corruption; an attacker can construct another internally coherent archive. Preserve existing links separately. Do not output titles, captions, participant names, digests or raw private records in CLI logs, exceptions or summaries.

## Bounds and exact container

Use a new independent library ZIP_STORED dialect, not arbitrary `zipfile.extractall` or an imported SQLite file. No runtime dependency beyond current Python 3.11+ and Pillow 12.3.0. The only accepted payload paths are:

1. `manifest.json` first.
2. `records/<challengeId>.json`, sorted by challenge ID, zero to twenty entries.
3. `images/<challengeId>/<evidenceId>.jpg`, sorted by challenge ID then evidence ID, zero to 160 entries.

Both IDs are the existing exact 32 lowercase hex characters. No directory members or user-supplied paths. Separate raw record members avoid escaping a 1 MiB record into a larger JSON string and preserve TEXT bytes without normalization.

All shared constants belong to new `archive_common.py`:

```python
ARCHIVE_VERSION = 1
ARCHIVE_KIND = 'friendly-challenges-library'
DATABASE_NAME = 'challenges.sqlite3'
LOCK_NAME = '.server.lock'
MANIFEST_NAME = 'manifest.json'
MAX_CHALLENGES = 20
MAX_IMAGES_PER_CHALLENGE = 8
MAX_IMAGES = 160
MAX_RECORD_BYTES = 1024 * 1024
MAX_IMAGE_BYTES = 512 * 1024
MAX_IMAGE_SIDE = 1024
MAX_IMAGE_TOTAL_BYTES = 80 * 1024 * 1024
MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
MAX_DATABASE_BYTES = 128 * 1024 * 1024
MAX_MANIFEST_BYTES = 64 * 1024
MAX_CENTRAL_BYTES = 64 * 1024
MAX_MEMBERS = 181  # manifest +20 records +160 images
MAX_JSON_DEPTH = 32
BLOCK_BYTES = 65536
OPERATION_SECONDS = 300.0
```

The 100 MiB maximum raw record/image payload plus bounded manifest/headers/directory fits below 128 MiB. This is a byte/count bound, not measured heap or SQLite fragmentation capacity. Refuse an oversized source database; do not vacuum or repair it. Empty valid libraries are supported. User-version 1 sources cannot have image rows or private schema-2 image records. User-version 2 permits private schema-1 text-only rows and schema-2 image rows.

Each manifest has exact keys `{schemaVersion:1,kind:'friendly-challenges-library',createdAtMs,sourceSchemaVersion,members}`. `createdAtMs` is a nonnegative safe integer captured once; `sourceSchemaVersion` is exactly integer 1 or 2. Each member descriptor is exactly `{name,bytes,sha256}`, listing every nonmanifest member in archive order. Record bytes are 1..1 MiB; image bytes are 1..512 KiB; SHA is exactly 64 lowercase hex. Manifest writer uses compact sorted-key `ensure_ascii=False,allow_nan=False` UTF-8 JSON, no BOM/LF. Readers allow bounded whitespace/key order but reject duplicate keys, nonfinite/unsafe metadata numbers, invalid Unicode/NUL and depth >32. Record admission uses the existing stricter domain authority and a before-parse depth scan; it does not normalize the raw payload.

Require exactly the proven Duet physical ZIP dialect: method/flags 0, fixed DOS epoch 1980-01-01, version-needed 20, creator Unix/version20, internal attributes0, external `(stat.S_IFREG|0o600)<<16`. No compression, encryption, UTF-8 flag, extras, comments, descriptors, ZIP64, links/special files, prefix, gaps, overlapping extents, duplicate paths or trailing bytes. Read fixed EOCD at exact EOF before allocating the bounded central index; cross-check every local header/offset/name/size/CRC against the directory and manifest. Stream SHA/CRC for every member, with exact bounds/cancellation between blocks. Recheck archive file identity/size before publication. Do not accept a physically valid container without replay-valid private records, exact media membership and complete image decode.

For each admitted record, ID must equal its member ID. Derive the image descriptor set from its retained evidence, then require exact one-to-one `(challengeId,evidenceId)` association with image members and BLOB rows: no missing, duplicate, orphaned, extra or text-only-entry media. Descriptor MIME/dimensions/bytes/hash must equal `images.validate_jpeg(original_bytes)`. That current function already enforces exact normalized JPEG framing, RGB single-frame Pillow decode, 1024-side limit, metadata policy and complete EOF. No normalization or JPEG re-encoding in archive code. Every create/inspect/restore validates every declared JPEG; inspecting headers/hashes alone cannot report a complete valid archive.

## Stopped-source ownership and publication

Acquire all source/archive/output/target-parent directories component-by-component with directory FDs and NOFOLLOW. Source must exist and contain an existing regular `.server.lock`; obtain its nonblocking exclusive flock without creating/truncating/writing it, and keep it through validation/copy/publication. A running service rejects as busy. Require the regular `challenges.sqlite3` and reject nonempty WAL, SHM or rollback-journal siblings; permit existing zero-byte regular sidecars without changing them. Reject unknown source children, symlinks and nonregular children with preserve/cleanup guidance. No source child is silently excluded. Lock/source/database identities and actual current entries are rechecked before publication; this is cooperative locking, not a malicious same-UID sandbox.

Read the pinned database using a readonly immutable SQLite URI through its FD, `trusted_schema=OFF`, query-only, bounded schema/row reads and SQLite progress-handler cancellation. Admit exactly the existing tables/autoindexes and trusted SQL/columns for user-version1/2; reject views, triggers, virtual tables, custom collations or unsupported objects before table queries. Bound row counts/types/byte lengths in SQL before materializing TEXT/BLOB values. No source `BEGIN IMMEDIATE`, SQLite backup/migration, journal recovery or writable connection. File hash/identity checks before and after provide source immutability evidence; do not assert filesystem access times remain unchanged merely because bytes do.

Create output outside the source root by lexical **and** acquired/resolved ancestry checks, including nested absent parents, `.`/`..` and symlink aliases. Require an existing acquired output parent and absent final name. Write a random owned 0600 sibling, fsync, verify receipts/deadline, then no-clobber hard-link publication and unlink only the owned temporary name; fsync parent. Never overwrite an existing archive.

Restore requires an absent destination at admission and publication, even if an existing destination is empty. Feature-test Linux `renameat2(RENAME_NOREPLACE)` before staging; fail explicitly on unsupported systems. Build a random 0700 sibling under the pinned parent. Stream admitted image members into owned 0600 temporary staging files through EXCL/NOFOLLOW opens; their names are internally derived IDs, never archive extraction paths. Revalidate hashes/JPEGs before trusted database construction. Build an in-memory SQLite database using the current fixed schema, bound parameter INSERTs of **original** TEXT and JPEG bytes, commit and `Connection.serialize()`; verify resulting DB <=128 MiB and write it EXCL/NOFOLLOW/fsync under the acquired stage FD. No imported SQL or writable SQLite stage pathname. Feature-test serialize support before admission.

Temporary image staging is outside the source/archive and may consume up to80 MiB; database reconstruction can hold up to128 MiB of serialized bytes in addition to SQLite's own memory. Do not call these limits a measured RSS bound. Remove only still-owned temporary image children before publication, leaving exactly the trusted database (normal service creates its new lock). Fsync database/stage/parent and publish the complete directory with rename-no-replace. Receipt-checked cleanup must not recursively delete a replaced staging path. Cancellation/error leaves original data, archive bytes, preexisting destinations and unrelated siblings unchanged. Final parent-fsync failure after successful publication reports **complete target published, durability unconfirmed**; do not delete it or falsely claim rollback. No fallible content validation after publication. Cancellation after publication is completion.

One aggregate monotonic 300-second budget and cancellation Event apply to all phases. Check before/after SQLite statements and record replay, per streaming block and JPEG decode. Existing Pillow decode is a bounded512KiB/1MP native step; cancellation/deadline is observed before/after it, not a claim that arbitrary native code can be preempted. CLI installs/restores SIGINT/SIGTERM handlers on the main thread; source lock remains held through cleanup. Do not add threads/models or an unnecessary JPEG re-encode worker. APIs fail with bounded fixed actionable messages, never raw database/private content. Exit0 success,2 rejection,130 cancellation.

## Frozen module/API boundaries

1. **State/common owner:** new `archive_common.py`, `archive_state.py`, `tests/test_archive_state.py`. Common owns constants and `ArchiveError(code,message)` with readonly code (`input,busy,format,metadata,media,limit,cancelled,timeout,destination,storage`), `check_archive(cancel,deadline)`. State owns original schema admission, exact private TEXT replay/relationships, safe DB rebuild. Existing `domain.py`/`store.py` are read-only authorities; do not alter their semantics.

```python
@dataclass(frozen=True)
class RecordSource: challenge_id: str; raw: bytes
@dataclass(frozen=True)
class ImageRecord:
    challenge_id: str; evidence_id: str; size: int
    width: int; height: int; sha256: str
@dataclass(frozen=True)
class LibraryRecords:
    source_schema_version: int; records: tuple[RecordSource,...]
    images: tuple[ImageRecord,...]
    evidence_count: int; claimed_seats: int; pending_invites: int
@dataclass(frozen=True)
class ImageFile: record: ImageRecord; fd: int
def read_library(database_fd:int,*,cancel:Event,deadline:float)->LibraryRecords: ...
def validate_records(records:tuple[RecordSource,...],source_schema_version:int,
                     *,cancel:Event,deadline:float)->LibraryRecords: ...
def copy_library_image(database_fd:int,image:ImageRecord,output_fd:int,
                       *,cancel:Event,deadline:float)->None: ...
def write_database(directory_fd:int,records:LibraryRecords,images:tuple[ImageFile,...],
                   *,cancel:Event,deadline:float)->None: ...
```

`read_library` returns raw record bytes and media descriptors, not all JPEGs. `copy_library_image` performs a bounded exact-type/length SQL fetch of one512KiB maximum BLOB, verifies expected bytes/hash while copying to a separately owned stage; no persistent source connection crosses unrelated modules. `write_database` requires exact ImageFile membership and rechecks bytes/hash before bound INSERT; ordinary service lock creation is not part of archive reconstruction. Raw records remain sorted only at the outer library level; their arrays/key order/whitespace are never changed.

2. **Format owner:** new `archive_format.py`, `tests/test_archive_format.py`; strict byte dialect/manifest/streaming integrity. Frozen dataclasses `ArchiveMember(name,size,sha256)`, `ArchiveEntry(name,offset,size,crc32)`, `ArchiveIndex(created_at_ms,source_schema_version,entries,members)`, `ArchiveSource(name,fd,size,sha256)`. APIs `read_index(fd,*,cancel,deadline)->ArchiveIndex`, `read_records(fd,index,*,cancel,deadline)->tuple[RecordSource,...]`, `copy_member(fd,index,name,output_fd,*,cancel,deadline)->None`, `write_archive(output_fd,created_at_ms,source_schema_version,records,media:tuple[ArchiveSource,...],*,cancel,deadline)->None`. All immutable cross-module dataclasses (RecordSource, ImageRecord, LibraryRecords, ImageFile, ArchiveMember, ArchiveEntry, ArchiveIndex, ArchiveSource, ArchiveSummary) live in archive_common.py. State and format do not import each other. ArchiveIndex.entries includes manifest first and all other entries in canonical container order; members contains only nonmanifest descriptors. Writers own no filesystem publication; callers own FD lifetimes. Every source/copy verifies original extents, CRC/SHA; no general zip extraction.

3. **Media owner:** new `archive_media.py`, `tests/test_archive_media.py`; `validate_image(fd:int,expected:ImageRecord,*,cancel:Event,deadline:float)->None`. Read one bounded regular file, exact EOF/hash/descriptor and original `validate_jpeg` actual decode. Do not edit `images.py` or accept padding/metadata unsupported by the existing normalization policy.

4. **Orchestrator/CLI owner:** new `backup.py`, `tests/test_backup.py`; `create_archive(data_dir:Path,output:Path,*,cancel:Event|None=None)->ArchiveSummary`, `inspect_archive(archive:Path,*,cancel:Event|None=None)->ArchiveSummary`, `restore_archive(archive:Path,data_dir:Path,*,cancel:Event|None=None)->ArchiveSummary`, `main(argv:list[str]|None=None)->int`. Summary frozen fields: `schema_version,source_schema_version,challenges,evidence,images,claimed_seats,pending_invites,media_bytes,archive_bytes`. Counts/bytes only. Orchestrator owns every stage/file FD/lifetime receipt and the CLI; no server/Store/ordinary CLI changes.

5. **Independent oracle owner:** new `tests/test_archive_oracle.py` and original literal fixture helper; freeze hand-authored physical/header/footer/member/JSON/private replay expectations before producer reads. Include old valid schema1 raw TEXT with unusual whitespace and a literal Unicode record; private versions1/2/image append; exact corruptions/missing images/hostile SQL; full membership/hash/state revisions/digest preservation; running lock/late target no-clobber/cleanup/cancel and source unchanged after every failure. Do not use producer writer to generate all negative fixtures or producer output to decide expectations.

6. **Independent native/maximum owner:** new `tests/browser/archive.spec.ts` and `scripts/smoke_library_archive.py`; retain separately generated original raw links only in private runtime artifacts. Root schedules shared builds/services and maximum media. Test real proposer/opponent/arbiter agreement/evidence/resolution, pending opponent/arbiter invitations, old used/withdrawn invitation refusal and later accepted deadline behavior after restore. Exact auth/JSON/JPEG/full HTML exports remain usable through new process and same raw links, with no minted credentials.

Root owns final reviewed repository spec/plan, docs/config/version, port scheduling, original service protection, commits/push/CI and maximum reports. No producer edits another owner's code. A separate read-only source review follows coherent modules; preserve existing86 Python/37 TypeScript/24 native gates and subsequent header regressions unchanged.

The state/common owner also owns the narrow archive_media.py validator and its producer tests. Separate format and orchestration owners implement their modules. Independent oracle and native acceptance owners freeze expectations without reading those new implementations first. Existing Store/domain/image semantics remain unchanged.

## Independent acceptance and honest limits

Freeze exact raw TEXT/JPEG hashes, IDs/revisions/full historical snapshots and capability digests **before** backup. One native fixture includes allthree claimed seats and a settled dispute; a second retains a claimable original opponent invite; a third retains approved unclaimed arbiter invite; include legacy schema1 text-only records and exact expired original deadlines. Create/inspect must not change even one source file byte or row. Restore into another absent directory, start a distinct process, use original links, independently inspect record TEXT in SQLite and exact JPEGs, claim pending invite once, reject consumed/withdrawn links, append allowed evidence/settle only under unchanged domain rules. Current wall clock may affect public `deadlinePassed`/late acceptance naturally, never mutate history during archival restore.

Maximum uses the prior independently verified legal fixture idea: twenty challenges/eight images each,160 **existing-policy-valid** exact512KiB JPEGs (80MiB) plus varied original raw record content. Byte padding must obey current JPEG/JFIF policy and actually decode. Each archive API validates all160, exact hash compare afterrestore/restart, complete eight-image HTML remains byte-exact for JPEGs/publicaudit. Record separate original canonical/raw sizes, sourceDB/archive/restoredDB sizes, runtime/disk and measuredRSS if observed; do not assert every record1MiB canonical ceiling is naturally attainable. Raw whitespace file/record bounds and128MiB container/+1 are separate adversarial format gates.

Both input archive and output library are operator-private data; no browser token storage is included. Missing raw links cannot be recovered from hashes. The milestone is a complete local backup/restore flow, not live online snapshots, encrypted storage, malicious same-user isolation, public hosting or verified testimony.
