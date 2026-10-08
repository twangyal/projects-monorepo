# Melody #98 — saved-copy conflict protection (frozen contract)

Frozen by root on 2026-10-04 against published direct editor d582c0dd. Issue98 and draft PR100 supply the existing three native regressions; that draft remained tests-only at b6b99ede when implementation started. Implement the single current Astra storage/main integration, preserving any later concurrent commits through explicit Git reconciliation. No new dependency, service, model or portable format.

## Recommendation

Build a storage-only optimistic concurrency protocol enforced inside the native IndexedDB readwrite transaction. Do not change Composition1, MelodyDocument1, ReferenceAsset, portable backup1, ReferenceHistory, reference audio or roll proposal schemas. Keep database `melody-studio.projects`, database version1 and stores `projects`/`assets`; only the row at `projects/current` becomes schema2. Preserve exact schema1 rows and existing Blob bytes on every startup read. No automatic migration write, tab merging, BroadcastChannel dependency or PCM re-encoding is required.

Current `save()` clears the complete assets store before checking any saved-copy identity. That is the destructive seam. Current `pumpSave()` treats every error as retryable storage failure, while `replaceSavedCopy()` clears recovery before queuing a write. Both must change narrowly.

## Exact storage API and ownership

Use module-private, instance-bound opaque receipts; neither public JSON nor browser storage contains a caller-issued receipt. The following concrete API is small enough for the two existing integration sites and distinguishes a load that completed from a load that the editor actually accepted:

```ts
interface LoadedProject {
  bundle: ReferenceBundle | null;
  receipt: SavedCopyReceipt;
}
interface ReplacementReview {
  receipt: SavedCopyReceipt;
  summary: { readable: boolean; title: string | null;
    tracks: number | null; references: number | null };
}
class SavedCopyConflict extends Error { /* fixed, identity-free message */ }
class ReferenceStorage {
  constructor(factory: IDBFactory);
  load(): Promise<LoadedProject>;
  acceptLoad(receipt: SavedCopyReceipt): void;
  save(bundle: ReferenceBundle): Promise<void>;
  reviewReplacement(): Promise<ReplacementReview>;
  replace(bundle: ReferenceBundle, receipt: SavedCopyReceipt): Promise<void>;
  close(): void;
}
```

`SavedCopyReceipt` is an opaque type backed by a private WeakMap or equivalent private identity map, not a serialized client contract. Reject cloned, forged, wrong-instance and consumed replacement receipts. `acceptLoad()` accepts only the successful load result belonging to this instance; it does not write. It promotes the transaction snapshot to the ordinary save expectation only when main has rechecked its load owner and constructed an admitted ReferenceHistory. A cancelled/stale load or failed PCM hash check never silently advances the expectation.

This explicit load result changes only the internal load API and its main caller; current storage producer tests check rejection/close/timeout rather than successful return shape. Update any newly added successful-load tests honestly. An alternative preserving the old return shape would need a separate opaque load-token method anyway; the single result above avoids ambiguous multiple `null` loads.

Every `save` validates and detaches its bundle synchronously at call time, as today. Its expectation is the instance's last *accepted* load or successfully completed write, read when that queued operation executes. This permits A→B→C saves queued by one tab: successful A advances the private receipt used by B, even if A is no longer the current editor generation. It does not permit save before a known, accepted read. A failed transaction does not advance that receipt.

Suggested exact new row: `{schemaVersion:2, revision:<fresh lowercase UUIDv4>, document:<canonical MelodyDocument1>}`. The UUID is a storage revision, not a portable/reference ID. A fresh revision for every successful write avoids an integer reset/ABA when a deliberately repaired legacy or malformed row is replaced. Use this UUID revision format; no resettable integer revision or weakened legacy fallback. Existing PR100 tests require schema2 but do not prescribe the revision field type.

The receipt distinguishes: proven key absence, admitted legacy row, admitted schema2 row, and protected unreadable current row for explicit replacement only. It covers the full bounded stored descriptor (not just its document title) and the selected stored asset metadata/hash/Blob size/type. Loaded PCM hashes remain verified by the existing reader. Supported writers update revision and descriptor+assets together; a changed reference hash or binding in a legacy writer must also conflict. No full PCM hashing belongs inside a live native transaction.

