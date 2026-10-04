# Motion Studio #104: local named editable project library

Frozen implementation contract, 2026-10-04. Tracked by GitHub issue #104. Sources inspected: current Motion README, model.ts, storage.ts, history.ts, main.ts, images.ts and existing storage/recovery/cel/tween tests. This is an editable library, not a snapshot shelf, cloud service or sharing system.

## Product and verified limits

Keep up to **eight named projects** in the current browser profile/origin. Create blank, create original demo, import editable project as a new entry, open, duplicate and explicitly delete. Editing an opened entry autosaves that entry. The existing Project.title is the name; there is no independent library label that can drift from it. Duplicate preserves all committed project fields and embedded artwork exactly, including layer IDs, but has a fresh library ID and separate subsequent edits/history. Duplicate names are allowed; the UI identifies cards by storage ID rather than title.

The source defines `MAX_JSON_BYTES = 6 * 1024 * 1024 + 168` in model.ts: **6,291,624 bytes is the actual canonical schema-2 admission cap**, not merely a measured fixture size. Existing schema-1 known-field migration separately admits at most6 MiB before its wrappers are added. Do not reduce or widen either bound. Up to8 project payloads account for50,332,992 canonical UTF-8 bytes, plus bounded native wrappers/metadata. Native browser quota may be lower. This is not an RSS or available-storage guarantee. Portable `.motion.json` remains plain Project schema2, with genuine schema1 import compatibility. PNG/GIF formats and model/render/tween/history algorithms are unchanged.

Only the active entry's images are decoded. At most one current asset map and one current History are retained. Opening another entry resets session Undo/Redo; reopening does not promise previous session history or raw drafts. Existing30-state/20 MiB active history budget is unchanged. Library metadata refresh must never recreate editor input nodes or replace their raw values/caret.

## One authoritative database and legacy admission

Upgrade existing IndexedDB `motion-studio` to version2. Keep existing `project` object store and `current` key **read-only**, including their exact original native values. Add `library` and `projects` stores. The upgrade creates stores only; it never normalizes/deletes/rewrites `project/current` or synthesizes library entries. Close new connections on versionchange. Older builds explicitly opening version1 receive VersionError after upgrade; a blocked upgrade displays close-other-tab/retry guidance and remains memory-only. No second database, localStorage pointer or competing active copy.

`library/current` contains an exact bounded native object:

```ts
type LibraryEntry = {
  id: string; revision: string; title: string;
  frameCount: number; layerCount: number; projectBytes: number;
};
type LibraryHead = {
  schemaVersion: 1; revision: string;
  activeId: string | null; entries: LibraryEntry[];
};
type ProjectRow = {
  schemaVersion: 1; id: string; revision: string; project: Project;
};
```

IDs and mutation revisions are lowercase UUIDv4; every new successful write generates a fresh revision. Entries are in creation order and IDs are unique. Zero to8 entries; activeId is null exactly when empty, otherwise refers to an entry. Title uses the existing model's exact1–80 UTF-16-unit string admission, preserving legacy accepted text, not a new Unicode normalization. frameCount12–96, layerCount0–8 and projectBytes1..MAX_JSON_BYTES are integer metadata. The complete head compact JSON must be≤8 KiB. ProjectRow's canonical project payload is≤MAX_JSON_BYTES; its bounded wrapper/recovery JSON may be≤MAX_JSON_BYTES+256. Unknown schema/fields, sparse/accessor/exotic shapes, unsafe revisions and mismatching IDs/derived metadata refuse admission. Exact key presence matters: undefined is not absence. `projects` key set must exactly equal head entry IDs and contain≤8 keys; read keys/count, not all project values. Other rows' compressed pixels are not decoded merely to display the list.

A proven **absent** library head together with an empty `projects` store is the only legacy path. Orphan project rows without a head are retained corrupt library data: protect them, with no legacy fallback or promotion. Read `project/current` with independent presence (`getKey` or count+get in one readonly transaction). Valid legacy model is canonically admitted in memory; selected images/history must finish before accepting its authority. No write occurs simply from load, refresh, retry or migration. The first successful edit-save promotes the edited legacy project to a fresh library entry; New/demo/import/duplicate instead promotes the unchanged accepted legacy project first and creates the new entry, atomically, so the old canvas is retained. Original legacy native bytes remain untouched in the old store. If the legacy record is absent, an initially unsaved demo is saved only after the first edit or explicit creation. A malformed/undecodable/unknown legacy copy protects writes until explicit reviewed replacement; current memory remains downloadable. This protection cannot be bypassed with New/import.

