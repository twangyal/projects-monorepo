# Style Studio #116 — protect complete saved profiles

Status: **Approved by root after independent review and original native failure. Implementation released in disjoint files.**

Issue: https://github.com/twangyal/projects-monorepo/issues/116

## Purpose and grounded failure

Protect a complete local wardrobe profile from a stale tab's autosave. Keep the current profile, session history, photos, labels, saved-look snapshots, raw form fields and complete backup export available when browser storage refuses a write. There is no tab merge, synchronization service, new recommendation algorithm or change to portable Project schema1.

The failure was first source-confirmed and then reproduced by root in two real Chromium pages before any product changes: `src/storage.ts` queues operations within one instance, but `save()` unconditionally calls `profiles.put(captured, 'current')`. `src/main.ts` checks its own save sequence and reports Saved. If two tabs restore P, tab A saves a new photo/opinion/look, and tab B edits its stale P, B replaces A's complete durable value. Neither the local queue nor the local generation counter detects the foreign write. Existing native tests cover ordering, rollback and corruption preservation, not this two-tab comparison.

The recommended solution is native transaction-local optimistic concurrency with private receipts. Comparing before a separate transaction, checking only title/revision, or relying on BroadcastChannel does not protect complete bytes atomically. Holding an exclusive tab lock would unnecessarily prevent two readable/editable copies and does not provide explicit conflict recovery.

## Storage compatibility and fixed bounds

Use the existing IndexedDB database `style-studio`, object store `profiles`, key `current`, upgrading **database version1 to version2**. Do not move, rename, delete or rewrite the current value during upgrade. The only schema-upgrade work is creating `profiles` for a genuinely fresh database; an existing database missing that store remains incompatible and protected, rather than receiving an invented replacement store. Catch schema-creation errors, abort the upgrade and preserve #68's private-safe failure and no-pageerror behavior.

Database version2 is deliberate old-writer protection: published old clients open version1 and unconditionally put bare projects. After upgrade they receive VersionError instead of reopening a destructive writer. Existing live old clients already close on versionchange; a blocked upgrade is refused with close-other-tabs guidance. This is a local compatibility change, not a promise to resist manual developer-tools writes or arbitrary same-origin scripts. New readers still compare the whole value, including legacy values.

Two exact current-row shapes are admitted:

```ts
// Genuine existing value, read without modification.
type LegacySavedProfile = Project; // portable schemaVersion: 1

// All new successful writes.
interface SavedProfileRow {
  schemaVersion: 2;
  revision: string; // fresh lowercase UUIDv4 for each committed write
  project: Project; // unchanged portable schemaVersion: 1
}
```

The wrapper is strict: exactly those three enumerable ordinary data fields. UUIDv4 uses the exact lowercase 8-4-4-4-12 version4/variant spelling. Portable import/export remains bare Project1, with no storage revision. A read or successful database-version upgrade does not migrate the legacy value. Only a later successful ordinary save or reviewed replacement writes the wrapper. Duplicate/clone UUIDs are not authority; private full-value receipt comparison remains required.

Preserve `LIMITS` unchanged: 36 pieces/12 per category, 80 examples, 30 saved looks, 20 JPEG references, each at most 204,800 bytes and 720×720, Project JSON at most 8,388,608 UTF-8 bytes; history at most 20 snapshots/25,165,824 bytes. The compact wrapper above adds exactly 80 bytes with its 36-character UUID. Export `MAX_STORED_BYTES = LIMITS.projectBytes + 80` (8,388,688) for native row/comparison admission, without widening the portable cap. Legacy rows must independently remain within8,388,608 bytes. Depth 32 and 100,000 visited value nodes bound comparison traversal; actual canonical profiles are far below the node bound. Count expanded JSON UTF-8 bytes before retaining encoded identity; a tagged comparison representation must not accidentally double the raw admission cap.

