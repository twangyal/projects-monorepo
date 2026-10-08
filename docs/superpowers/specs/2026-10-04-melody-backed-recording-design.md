# Melody Studio: record a part with backing

Issue: #113. The root-reviewed architecture is approved for implementation. Root coordinates the written implementation plan and exclusive ownership.

## Intended outcome and scope

A user with an existing composition selects the track they want to replace, chooses **Record with backing**, hears a four-beat count-in and the other committed tracks, and records a new monophonic part starting at composition beat zero. A successful take replaces only that track's notes and normalized microphone reference as one existing Undo edit. Cancel, invalid audio, stale ownership and failed history admission preserve the previous complete project.

The ordinary **Record melody**, audio import, demo, note editing, continuation, complete backup and MIDI/WAV flows remain available with their current behavior. Composition v1, reference document/asset schemas and portable formats are unchanged. This milestone provides browser audio-graph alignment, not measured physical input/output latency, acoustic isolation, improved vocal recognition, general overdubbing, arbitrary punch-in or a multitrack audio recorder.

## Existing integration and chosen approach

Current `recorder.ts` uses MediaRecorder, then `main.ts` decodes the container and passes mono samples through `normalizeReference` and the existing transcription worker. Native recorder/container startup is not a reliable beat-zero clock. Ordinary playback already uses a reusable AudioContext and a rendered mono BufferSource. Reference normalization/history/storage already admit bounded original-speed PCM, one atomic complete change and saved-copy conflict protection.

Use a separate AudioWorklet microphone recorder attached to that same playback AudioContext. Schedule count-in and backing sources against absolute integer context frames; retain microphone input only in the agreed frame interval. This avoids estimating offsets from Date.now, performance.now, permission completion, MediaRecorder events or message-delivery times. Alternatives are retaining a MediaRecorder container and guessing its alignment, or implementing an independent synthesizer inside the worklet; both introduce avoidable timing or synthesis divergence.

Use the existing renderer and oscillator algorithms. The backing is a detached committed Composition with the target track removed entirely. Preserve captured tempo and all remaining instruments, volumes, velocities, mute flags and note timing. Render its complete bounded duration with existing global peak limiting, then take/pad its first 20 seconds. Thus late backing notes can affect the existing full-render limiting; no new gain algorithm or sectional limiter is introduced. Do not include any reference PCM. The target's old notes are never electrically routed into the backing, even when muted or silent.

At least one remaining track must contain an audible eligible note starting before 20 seconds at the captured tempo. Otherwise refuse with guidance to add/unmute a backing part or use ordinary recording. Short backing ends in silence while microphone recording continues; source ended events never finalize the take.

## User flow and controls

Add **Record with backing** beside ordinary recording, with clear guidance: select the destination track, apply or discard all unapplied fields and any continuation suggestion, and use headphones to keep playback out of the microphone. Before permission, confirm replacement of an existing destination's notes/reference through an explicit confirmation. Refusal/declined confirmation must not rebuild raw editors, clear fields or move focus.

The new mode requires `scratchExists()`-equivalent whole-editor admission, including drafts on other notes/tracks and proposal scratch. It does not change the ordinary recorder's existing draft policy. Capture the target ID, immutable backing/source project, tempo, composition generation and raw editor intent before asynchronous work. Changed-back raw inputs still retire ownership.

Status distinguishes preparation, microphone permission, count-in beats 1–4, recording elapsed graph time, and processing. During preparation/count-in, **Cancel** is available; **Finish recording** is available only after beat zero. A programmatic Finish before beat zero cancels without processing. After beat zero, Finish keeps the exact contiguous microphone interval captured so far, subject to ordinary note detection/admission. The existing **Stop playback** must cancel the complete backing capture session; stopping only the backing while capture continues is unsupported. Natural 20-second completion follows the same single finalization path.

