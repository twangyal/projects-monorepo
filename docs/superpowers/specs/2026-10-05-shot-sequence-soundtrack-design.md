# Shot Studio sequence soundtrack (#124)

Root-approved implementation contract, 2026-10-05. This is the next usable product
milestone after Git History #123. No Gaze Nav, catalog #8, frozen stock experiment,
blocked handwriting weights, production deployment, or physical headset claims.

## Product behavior

Add one local soundtrack to an editable scene sequence. Users import a bounded
PCM16 WAV, choose source In/Out, sequence start time and gain, rehearse deliberately,
and export a WebM containing its audio. Keep exact original WAV bytes in complete
portable backups and protected atomic browser saves. Existing ordinary scene
schema3, sequence schema3 geometry and silent retained takes stay compatible.

Source In/Out are integer sample frames with an exclusive Out. The UI accepts
finite decimal seconds, rounds once with Math.round(seconds * sampleRate), and
shows effective frame/time bounds. The represented frame span must be at least
ceil(0.1 * sampleRate). startTime is finite 0..60 inclusive; gain is finite 0..1.
An empty or shorter sequence may retain audio outside its audible interval: show
the crop/inaudible state, never extend the film, loop, stretch, normalize, or change
the descriptor when clips move. Audio uses sequence time across cuts, while every
copied film's camera/performer evaluation keeps its original source time.

Scrubbing and explicit endpoint preview are silent. Deliberate rehearsal starts
from its current sequence position; Stop, seek, raw input, edit, selection/import,
Undo/Redo, export, hidden/page departure and graphics loss retire owned playback.
No automatic playback on import, load, reload or asset admission. A soundtrack
export must refuse unsupported audiovisual encoders rather than discard audio.

## Audio admission and immutable asset

`src/sequence-audio.js` exports:

- `parsePcm16Wav(bytes)` -> `{sampleRate,channels,frameCount,dataOffset,dataBytes}`.
- `admitSequenceAudio(blob,{signal}={})` -> branded frozen asset
  `{sha256,bytes,sampleRate,channels,frameCount,blob}`.
- `assertAdmittedWavAsset(asset)` -> the same privately admitted asset.
- `sequenceAudioDescriptor(asset)` -> exact frozen metadata without Blob.
- `planSoundtrack(soundtrack,asset,sequenceDuration)` -> immutable timing plan;
  exact additional plan fields are frozen by the owner before dependent tests.

Bound total WAV bytes at 12 MiB before reads/copies; validate RIFF/WAVE little-endian
PCM format1, mono/stereo, 44100 or 48000 Hz, 16-bit, exact byteRate/blockAlign and
complete frame divisibility. Require 1..60 seconds by integer frame count/rate.
RIFF declared EOF equals actual bytes. At most64 chunks, exactly one fmt and data;
fmt is16 bytes or18 with cbSize0. Unknown ancillary chunks are retained within the
whole byte cap; verify each header, size and required pad byte exists. Refuse
RIFX/RF64, compressed/extensible formats, duplicate/truncated chunks and trailing
unframed bytes. Do not use browser decoding to decide admission. Hash original
bytes with SHA256; never resample/reencode the retained Blob. Assets are branded
and immutable, so synchronous history cannot trust a caller-declared hash.

## Complete document, history and portable format

Keep `sequence.js` canonical schema3 unchanged. New `sequence-document.js` uses:

```
document = {schemaVersion:1, kind:'shot-studio-sequence-document',
  sequence:<canonical sequence3>, soundtrack:null|{
    label, asset:{sha256,bytes,sampleRate,channels,frameCount},
    inFrame,outFrame,startTime,gain}}
bundle = {document, asset:<admitted asset>|null}
```

The soundtrack label is bounded well-formed nonblank Unicode, at most80 UTF16
units without controls. Wrapper validation preserves all valid existing source
films, including legacy accepted escaped UTF16 values within those films. Exact
fields, finite numeric types and matching asset descriptors are mandatory.
Inner sequence remains <=320 KiB; complete canonical metadata <=324 KiB.