Neither the 8 MiB cap nor browser quota means a legal profile can occupy exactly 8 MiB. Maximum valid photo assets contribute 4,096,000 JPEG bytes before base64 and bounded text. Maximum acceptance must report measured actual complete JSON bytes, not claim an exact8 MiB valid profile that violates existing semantic limits.

## Exact public API

All exports below live in `src/storage.ts`. Keep `openProjectStore()` as the integration entry; no dependency injection API or alternate production writer is added merely for tests.

```ts
export interface SavedCopyReceipt { readonly __savedCopyReceipt: unique symbol }
export interface LoadedProject {
  project: Project | null;
  receipt: SavedCopyReceipt;
}
export interface ReplacementReview {
  receipt: SavedCopyReceipt;
  summary: {
    present: boolean;
    readable: boolean;
    title: string | null;
    pieces: number | null;
    examples: number | null;
    looks: number | null;
    photos: number | null;
  };
}
export class SavedCopyConflict extends Error {}
export class SavedCopyProtected extends Error {}
export interface ProjectStore {
  load(): Promise<LoadedProject>;
  acceptLoad(receipt: SavedCopyReceipt): void;
  save(project: Project): Promise<void>;
  reviewReplacement(): Promise<ReplacementReview>;
  replace(project: Project, receipt: SavedCopyReceipt): Promise<void>;
  clear(): Promise<void>;
  close(): Promise<void>;
}
export function openProjectStore(): Promise<ProjectStore>;
export const STORAGE_OPERATION_MS = 10_000;
export const MAX_STORED_BYTES: number;
```

Receipts are opaque objects backed by an instance-private WeakMap, never serialized. Their private record captures purpose, instance, protection epoch, used state and the actual native snapshot identity. A type assertion, clone, foreign instance or previously consumed token grants no authority. Receipt objects expose no stored project/identity. `acceptLoad()` is synchronous, one-use and accepts only a successful load-purpose receipt from the current protection epoch. It never writes. Replacement receipts cannot be accepted as ordinary load authority, and accepting a load receipt cannot turn it into a replacement token.

`SavedCopyConflict` has a fixed actionable, identity-free message identifying a changed saved copy/another tab. It does not echo private DOMException details, raw values or stored profile text. Unknown/unavailable storage remains a useful private-safe Error, distinguishable from proven conflict. A failed or unaccepted load never grants ordinary saving permission, including an absence result.

Root-approved integration clarification: export `SavedCopyProtected extends Error` as the explicit discriminator for unknown/unavailable read, deadline, versionchange, closed connection and failed unreadable-load authority. Its messages are bounded private-safe guidance. Main treats these as protected recovery without parsing message text or inspecting browser-private exception details. A confirmed native readwrite abort/quota failure remains an ordinary Error, preserving its last accepted expectation for explicit Retry saving. Proven `SavedCopyConflict` remains its separate exact class.

`clear()` is retained for existing internal/harness compatibility, but now requires accepted ordinary authority and performs exactly the same same-transaction CAS before delete. No UI clear-storage feature is added. Its completed receipt is proven absence, allowing later own queued saves. A protected corrupt value must not be cleared through this method; explicit reviewed replacement is the repair flow.

## Complete-value receipt and admission

Read both `getKey('current')` and `get('current')` in one native transaction. Absent key and present undefined are different: the former can be accepted as absence, the latter is protected unreadable data. No request error is interpreted as absence. Preserve the raw result during receipt creation; do not normalize it through `validateProject()` before comparing.

Identity covers the entire actual current value, including all photo data URLs, IDs, tag/feature values, ordered arrays, captions, saved-look notes and snapshots, plus every wrapper field and revision. Do not compare only revision/hash/title, or a canonicalized subset of the project. Object property insertion order is not part of value identity; compare all enumerable own ordinary fields in deterministic key order. Array order and membership are part of identity. Distinguish finite numeric -0 from0 because the existing feature validator admits -0. Existing JSON export/history normalization remains unchanged; the comparator must not introduce a new model rejection or silently equate the raw saved values.