Keyboard controls remain buttons with accessible names; do not reinterpret Space globally or inside editable fields. Block editing while actively preparing/counting/recording/processing, but also guard programmatic/stale callbacks independently. Successful capture uses the existing autosave pump; conflict retains the new complete memory bundle and offers existing #98 recovery, without automatic replacement or false Saved status.

## Exact shared-frame timing

Accept an integer AudioContext sample rate in 8,000–192,000 Hz and a running context. Four beats always means a disclosed 4/4 count-in; imported time-signature metadata does not change it. After backing render, worklet module setup, microphone connection, worklet readiness and successful context resume, compute a plan once:

- `countInFrame = ceil((context.currentTime + 0.1) * sampleRate)`.
- Click onset `k` for k=0,1,2,3 is `countInFrame + round(k * 60 * sampleRate / tempo)`.
- `startFrame = countInFrame + round(4 * 60 * sampleRate / tempo)` is composition beat zero.
- `maxFrames = floor(20 * sampleRate)`; `limitFrame = startFrame + maxFrames`.

All frame values and sums must be safe nonnegative integers. Tempo is the frozen validated 40–240 BPM value. The 100 ms graph scheduling lead is preparation time, not part of the count-in or capture. If the arm/ack flow reaches the scheduled count-in frame too late, reject before scheduling rather than silently shifting beat zero. Sources use `.start(frame / sampleRate)`; backing is stopped at `limitFrame / sampleRate`, regardless of source release/end. Count-in uses a separately generated bounded click buffer and never enters the microphone capture input electrically.

The processor uses AudioWorklet `currentFrame` and actual render-block lengths. Copy precisely the intersection of each input block with `[startFrame, limitFrame)`. Neither count-in nor scheduling lead is retained. Do not assume every browser block is 128 frames. Final contiguous sample index j corresponds to graph frame `startFrame + j`; no phase offset is inferred from wall clocks or message receipt. Before arm, no interval is retained: valid input blocks must remain monotonic and nonoverlapping, but forward graph-frame gaps during native startup are allowed. The first topology stays pinned and every observed sample stays finite. From arm onward, including count-in, every block must be exactly contiguous; no missing capture frame is padded or skipped.

Finish computes `stopFrame = min(limitFrame, floor(context.currentTime * sampleRate))`. Before start it cancels. A delayed finish message may arrive after more samples were copied; trim the retained result to that requested end frame. If the processor has not reached the end, finalize when it reaches it. Never pad an unreceived tail. Natural completion uses `limitFrame`. Return `endFrame = startFrame + samples.length`; the resulting frame count is 1..maxFrames. Empty captures return no take. Main validates every result and rejects malformed/gapped/extra data.

Reference and transcribed note starts are relative to this captured beat zero. Use the unchanged quarter-beat transcriber; its quantization can place an inferred boundary slightly beyond the exact retained audio end. No hidden latency compensation, automatic waveform shift or sample trimming is added to make physical recordings seem aligned.

## Microphone graph and bounded protocol

Request audio with echo cancellation, noise suppression and automatic gain control disabled as best-effort constraints; browser/device compliance is not guaranteed. Keep the microphone MediaStreamAudioSource connected only to the recorder worklet. The worklet emits silence to its output and connects to destination solely to keep processing alive. Backing/click sources connect separately to destination. Live microphone monitoring and backing/click capture are absent from this graph; acoustic leakage is still possible.

Average actual input channels to mono with no gain normalization. Admit 1–32 channels, pin the first valid topology before recording, and reject a topology change, unequal block lengths, missing capture input or nonfinite sample. Missing input before initial readiness can wait under setup deadline; after readiness loss fails. A muted/ended microphone track, worklet processor error or AudioContext leaving running after arming fails the session and discards partial audio. Genuine silent samples remain valid input, but existing no-clear-notes rejection preserves the old take.