Public domain exports: `createSequenceDocument(sequence=createSequence())`,
`validateSequenceDocument(value)`, `validateSequenceBundle(bundle)`,
`replaceSequence(bundle,sequence)`, `attachSequenceSoundtrack(bundle,asset,label)`,
`setSequenceSoundtrack(bundle,{inFrame,outFrame,startTime,gain,label})`,
`removeSequenceSoundtrack(bundle)`, and `SequenceDocumentHistory` with
current/canUndo/canRedo, commit, undo, redo and clear. Validation detaches metadata
but shares the same immutable asset. Import defaults to full source range,
start0/gain1. Each accepted import/adjust/remove is one history edit; no-op and
failed edits retain Redo. History retains30 prior states and at most64 MiB of
unique WAV assets after ordinary redo truncation and30-state oldest eviction.
If a new state still exceeds the audio budget, refuse atomically with guidance to
download a complete backup or explicitly clear Undo history. Provide a confirmed
Clear sequence Undo action; never silently drop extra states for audio capacity.

`sequence-archive.js` exports async `encodeSequenceArchive(bundle,{signal})` and
`decodeSequenceArchive(file,{signal})`, and `importLegacySequence(text)` using the
unchanged sequence importer and no audio. New complete binary `.shot-sequence`
framing:16-byte header, ASCII `SHOTSEQ1` (8 bytes), u32LE metadata length, u32LE WAV
length, exact UTF8 document JSON, then exact original WAV. Cap16 MiB overall,
324 KiB metadata and12 MiB WAV; exact EOF, no trailing data. Zero WAV iff null
soundtrack. Decode/hash/asset admission completes before publication. Accept old
`.shot-sequence.json` inputs without rewriting their saved bytes during load.
For compatibility Save sequence without audio may still download its complete
inner schema3 JSON; with audio it must download the complete binary archive.
No descriptor-only download may masquerade as complete recovery.

## Atomic protected browser storage

New `sequence-document-store.js` replaces sequence UI persistence; existing
`SequenceDraftStore` can remain solely for legacy/helper compatibility. Own one
IndexedDB database `shot-studio-sequence-documents`, version1, store `state`, key
`sequence`. One exact row is `{schemaVersion:1,revision,archive:ArrayBuffer,
legacyRaw:string|null}`. Complete archive bytes and metadata are one transaction.
Never put audio into localStorage or create a non-atomic audio sidecar.

API: `SequenceDocumentStore(factory=()=>indexedDB,getLegacyStorage=()=>localStorage)`;
`load({signal})->{bundle,receipt,legacyChanged}`; `acceptLoad(receipt)`;
`save(bundle,{signal})`; `reviewReplacement({signal})->{summary,receipt}`;
`replaceSaved(bundle,receipt,{signal})`; `recoveryArchive()` and
`recoveryLegacyJson()` only for known bounded retained data; `protect()`;
`close()->Promise<void>`. Owner exposes clear read-only protected/recovery status
for UI. Receipts are private, one-owner, bounded and invalidated on supersession.

Use getKey/get to distinguish absent from present undefined. Only proven IDB
absence permits reading legacy localStorage `shot-studio-sequence-v1`. Corrupt or
failed IDB reads never fall back or authorize a write. Startup reads do not write,
delete or migrate old bytes. Accept load only after complete bundle/history/render
preparation succeeds and current UI lifetime still owns it. A valid new IDB record
with changed legacy baseline may restore its complete bundle in memory while
keeping autosave protected; do not adopt the foreign legacy draft.

Admission/hash work occurs outside the transaction. Retain a detached exact old
archive/row receipt. Inside a single RW callback, compare complete bounded old row
metadata AND every archive byte before any put; revision-only CAS is insufficient.
Resolve saved status and advance authority only after native transaction complete.
Serialize writes/coalesce latest complete UI state; a late earlier save cannot
mark newer state saved, replace raw fields, or resurrect stale startup data.

Read legacy bytes immediately before and within save admission/transaction and
observe storage events. Preserve old localStorage bytes forever unless a future
separate explicit user operation says otherwise. A reviewed replacement stores
the newly observed legacy baseline in the IDB row without altering legacy bytes.
There is no atomic transaction across localStorage and IDB: disclose that limit,
and protect after post-complete legacy changes without falsely claiming rollback.
Failed reads and unsupported/oversized unrepresentable raw shapes stay protected;
do not invent absence or permit blind destructive reset. Bounded recoverable
archive bytes and legacy raw JSON remain available separately from current backup.

Logical cancellation/10s timeout must retire publication promptly while holding
the native operation slot through actual terminal completion/abort. Unknown
commit outcome revokes old authority and requires fresh review. Keep ordinary
scene and take panels usable during sequence startup or protected storage.

## Native audio session and encoder