Use a narrowly bounded comparator for ordinary JSON-compatible data, plus a distinct root present-undefined sentinel. It rejects getters, holes/extra array properties, cycles, nonfinite numbers, symbol properties, functions, native objects and excessive depth/nodes/bytes before minting authority. Accessors are not invoked. This is not a general arbitrary-object recovery framework. Count ordinary JSON bytes separately from any -0 identity tags, including escaped strings and punctuation; do not grant replacement for a malformed row one byte beyond the applicable bound. Full-value identity may be a private bounded deterministic encoding; no cryptographic hash or photo decode belongs inside a live readwrite transaction.

Load still validates the exact project schema and strict photo headers. Main then independently completes the existing actual JPEG decode with `validateProjectPhotos()` and constructs `ProjectHistory` before accepting the receipt. Legacy string trimming/model canonicalization follows the existing validator; receipt comparison nevertheless describes the actual original native value, not the returned canonical project. Unknown fields, future wrappers and invalid semantic references fail load and remain preserved.

For replacement review, bounded ordinary malformed data (including null or present undefined) may receive a replacement-only receipt with `readable:false`; malformed schema2-looking wrappers use the row bound, and malformed bare legacy-looking values use the portable bound. Ambiguous other ordinary values use the portable bound. If the snapshot cannot be compared within those bounds, replacement is refused; the editor stays memory-only with complete current-profile export available. No unsupported raw recovery download or native-object serialization is introduced. An admitted readable summary is derived from a validated Project; header-valid but undecodable photos may still be disclosed as a structurally readable saved profile, without claiming image decode success. Review never silently installs or authorizes the winner.

## Transaction sequence and queued authority