Preallocate one Float32 buffer of maxFrames in the processor before readiness. At maximum rate this is 3,840,000 frames / 15,360,000 bytes, excluding graph and normalization buffers. Transfer one bounded final mono array; do not accumulate an unbounded message/chunk queue. Progress is at most ten updates per graph second with bounded numeric fields; no audio in progress records. A cancellation releases processor references, disconnects nodes, closes ports and stops every microphone track. No new take is committed during this cleanup.

Internal protocol is single-use per node: `arm {startFrame,limitFrame}`, `finish {stopFrame}`, `cancel`; replies `ready {sampleRate,channels}`, `armed {startFrame,limitFrame}`, `progress {phase,framesCaptured}`, `complete {sampleRate,channels,startFrame,endFrame,samples}`, or a fixed sanitized error. Enforce one arm and one terminal outcome, bounded numeric shapes, and ignore late/duplicate outcomes after retirement. No source text or device identifiers cross this protocol. The complete samples ArrayBuffer is transferred once. The worklet returns false once terminal; outputs are zeroed whenever processing continues.

## Proposed pure and browser APIs

New `backing.ts`:

```ts
export interface BackedFramePlan {
  sampleRate: number; countInFrame: number; clickFrames: readonly number[];
  startFrame: number; limitFrame: number; maxFrames: number;
}
export function backingComposition(composition: Composition, targetId: string): Composition;
export function backedFramePlan(sampleRate: number, tempo: number, contextSeconds: number): BackedFramePlan;
```

Both APIs admit finite bounded inputs, return detached values and reject absent targets/no eligible backing. `backingComposition` uses existing validation and does not alter source notes/references. A separate small pure frame accumulator can be shared by worklet/unit tests; it owns interval selection, channel averaging, continuity and terminal trimming, not synthesis or project history.

New `backed-recorder.ts` and `backed-capture.worklet.ts`:

```ts
export interface BackedCapture {
  samples: Float32Array; sampleRate: number; channels: number;
  startFrame: number; endFrame: number;
}
export type BackedProgress =
  | { phase: 'requesting' | 'preparing' }
  | { phase: 'counting-in'; beat: 1 | 2 | 3 | 4 }
  | { phase: 'recording'; framesCaptured: number; sampleRate: number };
export class BackedRecorder {
  start(options: {
    context: AudioContext; backing: Float32Array; tempo: number;
    signal: AbortSignal; onProgress: (progress: BackedProgress) => void;
    setupDeadline?: number;
  }): Promise<BackedCapture | null>;
  finish(): void;
  cancel(): void;
}
```

Backing input is an owned detached mono 22,050 Hz array of exactly 441,000 frames, rendered/cropped/padded by the caller; all samples finite. The recorder never closes the shared playback AudioContext. Optional `setupDeadline` uses performance.now(), must be finite, later than admission and at most 30,000 ms ahead; the UI passes its deadline captured before backing rendering. The default is admission time plus 30,000 ms. Export `BACKED_PROCESSOR_NAME = 'melody-backed-capture'` and async `backedWorkletUrl():Promise<string>` resolving the Vite `?worker&url` bundle. The worklet uses no processorOptions. Wire messages have a `type` discriminant matching the names above; explicit armed acknowledgment is required before scheduling count-in sources. One active recorder/native preparation chain per BackedRecorder instance; no waiting queue. The app owns one instance and its shared nativeAudioPending barrier across capture paths, including cancelled preparation and subsequent normalization/transcription. `start` completes once with a bounded capture or null for intentional cancellation/empty early finish; failures reject with actionable fixed messages. Progress consumer exceptions are handled without escaping native callbacks.

The UI prepares backing through the existing render worker and uses the shared AudioContext. It passes complete dry mono samples and actual input channel count through existing `processSamples`/normalization/transcription at captured tempo; reference kind remains `microphone`. Existing decoded metadata describes the browser audio-graph input rate/channels, not an original device clock or encoded container. Explain this for backed takes without claiming new provenance authenticity.

