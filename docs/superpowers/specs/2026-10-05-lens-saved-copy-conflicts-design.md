# Lens Studio #117 — protect the complete saved study

Status: **Root approved on 2026-10-05 after unchanged-build native reproduction and independent contract review; disjoint implementation is released.**

Issue: https://github.com/twangyal/projects-monorepo/issues/117

## Goal and current evidence

Prevent a stale Lens tab from replacing another tab's complete saved photo, authored depth mask and settings through autosave. Preserve both the actual durable winner and the losing tab's editable study, session history, typed fields, mask gesture, source/result display and project/PNG downloads. This is local saved-copy conflict protection, not a study library, tab merge, learned-depth feature or change to the renderer.

The risk was source-confirmed and root reproduced it before product edits on the frozen normal build at head 14c8c2a1. The corrected classifier run retained an independently original 16×12 PNG and showed A's 12 near-mask pixels, target 100, shifts±0.125, near 0.7 and far 3 overwritten by B's stale title edit with all-subject mask, target 50 and zero shifts; both pages reported Saved. Its protection assertion failed in 2,579.007 ms. The first actual failure in 2,720.323 ms is also retained, but its whole-value classifier additionally mistook object property order for structural inequality; only classification changed before the corrected repeat, not fixture/UI/oracle actions. Root's durable receipt is `apps/lens-studio/docs/2026-10-05-saved-copy-baseline.json`; raw evidence is `/workspace/lens117-baseline-stale-save-corrected/verification.json`. This producer did not run either baseline. `src/storage.ts:92–104` validates and decodes a captured project, then unconditionally calls `projects.put(snapshot, 'current')`. Its module queue orders one JavaScript realm only. `src/main.ts:118–123` checks its local generation and reports Saved, without comparing any saved-copy authority. A second tab's stale title edit can therefore erase a newer photo, painted mask or projection settings. Do not substitute an import/setup fixture error for the expected native data-loss reproduction.

Use an isolated per-instance storage protocol with same-readwrite-transaction CAS. A separate read-then-put, revision-only comparison or BroadcastChannel notification is insufficient. An exclusive tab lock would prevent useful independent readable/editable copies and still require explicit recovery. Reuse proven design lessons from Style, but do not create a shared library or import its storage implementation into Lens.

## Preserve the data and simulation contracts

Portable Project remains exact schema 1: `{schemaVersion,id,title,photo,settings,depth}`. Source/target focal and depth/shift admission, title code-point policy, canonical mask base64, PNG admission and all fixed/manual-perspective numerical behavior remain unchanged. `History` still retains one immutable photo separately from its bounded edit-state strings; a new photo/study starts a new history. Conflict alone is not an edit or history reset.

Preserve all existing limits: portable JSON 12,582,912 bytes (12 MiB), normalized photo and output PNG at most 7,340,032 bytes (7 MiB), longest normalized edge 1,280, source input 8 MiB/16 million pixels/8,192 per side; up to 30 history edit states/33,554,432 bytes (32 MiB), brush 2,048 points/8,192 path pixels/radius 1–100, render/export worker 30 seconds. Depth has exactly one label per normalized source pixel, each 0/1/2; dimensions match the photo.

Do not claim a legal normalized project can occupy exactly 12 MiB merely because the parser's byte cap is 12 MiB. Maximum acceptance should use actual full-size valid normalized PNG and full-size mask and report their measured byte counts. Browser quota/physical RAM availability are not promised. The stored wrapper adds exactly 80 compact UTF-8 bytes; export `MAX_STORED_BYTES = LIMITS.projectBytes + 80` = 12,582,992. Legacy bare values independently retain the 12,582,912-byte cap. Portable output never includes storage revision metadata.

## Native schema and old-client fence

Keep database name `lens-studio.v1`, store `projects`, key `current`; upgrade its native database version from 1 to 2. Do not rename the database merely because its name contains `.v1`. During upgrade, create `projects` only for a genuinely fresh database (oldVersion 0). An existing database missing that store remains incompatible/protected and its upgrade aborts; do not invent an empty authoritative store. Retain #68's caught schema-creation failure, rollback, sanitized guidance and absence of uncaught page errors.

The upgrade fences published old clients that hardcode `indexedDB.open('lens-studio.v1',1)` and write unconditionally. Their new opens receive VersionError after upgrade; already live old connections close onversionchange. Blocked upgrade refuses with close-old-tabs guidance. No automatic row migration or deletion occurs during successful version upgrade/load/decode.

Two saved-row forms are read:

