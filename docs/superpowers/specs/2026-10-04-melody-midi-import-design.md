# Melody Studio: reviewed MIDI phrase import

Tracker: [issue #60](https://github.com/twangyal/projects-monorepo/issues/60). This document freezes the implementation contract after independent and root review; it does not release implementation by itself.

## Outcome and scope

A person can open a bounded MIDI file locally, inspect its channels, choose supported parts and a phrase window, map each part to one of Melody Studio's three instruments, and deliberately replace the composition. The imported notes remain editable, playable and exportable. Replacement is one undoable composition edit. Parsing, reviewing, changing import choices, cancellation and failure do not save, play audio, replace notes, clear redo or discard editor drafts or a continuation proposal.

This is a reviewed phrase importer, not a general MIDI workstation. It does not reproduce sampled General MIDI instruments, percussion, controller expression, changing tempo, device configuration or arbitrary sequencer effects. Unsupported channels and excluded note attacks are visible. Unsupported global events reject the file. No new model, account, service, runtime dependency or project schema is introduced. Original audio transcription and learned continuation accuracy are unchanged.

## Existing contracts

Keep `Composition.version = 1`, the existing localStorage key, JSON backups and history. `validateComposition` remains the authority for a destination composition: 40–240 finite BPM, 1–8 tracks, at most 256 notes per track, integer pitches 36–96, start beats at least zero, duration 0.25–16 beats, note ends at most 128 beats, and velocity/volume in 0–1. Titles and track names are trimmed by the current model and limited to **80 UTF-16 code units**. This importer validates its explicit text choices without silent trimming before calling that model.

The three local instruments remain `sine` / Soft keys, `triangle` / Warm flute and `sawtooth` / Bright synth. Source programs are hints, not sound mappings. Existing MIDI export uses format 1 with 480 ticks per beat and approximate zero-based programs 73/80/81; it rounds note positions to that resolution and merges overlapping same-pitch notes. Import does not promise byte-identical or tick-identical MIDI round trips. Existing WAV export is the actual local synthesized mix.

`main.ts` currently replaces its editor DOM during render. Only note drafts and continuation count are already tracked as raw strings; title, tempo and track fields need narrowly scoped raw draft preservation. MIDI staging must not reuse the audio/JSON replacement handlers, which stop playback and redraw at the start of their asynchronous reads.

## Parser admission and budgets

`src/midi-import.ts` is a bounded, synchronous, browser-compatible byte parser with no DOM, storage, playback or network access. Export:

```ts
export const MIDI_IMPORT_LIMITS = {
  bytes: 1_048_576,
  rawTracks: 32,
  events: 32_768,
  notePairs: 8_192,
  lanes: 16,
  maxTick: 2_147_483_647,
  textBytes: 4_096,
} as const;

export type MidiImportErrorCode =
  | 'invalid-midi' | 'limit' | 'unsupported-midi'
  | 'invalid-selection' | 'stale-review';
export class MidiImportError extends Error {
  readonly code: MidiImportErrorCode;
  constructor(code: MidiImportErrorCode, message: string);
}
```

Admission counts every event, including metadata, ignored events and EOT. The note-pair budget counts **every positive-velocity NoteOn attack**, including unsupported/shared channels; completed pairs cannot exceed that budget. Check lengths, counts and tick sums before growing arrays or decoding text. Each raw track's accumulated integer delta ticks must stay within `maxTick`; no wrap, signed coercion or floating integer overflow is permitted.

Require `MThd` at byte zero with length exactly 6; format 0 with exactly one track, or format 1 with 1–32 tracks. Division is PPQN 1–32767. Reject format 2, SMPTE division, zero division, extended headers, unknown chunks, prefixes and trailing bytes. Exactly the declared consecutive `MTrk` chunks must consume EOF. Every event stays inside its declared track length. Require one EOT (`FF 2F 00`) at that track's exact EOF; missing EOT, nonzero EOT length or bytes after it reject the whole file.

Delta times and metadata/SysEx lengths use terminated VLQs of at most four bytes, value at most `0x0fffffff`; do not require shortest encoding beyond that SMF limit. Running status is local to a raw track and only channel statuses `80..EF` can establish it. Meta and SysEx clear running status. A data byte requires a prior valid running status and every channel data byte must be below 128. Channel statuses have their exact one/two data-byte lengths. Reject bare system-common/realtime/reserved statuses. Structural validation covers **all** tracks and events, including parts the person will not select.

### Global metadata and constant tempo

Reject every SysEx `F0/F7`, MIDI Port `FF21` (including port zero), Channel Prefix `FF20`, SMPTE Offset `FF54`, Sequencer Specific `FF7F` and unknown meta type. These may alter global channel/device interpretation; they cannot be silently treated as harmless text or an independent channel namespace.

The only metadata whitelist is sequence number `00` (length 2); text/copyright/track name/instrument name/lyrics/marker/cue/program name/device name `01..09` (each at most 4096 bytes); EOT `2F` (length 0); tempo `51` (length 3); time signature `58` (length 4); key signature `59` (length 2). Validate fixed lengths. Text other than a usable track name, sequence numbers and time/key signatures are not represented in the composition; review displays their type/count/byte totals. Time/key signatures do not change beat arithmetic or imply bars. Source note-off release velocity is omitted and counted when nonzero.

Tempo defaults to 500,000 microseconds per quarter note / 120 BPM. Gather tempo values and the minimum absolute tempo tick across **all** raw tracks before evaluating constant-tempo admission; physical raw-track parse order is not temporal order. Every supplied tempo must be nonzero and identical to every other supplied tempo. A nondefault minimum tempo tick after zero is a change from the default and rejects the file; an identical default tempo appearing later is harmless. For example raw track 0 has 600000 at tick 10 and raw track 1 has 600000 at tick 0: this is constant globally and accepted. Identical tempo events at zero in multiple tracks are allowed. Compute `tempo = 60_000_000 / tempoMicros` without integer BPM rounding, and require it to be within model 40–240. Any actual tempo change anywhere rejects the file, even outside a chosen phrase. Do not flatten a tempo map.

## Channel semantics and note pairing

One lane represents one **global MIDI channel**, with ID `channel-0` through `channel-15`. UI displays channels 1–16. Record all raw tracks containing any channel-voice event for that channel, not only note events. If more than one raw track owns the channel, mark the entire lane unsupported: this conservative implementation does not merge independent track order into global state. It neither creates per-track copies of a shared channel nor invents same-tick ordering. Other supported channels can still be deliberately selected; the excluded shared-channel attack count is disclosed.

For a uniquely owned channel, pair notes in that track's event order. NoteOn with velocity zero is NoteOff. Positive attacks carry their own onset velocity. A NoteOff without an active note, a second attack of an already active channel/pitch, zero-duration pair or a note still active at EOT makes the lane unsupported. Different-pitch polyphony is supported. Do not repair, drop, arbitrarily pair, shorten or extend ambiguous notes. Unsupported lanes expose no fabricated paired-note list (`notes = []`) but retain their raw attack count and bounded reasons.

Channel index 9 (display channel 10) is percussion and unsupported. Pitch bend, polyphonic/channel pressure and every controller other than CC7 make that lane unsupported. This includes bank selection, sustain, modulation, pan, expression and reset/all-notes controls. Unknown/unsupported channel events remain structurally parsed and budgeted; they never become invented static note properties.

Initial state convention is GM program 0 and CC7 100 when absent, visibly labeled as defaults rather than a claim about an external receiver. Before the first positive attack, program and CC7 may be set repeatedly; the last event before that attack supplies static state. After the first attack, only repeats of the identical value are permitted. Any later changed program/CC7 makes the lane unsupported, including outside the selected window. At the first attack's tick, physical event order determines whether a state event is initial or later. Store CC7/127 as **track volume** and onset velocity/127 separately; never multiply volume into velocity. CC7 zero remains zero and is explicitly shown as silent. Every included lane requires a user-selected local instrument; none is silently chosen from GM program numbers.

## Exact parser types

These types and `parseMidi` are exported from `midi-import.ts`; consumers import them rather than duplicate shapes. Arrays are detached results; no source byte buffer is retained or mutated.

```ts
export type MidiNameReason =
  | 'invalid-utf8' | 'control' | 'too-long'
  | 'edge-whitespace' | 'multiple-names';
export interface MidiName {
  value: string | null;
  status: 'missing' | 'usable' | 'needs-choice';
  reason: MidiNameReason | null;
}
export type MidiLaneIssueCode =
  | 'shared-channel' | 'percussion' | 'controller'
  | 'expression' | 'changing-state' | 'ambiguous-notes' | 'empty-lane';
export interface MidiLaneIssue {
  code: MidiLaneIssueCode;
  message: string;
}
export interface MidiSourceNote {
  onTick: number;
  offTick: number;
  pitch: number;
  velocity: number; // exact positive integer 1..127
}
export interface MidiLane {
  id: string; // exactly channel-N matching channel
  channel: number; // integer 0..15
  sourceTracks: number[]; // zero-based sorted unique raw-track indices
  name: MidiName;
  noteOnCount: number;
  notes: MidiSourceNote[];
  program: number; // initial/effective integer 0..127
  programExplicit: boolean;
  volume: number; // initial/effective integer CC7 0..127, not normalized
  volumeExplicit: boolean;
  issues: MidiLaneIssue[];
}
export interface MidiMetaSummary {
  type: number;
  count: number;
  bytes: number;
}
export interface MidiPreview {
  format: 0 | 1;
  ppqn: number;
  rawTrackCount: number;
  eventCount: number;
  noteOnCount: number;
  lastTick: number; // max EOT tick, including trailing rests
  tempoMicros: number;
  tempo: number;
  tempoExplicit: boolean;
  title: MidiName; // raw track 0 name, not an authenticated song title
  lanes: MidiLane[]; // ascending channel order; at most 16
  ignoredMeta: MidiMetaSummary[]; // ascending type, includes omitted names/text
  ignoredReleaseVelocityCount: number;
}
export function parseMidi(bytes: Uint8Array): MidiPreview;
```

Issues contain at most one bounded message per code per lane; do not repeat messages per event. Supported note arrays sort by onset tick, then pitch, then offset tick, then original attack order for ties. Every lane with no positive attacks/pairs is unselectable with `empty-lane`. Unsupported state fields are diagnostic only, never imported. For a shared channel, use default program/volume with explicit flags false; do not assert a merged effective state. `ignoredMeta` counts all whitelisted non-tempo/non-EOT metadata, including names; the review explains which usable names were explicitly mapped and that all other metadata is omitted.

### Text handling without silent truncation

SMF names are arbitrary byte strings. Decode each bounded track-name payload with fatal UTF-8 and preserve any BOM as data (`ignoreBOM: true`); never replace malformed bytes with replacement characters. Other omitted text payloads need not be decoded: their visible type/count/byte summaries disclose omission. A missing name has `value=null,status=missing,reason=null`. A unique usable track name is exact nonblank text, no leading/trailing whitespace, at most 80 UTF-16 units and no C0/C1 controls, BOM, lone surrogate or NUL. Repeated identical names are okay. Differing repeated names produce `needs-choice,multiple-names,value=null`; UI explains that it cannot select one silently. Invalid UTF-8 produces `needs-choice,invalid-utf8,value=null`; otherwise preserve the full decoded bounded value when it needs a text choice. Reason precedence is invalid UTF-8, multiple names, control, too-long, edge-whitespace; whitespace-only names need `edge-whitespace`.

UI offers the usable exact name or visibly disclosed safe fallback `Imported MIDI` / `Channel N`. It shows the bounded original decoded value literally when available, or the explicit decoding/multiple-name reason. Nothing is silently shortened, trimmed, decoded as Latin-1 or converted into HTML or an ID. Title and every included part name are editable explicit choices; the review acknowledgement covers fallback/omitted source text. Names are validated without trimming or truncation against the model's 80 UTF-16 bound and the safe Unicode/control rules. UTF-8 supplementary characters therefore consume two of the 80 units. Do not use `maxlength` on source-derived text to conceal a truncated choice.

## Phrase selection and exact proposal API

`src/midi-review.ts` owns destination selection, limits, detached candidate construction and stale-base validation. It imports parser types and current model/types. No storage, DOM or audio access.

```ts
import type { Composition, Instrument } from './types.ts';
import type { MidiPreview } from './midi-import.ts';

export interface MidiLaneChoice {
  laneId: string;
  name: string;
  instrument: Instrument;
}
export interface MidiImportChoices {
  title: string;
  startBeat: number; // zero-based whole beat, inclusive
  endBeat: number; // zero-based whole beat, exclusive
  lanes: MidiLaneChoice[];
}
export interface MidiReviewedLane {
  laneId: string;
  sourceTracks: number[];
  channel: number;
  sourceName: string | null;
  name: string;
  instrument: Instrument;
  sourceProgram: number;
  sourceVolume: number;
  includedNotes: number;
  outsideNotes: number;
}
export interface MidiImportReview {
  base: Composition;
  candidate: Composition;
  choices: MidiImportChoices;
  lanes: MidiReviewedLane[];
  sourceNoteOnCount: number;
  includedNotes: number;
  excludedNoteOnCount: number;
  warnings: string[];
}
export function buildMidiReview(
  base: Composition, source: MidiPreview, choices: MidiImportChoices,
): MidiImportReview;
export function applyMidiImport(
  current: Composition, review: MidiImportReview,
): Composition;
```

Validate all arguments and bounds defensively, including mutated public preview/choices: finite integer ticks, valid channels/IDs/order, note arrays/counts, exactly paired supported-lane attacks, source ticks within lastTick, selected unique existing supported lanes, canonical text and existing instrument enum. No unchecked type assertion may bypass destination validation. Both functions detach their returned records/arrays and leave inputs untouched. Fresh track/note IDs use `crypto.randomUUID`, collision-check against the entire base and candidate ID set, with at most 32 attempts per ID before an actionable failure; source names are never IDs. IDs are generated when building a review, not when parsing. Applying returns the validated detached reviewed candidate; it does not allocate another different candidate or commit itself.

Specifically require `source.noteOnCount === sum(lane.noteOnCount)`, `notes.length === noteOnCount` for every supported lane, `notes=[]` for unsupported lanes, and `source.tempo === 60_000_000 / source.tempoMicros`. Require sorted unique lane/source-track IDs, known bounded issues, and no overlapping same-pitch intervals in a claimed supported lane. These are validation of a preview's declared guarantees, not a second MIDI parser or recovery of ambiguous notes. Review warnings are at most 64 strings of at most 512 UTF-16 units; lane/source details remain structured rather than copied into enormous warnings.

Choices contain 1–8 unique supported lanes, each with an explicit instrument and name; output tracks are ascending channel order regardless of checkbox click order. Choose whole-beat boundaries `0 <= startBeat < endBeat`, span at most 128 and `endBeat <= max(1, ceil(lastTick / ppqn))`. UI labels source start/end as 1-based beat positions; end is exclusive. For example source displayed beats 9 to 17 means API `[8,16)` and destination beat 1 corresponds to source beat 9. Avoid bars/time-signature assumptions.

Compute window ticks by exact integer beat × PPQN. End may round up to the next whole beat past a fractional final tick, still within safe integer arithmetic; parser `maxTick` remains the source event bound. A selected supported note is included only if `onTick >= startTick && offTick <= endTick`. It is outside only when `offTick <= startTick || onTick >= endTick`. Any other selected note crosses the boundary and rejects the review with its channel/ticks and a request to adjust the window/deselect that part. Never silently clip, shorten or omit a crossing note.

For included notes compute `start = (onTick - startTick) / ppqn`, `duration = (offTick - onTick) / ppqn`, and `velocity = velocityByte / 127`. Do not subtract separately rounded floating beat endpoints or quantize to quarter beats/480 ticks. Each selected part must contain 1–256 included notes; included pitch/duration/end must satisfy the existing destination model. Out-of-range selected notes reject the whole candidate rather than disappear. The represented JavaScript values must pass the existing model without epsilon widening, clamping or arbitrary precision rounding. Preserve off-grid values in JSON; MIDI re-export's 480-tick rounding is a disclosed separate limitation.

Review shows source PPQN/format/raw tracks/tempo, window, selected per-lane counts, every excluded unsupported/unselected lane and selected-window outside counts. `excludedNoteOnCount = sourceNoteOnCount - includedNotes`; label it **excluded source note attacks**, because unsupported pairing is not a reliable completed-note count. Warn about ignored metadata/release velocity, default initial state, silent CC7 zero, chosen names/fallbacks, local instrument approximation, source-to-destination beat shift and re-export rounding. Warnings are bounded category summaries, not one string per event; use lane details/counts for larger inputs. Selection of an otherwise valid subset does not hide structural/global failures elsewhere in the file.

The window selects notes, not a persisted phrase length. Composition v1 has no explicit end/loop duration: leading and internal rests are retained through note positions, but **trailing silence and source EOT padding are not retained**. For example `[8,16)` whose latest selected note ends at source beat 10 imports a composition ending at destination beat 2, not 8. Review visibly explains this even if the source window/EOT is longer; README repeats it. MIDI ends at exported note end and WAV follows the existing note-end plus synth release behavior (currently 80 ms), not the chosen window end. Do not invent silent notes, stretch notes or alter the schema to preserve padding.

`buildMidiReview` records a private receipt in a module-local `WeakMap` keyed by the exact returned review object. The receipt holds the immutable full canonical review JSON, canonical base JSON and a detached validated candidate snapshot. It is not an exported field, persisted token or authentication mechanism. `applyMidiImport` first requires that exact produced object identity and an unchanged full canonical review; reject clones, forgeries, added properties and any mutation, including jointly changed candidate/choices. Apply bounded shape/count admission before serializing a mutated object. It then compares `JSON.stringify(validateComposition(current))` with the receipt's canonical base; any mismatch throws `stale-review`. Return a detached validated copy of the private candidate snapshot, not a mutable public candidate. There is no serialization/import of review objects or public source reparse. UI epoch and input-intent checks remain necessary: equal committed models do not prove equal unsent editor state. UI permits application only once and invalidates the review after application or any invalidating intent; it is not an append/merge operation.

## UI, draft and lifecycle contract

Own MIDI state separately from the existing audio/recording/render `operation`. Mount a stable MIDI review host as a sibling of the replaceable composition editor subtree inside `#app`; route existing editor rendering/listeners to that editor subtree while keeping existing selector IDs/labels. MIDI file/progress/error/choice/review/cancel updates touch only the review host. Never re-render the composition editor to announce MIDI staging status.

Preserve raw title/tempo and per-track name/instrument/volume/muted drafts through ordinary editor re-renders, including late playback completion, alongside all existing `noteDrafts` and continuation count. Capture raw strings/checked values on input before change handlers, keyed by field and track identity; successful field commits clear only that field's matching raw draft, failed commits retain it. Keep valid raw spellings such as `108.000` until their own deliberate commit; do not mark every field dirty merely because a new render changes formatting. Other editor actions continue their established behavior, but MIDI itself cannot erase drafts or produce a hidden change event/commit.

Add an editor input-intent counter covering project/track/note controls and continuation source/length, plus explicit track/note selection, changed commit/history restore and other replacement/capture starts. At native file selection capture the dedicated file epoch, editor intent and composition generation. Check all three before parsing and after parsing/publication; stale success/error/finally may not replace/clear a newer picker/status. New MIDI selection, Cancel and pagehide invalidate its epoch. Clearing a file input after selection permits selecting the same file again. File size is preflighted before `File.arrayBuffer`; no extension/MIME trust. A file read cannot be canceled physically, but stale completion is ignored and the editor remains usable. Starting MIDI selection/review while an unrelated capture/render operation is busy is disabled without canceling that operation.

Any new editor intent invalidates a completed review irreversibly, including input changed back to its previous value; preserve parsed source and visible choices, show “The editor changed. Review this phrase again.” Choices/window edits invalidate only the completed candidate and acknowledgements. A fresh Review captures the latest committed base and current editor intent. Track/selection changes, continuation changes and raw edits cannot revive an old captured base. MIDI parse/review never clears, auditions or applies a continuation proposal.

Explicit Review and the final Replace confirmation supply review consent; do not add a generic limitations acknowledgement checkbox. When **any** unsent global/track/note draft exists (check the entire draft map, not only selected note), or any unapplied continuation proposal exists, an additional explicit checkbox acknowledges **Discard unapplied editor edits and suggestion on replacement**. Checking it does not discard anything yet. Every new editor or import-choice intent clears that acknowledgement. The final native Replace confirmation states included notes and excluded source note attacks, the selected window/parts and that Undo restores the previous **committed composition**, not discarded raw drafts or an unsaved suggestion. Cancellation leaves all drafts/proposal/history/storage untouched.

Immediately before and after confirmation, recheck epoch/intent/generation, current candidate, any applicable scratch acknowledgement and exact base. Validate through `applyMidiImport` before any destructive action. Commit once with the existing history/save flow. Only on successful commit clear unsent draft maps/proposal, choose the imported first track, clear selected note, reset source-count defaults and close the review. Stop old playback as part of that committed replacement, not during parsing. A storage failure follows the existing honest in-memory save-error behavior; do not falsely promise persistence or perform a second history commit. Failure before commit preserves old selection/audio/history/redo and editor DOM. Numeric draft parsing must reject blank/nonfinite values rather than `Number('')` becoming zero; fractional source tempo must remain accepted without HTML integer step validation.

### Stable accessible DOM contract

Keep all existing Melody labels and browser selectors. Use these new controls:

| Label / element | Stable selector and behavior |
| --- | --- |
| Import MIDI file | `#midi-file`, native file input accepting `.mid,.midi,audio/midi` as a picker hint |
| MIDI import | `#midi-import`, stable review host / labeled section |
| MIDI status | `#midi-status`, polite status; bounded parse/stale/error messages |
| Source start beat / Source end beat (exclusive) | `#midi-start`, `#midi-end`, raw text numeric inputs; whole-number validation |
| Imported project title | `#midi-title`, editable explicit destination text |
| Part row | `[data-midi-lane="channel-N"]`, literal source/name/state/issues/counts; at most 16 |
| Include channel N | Row `input[name="included"]`; unsupported lanes disabled with visible reasons |
| Imported part name / Local instrument | Row `[name="name"]`, `select[name="instrument"]`; instrument starts with empty “Choose an instrument” |
| Review MIDI phrase | `#midi-review`, builds candidate without committing |
| Reviewed phrase | `#midi-summary`, candidate counts/window/shift and bounded warnings, plus excluded lane details |
| Discard unapplied editor edits and suggestion on replacement | `#midi-discard-ack`, conditionally visible required acknowledgement; no early clearing |
| Replace composition | `#midi-apply`, current reviewed candidate plus conditional scratch acknowledgement, followed by native count/window/Undo confirmation |
| Cancel MIDI import | `#midi-cancel`, clears only import state |

Use keyboard-accessible native controls, literal text/escaped HTML and readable mobile rows with labels. Names/metadata/filenames are never HTML, selectors, script, URLs or IDs. Imported title fallback comes from the spec, not unsanitized filename. Do not auto-select all channels, infer instruments, preview audio or unexpectedly move editor focus when an asynchronous read finishes. Focus/caret of existing raw inputs survives stage/review/cancel updates; deliberate Apply can focus the imported editor.

## Validation and release evidence

No model downloads or backend are needed. Parser and builder use meaningful RED → GREEN tests before implementation. Keep independent fixtures/oracles separate from producer code; neither calls the parser to generate its expected interpretation.

1. Byte fixtures cover both formats, every budget boundary, PPQN/SMPTE, tick accumulation, overlong/truncated VLQ, running status per-track and clearing, high-bit data, chunk/EOT/exact EOF, unknown metadata/port/SysEx, default/exact fractional tempo and actual tempo changes. Validate malformed/unselected tracks too. Include a format-1 shared channel containing state on one track and notes on another, not only obvious duplicated notes.
2. Independent event expectations cover zero-velocity off, release velocity, polyphony, overlapping same pitch/orphan/hanging notes, channel 9, expressions/controllers, static program/CC7 before/after first attack, identical repeats, CC7 zero and separate volume/velocity. Verify unsupported lanes remain visible and cannot be selected.
3. Builder tests cover 1/8 selected parts, 256/257 notes, all pitch/duration/end boundaries, whole-beat source shift, off-grid PPQN values, boundary-crossing rejection, outside/unselected counts, text UTF-8/control/80-UTF16 limits and explicit fallback/mapping. Detached inputs/results, fresh unique IDs with bounded collision failure, stale committed base, forged/cloned/mutated review and malformed preview reject atomically.
4. Production Chromium uses actual native File uploads of independently authored MIDI bytes. Open → review → choose phrase/parts/instruments → explicit replace → edit/play → Undo/Redo → actual localStorage reload → JSON/MIDI/WAV downloads. Decode the actual MIDI event ticks/program/CC7/velocity and actual WAV header/samples independently; use a distinguishable selected phrase, unselected parts, outside-window notes and trailing source rest. Assert exported note-end duration plus WAV release and the exported 480-tick rounding rather than expecting the source window/EOT length or source tick identity; listen/test nonzero audio and bounded timing without claiming GM timbre fidelity.
5. Native lifecycle acceptance preserves raw blank/invalid note timing, global title/tempo/track drafts, proposal and undo/redo through failed/unsupported/canceled reads and review updates. Hold real File.arrayBuffer completion, then type without blur, commit/Undo/select tracks, choose another file or cancel; no stale publication/finally or candidate may erase edits. Preserve drafts when Replace consent is declined, check all unselected-note drafts, and require fresh Review after intent even when the text is changed back. A successful replacement yields exactly one history edit and canonical persistence; failed localStorage saves remain visibly unsaved with a usable JSON backup.

Root runs existing unit/lint/type/build and all production browser gates after coordinated shared-build ownership. Record actual observed test/artifact results in README/evidence, not projected counts. Original authored/synthetic musical fixtures prove import/timing/export behavior, not broad third-party DAW compatibility or real-vocal accuracy. Metadata, sound mappings and source precision limitations remain explicit after completion.

## Ownership and integration order

Root assigns implementers after review; ownership boundaries are fixed:

- Parser owner: `src/midi-import.ts`, `tests/midi-import.test.ts`; publish exact exported constants/types/signatures first, then byte parser.
- Review owner: `src/midi-review.ts`, `tests/midi-review.test.ts`; use the parser contract and existing model without changing either owner's files.
- UI owner: `src/main.ts`, `src/style.css`; stable host, raw drafts/intent, controls and one-commit application; no parser duplication.
- Independent semantic owner: `tests/midi-import-oracle.test.ts`; derive expected events/state/timing directly from authored fixture bytes and documented MIDI rules, not producer implementation.
- Browser owner: `tests/browser/midi-import.spec.ts`, `tests/browser/midi-import-fixtures.ts`; actual production/native File/history/storage/artifact/lifecycle checks, existing selectors retained.
- Root: configuration/README/evidence/CI integration, coordinated production builds/ports, Git and issue closure. Existing port 4174 belongs to the coordinated Playwright webServer; any manual preview uses an agreed different port/output.

Publish parser types first so builder/UI/oracle/browser can proceed independently. No owner edits project schema, ordinary MIDI/WAV exporter or learned model to make import tests pass. A genuine incompatible constraint goes back to root with a concrete fixture before changing the frozen contract.