Once a head exists, it is the sole authority, even when empty or invalid. No fallback to old current and no remigration after last deletion. A present-invalid head protects the entire library; do not silently reconstruct from rows or delete it. A bad individual project protects only that entry: other admitted entries remain openable, and selected failure keeps current work/assets. Keep legacy raw-download capability for the preserved migration source, clearly separate from current editable backup; do not claim it is the currently active saved project.

## Frozen storage API

Implement in new library-model.ts (pure exact shapes/metadata) and library-storage.ts (native IDB/CAS); retain existing storage.ts's pure lossless raw serializer, extending its internal bound only for the bounded new wrapper when explicitly requested. Do not keep old single-project writers active alongside library writes. Old native fixture helpers that open DB1/key current must be intentionally adapted to seed legacy1 or inspect canonical2; their original recovery/lifecycle expectations remain.

```ts
// Opaque runtime receipts: module-private WeakMap, instance-bound, never serialized.
export interface LibraryReceipt { readonly kind: 'motion-library-receipt' }
export interface ProjectReceipt { readonly kind: 'motion-project-receipt' }
export interface ReplacementReceipt { readonly kind: 'motion-replacement-receipt' }
export interface DeletionReceipt { readonly kind: 'motion-deletion-receipt' }
export class SavedProjectConflict extends Error {}
export type LibraryView = {
  mode: 'library' | 'legacy' | 'empty';
  head: LibraryHead | null;
  receipt: LibraryReceipt;
  legacy: { project: Project; receipt: ProjectReceipt } | null;
};
export type LoadedProject = {
  entry: LibraryEntry; project: Project;
  receipt: ProjectReceipt; libraryReceipt: LibraryReceipt;
};
export type LibraryCommit = {
  head: LibraryHead; entry: LibraryEntry | null;
};
export class ProjectLibrary {
  read(): Promise<LibraryView>;
  acceptRead(receipt: LibraryReceipt): void;
  readProject(id: string): Promise<LoadedProject>;
  acceptProject(receipt: ProjectReceipt): void;
  activate(receipt: ProjectReceipt): Promise<LibraryCommit>;
  save(id: string, project: Project): Promise<LibraryCommit>;
  promoteLegacy(project: Project): Promise<LibraryCommit>;
  create(project: Project): Promise<LibraryCommit>;
  duplicate(id: string): Promise<LibraryCommit>;
  reviewDelete(id: string): Promise<{
    receipt: DeletionReceipt; entry: LibraryEntry; nextId: string | null;
  }>;
  delete(receipt: DeletionReceipt, next: ProjectReceipt | null): Promise<LibraryCommit>;
  reviewReplacement(id: string | 'legacy'): Promise<{
    receipt: ReplacementReceipt; title: string | null;
  }>;
  replace(project: Project, receipt: ReplacementReceipt): Promise<LibraryCommit>;
  readRaw(id: string | 'legacy' | 'head'): Promise<RawRecord>;
  close(): void;
}
```

All returned projects/heads/entries are detached. `read` validates head/key membership only and supplies an actual legacy project only in absence mode; it never decodes images. `acceptRead` adopts successful bounded head/absence authority only, not loaded row authority. Legacy acceptance additionally requires its separate ProjectReceipt via acceptProject after caller image/history admission. `readProject` reads selected row+head/key membership in one snapshot, validates model and metadata, and mints but does not accept row authority. After caller prepares selected assets/History, activate compares that same row+catalog receipt and atomically changes activeId; successful activation accepts the admitted row and returns the actual completed head. readProject's `acceptProject` permits startup adoption of the already-active row without writing or changing activeId. Rejected/stale/foreign/cloned/consumed load receipts never advance authority. Storage does not claim to have independently verified compressed pixels: UI acceptance follows actual image decoding.

`create` and duplicate return the fresh active entry after native completion, not a generated provisional ID. Duplicate is available for the currently admitted entry only and uses its accepted exact current saved document; UI flushes committed edits first. Never copy unapplied raw fields or reviewed tween scratch. `promoteLegacy` is available only for an accepted valid legacy receipt. Every create/promotion prepares complete payload/metadata and all prospective quotas before writing. A full library rejects with delete/export guidance, no eviction. Empty legacy mode may require two slots when creating alongside retained legacy. Failed promotion does not advance migration authority.

`reviewDelete` captures exact head and target row receipt. Deleting a nonactive entry keeps activeId. Deleting the active entry chooses the next entry in creation order at `min(oldIndex,remainingLength-1)`; deleting the last keeps a durable empty head and returns null. UI prepares that exact next row's images/History before calling delete; failed decode refuses deletion. The transaction compares target/head and next prepared load receipt before deletion or pointer change. No fallible media validation follows the committed deletion. Explicit Delete is outside history and cannot be undone; confirmation names the entry and advises backup. Do not offer unchecked force/clear-library operations.