1. `load()` captures existence/value and identity in one readonly snapshot. Require both native transaction complete and successful result-callback admission before returning; a delayed request callback must not resolve undefined merely because the native transaction completed. No publication on request success alone.
2. Outside the transaction, return the detached validated project and its unaccepted token. Main rechecks operation/editor/raw-intent ownership, actually decodes all saved photos and constructs a temporary history/model. Only immediately before matching visible publication does it call `acceptLoad(receipt)`. An aborted/stale decode or expired startup owner does not authorize a save.
3. `save()` validates/detaches the candidate synchronously at invocation. Main maintains one in-flight save and one newest pending committed snapshot, coalescing intermediate autosaves rather than retaining an unbounded queue of full photos. The store's existing serial invocation order is retained for explicit callers. The ordinary expected identity is read when each queued operation executes, from the latest accepted load or actually successful own mutation.
4. Open one native readwrite transaction, read current key/value, create its bounded raw identity and compare to the expected receipt. On mismatch, abort with `SavedCopyConflict` before any put/delete. Atomically enter protected mode, retire ordinary authority and unused old receipts; later queued ordinary saves refuse. Do not adopt the foreign winner.
5. On match, queue a fresh UUIDv4 schema2 row (or clear's deletion) in that same callback and transaction. There is no await, JPEG decode or independent task between compare and mutation. Overlapping native readwrite scopes serialize, so two instances comparing the same old value cannot both win.
6. Advance the private expected receipt only on confirmed native transaction complete, even if the corresponding UI generation has retired. A successful older local write establishes the truthful basis for the next queued write, but must not mark newer memory Saved. Request-success followed by abort does not advance expectation. Proven abort/quota failure leaves the last expectation intact so an ordinary explicit retry can compare again; conflicts and unconfirmed outcomes remain protected.
7. `replace()` validates/detaches the candidate at call time and consumes the reviewed receipt on admission. Its transaction rereads and compares against exactly that reviewed value before put. It does not use whatever ordinary expectation happens to be current. A third writer between review and replacement causes conflict, with no automatic repeat or reuse of confirmation. Only matching transaction complete establishes a new ordinary expectation.

Every proof is stamped at the operation's initial read admission with a protection epoch. Any timeout/unknown completion/conflict/versionchange retires older proofs. A pre-protection read delivered late cannot mint a token that restores authority; a fresh read from a settled connection is required. Post-await publication and receipt advancement must check that epoch, not just whether a timer task has happened to fire.

## Native deadlines, close and page lifetime

Opening and each executing native operation have a 10-second monotonic deadline. Check finite deadline/current ownership at admission, before mutation and on successful completion, as well as the watchdog. Synchronous detection of expiry must enter the same protection path as the timer; clearing a delayed timer must not accidentally preserve authority. Deadline expiry is not proof of rollback.

On timeout, best-effort abort active native transactions, close the connection to new work, invalidate receipts and surface protected memory-only guidance. Recovery reopens a fresh store instance through openProjectStore(); the UI must not repeatedly call a timed-out/closed instance or interpret its failure as empty. Do not advance authority, claim Saved or run another ordinary write against unconfirmed state. Settle the logical operation boundedly even if no terminal callback is delivered, retaining only its native cleanup handler/connection ownership until eventual abort/complete. Late callbacks may retire owned native resources but cannot restore authority or publish stale UI. A separately opened recovery instance still needs a fresh bounded read, so an older blocking native transaction cannot be bypassed by fabricated absence.

Opening cannot generally be cancelled: timeout/blocked failures close a late onsuccess database, abort an upgrade if still active, and never hand it to the editor. Unsupported/incompatible databases remain untouched. On `versionchange`, retire receipts, refuse new work and abort/close the owned connection with private-safe guidance.

Normal `close()` immediately refuses new method admissions and waits for already accepted ordered operations to settle under their deadlines, then closes exactly its database. Repeated close is idempotent. Keep the existing native close-waits-for-accepted-writes meaning; do not instantly claim a pending write rolled back. Receipt acceptance after close is refused.

On persisted pagehide, retire startup/reload/replacement/import/photo/board UI owners and cancel transient work, but retain the committed project, raw forms, photo drafts already normalized and history. A already-running save may reach actual terminal and update private truth without publishing a stale save status. Do not automatically replace memory from storage on pageshow. Nonpersisted teardown closes the store and releases existing download/native resources. BFCache return remains editable and requires explicit protected recovery if authority became uncertain; it must not display Saved based on a pre-hide retired UI callback.

## UI flow and selectors

Keep all current wardrobe/opinion/look DOM nodes, source ID semantics and successful ordinary edit history. Add these controls beside the existing status, without replacing current forms:

- Existing `#save-status`: honest saved/saving/unsaved/protected text.
- Existing `#retry-save`: retry an ordinary proven storage failure only; hidden/disabled while protected or restoration/replacement is pending.
- New `#retry-load`: explicitly read the saved profile, replacing local committed memory/raw drafts only after confirmation and full admission.
- New `#replace-saved-copy`: review then confirm writing this page's complete committed profile to the current saved location.
- Existing `#export-profile`: always available for admitted current memory; emits unchanged bare Project1 JSON.

On any proven conflict (including a failure from an older active save), set `preserveStoredData`, stop/coalesce away pending automatic saves, mark current memory unsaved and show another-tab/conflict guidance. Future local edits/Undo/Redo remain usable and unsaved. Do not reset form values, focused nodes, caret, selected piece, keyed look drafts, assessment/suggestion controls or normalized-but-uncommitted photo drafts. Status-only updates must not call blanket reset/render. A generic proven abort may expose ordinary Retry saving; unknown outcomes/corrupt or denied reads are protected and cannot be retried as unconditional save.

Separate committed generation from raw intent (or capture an equivalent exact existing owner). Every input/change, including changed-back text, supersedes a pending reload/replacement/import publication. A replacement candidate consists only of the committed Project; confirmation clearly says unapplied fields and unsubmitted photos are excluded and will stay in the editor. Saved status acknowledges the captured committed generation only, never newer memory; raw drafts remain independently guarded by `hasUnsavedDrafts()`.

### Startup and explicit reload

Capture startup owner before open/load. Hold the startup/native-read barrier until that chain settles. If editing supersedes a saved-profile read, retain current memory/raw fields and refuse ordinary write authority; a cancelled nonempty load must not set storageReady then flush pending saves. Proven empty load still requires explicit matching acceptance before a first ordinary save. Unknown/denied read is not empty.

For `#retry-load`, confirm loss of this page's unsaved committed changes and raw drafts before starting. Retire pending import/photo/board owners through existing hooks; capture an operation epoch and intent. Read, decode photos and construct a temporary History/model without touching current memory. Recheck after every await, then synchronously acceptLoad+publish prepared state and only then clear protection. Failure/cancel/late changed-back input preserves all current data and protection. A successful reload explicitly resets session history and editor drafts; this is the user's chosen read operation, not an automatic merge.

### Reviewed replacement

1. Refuse while initial restore, an active save, reload, photo decode/import or replacement is outstanding. Keep complete backup available. Do not clear protection at admission.
2. Capture the committed Project, committed generation, raw intent and a unique replacement owner. Call `reviewReplacement()` for a fresh native snapshot and summary; no visible winner installation or ordinary-authority promotion occurs.
3. Recheck owner/intent/generation after the await. Confirm the actual saved title/counts, absence or unreadability; identify that the complete committed local profile, including photos and saved looks, will replace it. Cancel leaves both sides unchanged.
4. Recheck after confirmation and call `replace(captured, receipt)`. Keep protected throughout the transaction. Failure/conflict/timeout leaves the winner and newest memory available, with a fresh review required for another attempt.
5. On confirmed success, the storage receipt advances. Only matching committed generation/raw intent may report Saved and resume ordinary automatic saving. If newer local edits occurred while native mutation was pending, retain them unsaved; do not automatically overwrite the newly committed snapshot with those newer edits. The confirmed write establishes known storage authority, so offer explicit Retry saving for the newer committed memory while holding automatic saves until that action. If page lifetime retired the operation owner, retain protected recovery instead of unprotecting a returned editor. Stale callbacks never reset raw forms or admit late startup data.

New profile, sample and valid import continue to be explicit undoable **in-memory** replacements through existing history. They must not clear `preserveStoredData`/invent storage authority, and their existing confirmation must no longer claim an unreadable browser record is thereby replaced. On protected storage they remain editable local profiles until #replace-saved-copy succeeds. Remove the `explicitReplacement` startup bypass that currently converts a later failed read into an unconditional save. There is exactly one native writer through the new store API.

## Verification and frozen expectations

First capture the actual old two-page failure on an original complete profile with real720×720 JPEG references and independent labels/look snapshots; distinguish that new native evidence from the current source-derived report. Author expected native database and complete exported-project values independently of receipt internals. No fake IndexedDB implementation is introduced.

Required real-IDB coverage:

1. A/B accept the same legacy and then schema2 profile. A adds/changes photo, opinion and look; B commits a title/piece/rating edit. Exactly A's complete native value stays saved, including every JPEG byte and ordered graph; B remains editable/Undo-able and exports its own exact complete profile, with a conflict status.
2. Two instances race readwrite CAS; only one succeeds. Multiple queued own snapshots advance only on actual complete, detach at call time and preserve order. A foreign conflict protects all later ordinary queued work. Proven abort-after-put-success retains the old receipt; a later own retry succeeds if the saved value is unchanged.
3. Version1 bare value with unusual but admitted strings/feature -0 survives upgrade+read byte/value-exact with no current-row put. First accepted edit writes wrapper2 once. Old `indexedDB.open('style-studio',1)` refuses after upgrade; blocked live legacy connection and #68 rollback/retry remain meaningful.
4. Absent key, present undefined, null, malformed/future wrapper, extra fields, bad references and header-valid-undecodable JPEGs are distinct. Failed/unaccepted load grants no ordinary authority. Fresh review of bounded ordinary unreadable data permits confirmed CAS repair; cycles/native objects/nonfinite/getters/sparse/over-limit values refuse without write. Test wrapper comparison byte cap and -0 identity separately from portable/history normalization.
5. Review→third writer→replace refuses with all winner images/labels untouched; cancel confirmation and quota/abort leave protected status. A new fresh review can succeed. Forged/cloned/foreign/used/load-purpose receipts reject. Returned project mutation cannot alter expected raw identity.
6. Held real read callback after native completion never fabricates undefined/absence. Deadline after current callback but before delayed watchdog also protects. Old receipt/replacement tokens cannot revive after timeout; old completion cannot mark newer work Saved. Close/versionchange/blocked-open/late-open resources retire without pageerror or leaked usable writer.
7. Held restore/photo decode, file import and reviewed replacement superseded by committed edits or raw changed-back input cannot publish/reset/unprotect. Existing focus/caret/keyed raw photo and look drafts stay exact on conflict/failure. BFCache return preserves in-memory work; native terminal truth is separate from UI Saved state.

Maximum native acceptance uses 20 independently original valid720×720 JPEGs at the existing 200 KiB bound, all 36 pieces, 80 examples and 30 three-piece look snapshots with legitimate references and maximum admitted text. Construct the legal graph without claiming unsupported 80 outfit examples when only 30 sourceLookIds exist: fill remaining opinions with tagged examples. Include a foreign stale tab, exact complete JSON/JPEG hashes and actual close/relaunch of a persistent Chromium profile. Compare the winning durable project before/after restart and both backup exports; verify recovered reviewed replacement can subsequently persist and restart. Report actual UTF-8 project/wrapper bytes, photo totals, timings, browser version and fixture hashes. Browser quota and retention availability are not guaranteed; the gate proves actual controlled software behavior, not fashion prediction.

Preserve all previous numerical model, photo orientation/PNG board, complete-flow and history assertions. Necessary old native storage harness adaptations are limited to DBversion2, LoadedProject/acceptLoad, schema2 wrapper readback and reviewed corrupt replacement instead of unconditional clear. Keep literal version1 fixtures, old rollback assertions and actual transaction gates. Do not weaken assertions to make an unaccepted load silently authorize saves.

## Exclusive implementation ownership after root approval

1. Storage producer: `src/storage.ts`, `tests/storage.test.ts`, new owned storage receipt tests and a sanitized producer receipt. All public storage-only types/errors/constants live in storage.ts; no domain/model/history/photo changes.
2. UI producer: `src/main.ts`, minimal `src/style.css` if needed and focused UI tests. Implement save pump, accepted startup/reload, reviewed replacement and status-only draft preservation. No storage internals.
3. Independent native receipt/oracle owner: new `tests/browser/save-conflicts.spec.ts` and constructor-only extension of the existing storage harness where necessary; fixtures/expected raw records authored before producer reads. Covers actual old failure, transaction compare/race/corruption/timing.
4. Independent editor/native owner: distinct new browser ownership/recovery tests, actual complete-profile exports and focus/history/photo lifetime. Existing flow/model/media expectations remain unchanged.
5. Independent maximum/source reviewer: original maximum fixture, portable smoke/restart evidence and read-only final cross-seam review; no producer edits or fitted-model accuracy claims.
6. Root: review/freeze/plan, minimal old test/harness compatibility edits, version/docs/config/Git/CI and serialized shared build/native leases. No producer runs shared build or browser without a root lease.

No implementation/runtime/test execution was performed while preparing this design. Root review must resolve this document before product edits begin.

## Original native failure captured before implementation

Root built unchanged Style source at monorepo head `54e1f7b8b93549a3e38af8848d9e6df4597f4856`, then served an isolated immutable copy at port4310. Two genuine pages restored the original complete profile. Page A committed a second decoded photo, fourth piece, changed saved-look text and Like rating. Page B then saved its stale title edit and reported Saved; native durable state lost A's photo/piece/rating/look changes and exactly matched B's stale memory. The original protection assertion failed after all backups and screenshots were retained. See `apps/style-studio/docs/2026-10-05-saved-copy-baseline.json`; no fixture failure is substituted for this data-loss reproduction.
