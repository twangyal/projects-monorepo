# Melody Studio saved composition library

Issue: [#126](https://github.com/twangyal/projects-monorepo/issues/126). Status: accepted design; implementation and verification pending. The user authorized autonomous implementation on Astra; no additional design approval is required.

## Product contract

Melody currently autosaves one complete workspace. New/example/file-open actions replace it, so keeping several songs requires managing downloaded files. Add an explicit local library of **eight named complete copies**, while preserving the existing workspace and its recovery behavior.

Use this copy:

> **Saved compositions**  
> Keep up to eight complete copies. Copies change only when you choose Save new copy or Update selected copy. Your current workspace autosaves separately.

The actions are **Save new copy**, **Update selected copy**, **Open selected copy**, **Refresh copies**, **Download selected copy**, **Delete selected copy**, and **Cancel library operation**. Selecting a row never opens it. The saved-copy label is separate from the composition title; saving or renaming a copy does not change the title inside its backup. Duplicate labels are allowed; UUID option values identify distinct entries.

There is no migration, implicit startup copy, per-entry autosave, full-library archive, account, network service, new dependency, or changed portable format. Existing New/Example/file-import behavior remains available. Current-workspace storage failures cannot disable independent library recovery, and library failures cannot change current-workspace recovery or saving state.

## Exact public interface

Implement in `apps/melody-studio/src/composition-library.ts`, consuming `ReferenceBundle` from `reference-types.ts` and the existing `encodeProjectBackup` / `decodeProjectBackup` functions.

```ts
declare const receiptBrand: unique symbol;
export interface LibraryReceipt { readonly [receiptBrand]: true }
export interface LibraryEntry {
  readonly id: string;
  readonly revision: string;
  readonly label: string;
  readonly title: string;
  readonly tracks: number;
  readonly references: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly receipt: LibraryReceipt;
}
export interface LibraryReview {
  readonly entry: LibraryEntry;
  readonly backup: Blob;
  readonly bundle: ReferenceBundle | null;
  readonly error: string | null;
}
export interface LibraryOptions { signal?: AbortSignal }
export class CompositionLibrary {
  constructor(factory: IDBFactory);
  list(options?: LibraryOptions): Promise<readonly LibraryEntry[]>;
  review(receipt: LibraryReceipt, options?: LibraryOptions): Promise<LibraryReview>;
  create(label: string, bundle: ReferenceBundle,
         options?: LibraryOptions): Promise<LibraryEntry>;
  update(receipt: LibraryReceipt, label: string, bundle: ReferenceBundle,
         options?: LibraryOptions): Promise<LibraryEntry>;
  remove(receipt: LibraryReceipt, options?: LibraryOptions): Promise<void>;
  readonly nativePending: boolean;
  close(): Promise<void>;
}
```

Returned metadata, arrays, receipt objects and review wrappers are immutable. Bundles are detached defensive copies; callers cannot mutate stored bytes or receipt authority. Receipts are opaque, private to the issuing store instance and never serialized. Forged, cloned, wrong-instance or consumed mutation receipts refuse. A successful update returns fresh authority; a successful removal cannot recreate an entry. Reads do not consume a receipt. A failed destructive operation requires refreshed authority before another destructive attempt.

`list` returns metadata and receipts only. `review` reads the selected complete copy, checks its receipt, verifies SHA-256 and decodes it, then rechecks its saved identity after decoding. A changed or removed selection refuses. A readable result has a bundle and `error: null`. For a safely bounded but corrupt backup, retain the exact Blob and return `bundle: null` with a sanitized error. This supports exact-byte download and explicitly confirmed update/deletion; Open is unavailable. Unsafe row shapes, malformed metadata or oversized payloads receive no mutation authority and are never silently cleared.

## Storage, identity and bounds

Use a separate IndexedDB database **`melody-studio.library`**, version **1**, with one object store **`copies`**, keyed by entry UUID. Each row has exactly `schemaVersion`, `id`, `revision`, `label`, `title`, `tracks`, `references`, `bytes`, `sha256`, and `backup`; `schemaVersion` is 1 and `backup` is an immutable `Blob` of type `application/json`. IDs and revisions are lowercase UUID v4 values. Counts are bounded integers, byte length is positive, and SHA-256 is 64 lowercase hexadecimal characters.

Save/update synchronously detach and validate the supplied bundle before their first await. Encode with the unchanged complete-project encoder; store exactly its resulting bytes, with a hash and display metadata derived from that same capture. Do not re-encode on Download, decode/re-encode nonselected copies, modify asset IDs, normalize old composition text, or include raw drafts/history/library wrappers in `.melody.json`.

Every create/update receives a fresh UUID revision. Update/delete compare the receipt's revision, complete canonical metadata, and Blob size/type inside the readwrite transaction before mutation. This is **revision compare-and-swap**, not a claim of synchronous byte-by-byte Blob comparison. All library writers must change the revision when replacing content. Selected reads independently verify content integrity. Hashing or Blob reads must not be awaited inside an active native write transaction.

Create checks current valid rows and capacity in its transaction. Concurrent creates cannot exceed eight. Same-entry stale changes/deletion refuse; mutations of different entries remain independent. Read-only listing uses `getAll(undefined, 9)` and inspects at most eight metadata/Blob handles without calling `arrayBuffer()` on their contents. Malformed or excess catalog data protects library writes. No automatic database reset, overwrite or repair is permitted.

- **8 entries**; **12,582,912 bytes (12 MiB)** per complete backup; aggregate permitted backup payloads **100,663,296 bytes (96 MiB)**, excluding bounded metadata.
- Aggregate serialized row metadata, excluding Blobs and receipts: **16,384 bytes (16 KiB)** maximum.
- New library labels trim once on explicit Save/Update, then require **1–80 UTF-16 code units**, well-formed Unicode, and no C0/C1 controls or U+2028/U+2029. Invalid raw label text stays editable. Existing valid composition titles retain their existing semantics.
- Existing admission stays unchanged: **1–8 tracks**, **256 notes per track**, **8 references**, **882,000 PCM bytes per reference**, **2 MiB document**, **12 MiB backup**, and JSON depth **16**. The library does not widen any parser limit.
- **10,000 ms** per library operation from admission, including preparation, open, transaction, and selected verification. Check an absolute deadline after asynchronous work; synchronous browser work cannot be forcibly preempted. Existing unrelated project-file imports retain their existing 30-second bound.

Resolve write success only after native transaction completion. Abort/cancel/timeout promptly retires logical ownership, attempts native rollback where possible, and retains pending open/transaction cleanup ownership until a real terminal event. A blocked native open cannot be physically canceled. Do not release a later write through a still-draining native operation. `nativePending` exposes that drain; `close` is terminal, rejects further work and resolves after owned native cleanup. A lost or timed-out response does not prove rollback: require Refresh and never replay a create/update/delete automatically. Late results cannot relabel newer work as saved.

## UI integration and ownership

Implement a stable `libraryHost` and `library-view.ts` outside the rebuilt `app.innerHTML`, alongside the existing reference/MIDI hosts. Freeze these IDs:

| ID | Meaning |
| --- | --- |
| `library-label` | Editable label for a new/updated saved copy |
| `library-select` | Saved-copy selector; option values are entry UUIDs |
| `library-refresh` | Refresh metadata without opening a copy |
| `library-create` | Save committed workspace as a new copy |
| `library-update` | Confirm and replace the selected copy |
| `library-open` | Confirm and open the selected complete copy |
| `library-download` | Download the exact selected stored backup |
| `library-delete` | Confirm deletion of only the selected copy |
| `library-cancel` | Cancel the current logical library operation |
| `library-status` | Live status, separate from workspace save status |
| `library-details` | Selected title, track/reference counts and size |

Save/Update capture `history.snapshot()`, excluding raw editor fields, MIDI review, reference comparison windows and continuation scratch. They never apply those fields, record a history edit, change the composition title, or reset current `unsaved`, `recovery`, `hasSavedCopy`, or its saved-copy receipt. Preserve field DOM nodes, raw spellings, selection and focus; prevent an action's pointer admission from involuntarily blurring and committing a draft.

Update and Delete explicitly confirm the captured selected label/identity. Their receipts still have to match when the transaction executes. Refresh obtains current receipts, preserves the editor and does not open anything. A changed/deleted selection is explained and does not silently become another target. Failed/quota writes leave current memory, all existing copies, and current autosave behavior unchanged.

Open uses an admitted `review.bundle` through the existing `commit(..., document, assets)` seam. It is one reversible committed edit; current autosave follows its existing queue/recovery policy. Retain `ReferenceHistory`'s **64 MiB unique-audio budget**, existing asset-ID collision checks, and atomic failure behavior. Do not reset history to bypass a refusal. Clear scratch/selection only after successful history admission. If the opened bundle is unchanged, preserve no-op history semantics. In current protected recovery, Open changes memory only until the user uses that existing recovery flow.

Open is blocked during startup, recording/permission/native audio cleanup, processing/rendering, current saving/replacement, file reads, or an active piano-roll gesture. Resolve or explicitly confirm discarding raw fields, MIDI source/review and continuation scratch before replacement; `scratchExists()` alone does not cover MIDI review state. A canceled or refused Open preserves all of them. Save/Update can preserve and exclude raw scratch, but cannot capture through an active recording or partial committed operation.

Capture operation epoch, selected receipt, `compositionGeneration` and `editorIntent` before asynchronous work. New editing intent, selection/label changes, cancellation and page departure retire dependent work. Check ownership after every await and after confirmation. A native mutation already committed before retirement may leave a captured copy in the library; it must not be presented as saving newer workspace state. Selection/Refresh never overwrites the editor. Page return never replays a mutation or automatically opens a copy. Stop owned playback only when deliberately admitting Open; a canceled read must not disturb unrelated playback. Library lifecycle cleanup must not permanently disable a retained page merely because `pagehide` was persisted.

## Verification and delegation

Producer owns the library module and focused tests; UI owns its stable view, `main.ts` integration and CSS; independent oracle owns original fixtures/native cases; maximum author owns a bounded runner. Root owns Git/GitHub, package/docs/catalog, all test/browser/service execution, integrated review, full gates, maximum execution and published CI.

Verify count/race boundaries, detached byte preservation, receipts, corrupt safe recovery, exact revision CAS, same-ID refusal and independent IDs, native terminal outcomes, held-open/transaction drains, stale editor/selection/label ownership, complete audio/Undo retention, unchanged autosave protection and original exports. Preserve first failures and distinguish fixture defects from product defects.

A separate eight-copy maximum uses complete original audio-backed compositions, checks ninth refusal and deliberate replacement/deletion/recreation, downloads exact stored bytes and reopens each after a full Chromium restart. Instrument Blob reads to show Refresh does not load nonselected contents. Test exact file/parser limits separately where canonical product data cannot naturally reach them; do not call padding a maximum musical composition. Physical microphone accuracy, browser quota availability, other browsers and general performance are not established by this milestone.