```ts
// Original value: unchanged, genuine portable Project schema 1.
type LegacyRow = Project;
// All newly completed saves/replacements.
interface SavedProjectRow {
  schemaVersion: 2;
  revision: string; // fresh canonical lowercase UUIDv4 on every write
  project: Project; // unchanged portable schema 1
}
```

Wrapper2 has exactly those three enumerable ordinary data fields and a strict UUIDv4 version/variant spelling. Future/extra/invalid fields are not normalized away. First successful admitted save writes wrapper 2; loading a bare value never puts it. Arbitrary developer-tools/same-origin scripts can still modify storage; the application detects a changed complete value rather than claiming a security boundary against those scripts.

## Exact API proposal for review

All types and implementation live in Lens `src/storage.ts`. Retire production module-global `loadProject/saveProject/clearProject` writers; main owns one instance returned by `openProjectStore()`. Old test call sites must be intentionally adapted rather than retaining a second implicit writer with hidden authority.

```ts
export interface SavedCopyReceipt { readonly __savedCopyReceipt: unique symbol }
export interface LoadedProject {
  project: Project | null;
  raster: Raster | null;
  receipt: SavedCopyReceipt;
}
export interface ReplacementReview {
  receipt: SavedCopyReceipt;
  summary: {
    present: boolean;
    readable: boolean;
    title: string | null;
    width: number | null;
    height: number | null;
    mode: Settings['mode'] | null;
  };
}
export class SavedCopyConflict extends Error {}
export class SavedCopyProtected extends Error {}
export interface ProjectStore {
  load(options?: { signal?: AbortSignal }): Promise<LoadedProject>;
  acceptLoad(receipt: SavedCopyReceipt): void;
  save(project: Project): Promise<void>;
  reviewReplacement(): Promise<ReplacementReview>;
  replace(project: Project, receipt: SavedCopyReceipt): Promise<void>;
  clear(): Promise<void>;
  close(): Promise<void>;
}
export function openProjectStore(): Promise<ProjectStore>;
export const STORAGE_OPEN_MS = 5_000;
export const STORAGE_OPERATION_MS = 10_000;
export const STORAGE_IMAGE_MS = 30_000;
export const MAX_STORED_BYTES: number;
```

Lens-specific choice: retain the current actual compressed-image gate in storage `load()` and return its detached decoded source Raster. Main constructs a temporary `History` and rechecks ownership before accepting the token and publishing that same raster. This removes the present repeated decode (storage gate plus main source decode), while preserving direct-load refusal of a header-valid undecodable PNG. Proven absence returns both project and raster null, not a fabricated default study. Returned project/raster mutation cannot change private authority. The load result holds no open ImageBitmap; existing `decodePhoto()` closes it in finally.

`save/replace` keep current actual image-decode admission before writing, outside the native readwrite transaction. Retain this integrity gate; do not reinterpret a photo header as verified compressed pixels. `reviewReplacement()` is a bounded native structural comparison/summary only, not an image decode or automatic winner adoption. Readable means validated Project/headers/mask/settings, not a claim that compressed PNG decode succeeded.

`SavedCopyConflict` identifies a proven changed saved value/another tab. `SavedCopyProtected` identifies unknown/unavailable read, corrupt/uncomparable value, deadline, closed/versionchanged storage or missing authority. Both have bounded private-safe guidance without raw DOMException/record details. A confirmed native readwrite rollback/quota error remains ordinary Error, preserving the last accepted expectation for explicit Retry saving. Caller cancellation of load promptly rejects with AbortError, retires that instance and preserves its private native/decode drain for close(); it does not create or promote authority. Main never parses error strings to decide whether overwrite is permitted.

## Private complete-value identity and receipts

Use instance-private opaque objects backed by a WeakMap. Proofs capture purpose (load/replacement), used state, protection epoch, initial operation ownership and exact native identity. A cloned/forged/foreign/consumed/stale token rejects. Replacement tokens cannot be accepted as loads, and a successful but unaccepted load cannot authorize saving. A supplied load signal must still be live at token acceptance; late cancelled load receipts cannot authorize an editor that declined them.

Read both `getKey('current')` and `get('current')` in one native snapshot. Proven absent key differs from present undefined. Failed/denied/aborted reads never become absence. Identity covers every raw field, including original title before trimming, project/photo IDs, the whole PNG data URL and dimensions, all settings, full ordered mask labels, wrapper revision and unknown ordinary fields. Do not compare only canonicalized project, photo ID, title, revision or a subset hash.

Deterministic field ordering is permitted; object insertion order is not semantic identity. Array order is semantic. Preserve raw finite -0 distinction even though the existing settings validator normalizes its admitted result to+0. Receipt comparison must describe the original native value, not reject otherwise admitted old data or silently normalize it. Portable/history normalization follows current behavior unchanged.