Use `getKey('current')` with `get('current')` in the same snapshot to distinguish proven absence from a present `undefined` value. Present undefined is protected corruption, not permission for a first ordinary save. Metadata snapshots must use existing document/asset limits and exact shape checks before serialization. Do not add a generic arbitrary-object recovery framework. Explicit replacement may capture a bounded malformed descriptor as an unreadable receipt and disclose that fact; if it cannot obtain a bounded comparable receipt, refuse replacement and retain protected memory/backup access rather than treating failure as absence.

## Load, compare and write sequence

1. Read the descriptor existence/value and referenced asset records within one readonly transaction across both stores. Capture its receipt from that same snapshot. Resolve the capture only on transaction complete.
2. Outside the transaction, decode bounded Blob bytes and verify all existing metadata/PCM hashes; finish bundle validation. Do not rewrite the saved row, assets or legacy localStorage.
3. Return the bundle and opaque receipt. Main rechecks loadEpoch/editor generation/raw intent, constructs ReferenceHistory, and calls acceptLoad immediately before publishing the restored state. The startup barrier remains until the owning load settles. A refused restore leaves memory/drafts/history intact.
4. For ordinary save, precompute candidate asset hashes/Blobs outside the transaction under the existing operation deadline. Open one readwrite transaction over both stores, read current existence/descriptor and bounded asset metadata, and compare to the queued operation's accepted receipt.
5. On mismatch, abort with `SavedCopyConflict` **before** assets.clear/put or projects.put. Do not auto-adopt the winner as an ordinary-write expectation. Do not return success or overwrite either side's reference PCM.
6. On match, allocate the new storage revision and queue assets.clear/put plus schema2 descriptor.put inside that same transaction. No await, hash or unrelated asynchronous work occurs between the compare callback and those writes.
7. Publish the new private receipt only on native transaction complete. Error, abort, timeout, close and versionchange leave it unchanged. Preserve the existing 10-second per-operation limit and serial queue.

Native readwrite transactions serialize overlapping scopes, so two tabs that both read revision A cannot both commit against A. Unlike localStorage read-then-set, this comparison is atomic with the write. Receipts are authority for storage, not UI generations; main still separately owns whether any completed operation may replace visible state or display Saved.

## Main integration and recovery

Keep #99's roll controller, gesture begin(), raw input invalidation, actionPointer bypass, geometry checks and commit/withComposition paths intact. Direct roll publication still uses ReferenceHistory and queueSave; it must never bypass the new storage authority. No new history schema and no PCM copying/hashing during pointermove.

On `SavedCopyConflict` in pumpSave:

- Set recovery=true, unsaved=true and saveFailed=true, clear savePending, and stop the pump. Show an honest conflict message containing `another tab` or `conflict`.
- Preserve current ReferenceHistory, project, bindings, PCM, selected track/note, note/field drafts, continuation and reference-window fields. A conflict status update uses syncSaveStatus/updateReference, not a blanket render.
- Expose Save project file, Retry load and Replace saved copy. Hide/disable automatic Retry save while protected. Future commits may proceed in memory and remain unsaved, but cannot queue automatic writes while recovery=true.
- A stale successful job must not mark a later generation Saved; retain existing generation checks. A conflict from an older queued snapshot still protects the newest local work and clears its pending autosave.

For deliberate replacement:

1. Refuse admission while startup, busy capture/render, loading or an existing save/replacement is outstanding. Retire any active roll gesture and pending staged project/MIDI import through the existing explicit-intent hook; preserve raw fields/continuation unless the user actually chose to discard them.
2. Capture the current complete bundle plus compositionGeneration/editorIntent and a replacement operation epoch. Ask storage.reviewReplacement() for a fresh bounded *current* receipt and saved-copy summary, without adopting that copy into the editor or normal-save expectation.
3. After the await, recheck owner/generation/intent and show a native confirmation identifying the saved copy being replaced (or explicitly unreadable), that current **committed** local notes/audio will be written, and that unapplied fields are excluded. Cancel leaves both copies and protection unchanged.
4. Recheck after confirmation, then call replace(capturedBundle, reviewedReceipt). The storage transaction performs the same fresh comparison before audio mutation. If another tab changed the copy after review, refuse; do not retry automatically or reuse the old confirmation. A new deliberate action must read/review again.
5. Keep recovery=true throughout read, confirmation, hash preflight and transaction. Only a matching successful transaction may unprotect the browser copy. Quota/abort/timeout/close/conflict leave recovery active and preserve raw fields/audio/history.
6. If newer local edits occurred after replacement admission, the saved receipt may advance on actual transaction completion, but that older bundle is not the latest editor state: leave unsaved=true and do not display Saved for it. Keep editing available and require an explicit Retry save for the latest snapshot after the successful reviewed replacement. Do not automatically save edits that occurred after replacement admission; show that the newer memory work remains unsaved.

