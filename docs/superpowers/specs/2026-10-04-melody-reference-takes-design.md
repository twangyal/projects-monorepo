# Melody Studio retained reference takes

Issue: [#66](https://github.com/twangyal/projects-monorepo/issues/66). Reviewed contract frozen before production implementation. Root release follows its commit. Independent audio and storage review cleared the architecture; root resolved legacy UTF-16 compatibility without changing the engine format.

## Outcome and scope

Keep a listen-back copy of every successfully transcribed microphone, imported-audio or generated-demo take. The musician can compare a chosen interval of that take with the edited selected track, remove a reference, undo edits, close/reopen the browser and move the complete project to another browser. This is audible correction and recovery, not improved transcription, source separation, audio editing, automatic alignment or measured vocal accuracy. No backend, network, model, paid service, ZIP dependency or general DAW.

Keep `Composition` version 1 and all existing note, MIDI, continuation and synthesis contracts unchanged. A separate versioned document binds tracks to immutable audio assets. Putting binary audio into the existing composition would couple every learner/exporter/validator to persistence and duplicate bytes across history; keeping audio only in volatile memory would not deliver recovery. The wrapper is the chosen middle path.

Actual seams: `main.ts` currently transfers `samples.buffer` into the transcriber, clears a proposal before capture succeeds, saves synchronously to localStorage and stores composition-only history. `audio.ts` analyzes the first 20 seconds, quantizes at capture tempo and synthesizes an 80 ms release tail. The new integration changes those lifecycle seams without changing the detector or oscillator algorithms. Existing `CompositionHistory`, `storage.ts` legacy helpers and their old tests remain usable; the app adopts the new complete-project APIs.

## Public data and limits

All new shared types/constants live in `src/reference-types.ts`. Engine types remain in `types.ts`.

```ts
interface TrackReference { trackId: string; assetId: string }
interface MelodyDocument {
  schemaVersion: 1;
  composition: Composition;
  references: TrackReference[];
}
type ReferenceKind = 'microphone' | 'audio-file' | 'demo';
interface ReferenceAsset {
  id: string; kind: ReferenceKind; captureTempo: number;
  decodedSampleRate: number; decodedChannels: number;
  decodedFrames: number; analyzedFrames: number;
  frameCount: number; pcm: Uint8Array;
}
interface ReferenceBundle { document: MelodyDocument; assets: ReferenceAsset[] }
interface ReferenceWindow { startFrame: number; endFrame: number }
const REFERENCE_LIMITS = {
  sampleRate: 22050, seconds: 20, frames: 441000,
  sourceBytes: 10 * 1024 * 1024, decodedChannels: 32,
  assetBytes: 882000, currentAssets: 8, historyStates: 51,
  historyAssetBytes: 64 * 1024 * 1024,
  documentBytes: 1024 * 1024, backupBytes: 12 * 1024 * 1024,
  operationMs: 30000, jsonDepth: 16,
} as const;
```

`pcm` is exactly `frameCount * 2` bytes of little-endian signed mono PCM16 at 22050 Hz, with no WAV header. Asset IDs are lowercase canonical UUID v4 strings; track IDs retain existing engine rules. Decoded rate is an integer 8000–192000; channels 1–32; decoded frame count positive and duration <=20.1 seconds. `analyzedFrames = min(decodedFrames, floor(decodedSampleRate * 20))`; `frameCount = floor(analyzedFrames * 22050 / decodedSampleRate)`, positive and <=441000. Capture tempo is finite 40–240. No wall-clock date, local filename, device name or original upload bytes are retained. Provenance describes the supplied capture path, not verified authorship; imported backup metadata is unverified supplied data.

Documents have exact own keys, dense arrays, at most one reference per existing track, <=8 references, and normalized composition equal to its validated value (new envelope inputs may not silently lose unknown composition keys or trim names). Preserve every previously accepted Composition v1 string value, including NUL and lone UTF-16 surrogates in titles, names and IDs; a binding trackId mirrors the exact engine ID. JSON.stringify emits these values as reversible JSON escapes, so fatal UTF-8 decoding of the actual file bytes remains safe and lossless. Do not sanitize, replace or add Unicode admission restrictions to engine strings; new envelope keys, UUIDs, kinds and digest/base64 fields retain their strict schemas. The legacy parser/helpers remain unchanged. Legacy conversion uses the existing parser normalization only, then preserves its exact UTF-16 values through complete export/reopen. A bundle has exactly the distinct referenced assets, no missing/extra/duplicate IDs. References sort by composition track order; assets sort by ID for serialization. Document compact UTF-8 JSON is <=1 MiB. Validators return detached values, reject accessors/custom prototypes/sparse arrays, and must not expose the internal mutable PCM buffers. Boundary errors are bounded actionable text without echoing payloads.

## Capture and normalization

Capture context freezes target track ID, complete-document generation, raw editor intent and committed tempo before permission/file decoding. Recording/import/demo replacement asks about notes **and** an existing reference. Declining, permission/decode/analysis/normalization failure, timeout, cancellation or stale completion changes neither document, history, saved state, raw drafts nor continuation proposal. Starting capture may stop sound but does not clear the proposal; a successful actual commit invalidates it. Successful replacement publishes notes and reference together as one edit. Zero detected notes fails the whole take; it does not attach silent/unrecognized audio separately.

Native audio decoding remains browser-dependent and capped at 10 MiB encoded input. Reject decoded duration >20.1 seconds. Mean all decoded channels at their decoded sample rate without changing existing transcription math; reject nonfinite data. Analyze and retain only the first `analyzedFrames`, dropping <=100 ms of encoded padding with a visible message when truncated. The retained reference starts at decoded time zero, including leading/internal/trailing silence; mean-channel downmix can cancel opposite-phase material. `decodeAudioData` resamples to its AudioContext rate, so recorded metadata describes decoded audio, never the original codec or microphone clock; decoder delay/padding is not estimated or repaired. Duration checks occur after native decoding; the byte bound does not promise a hard predecode memory bound for arbitrary compressed files.

Normalize that same bounded mean-channel input using native `OfflineAudioContext(1, frameCount, 22050)`, source buffer at source rate, scheduled at time zero. At equal 22050 rate copy samples directly. Native resampling is intentionally not specified bit-for-bit across engines. Require finite output; clip to [-1,1], multiply negative values by32768 and nonnegative by32767, `Math.round`, encode signed16 LE. Do not amplitude-normalize, trim silence or change speed. Quantization and sample-rate conversion are lossy. Retain a bounded detached copy **before** transferring original-rate samples to the existing transcription worker; the detector input and algorithm stay unchanged. Asset metadata records the decoded source properties, not container claims.

Normalization, transcription and commit have one overall 30-second processing deadline after decoded input is admitted; file read/decode also have an owning 30-second timeout. Stop revokes ownership immediately. Native decode/offline render may be unabortable: ignore late settlement and close any owned live AudioContext; admit at most one outstanding native decode/normalization chain, including cancelled-but-draining work. New capture during drain gives a retry message rather than accumulating contexts. Pass the remaining aggregate processing deadline into the transcription worker timeout; normalization does not restart a fresh30-second worker allowance. Every await rechecks capture token, target, document generation and raw intent; pagehide releases capture and playback. Recorder permission cancellation retains its existing late-stream cleanup.

## Reference and notes audition

A stable reference panel belongs to the selected track. Show kind, captured BPM, reference duration, decoded source rate/channels, the normalized-copy description and any padding cut. The reference never automatically follows later note edits, transpose, repeat, tempo changes or continuation. Duplicating a track shares its reference asset; deleting it removes only its binding. New/example/MIDI composition replacements have no references, with one undoable complete-document replacement. Removing a reference does not remove notes.

Use two explicit actions: **Play reference** (original speed, reference PCM only) and **Play edited notes at capture tempo** (selected track solo, current instrument/volume/velocity, captured BPM). Ordinary **Play** and MIDI/WAV remain current-project-tempo synthesized notes only. The panel always displays both captured and current BPM when different. No time stretching or claim of automatic alignment. Reference audio ignores track mute/volume and plays at its recorded normalized level; clearly disclose this beside its button. Notes audition respects mute/zero volume; disable it with guidance when inaudible.

Window start/end fields are seconds from capture time zero, default [0, reference duration]. Parse finite nonempty decimal numbers; map each boundary by `Math.round(seconds * 22050)`, require `0 <= startFrame < endFrame <= frameCount`, and display the effective frame-derived bounds. Preserve invalid raw window input. These are transient controls, never saved or history edits. Window/track/document change stops an owning reference comparison audition and invalidates pending rendering; it does not stop unrelated ordinary playback merely because a window field was typed.

Both audition buffers contain exactly `endFrame - startFrame` samples. Reference conversion uses signed PCM/32768 for negatives and /32767 for nonnegatives. If edited notes extend outside the retained duration, show that comparison covers only the chosen reference window; use ordinary Play for the whole arrangement. Notes comparison renders a validated one-track composition at captured tempo with the existing synthesizer, then copies `[startFrame,endFrame)`, padding with zero beyond synthesized length. Rendering the full bounded solo track (at most192.08 seconds/4,235,364 samples) is accepted to preserve exact existing phase, gain limiting and release behavior; crop happens after rendering. Leading silence remains, sustained notes that started before the window retain their phase/envelope, and releases inside the window remain; any release crossing its end is cut. No extra tail or trailing-note extension is appended. This comparison crop is not exported as the ordinary WAV.

Use the existing exclusive playback/source generation and worker termination path. No concurrent reference/notes/ordinary/continuation playback. Late worker replies, AudioContext.resume and old source.onended cannot start/stop a newer audition. Stop cancels both rendering and playback. Reference playback does not commit, autosave, invalidate a continuation or discard drafts. A note correction invalidates a pending comparison by normal document generation. A raw note draft is never played as committed notes; the panel says auditions use applied notes.

## Complete-document history

`ReferenceHistory` owns detached document snapshots and a private immutable asset registry; all getters return detached metadata/bytes. Current + undo + redo share one stored copy per asset ID. Existing engine/arrangement transformations apply to `document.composition`; reference bindings persist for retained tracks, duplicate explicitly copies its source binding, and removed tracks lose bindings. Reject conflicting asset IDs unless every metadata field and PCM byte matches an already registered asset; never silently replace bytes behind an old snapshot.

Keep 50 prior committed edits (51 snapshots including current). Before materializing or validating incoming assets, require a dense array of at most8 distinct assets, all referenced by the candidate. Before a real commit, validate the candidate document/assets and compute reachability **after** redo truncation and normal oldest-state eviction. If unique retained PCM exceeds64 MiB, reject before changing registry, cursor, snapshots or current; never reduce the history depth earlier to fit audio. Metadata is bounded by51 ×1 MiB. A normalized no-op leaves redo and registry unchanged and may not register orphan assets. Garbage-collect only assets unreachable from all remaining snapshots. Failed candidates have no side effects. Undo/Redo needs no async decoding or hashing; it restores exact bytes and metadata along with notes, then queues an ordinary complete save.

Expose **Clear undo history** with explicit confirmation explaining that current notes/reference and saved copy are unchanged, but previous edits/takes cannot be restored. It keeps exactly current state, frees unreachable assets and invalidates staged import intents. It does not autosave, clear drafts/proposals or alter playback. This is the recovery path after the audio-history cap; downloading a complete project first remains available. Reload starts fresh history from the last complete saved project, as before.

## Atomic IndexedDB and recovery

New database `melody-studio.projects`, version1; object stores `projects` and `assets`, out-of-line keys. `projects['current'] = {schemaVersion:1,document}`. `assets[id] = {id,kind,captureTempo,decodedSampleRate,decodedChannels,decodedFrames,analyzedFrames,frameCount,sha256,pcm:Blob}`; `sha256` is lowercase SHA-256 of exact PCM bytes. The stored Blob contains raw PCM bytes, has empty MIME type, and is immutable; admit its `size === frameCount * 2 <= 882000` before calling `arrayBuffer()`. This avoids eagerly copying oversized audio through IDB get; arbitrary malicious same-origin database contents are not a hard process-memory security boundary. Hash is integrity checking, not authentication or proof of capture metadata. Save/backup uses Web Crypto, never a network.

Load the descriptor plus only its bounded distinct referenced asset keys in one readonly transaction; wait for transaction completion, validate metadata/Blob type/size before reading bounded PCM, then validate/hash all data before exposing any project. Present corrupt/unsupported/missing-asset state is an error, never notes-only success or fallback. Do not enumerate arbitrary asset stores or allocate from unchecked metadata. Startup blocks project mutation until the initial read finishes or fails. Read/open timeout is10 seconds; abort transaction/close late DB opens. `versionchange` closes owned connections and reports recovery guidance.

Prepare detached, validated snapshot and hashes before opening the readwrite transaction. In ONE transaction on both stores clear obsolete current assets, put all complete current assets and replace `projects['current']`. Only `transaction.oncomplete` is success; request-success is not. Abort/quota/constraint/open/serialization failures leave the previously committed complete project and assets intact. Do not garbage-collect stored assets in a separate transaction. History-only assets stay in session memory and re-enter storage if Undo restores them.

The UI owns an ordered save pump with at most one active transaction and one newest pending snapshot (coalesce pending edits). Each save captures document generation; stale completion may not mark a newer document saved. A failed save does not roll back the in-memory edit/history; mark **Not saved in this browser**, keep complete download usable and offer **Retry save**. Retry saves the current complete snapshot. Closing/reloading while pending may lose unsaved edits; show Saving until completion and use beforeunload only while saving/unsaved. Cross-tab concurrent edit merging is out of scope; disclose last completed save wins, while every stored state remains complete.

Only a successfully read **absent** IDB current record permits reading existing `melody-studio.project.v1` localStorage. Valid legacy Composition becomes a notes-only wrapper; preserve original localStorage text. Do not automatically write a migration merely on load; the next explicit edit or Retry save transaction establishes the new complete record. A present valid IDB record wins over stale legacy. Failed/unavailable IDB reads are not absence. Corrupt legacy or IDB state/read failure enters protected recovery: offer Retry load and a clearly confirmed **Replace saved copy** of the current complete in-memory project; no ordinary autosave until that confirmation. Never delete damaged stored data merely because validation failed. Retry load cannot replace newer edits without native confirmation and post-confirmation generation/intent checks. Export remains available in recovery. An unavailable database may still fail explicit replacement safely.

## Portable backup and imports

**Save project file** now downloads a complete `.melody.json` even with no reference. It contains current committed document/assets only; no undo history, raw draft, suggestion, window, playback or original encoded uploads. Keep **Open project** accepting old v1 Composition JSON (<=1 MiB) as notes-only. New complete input/output has this exact shape:

```ts
{
  format: 'melody-studio-project', version: 1,
  document: MelodyDocument,
  assets: Array<{
    id: string; kind: ReferenceKind; captureTempo: number;
    decodedSampleRate: number; decodedChannels: number;
    decodedFrames: number; analyzedFrames: number; frameCount: number;
    sha256: string; pcmBase64: string;
  }>;
}
```

UTF-8 compact JSON, no trailing newline; object keys emitted in the shown order, document/Composition keys in declared type order, assets sorted by ID. No compressed payload, data URL, path, external link or MIME field. New file <=12 MiB; exactly referenced <=8 assets and each PCM <=882000 bytes. Before JSON.parse, perform bounded depth<=16 and duplicate-object-key preflight; reject malformed raw UTF-8 and nonfinite JSON numbers. JSON escape sequences representing NUL/lone surrogates in engine strings or matching binding trackIds are valid and must survive exactly; do not blanket-reject parsed string values. New non-engine string fields are admitted by their strict UUID/kind/digest/base64 schemas. Reject unknown keys at every new-format object, noncanonical base64/padding/alphabet, decoded-size mismatch, checksum mismatch, unsupported version, missing/extra asset and conflicting IDs. Pre-admit File.size and base64 encoded length before allocating decoded buffers. SHA and strict validation precede all publication. The legacy parser remains unchanged internally; conversion preserves its accepted string values and yields no references. Strict new-format exact keys do not authorize rejecting or silently altering valid old engine strings.

The native File read/parse/hash is staged, not a project change. Snapshot file epoch, raw editor intent and document generation; input-only changes (including changes back), selection, Undo/Redo, capture, a newer file or Cancel make old results stale. Cancel/error/stale file settlement may not stop current audio, clear a proposal/raw drafts, alter history/autosave or clear a newer file/status. Replacement confirmation states reference/track counts and that Undo restores the prior committed document, not discarded unsent fields. If scratch fields/proposal exist, obtain explicit discard consent; clear them only after a successful single history commit. Recheck all guards after confirmation. ID collision/budget failure preserves the entire old state. MIDI replacement continues using its existing receipt and conditional consent; its new document has no references and Undo restores the old referenced document.

## Exact producer APIs

`reference-project.ts` (sync, runtime validation and detached results):
- `notesOnly(composition: Composition): MelodyDocument`
- `validateDocument(value: unknown): MelodyDocument`
- `validateAsset(value: unknown): ReferenceAsset`
- `validateBundle(value: unknown): ReferenceBundle`
- `withComposition(document: MelodyDocument, composition: Composition): MelodyDocument` retains only bindings to surviving IDs; duplicate is explicitly added by UI before validation.
- `ReferenceHistory(initial: ReferenceBundle)`; getters `current: MelodyDocument`, `canUndo:boolean`, `canRedo:boolean`, `assetBytes:number`; `asset(id:string):ReferenceAsset` detached or throws; `snapshot():ReferenceBundle`; `commit(next:MelodyDocument, incoming:readonly ReferenceAsset[] = []):boolean`; `undo()/redo():MelodyDocument|null`; `clear():void`.

`reference-audio.ts` (native normalization and pure crop helpers):
- `normalizeReference(samples:Float32Array, decodedSampleRate:number, meta:{kind:ReferenceKind;captureTempo:number;decodedChannels:number;decodedFrames:number}, signal:AbortSignal):Promise<ReferenceAsset>`; validate input type, length, metadata and pre-aborted signal before allocation/admission; input samples length must equal analyzedFrames, then copy at entry with no ownership transfer from caller. New UUID assigned only to completed normalized asset. One module-wide native normalizer slot including draining work; concurrent call rejects with retry guidance.
- `referenceWindow(startSeconds:number,endSeconds:number,frameCount:number):ReferenceWindow`
- `referenceSamples(asset:ReferenceAsset,window:ReferenceWindow):Float32Array`
- `comparisonComposition(document:MelodyDocument,trackId:string,asset:ReferenceAsset):Composition` returns selected track at asset.captureTempo, verifies binding, respects mute/volume.
- `cropComparison(samples:Float32Array,window:ReferenceWindow):Float32Array` copies/pads exact window; bounds samples to maximum192.08-second solo render.

`reference-backup.ts`: `encodeProjectBackup(bundle:ReferenceBundle):Promise<Uint8Array>`; `decodeProjectBackup(bytes:Uint8Array):Promise<ReferenceBundle>`; both detach before awaits, strict canonical new format, legacy notes-only decode. They never mutate history/storage or assign fresh IDs.

`reference-storage.ts`: `ReferenceStorage(factory:IDBFactory)`; `load():Promise<ReferenceBundle|null>` (null only proven absence); `save(bundle:ReferenceBundle):Promise<void>`; `close():void`. Operations serialize per instance, reject after close; no localStorage access inside this class. `save` detaches at invocation, resolves only complete. Expose `REFERENCE_DB_NAME` and `REFERENCE_DB_VERSION`. UI handles migration, save coalescing, recovery consent and generation checks; no callback imports/cycle back to main.

## UI contract and accessibility

Keep all existing editor/MIDI/continuation selectors and a single existing role=status. New stable sibling host `#reference-panel`, heading **Reference take**; literal metadata `#reference-summary`, polite `#reference-status` (aria-live, not a second role=status); `#reference-start` **Comparison start (seconds)**, `#reference-end` **Comparison end (seconds)**; `#play-reference` **Play reference**, `#play-reference-notes` **Play edited notes at capture tempo**, `#remove-reference` **Remove reference**; existing Stop/Cancel own playback. `#reference-empty` explains notes-only/no-reference state. Removal confirms, is one history edit and leaves notes untouched. `#clear-history` **Clear undo history**, `#retry-save` **Retry save**, `#retry-load` **Retry load**, `#replace-saved-copy` **Replace saved copy** are visible only when useful (clear history when history nonempty). Existing Save project file/Open project retain accessible names. Project-file transient status can use existing notice without destroying editor DOM.

A stable host prevents reference status/save completion from replacing raw note/title/tempo/track fields. Ordinary editor redraws retain all existing draft maps, exact numeric spelling, focused node/caret when equivalent fields remain, and window input drafts keyed to selected track+asset. Do not auto-round unrelated inputs or discard invalid fields to audition/download. Choosing another track resets its reference window to full duration unless its same asset has a retained transient window; deleted asset/control entries are pruned. Controls and facts wrap at390px; both audition buttons and inputs support keyboard. Reference metadata/table strings use textContent or existing escaped templates. No autoplay on load, import, selection or recovery.

## Acceptance and independent gates

1. Pure fixtures: exact quantization at -1/0/+1/half-LSB, LE bytes, frame counts for44100/48000/22050, arbitrary sample-window boundaries, leading silence, notes sustaining into window, release cut and zero-padded end; a louder note outside the window still influences the existing full-solo global peak limiting. Native resampler gates: equal-rate exact PCM; two-channel opposite-phase cancellation through the actual capture downmix; DC steady interior; impulses finite and correctly timed;440/1000Hz passband sine fixtures at decoded44100/48000 have measured frequency error <=3 Hz and steady-interior RMS error <=2% versus the analytic signal; DC interior error <=3 PCM LSBs, non-edge impulse peak position error <=2 output samples. Use at least1 second of source and exclude512 output samples at each edge for steady-interior metrics. These are required Chromium fixture gates, not an all-audio quality guarantee. No bit-exact cross-engine resampling claim.
2. History: replacement/removal/delete/duplicate/Undo/Redo restores exact asset bytes and bindings; shared IDs counted once;50-step trim; redo-preserving no-op; capacity just below/at/above64MiB with redo reclamation; rejected candidate/collision/missing asset atomic; clear-history explicit and current-preserving. Returned byte mutation never affects registry.
3. Backup: independently construct and decode max8×20s bundle, verify every SHA/frame/PCM value and notes; exact1MiB legacy, including literal legacy-to-complete encode/decode fixtures preserving exact UTF-16 units for NUL/lone-surrogate titles, names and IDs/bindings; oversize/depth/duplicates/base64/nonfinite/invalid-raw-UTF8/unknown/missing/conflicting payloads reject before publication. No prototype mutation, network, or decoder invocation for PCM backup import.
4. Native IndexedDB: genuine transaction abort/quota failure retains previous descriptor+assets; missing/corrupt asset fails closed; delayed ordered saves/retry cannot mark wrong generation saved; old localStorage migration preserves raw bytes and valid IDB takes priority. Close and relaunch a real persistent browser process; exact backed-up reference samples and notes survive without fixture storage injection.
5. Native capture/import/demo, audition and window: actual Worker/WebAudio buffers inspected independently; reference fixed speed after tempo edit; comparison captured BPM and exact crop; WAV/MIDI remain notes-only; delayed decode/normalization/worker/resume/source.onended/Stop/pagehide cannot publish/start stale data. Cancelling/failing replacement preserves proposal, history, reference and invalid raw fields/focus.
6. Native complete-file import/cancel/error/scratch consent/stale input before blur/new file/ID collision; single replacement Undo/Redo; reference delete/duplicate/reopen;390px keyboard/focus. Retain all existing173 unit/35 native browser behavior except documented complete-backup/storage expectation updates owned by root. Run scoped producer tests first, then full lint/typecheck/unit/native gates and independent maximum/process-restart evidence. Synthetic evidence is not microphone/vocal quality validation.