Replacement is explicit, one-use, fresh-reviewed CAS for a protected existing entry or protected legacy absence mode. It requires a bounded comparable raw row/legacy value, not a made-up zero receipt. Unsafe/non-JSON/oversized values with no bounded comparable identity remain protected; fail with backup/repair guidance. Malformed head does not expose a destructive whole-library reset through replacement. Each review refusal leaves data and current memory untouched. Failed, stale or unknown replacement must never enable ordinary autosave. Successful legacy replacement creates canonical head/entry while preserving original old-store raw value.

## Transactions, conflict and deadlines

Use one instance mutation queue, plus native transaction-local compare-and-swap. Candidates are validated/detached at API admission before awaiting anything. `save` captures the explicit storage ID; expected row authority is consumed at queue execution from the latest successful **own** receipt for that ID, not a late global active ID. In one readwrite transaction over projects+library: read current bounded head/row/key membership, require target still exists and revision/full admitted row identity matches, then update only that row and its head metadata. Preserve other entries and current activeId even if another tab selected another project. Ordinary save must never upsert a missing/deleted row. Unrelated other-tab project saves may merge safely if this target is unchanged; create/activate/duplicate/delete/replace also compare the specifically reviewed catalog revision and cannot silently overwrite concurrent membership/selection changes.

Charge every mutation to actual transaction completion; request onsuccess is not durable success. Expected receipts and returned durable metadata advance only at oncomplete. Failure/abort leaves authority unchanged. A completed older save updates its known actual receipt even if its UI owner retired; it never marks newer active project or newer memory revision Saved. On conflict keep exact current memory/history/raw drafts and allow explicit reload, editable download, or Save memory as new project when capacity/valid catalog permit. No hidden retry against another tab's changed target.

Each storage call has a **10-second monotonic aggregate deadline including queue/open/read/write**. Every queued call expires independently; a rejected older call cannot wedge all later calls. Open timeout/blocked/close/versionchange guards abort active native transaction, close connections and retire listeners/results; eventual late open success closes its DB and cannot publish. Abort error and deadline paths release the logical queue even if a browser does not deliver another event; no forever-held native slot. If abort cannot prove rollback because the transaction already committed, report completion unconfirmed, protect writes and require a fresh accepted read; never claim data was rolled back. Late actual completion may be recorded privately but cannot unprotect or publish stale UI work. No async hashing/decoding/await gaps inside a readwrite request callback before CAS+puts; only bounded synchronous admission/comparison.

## UI ownership and complete flow

Add Projects region with count, creation-order names, active marker, Open, Duplicate, Delete, New project and Open project file (imports as new editable entry). Try demo creates a separate entry. Existing title field renames the active entry through normal edit/autosave. Preserve current artwork backup during every protection/conflict/error. Status names the owner: Saved locally / Saving / Not saved / Protected / Memory-only, tied to captured entry ID and current generation rather than generic global success.

Before switching/new/import/duplicate/delete, require Apply or explicit Discard of raw pose/name fields and confirm leaving tween pairing draft. Flush the captured active committed snapshot and await its completed save before navigating. Failed flush keeps current memory/history/assets/drafts and refuses ordinary navigation; user can explicitly download then confirm discarding unsaved memory or Save as new project. Debounce cancellation alone does not cancel already queued writes. API CAS prevents resurrection after deletion. Metadata refresh doesn't touch editor fields/history/assets.

Every async chain owns library entry ID (or explicit legacy/memory origin), current document generation, raw-intent epoch and operation ID. Raw input, selection/layer/frame/project changes, history/recovery/import/pointer gestures and pagehide retire affected image/history/tween/PNG/GIF work. Stop playback and terminate/reject exports before project switch. Prepare target assets and fresh History locally; recheck owner, then activate/delete CAS, then publish exactly that prepared target and close only the old owned assets. If cancelled before transaction completion, abort; if durable completion already happened, retain its truthful metadata but do not adopt a newer/retired editor owner. A pagehide closes owned assets/work/storage connection; reopening reads the actual durable active pointer. Storage mutation busy admission can lock editor controls during short final create/activation/delete writes; pending image read/decode remains cancellable by owner and does not move the durable cursor early.

No raw draft is silently attached to another project. Import image and all existing edits target the captured active entry. Project File becomes explicit new-entry import, bounded file+model+actual selected image decode, with no library mutation until complete admission. JSON/PNG/GIF download receipts also capture entry ID, project title, frame, generation and raw intent. They cannot acquire a newer filename/project if completion arrives after selection.