Retry load keeps the existing deliberate replace-memory confirmation and startup barrier. It must invalidate earlier staged imports and roll publication. Do not accept its storage receipt or clear conflict protection until the final visible restore is admitted; failure remains protected. Pagehide retires pending replacement/reload publication epochs as well as existing capture/roll work. A transaction already completed before pagehide is an actual saved copy, not something to roll back; late UI callbacks cannot reopen playback or falsely publish a restored editor.

## Minimal ownership split

1. Storage owner (audio_engine): `src/reference-storage.ts`, storage-only types/error exports as needed in that file, new/extended `tests/reference-storage.test.ts`; transaction receipts, exact schema1/2 row admission, absence distinction, serial queued writes, replacement CAS, timeout/close tests. No reference/audio/portable changes.
2. Sole main integrator (recorder): `src/main.ts` only, narrow load/pump/replacement/status/epoch changes while retaining #99 roll hooks. The readonly storage owner must communicate exact new result/error/review APIs before integration; do not overwrite main wholesale from the older PR base.
3. Independent native author (git_reader), with additional independent receipt/state tests from next_project_assessment: retain PR100's `tests/browser/save-conflicts.spec.ts` and extend meaningful delayed-review/queued-write/abort cases. Existing full58/reference/MIDI and #99's22 cases remain untouched except justified helper API admission corrections.
4. Root: authored reviewed spec/plan, branch reconciliation, coherent build, actual combined CI and evidence. Root owns package version0.5.1, evidence, builds/ports/Git/GitHub and final CI. The existing #99 editor and its original media expectations remain intact.

## Verification that distinguishes the real failure

- Two genuine same-origin pages load the same saved descriptor+reference. A publishes different reference bytes. B commits a note or title: B's committed memory and exact complete backup survive, while the actual DB descriptor and **all** A PCM bytes stay unchanged. B receives conflict/protected recovery, not generic quota error.
- Real two overlapping readwrite saves from separate instances against the same receipt: exactly one wins; loser aborts before any asset deletion/put. Subsequent serial saves from the winning instance advance their receipt and succeed.
- Genuine schema1 descriptor/PCM read and reload cause no write; its first admitted edit writes schema2 once. A stale second legacy tab conflicts, including equal title but changed reference hash/binding. Present undefined and malformed descriptors are not absence.
- Delayed replacement review/confirmation: A changes its copy after B's review; B must refuse without losing either graph. Cancel confirmation, quota failure and abort after request success retain protected status and actual winner bytes. A second deliberately reviewed action can succeed.
- During replacement hashing or a genuine transaction wait, later local committed edits/raw changed-back intent survive. Saved status only acknowledges matching generation; later work remains unsaved or is separately admitted through ordinary queue.
- Retry-load owner: held actual transaction/Blob hash cannot replace a later chosen operation or accept a receipt after cancellation/pagehide. Existing native startup-Cancel barrier regression remains valid.
- Keyboard rejected roll edit retires a pending file read; no-op roll movement keeps redo, proposal and reference bytes. Changed roll edit on a stale tab stays in memory, protects the winner, and remains Undo-able without triggering another write.
- Failed save after put request success but before complete must not advance expected receipt. Retain existing close/open-timeout/versionchange ownership tests and add late completed-old-connection tests if the new receipts introduce callbacks.

This is the next high-value repair: it protects irreplaceable retained audio with a native transaction and an explicit recovery choice, without expanding Melody's musical or portable-data model.