## Ownership, deadlines and lifecycle

A single UI operation owns permission, backing render, module loading, resume, frame plan, sources, worklet, input tracks and processing. Every await/native callback requires the same capture object, generation, target ID, editor intent, operation epoch and live AbortSignal. It cannot adopt a later selected track or raw fields. Stop ordinary playback/auditions before preparation; late prior resume/render cannot start sources.

Preparation has a 30-second monotonic deadline encompassing backing rendering, permission, addModule/readiness and resume. Schedule-to-final-capture has a 30-second wall deadline, enough for the maximum six-second count-in plus scheduling lead plus 20-second capture. Normalization plus transcription has one existing 30-second aggregate processing deadline. Recheck deadlines at actual successful boundaries, not only timer callbacks. Permission/native module/resume/normalization may not be forcibly aborted; logical cancellation is immediate, but shared native admission remains held until outstanding native work settles. If it never drains, preserve complete download and offer reload guidance rather than accumulate contexts/requests. Late granted streams must be stopped; late prepared sources may never start.

Visibility becoming hidden, pagehide, context interruption, stale programmatic edits, target changes or project replacement cancels the backed session rather than committing a partial take. Count-in capture is not resumed after returning. BFCache may retain committed memory/history under existing lifecycle policy; it never revives an old recording. Pending saves from before or after a capture retain #98 completion/CAS semantics independently.

On valid completion, stop backing/click sources and microphone tracks before expensive processing. Use current reference normalization and existing transcription unchanged. Validate the complete candidate document/asset/history budget before clearing proposals/raw drafts, moving selection, mutating saved-copy expectations or publishing new notes. One history commit replaces selected notes/reference only; other tracks and every other reference byte remain exact. Failure, empty detected notes, capacity overflow or late completion leaves prior history/redo/drafts intact.

## Verification and release evidence

Pure independently authored tests pin 44,100/48,000/192,000 Hz and fractional tempos; exact ceil/round start plans; blocks straddling start/end; excluded count-in; mono/stereo opposite-phase averaging; finite/topology/gap errors; delayed Finish trimming; start==end cancellation; exact 20-second cap; detached backing target exclusion and mute/volume/velocity preservation. Preserve existing oscillator/transcriber numerical tests.

A root-gated native harness loads the actual bundled production worklet and connects an original AudioBufferSource in the same real AudioContext for exact graph-frame interval verification; it never injects expected capture results. Native editor acceptance uses an original synthetic MediaStream connected into the real AudioWorklet and real owned backing/click graph. Verify graph-frame origin and a known pre-count-in/at-zero/late tone sequence against retained reference PCM, without mocking capture results. Verify target old-note absence in actual backing and different audible parts, short backing silence with longer capture, four count-in beats, Finish during count-in, manual partial and automatic completion, context suspension/track end, permission/addModule/resume delays and late cancellation. Software clocks do not establish physical microphone/acoustic latency.

Exercise replacement confirmation, all raw drafts, changed-back inputs, cancel/pagehide/Stop, one Undo/Redo, references/history budgets, a foreign saved-copy winner during capture, and no stale sound/commits. Decode actual complete backup/reference PCM and exported MIDI/WAV independently; check retained microphone excludes graph backing, original other references stay exact, note starts remain beat-zero-relative and existing exported MIDI rounding/synth release behavior remains. Use full browser restart for successful persistence. No real model download, paid service or new recognition accuracy claim.

Root coordinates coherent production builds and native slots, updates README/catalog/issue, commits the reviewed contract/implementation and checks exact-head CI. Proposed exclusive producers: pure backing/frame kernel; browser recorder/worklet; narrow UI integration; independent scalar oracle; independent native audio/lifecycle; root integration/evidence. Ordinary recorder/import algorithms remain untouched unless an independently reproduced integration defect requires a separately reviewed narrow change.