## Independent acceptance and ownership

Freeze literal legacy schema1 and2 current records before producer reads; verify upgrade/read/decode alone leaves old raw record identical. Promotion/create/delete-last/restart must establish one canonical head and never resurrect legacy. Native real-IDB cases: two tabs save same project (second conflict, bytes preserved); unrelated entry saves safe; other tab changes selection; stale create/delete/replacement receipt; queued autosave after delete cannot recreate row; timeout/blocked open/held transaction releases queue; post-request-success abort doesn't advance expected revision; delayed retry/decode/import after editing/switch leaves current fields and assets. Present undefined/corrupt project/head and unknown read remain protected; raw downloads retain lossless shape rules.

Actual production flow: create A, draw/pose/cels+tween, autosave; create B/import image, switch between exact project files; rename; duplicate then edit independently; delete with cancel/confirm; PNG/GIF through unchanged shared renderer; complete Chromium process restart with real on-disk IDB proves active pointer and all eight editable projects. Maximum admits **eight separately original exact6,291,624-byte projects**, selects/decode only one≤four images, compares canonical bytes after restart, then rejects ninth atomically. Measure actual durations/artifact sizes; distinguish50,332,992 payload bytes from memory/available quota. Failure keeps every original row and portable export intact.

Suggested six nonoverlapping owners after root freeze: (1) library-model.ts and pure tests; (2) library-storage.ts/storage.ts narrow pure-helper reuse + native receipt harness/tests; (3) main.ts/styles/library-view.ts only UI; (4) independent literal schema/transaction oracle; (5) real production browser/persistence/ownership tests; (6) independent maximum fixture/smoke/source review. Root owns final docs/config/version/Git/build scheduling and intentional old fixture DB-version/row-location adaptations. Existing model/render/export/history/tween producer source remains untouched unless a concrete integration defect is separately authorized.


## Final lifecycle clarifications

- A deadline is a logical failure, not evidence of native rollback. Abort active work where possible. Unknown settlement invalidates ordinary write authority and leaves the UI protected; later native callbacks cannot restore permission or publish stale editor state. A fresh accepted read after actual settled storage is needed before normal saving. Reads that remain blocked also have a deadline. It is acceptable to release editing into explicitly protected memory-only mode after a timeout; never release into ordinary autosave or claim Saved while native state is unknown.
- Deleting a nonactive project supplies `next = null`, preserves the actual active pointer, and does not replace current memory, assets, history, frame or draft nodes. Deleting an active project consumes the freshly prepared next-project receipt directly at durable completion; do not first consume it with `acceptProject`. The last deletion retains the empty head permanently; it does not erase or rewrite legacy bytes.
- On `pagehide`, retire asynchronous UI owners, pause playback and cancel gestures/exports. A persisted BFCache suspension retains current assets, memory, raw drafts and history; its later `pageshow` does not blindly reload durable data. Closing/aborting native connections must not fabricate transaction outcomes. Terminal pagehide may release owned assets. Returned unsaved memory remains protected until explicit recovery.
- An invalid individual entry must not block opening another validated entry in a valid catalog. Leaving current unsaved/protected memory requires an explicit discard confirmation (or a successful save as new); a failed ordinary flush must never silently discard it. A corrupted head cannot be repaired through an implicit create/import action.
- Selected-project preparation includes a temporary `History` admission before mutation/publication; no fallible decode or history admission may occur after the durable pointer/deletion write. Commit publication adopts those prepared assets and history only under the matching entry/generation/operation/raw-intent owner.
- The storage/model owner will state exact pure helper export names before oracle compilation. The public class API above is the shared integration boundary. Any necessary contract change must be recorded here and communicated to UI and independent test owners before changing expectations.

- An unchanged already-saved editor does not issue a redundant write when leaving. Drain actual pending work; cancelled or rejected navigation/import/capacity actions must not change row or catalog revisions merely for checking readiness.
- The UI requires local editor selection and a freshly read durable active pointer to agree before deletion. Both deletion review and final transaction bind to that accepted catalog; a foreign selection in either gap refuses safely. Refreshing and explicitly opening the desired project resolves the mismatch.
- Duplicate targets this tab's independently admitted current row, even when another tab selected a different durable active project. It compares the accepted row and reviewed catalog, creates a new separate active entry, and preserves both existing projects.
- Replacement of a known protected project ID never redirects to another tab's active ID. An unknown startup failure may discover the actual active target through a fresh read; a deleted known target refuses and offers a new copy instead.