Comparator admission is deliberately narrow: JSON-compatible primitives, ordinary own enumerable data objects, dense ordinary arrays, and a distinct root present-undefined sentinel. No getters/toJSON hooks, cycles, holes/extra array fields, symbol/function/native values or nonfinite numbers are invoked/coerced. Bound depth by current `LIMITS.jsonDepth` 24, visited nodes 100,000 and expanded JSON UTF-8 bytes by the applicable legacy/wrapper cap. Count escaped strings/punctuation before retaining the encoded identity; a -0 position table must not double the permitted raw byte budget. Exactly-cap bounded ordinary malformed data can be reviewed; cap+1 must refuse atomically.

Only bounded comparable malformed ordinary values can receive replacement-only authority, with readable:false. Schema2-looking values use the wrapper bound; legacy/ambiguous other values use the portable bound. An uncomparable native value remains protected: complete current-memory backup is available, but no general raw-native-object recovery or implicit clear is invented.

## Load and mutation protocol

1. Native load captures existence/value/full identity in one readonly transaction. Require both confirmed native transaction complete and successfully delivered/admitted read callbacks; held callbacks must not resolve undefined merely because the native transaction ended. Capture the protection epoch at read admission.
2. Outside that transaction, validate the canonical Project, actually decode its bounded PNG and return project/raster/receipt only after the operation remains live. No row write occurs. Main prepares `History`, verifies operation+committed generation+raw editor intent+page lifetime, and calls acceptLoad synchronously immediately before visible adoption. Failed/cancelled/stale decode never promotes ordinary authority.
3. Each save validates/detaches the complete candidate at invocation, including mask/settings/photo. Main coalesces autosave into one active captured snapshot and one newest pending committed snapshot. The existing180ms debounce can remain. Store orders accepted explicit operations; each executing ordinary save uses its latest accepted load or confirmed own write, not an expectation captured before an earlier own save.
4. Run actual image validation outside the transaction. Then open one readwrite transaction, read key/value, recompute bounded raw identity and compare before any put/delete. On mismatch abort with SavedCopyConflict, revoke ordinary authority/old proofs and protect all later pending saves. Do not adopt the winner.
5. On match, queue a fresh wrapper 2 in the same callback/transaction. No await, worker, decode or external task occurs between compare and put. Concurrent readwrite scopes serialize natively, so two tabs against one old value cannot both succeed.
6. Only native transaction complete advances the private expected identity. Request success followed by abort does not. Proven rollback leaves the last expectation intact; timeout/unconfirmed outcome/versionchange invalidates it. A completed older local snapshot remains the actual expected basis for future queued saves but cannot mark newer UI memory Saved.
7. `replace()` detaches its candidate and consumes its purpose-bound reviewed token on admission. After actual image validation, its write transaction compares against exactly the reviewed saved snapshot. A third writer between review/confirmation/preflight and put refuses before mutation, requiring a new deliberate review/confirmation. It never substitutes the latest ordinary expectation.
8. Internal `clear()` remains only for existing API/test compatibility, with accepted-load/write authority and same-transaction CAS before delete; successful deletion establishes absence. Protected/unreadable records cannot be cleared unconditionally. No new clear-storage UI is added.

Any protection transition stamps a new epoch. Old unused tokens and already-in-flight old reads cannot revive after protection, even if delivered late. Synchronous deadline checks use the same retirement path as timers; delayed watchdog scheduling cannot preserve expired authority. Native complete and application output admission are distinct, and no write is attempted after native transaction terminal.

## Bounds, decode drain and lifetime

Retain the current 5-second native open bound. Native transactions have a 10-second monotonic bound, checked before mutation and on both successful and failed terminal callbacks; a generic abort arriving after its deadline cannot preserve expired authority. Actual image preflight has a 30-second bound, matching the existing image/worker scale, separate from native transaction time. No image work runs within native transaction lifetime; a save can require image preflight followed by native CAS, so this is not a claim of a single 10-second whole-save walltime.

Native timeout best-effort aborts/closes the owned connection, logically refuses completion, invalidates authority and requires a fresh instance/read for recovery. Timeout is not proof of rollback. Keep late cleanup handlers until actual abort/complete; late events never unprotect or publish. Blocked/open timeout closes a late-opened handle and aborts a still-active upgrade. Catch all callback scheduling errors, including TransactionInactiveError, without pageerror or fabricated empty data.

