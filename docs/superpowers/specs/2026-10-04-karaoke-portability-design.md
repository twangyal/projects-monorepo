# Karaoke Studio: complete editable project archives

Tracker: [issue #59](https://github.com/twangyal/projects-monorepo/issues/59). This is the contract for implementation after root review. Root owns integration, documentation, Git and tracker updates; this document does not release implementation by itself.

## Product outcome and scope

A person can back up one saved clip, restore it into a different local library without installing or running the separation model, reopen it after a genuine service restart, and continue waveform timing or export SRT/MP4. The archive preserves the three normalized WAV files byte for byte, saved title/cues and saved revision. Restore always creates a fresh local project ID. It never replaces a clip or the active editor.

The archive contains saved fields only. A dirty or invalid lyric draft does not prevent backing up the saved revision; it is not silently saved, validated as if saved, or included. Import, failure, cancellation and status recovery preserve current raw title, lyric paste, cue text and numeric spellings, history/redo, selected audio/time, waveform and existing video link. Opening an imported clip is a separate action with the existing unsaved-edit leave guard.

Checksums detect corruption; they do not authenticate the producer, separation quality, rights to the recording or processing claims. Every imported clip remains visibly imported with unverified provenance, including after restart and re-export. This milestone adds no inference, model download, network service, compression, library-wide archive or generic ZIP importer.

## Existing architecture to preserve

Projects remain schema 1 records validated by `karaoke/model.py`, stored under a 32-lowercase-hex directory with `project.json`, `source.wav`, `vocals.wav`, `backing.wav` and optional `processing.json`. Existing audio, lyric, video, delete, waveform and timeline contracts stay intact. The lifetime data-directory lock, retained directory FDs, inode checks, loopback Host/Origin/Fetch-Metadata checks, mutation token, one global upload reservation, one media job, 20-project quota and owned cleanup remain mandatory.

`validate_project` deliberately normalizes away unknown keys and accepts unbounded nonnegative revisions. Archive validation therefore checks exact keys/types and its portable revision bound before invoking that validator; it must not advertise stricter guarantees than the existing validator supplies.

## Archive version 1

Filename extension is `.karaoke.zip`; MIME is `application/zip`. The container is this application's ZIP_STORED format, not an arbitrary ZIP. Exactly five or six regular file entries appear in this physical and central-directory order:

1. `project.json`
2. `source.wav`
3. `vocals.wav`
4. `backing.wav`
5. `processing.json`, only when present
6. `manifest.json` (fifth when processing is absent)

No paths, directories, links, other files, model weights, videos, archive caches, input uploads, waveform caches or private absolute paths are included. Export writes fixed DOS time 1980-01-01, ASCII names, regular Unix mode `0600`, no archive/member comments or extra fields, no encryption, data descriptors or ZIP64. Import accepts only these same structural properties; it does not rewrite a generic WAV or ZIP into this format.

`manifest.json` has exactly these keys:

```json
{
  "schemaVersion": 1,
  "kind": "karaoke-studio-project",
  "origin": "local-library",
  "audio": { "sampleRate": 44100, "channels": 2, "sampleWidth": 2, "frames": 44100 },
  "files": [
    { "name": "project.json", "bytes": 123, "sha256": "64 lowercase hex characters" },
    { "name": "source.wav", "bytes": 176444, "sha256": "64 lowercase hex characters" },
    { "name": "vocals.wav", "bytes": 176444, "sha256": "64 lowercase hex characters" },
    { "name": "backing.wav", "bytes": 176444, "sha256": "64 lowercase hex characters" }
  ]
}
```

The illustrative hash/length above are placeholders, not a valid fixture. `origin` is exactly `local-library` or `imported-declared`. `files` lists every member except the manifest, in physical order; optional processing is last in that array. Each item has exactly `name`, `bytes`, `sha256`; sizes are exact positive integers, hashes match streamed raw bytes. The manifest has no self-hash. Source identity and revision are the exact captured fields in `project.json`; no second competing identity is stored in the manifest.

Project keys are exactly `schemaVersion,id,title,duration,revision,cues`; cue keys exactly `start,end,text`. Apply existing Unicode/code-point, finite duration and cue-order validation. Portable revision is an exact integer in `0..2147483647`; a local project outside this range cannot be archived, with an actionable error and its files untouched. Import validates original ID and revision, then changes **only** ID in the project record. Title, cue order/text/times, duration and revision retain their saved values. Import serialization may change JSON whitespace; all three WAVs and optional processing bytes are copied exactly.

All JSON is strict UTF-8 without BOM, duplicate keys, nonfinite numbers, NUL or malformed Unicode. Maximum nesting is 16; numeric literals are bounded before conversion (at most 32 characters) and root/member keys and types are exact, including rejecting booleans as integers/numbers. Detect excessive nesting/number lengths without first allocating an unbounded recursive object. Reject unknown keys rather than silently dropping them. Existing validated literal Unicode, angle brackets and newlines remain data.

### Bounds and audio invariants

Add these constants to `karaoke/archive.py` (no change to the 64 MiB audio upload allowance):

```python
MAX_ARCHIVE_BYTES = 160 * 1024**2
MAX_MANIFEST_BYTES = 8 * 1024
MAX_PROCESSING_BYTES = 16 * 1024
MAX_ARCHIVE_CENTRAL_BYTES = 4096
MAX_ARCHIVE_ENTRIES = 6
MAX_PORTABLE_REVISION = 2147483647
ARCHIVE_TIMEOUT = 180
```

Both stored-file bytes and summed uncompressed member bytes are at most 160 MiB. Project metadata remains at most existing `MAX_JSON_BYTES` (256 KiB); each WAV remains at most `MAX_WAV_BYTES` (52,924,096). Retain the 1 GiB free-space admission and 800 MiB job scratch ceiling. Processing/archive failures never delete an existing completed clip. One cached archive per project permits at most 20 × 160 MiB = 3,200 MiB additional retained archive storage, separate from existing audio/video storage. Replacement does not accumulate archive versions; startup removes unfinished work, not completed archive caches.

Each WAV is the exact canonical format produced by the current source/stem writers: 44-byte little-endian RIFF/WAVE header, one `fmt ` chunk of length 16, PCM format 1, stereo, 44,100 Hz, byte rate 176,400, block align 4, 16 bits, then one `data` chunk and EOF. Reject ancillary chunks, floats, RF64, odd/incomplete frames, inconsistent RIFF/data lengths and trailing bytes. Its actual length is `44 + frames * 4`, with `44100 <= frames <= 13230000`. All three actual frame counts and manifest frames agree; project duration equals `frames / 44100` exactly using the ordinary binary float computation used by the current producer. Do not trust only `wave.getnframes()` or manifest sizes. Export also enforces these invariants before cache publication. No samples are transcoded, normalized again or trimmed.

### ZIP admission before constructing ZipFile

Read the final 22 bytes and require a single-disk, zero-comment EOCD at exact EOF, five/six entries, central-directory size at most 4096, and central-directory end at EOCD. Reject ZIP64 records/locator, prefixes and trailing bytes. Parse only that bounded central directory before creating any `ZipFile`/entry list. Require the fixed names/order above, unique names, stored method, no flags, comments, extras, links or non-regular modes, equal stored/uncompressed sizes and correct per-entry bounds.

Cross-check every central record against its local header (name, CRC, sizes, flags, method and zero extra length). Local header/payload ranges begin at offset 0, are contiguous in the prescribed order, do not overlap, and end exactly at the central directory. This excludes hidden/prefixed payloads and data descriptors. Bound offsets and arithmetic against the actual file length before reading. Never call `extractall` or use a member name as a filesystem path.

Use at most 64 KiB streaming buffers, SHA-256 and CRC-32 verification, actual byte counts, and cancellation/deadline checks before/between stages and every block. File contents are copied only to known fixed names through retained destination FDs. No full-song byte array, `ZipFile.read` of a WAV, browser-sized archive buffer or decompression is permitted.

## Portable processing and permanent provenance

Processing is optional. A missing file is valid and is shown as “Processing metadata not supplied.” An existing file must be a strict bounded JSON object with a subset of these keys, no unknown fields, and no paths or free-form messages. Preserve its exact accepted bytes:

| Keys | Type and bound |
| --- | --- |
| `model` | Exactly `spleeter:2stems` |
| `modelRelease` | Exactly `v1.4.0` |
| `modelArchiveSha256` | 64 lowercase hex characters |
| `spleeterVersion`, `tensorflowVersion` | 1–64 ASCII characters matching `[A-Za-z0-9.+_-]+` |
| `offlineNetworkAttempts` | Exact integer `0..1000000`; a claim, not proof |
| `peakRssKiB` | Exact integer `0..1000000000` |
| `workerSeconds`, `inferenceSeconds` | Finite number `0..1000000` |
| `sourcePeak`, `stemPeak` | Finite number `0..1000000` |
| `sourceGain`, `stemGain` | Finite number `0..1` |
| `frameCount`, `sampleRate`, `duration` | If supplied, match actual frames, 44100 and actual duration |
| `chunkScheme` | Exactly `linear-sample-center-overlap` |
| `windowFrames`, `overlapFrames`, `hopFrames` | Exact integer respectively `1..1323000`, `0..88200`, `1..1323000` |
| `windowCount` | Exact integer `1..11` |
| `windowRanges` | At most 11 exact `{start,frames}` objects, nonnegative integer start and positive integer frames, each range within actual audio; starts strictly increase; if windowCount supplied, counts match |

Legacy recognized subsets remain supported, including an empty object. These bounds admit current producer metadata; they do not establish an inference run occurred. Unknown/private metadata rejects the archive operation visibly; do not silently redact provenance or mutate the original file.

Import writes an internal `archive-origin.json`, at most 4096 bytes, before publication. Exact keys are `schemaVersion` (1), `sourceProjectId` (validated original ID), `sourceRevision` (portable revision), `archiveSha256` (SHA-256 of the entire uploaded archive), `declaredOrigin` (manifest origin). This sidecar is not an archive member. Its presence forces subsequent manifests to `origin: imported-declared`, regardless of the supplied declaredOrigin. Repeated import captures that archive's immediate source ID/revision/hash without building an unbounded ancestry chain.

Missing sidecar means a pre-existing local clip, not authenticated quality; malformed, symlinked or oversized sidecar fails provenance/backup visibly rather than reverting to “local.” An archive-info failure shows “Provenance unavailable” and keeps backup unavailable until resolved; it does not prevent an otherwise valid existing clip from opening, editing, auditioning or exporting ordinary SRT/MP4. Fetch provenance separately with the current project-generation guard, and do not convert its failure into an openProject failure. Processing claims on imported clips are always labeled “Imported audio and processing claims — unverified,” across restart/re-export. Local records are labeled “Stored in this local library — not independently authenticated.” Never change a model-ready flag based on an imported claim.

## Frozen archive engine API

New `karaoke/archive.py` uses Python stdlib only and imports existing project/audio limits. It owns strict format/metadata/RIFF validation, streaming/hash/CRC, provenance helpers and cooperative deadline. Server owns job reservation, retained directory identity, quota and publication. Exact exports:

```python
class ArchiveError(ValueError): ...

@dataclass(frozen=True)
class ArchiveResult:
    project: dict             # detached validated saved/new project
    frames: int
    origin: str               # manifest origin; imported result always imported-declared
    has_processing: bool
    archive_sha256: str       # whole archive hash
    output_identity: tuple[int, int]  # (st_dev, st_ino) of created ZIP/complete directory

def export_archive(project: dict, project_fd: int, work_fd: int,
                   cancel: threading.Event,
                   stage: Callable[[str], None]) -> ArchiveResult: ...

def import_archive(work_fd: int, project_id: str,
                   cancel: threading.Event,
                   stage: Callable[[str], None]) -> ArchiveResult: ...

def read_archive_project(source: BinaryIO) -> dict: ...
def read_archive_origin(project_fd: int) -> dict | None: ...
```

`export_archive` never changes project files. It opens only fixed source names with `O_NOFOLLOW|O_NONBLOCK`, checks regular files/size and writes a new fixed `export.karaoke.zip` through work_fd with exclusive creation. It copies saved project JSON from its detached validated argument, validates optional processing/sidecar, streams the audio and builds manifest. On success that file is complete and validated; it returns detached metadata plus output_identity captured by fstat from the original engine-created ZIP FD before closing it. On failure it may leave work-owned partial files for the server's anchored cleanup; it never publishes.

`import_archive` opens fixed `input.karaoke.zip` through work_fd with the same protections, validates bounded container and all data, creates exclusive `completed` directory through work_fd, and writes only project/three WAVs/optional processing/origin sidecar there. Fresh project_id is validated independently. Success returns the new validated project and metadata plus output_identity captured by fstat from the engine-created completed directory FD, with complete files flushed/closed before return. The service must not adopt a later replacement child as the validated output: its subsequently acquired completed FD and current work entry must match this receipt before publication. Neither function closes supplied FDs or trusts a caller-owned string path.

`read_archive_project` preserves caller ownership of the seekable stream and validates the bounded ZIP layout plus strict manifest/project and their project entry checksum, returning a detached original saved snapshot. It does not rehash WAVs on every cache download: the server cache was fully validated at publication. It rejects malformed/changed metadata. `read_archive_origin` opens only the fixed sidecar, returns a detached validated object or None for genuinely absent, and rejects all other failures. ArchiveError messages are fixed actionable bounded text without paths, token values or arbitrary supplied content. Job cancellation/deadline failures are equally bounded and clean up through existing work ownership.

## Service and publication contract

Extend job kinds to `separate | export | archive-export | archive-import`; retain existing snapshot shape. `JobManager.exporting(project_id)` protects both video and archive export from same-project PUT. Existing DELETE guard covers every active same-project kind. Export/restore are independent of `model_ready`, but serialize with all existing jobs, audio/archive uploads and shutdown. No model import/call is allowed in an archive path.

| Route | Contract |
| --- | --- |
| `GET /api/session` | Existing fields plus exact integer `maxArchiveBytes = 167772160` |
| `POST /api/projects/{id}/archive` | Token-protected exact JSON `{revision}`. Portable exact integer matching current saved revision or 409. Returns 202 `{job}` of kind archive-export. Empty cues allowed. |
| `GET/HEAD /api/projects/{id}/archive` | Completed cache as ZIP attachment, native range semantics. Missing 404; malformed/stale saved revision or ID 409. |
| `POST /api/archives` | Token-protected raw native File body, Content-Type `application/zip` or `application/octet-stream`, explicit single Content-Length `1..MAX_ARCHIVE_BYTES`, no Transfer-Encoding. Returns 202 `{job}` of kind archive-import after full upload. |
| `GET /api/projects/{id}/archive-info` | `{imported:boolean, processingSupplied:boolean, origin:'local-library'|'imported-declared', sourceProjectId:string|null, sourceRevision:number|null, archiveSha256:string|null}` from validated sidecar/files; no paths. |

Security gates match current routes. Raw upload uses existing 64 KiB streaming, 5-second idle and absolute 60-second upload deadline; a separate 180-second worker deadline starts with archive processing. Reserve `server.uploading` under lock before reading, skip only the model-ready gate, and clear it exactly once on every exit. Reject occupied job/upload, full library and insufficient free space before admitting; repeat quota/storage checks at publication. The upload file remains work-owned; incomplete/failed upload cleans only that acquired work directory. No decoding/inference runs.

Export snapshots validated project metadata/current revision and source directory identity under lock. Expensive copying/hashing runs outside it through pinned FDs. At publication, recheck cancellation, storage identity, saved revision and source inode under the JobManager lock. Acquire the completed work ZIP with NOFOLLOW, require its regular type and both FD/current-name identity to match the engine output_identity receipt, and repeat that work-entry identity check immediately before publication. A single `os.replace` of that work's complete `export.karaoke.zip` installs `archive.karaoke.zip` relative to the acquired project FD. No separate marker transaction exists; captured ID/revision in the archive itself determine freshness. A failed replace/cancel keeps any prior archive intact. Job resultUrl is `/api/projects/{id}/archive`.

Download opens a regular NOFOLLOW pinned cache FD under lock, checks its bounded captured project ID/revision against current saved state, then streams/ranges outside the lock. A future lyric save makes the prior cache stale, not falsely current. A save racing an already-admitted download does not alter its pinned immutable snapshot; that request still receives its admitted saved revision. Do not delete or replace a cache until a completed archive is ready. Generate safe attachment filename from saved title using the existing filename helper, not a current unsaved editor value.

Import chooses a fresh random 32-hex ID before starting the job; it never interprets supplied source IDs as destination paths. After full validation, acquire completed FD **before** rename and require its inode/current entry to match the engine output_identity receipt; capture that verified identity for map publication. A detected replacement child must fail rather than become trusted output. Recheck the current completed entry against the receipt immediately before the no-replace rename. Publication rechecks acquired parents, current quota, cancellation and destination filesystem absence (including unindexed/unreadable existing directories). An existing destination is never replaced: choose another ID before work or fail safely, not rename-overwrite. Publication uses atomic Linux `renameat2(RENAME_NOREPLACE)` through the acquired parent FDs, not a check followed by overwrite-capable os.rename. Under lock, move the complete directory with that primitive, then install already prepared project/inode map entries with no fallible post-rename filesystem operation. The completed directory becomes visible exactly once; failures before rename have no visible clip. Job resultUrl is `/api/projects/{newId}`. Cleanup only removes retained work-owned files; it cannot traverse restored/replaced parent paths or remove other clips.

Ownership guarantees are precise: acquired parent FDs and explicit output receipts reject detected parent/child replacement, and RENAME_NOREPLACE atomically prevents destination overwrite. A name-based rename cannot atomically compare its source inode; this local service does not sandbox arbitrary same-UID mutation of individual files/children between checks. Do not claim a general malicious same-user race defense or cryptographic source authentication. This preserves the existing README threat-model boundary rather than broadening it.

Restore support is explicitly Linux, matching the current service’s procfs/fcntl ownership machinery; no extra dependency is installed. The service owner adds exact internal helpers `_require_archive_restore_support() -> None` and `_rename_noreplace(source_fd: int, source_name: str, destination_fd: int, destination_name: str) -> None` in server.py. Use stdlib ctypes to bind libc renameat2 with declared argument/return types, `use_errno=True`, and flag 1 (RENAME_NOREPLACE). Check Linux/symbol/kernel availability before archive upload admission; unsupported platforms receive an actionable bounded error before accepting a body/job. Kernel/filesystem unsupported errors at publication fail closed; no overwrite fallback. Translate existing destination EEXIST/ENOTEMPTY to a collision failure preserving that directory, and propagate other errors safely with owned cleanup. Test a destination created between preflight and the actual call, including an empty directory, remains untouched. Names are only fixed completed/random validated IDs; no user-controlled path reaches ctypes.

A native upload abort before receiving 202 may race server acceptance. UI states uncertainty, never blindly repeats the restore or cancels a different active job. Provide in-page library/job discovery that preserves the editor; reload is not required to recover status. Existing loopback service is not a secure remote deployment and the archive is unencrypted private audio/lyrics, clearly disclosed in README.

## UI contract and lifecycle

Preserve existing accessible labels. Add:

| Control | Stable ID / behavior |
| --- | --- |
| **Back up saved clip** | `archive-backup`, selected saved project only; allowed with dirty/invalid draft; sends saved working.revision, never saves implicitly |
| **Download saved archive** | `archive-download`, native anchor only for the current completed saved-revision cache; rely on server saved-title Content-Disposition, never an unsaved-title download attribute |
| **Import project archive** | `archive-file`, labeled file input; preflight size only, sends File directly without ArrayBuffer/Blob duplication |
| **Cancel archive upload** | `archive-upload-cancel`, aborts pending native fetch; uncertainty disclosure if no accepted job response |
| **Check restore status** | `archive-recheck`, explicit in-page session/library discovery plus retry of current clip archive-info under captured project/epoch; no automatic editor replacement/upload retry/cancel |
| **Open imported clip** | `open-imported`, explicit completed-result action using mayLeave |
| Provenance and saved-only copy | `archive-status`, persistent current saved clip provenance and “Unsaved lyric edits are not included.” |
| Imported result | `archive-result`, literal title and new library entry; no raw processing/path text |

Archive controls share currentJob/requestingJob/loading/saving exclusion; they are not disabled by modelReady. Keep editor fields' actual DOM values through busy states; renderCues/openProject are forbidden in archive export/import terminal handling. Existing controls() updates readiness without resetting drafts. End any active timing gesture safely before starting work; do not clear LyricHistory or commit a no-op. Keep current audio/waveform/time/video links and playback state; archive result publication does not select the new item automatically.

Import completion refreshes only library entries, then exposes Open imported clip. Its leave guard must cover current dirty/pasted/raw cue timing edits. Canceling that guard keeps the current editor. Explicit opening uses existing project-generation loading checks; errors keep the old editor usable. Failed or canceled archive jobs never remove the existing result/download for an earlier completed job.

Capture operation epoch, job ID, saved project ID/revision and loading intent before awaits. Deduplicate terminal handling for a job; after **each** awaited library/session request, recheck ownership before updating messages, anchors, imported result or clearing currentJob. A delayed old terminal continuation must not hide a new job. Cancellation polling must not cause duplicate downloads or duplicate completion transitions. New status recovery also retries a failed current archive-info read, with current project/epoch guards and no reopen or field reset; successful provenance refresh can re-enable backup. It can display global active work explicitly, but must not silently take ownership or auto-follow a different project. A beforeunload warning covers pending upload/owned job as well as unsaved edits; it is not a substitute for in-page status recovery.

## Independent acceptance and honest evidence

Fast tests use original generated PCM fixtures and never download/run a model. An injected separator, where used by existing unrelated browser setup, is identified as such; archive acceptance itself must pass with readiness false and a separator that fails if called.

1. Strict format tests exercise fixed members/order, raw EOF/central-directory preflight, oversized central list before ZipFile allocation, duplicate/path/link/compressed/encrypted/ZIP64/extra/comment/descriptors, local/central mismatch and overlap. Strict JSON covers extra/duplicate keys, malformed UTF-8/surrogates/NUL, deep arrays, huge numbers, revisions and exact cues; independent byte fixtures must not be exclusively producer-generated.
2. WAV tests independently decode byte headers, declared/actual lengths, unequal frame counts, noncanonical chunks/format, exact 1s/300s and duration equality. Hash/CRC tamper is rejected; exact three audio SHA-256 values survive import and re-export.
3. Real HTTP tests cover no-model restore/export, token/Host/Origin/Fetch-Metadata/body limits, busy/quota/free space, stale revision, PUT/DELETE ownership, pinned range downloads, source/work/parent replacement, unreadable occupied fresh-ID collision, and injected failure before rename/replace. Cancel at upload/validation/copy and publication boundary; completed jobs remain complete and unfinished work is cleaned without sibling loss.
4. Real production browser acceptance preserves invalid blank timing, literal Unicode/markup, dirty paste/title and undo/redo/focus through failed, canceled and successful archive jobs. Explicit opening alone invokes leave consent. Delayed duplicate terminal poll plus library refresh/new job, interrupted native upload and explicit status check cannot replay a restore, hide another job or discard drafts. Actual archive/SRT/MP4 downloads are read independently, not inferred from a success toast.
5. Root runs an actual 300-second archive between two distinct private libraries, with missing model/runtime, exactly 200 valid cues where useful, late and waveform-boundary cues, Unicode title/text, processing and a nonzero saved revision. Verify no inference call, all audio bytes/revision/cues exact, fresh ID, provenance unverified after genuine service restart/re-export, and continued waveform timing/Save/Undo. Decode actual exported MP4 audio/video timing and late cue cards, and independently inspect SRT. Record byte sizes, time/memory/disk, cancellation cleanup and limits; synthetic audio proves transport/timing, not real-song separation quality.

No full-song browser buffer, ML download or another real inference run is needed. Existing Karaoke gates remain required. Only after independent native acceptance and scoped CI passes may root claim portability complete.