`sequence-audio-session.js` exports
`prepareSequenceAudioSession(asset,plan,{signal})` -> owned session with
captureStream, start(position,{capture}), time(), stop(), close(). Owner freezes
exact details before UI integration. Each session has a fresh AudioContext,
bounded decoded PCM buffers and one source schedule. Preview routes only speakers;
capture routes only its MediaStream destination, avoiding doubled playback.
One absolute audio-frame origin drives both source scheduling and rendered elapsed
time. Sources stop at planned cutoff; source ended does not end the film. Context
resume/state failure never silently falls back to unrelated video/performance time.
Check lifetime after async resume and before source start. Stop/disconnect/close
owned sources/nodes/streams and await native drain before replacement ownership.

Add optional `audioSession` to `exportFilm` without changing its silent call path.
For audio require supported `video/webm;codecs=vp9,opus` or vp8,opus, combine owned
canvas and destination tracks, start recorder and bind audio origin in the same
synchronous turn, draw from session.time(), retain existing manual frame capture
cadence and shared32 MiB encoder chunk bound. Stop audio exactly at soundtrack
cutoff; final video cadence may add disclosed silent tail. Preserve existing
duration+10s watchdog; setup timeout10s. Every error/cancel/constructor/start path
cleans graph and tracks. Encoding is real time with tab visibility requirements.
No sample-exact mux timing claim: freeze <=100ms A/V alignment gate measured from
one shared container origin, no independently fitted offsets.

## UI and ownership

Root owns README/catalog/package/config, broad checks, Git/GitHub, and all live
service/browser/install/maximum gates. Agents do not start services or broad suites.

- git_reader: document/archive/history modules, focused unit tests, receipt.
- git_runner: document store module, focused storage tests, receipt.
- audio_engine: audio admission/planning/session and additive export integration,
  focused audio/encoder tests, receipt. Coordinate exact interfaces first.
- recorder: sequence-ui.js, sequence panel HTML/CSS, optional focused UI helpers,
  helper tests and receipt. Preserve native input identities and raw ownership.
- git_history_review: independent literal unit and browser oracles/fixtures,
  original expectations frozen before new producer reads; receipt.
- next_project_assessment: independent maximum/decoded A/V verification runner,
  original fixtures and scoped static checks only; root executes live phases.

Selectors: `sequence-audio-file`, `sequence-audio-import`, `sequence-audio-label`,
`sequence-audio-in`, `sequence-audio-out`, `sequence-audio-start`,
`sequence-audio-gain`, `sequence-audio-apply`, `sequence-audio-remove`,
`sequence-audio-summary`, `sequence-clear-history`. Existing sequence controls
remain stable. Audio fields apply together explicitly. Native input intent retires
pending import/playback before blur; validation failure preserves exact raw text,
focus/caret, accepted bundle/history and complete saved bytes. Existing confirmation
and lifetime guards apply to replacements. Downloads/exports capture complete
committed bundles; no unsent field or late async read may silently substitute.

## Verification

Preserve actual first failing outcomes and fix their real cause; no invented RED,
producer-derived oracle, widened product limit, timing fudge or blanket retry.
Pure tests cover RIFF framing/bytes/rates/channels/frame limits, exact descriptor
and history admission, archive hashes/boundaries, migration and CAS/native drain.
Independent original PCM fixtures use known tones, channel separation and silence;
timing arithmetic derives from literal frames, not the new planner.

Native cases exercise complete import/trim/offset/gain/rehearsal/backup/Undo/Redo,
full browser restart, stored conflict/recovery, old draft migration, literal raw
late read ownership, cancellation, narrow keyboard layout and unavailable encoder.
Decode actual exported WebM with ffprobe/ffmpeg: exactly one VP8/VP9 video and one
Opus stream,960x540, monotonic PTS, original actor/camera oracle, expected pitch
within2Hz, stable plateau RMS within5%, silent regions <=1e-3 RMS outside fixed
codec-transition guards, markers within100ms on one shared timeline. Preserve
ordinary silent film/take checks. Test44.1k resampling and48k inputs.

Maximum: original60s/20clip/4source sequence with real60s stereo48k PCM (11,520,044B
canonical WAV); exact12MiB WAV with legal ancillary padding as separate container
boundary; exact metadata cap/+1 and complete archive refusal. Perform full actual
60s A/V export, independently decode PCM and video landmarks, complete archive
byte identity/restart and retained other-scene/take identity. Distinguish maximum
sample payload from legal padding and do not claim every limit simultaneously.

Root publishes meaningful completed progress, watches first push/PR CI, records
actual evidence, and closes #124 only on complete acceptance. Physical #21 stays
separate. No infrastructure or paid-service work is included.