`createImageBitmap` is not abortable. An image deadline promptly rejects the method with SavedCopyProtected, revokes result/write ownership and permanently retires the instance to all new method/token admissions. Caller load cancellation similarly rejects promptly with AbortError and retires the instance. Pass an owned abort signal into the existing decoder; if a native promise was already dispatched, its late bitmap closes via current decoder cleanup once that promise settles. Store retains a private decodeDrain until that actual chain finishes, regardless of the already-rejected public method. Handle every late promise rejection; never mint a late receipt, start a transaction after retired preflight, or expose an unhandled error. No second decoder is started on the retired instance.

Main reacts to the logical failure/cancel immediately with usable memory/editor/backup and truthful protection guidance. It detaches the retired instance from saving, starts close(), and holds a separate storageDrainPending barrier until close() fulfills. No fresh openProjectStore/recovery may be admitted through the app before that close barrier drains, even if another button/Cancel/raw edit changed the visible operation owner. This provides observable timely failure through the existing method Promise, without a new callback/getter. A never-returning native bitmap leaves recovery blocked with reload guidance; it does not accumulate fresh instances/decoders behind logical failures. Current committed rendering/PNG/project exports remain usable because they are separately bounded existing jobs, not new storage recovery decodes.

Normal close immediately refuses new admissions, waits accepted ordered/native work to actual terminal, closes exactly the owned connection and awaits all retained decodeDrain chains. An instance retired by timeout/cancel/versionchange cannot be made reusable by a late callback. close() is idempotent; its Promise need not settle before an uncancellable native decoder physically drains. This is explicit resource ownership, not a forever-muted UI: the operation already rejected and the page displays memory-only guidance. Versionchange protects authority and retires active ownership under the same close/reopen barrier. A completed write is never described as rolled back merely because UI publication retired. No public progress signal, shared decoder registry or changes to images.ts are needed.

Persisted pagehide cancels/retire transient preview/export/stage/recovery owners and unfinished pointer capture, retaining committed study, decoded source/raster, last completed result, typed fields and History. Do not overwrite these from durable storage on pageshow. A pending actual native save may complete truthfully; its stale UI callback cannot display Saved or clear protection after page lifetime retirement. Nonpersisted teardown closes storage and owned work/resources. Download URLs are always revoked; no new long-lived remote fetching occurs.

## UI contract and recovery controls

Place status/recovery controls **outside the hidden workspace**, since corrupt startup or proven absence may have no photo. Preserve #save-status; add #retry-save to the current Retry saving button, #retry-load labelled Reload saved study, and #replace-saved-copy labelled Replace saved copy. Existing project-title/numeric IDs/source-canvas/project-import/photo-import and successful Saved locally wording remain. Replacement requires a current admitted study; reload remains available with no study. Existing Download project and Export PNG remain local outputs of committed memory, not the durable winner.

Separate committed generation from editorIntent/page lifetime. Every raw input/change (including changed-back values), pointerdown even if the gesture later cancels, import/demo/export/recovery action and Cancel retires pending restoration/replacement publication. Raw title/numeric fields, selected brush plane/radius/overlay/manual acknowledgement are not silently applied or saved. Keep current invalid-field text/caret/error visibility. Recovery/status helpers must not force syncNumeric, clear dirty flags, redraw over a gesture, install a study or reset History.

A conflict from **any** executing queued snapshot protects newest memory, clears the save debounce/pending pump and hides ordinary Retry saving. Later edits/Undo/Redo/painting work in memory, with no automatic write. Conflict does not change generation/project/source/frame or cancel an in-progress mask gesture: its final valid release is still one local history edit. Report the conflict outside the canvas; do not repaint/reset focused DOM. Generic confirmed rollback may offer ordinary Retry; unknown/protected authority exposes Reload/Replace/Download instead.

Initial restore is one owned chain. Editing/import/demo can retire its publication; explicit Cancel may abort its load signal and retire its instance. Neither path manufactures an accepted absence or releases an ordinary-save expectation. If a cancelled/timed-out store exists, fresh recovery remains disabled behind its separately owned close/decode drain barrier. Do not let new publish() clear restoreFailed/protection or flush saves after a failed/discarded startup read. A successful staged photo/project/demo is an in-memory replacement, still protected when browser authority is missing. Existing import confirmation replaces local study/history only; it must not imply that choosing a new photo automatically repairs/overwrites unreadable saved data.

Reload confirms replacement of local study/history, unfinished raw fields and any pending gesture before action. It then prepares the complete new project+raster+History locally, without altering current frames. Use one owned operation plus the separate storage close/drain barrier; cancel old preview/stage/export owners deliberately. Logical failure may finish its visible operation, but only the corresponding close Promise can release the reopen barrier. On matching final ownership, acceptLoad then install only the prepared study. Valid absence explicitly clears the local study/history only after that confirmation. Failure/cancel/late input leaves current source/mask/history/raw fields untouched and protection intact. A superseding operation cannot be unlocked by an older callback's finally; a native close drain releases only its own barrier identity, regardless of editor generation.

Reviewed replacement refuses while an unfinished gesture, stage/import/export, initial/reload/native save or another replacement is active. Capture `history.current` (committed photo/mask/settings/title), generation, editorIntent and page lifetime. Fresh review gives title/dimensions/mode or explicit absence/unreadability; do not install it. After await, recheck ownership, confirm that the complete committed local study replaces that reviewed copy and unsubmitted fields/unfinished strokes are excluded, then recheck before dispatch. Keep protected throughout preflight/native CAS; failure/cancel/conflict leaves both copies and requires a fresh token for retry.

After confirmed replacement, matching generation/intent may report Saved and resume normal autosave. If newer local edits/raw intent occurred after dispatch, native receipt still advances truthfully but newest memory remains unsaved and automatic writes stay held until explicit Retry saving. A page-retired completion leaves returned UI protected. Never write newer edits merely because an older replacement succeeded. Recovery locks clear by their unique operation/drain owner, not by generation alone.

PNG export uses the existing worker, exact committed source/mask/settings and canonical lossless encoder. It must remain available under storage conflict and preserve its current single-job/Cancel behavior. Storage status changes cannot cancel/rename/rebind a successful local PNG job or substitute durable winner pixels. Reload/install explicitly retires preview/export ownership before replacing source; completed preview may remain visible until the newer current preview succeeds, as already documented. Preserve #53's actual eventual-frame assertions rather than assuming download completion equals preview paint.

## Independent verification and ownership

Root already ran the frozen original same-origin two-page baseline (see source evidence above): literal source PNG and independently authored mask/settings, A changes retained source/mask/settings, B edits stale title. Retain actual A/B project downloads, native raw value, PNG/mask hashes and status. Failure must show loss of the winning complete graph, not missing controls. Native gates then use independently authored expectations, never a fake IDB or producer-generated expected receipt.

Required cases: actual A/B winner preservation with exact original PNG/mask/settings and loser Undo/backup/PNG; same-native-snapshot racing CAS; queued own terminal success and snapshot detachment; request-success then rollback; legacy upgrade/read without row writes and old open1 refusal; absence versus undefined/corrupt/future wrapper/undecodable image; wrong-purpose/forged/foreign/used/stale tokens; bounded malformed review and cap+1 refusal; third writer during reviewed replacement/image preflight; synchronous delayed-watchdog timeout and old token retirement; held delivered read/decode/open/close/versionchange; changed-back raw fields and source gesture; superseded import/reload/recovery; genuine persisted page lifetime; actual complete browser-process restart.

Old storage harness call sites need intentional version 2, instance/acceptance, wrapper-unwrapping and reviewed corrupt replacement adaptations. Keep literal native version 1 fixtures and #68 setup rollback/private-safe expectations. Keep direct header-valid undecodable load/save refusal, actual keep-alive transaction gate and unchanged complete numerical/PNG/source-orientation/history assertions. No no-op/mirrored tests solely to increase counts.

Maximum fixture: independently original normalized 1,280×1,280 PNG within 7 MiB, all 1,638,400 authored labels with known near/subject/far regions, nondefault admissible manual settings and title, up to 30 distinct edit states within 32 MiB. Use the real normalization/import/painting/settings/save flows and stale second page, then reviewed replacement and entire persistent Chromium restart. Independently decode downloaded project mask and original PNG bytes and sample an actual exported PNG against declared scalar geometry; preserve existing numerical tolerances. Record actual photo/JSON/wrapper/history bytes and durations, not promised 12 MiB capacity or photo fidelity/depth accuracy.

Disjoint owners after approval: (1) storage.ts + owned storage tests/receipt; (2) main.ts/minimalstyle UI + focused recovery ownership tests; (3) independent native storage oracle and constructor-only harness exports; (4) independent editor/native mask/source/raw/history/export oracle; (5) independent maximum fixture/smoke plus read-only cross-seam reviewer; (6) root spec/plan/config/version/docs/minimaloldfixture adaptations/sharedbuild/native leases/Git/CI. No producer edits model/history/images/jobs/render/photo-header/PNG kernels without a separately demonstrated authorized defect.

No product, runtime, test, build, service or Git mutations were performed to prepare this design. Root approval precedes implementation; the original baseline reproduction is already separately recorded.
