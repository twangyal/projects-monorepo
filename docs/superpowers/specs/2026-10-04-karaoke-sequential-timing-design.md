# Karaoke Studio #115 — time supplied lyric lines while listening

Approved by root after independent review, 2026-10-04. Tracker: [#115](https://github.com/twangyal/projects-monorepo/issues/115). Implementation is released under disjoint ownership while root completes the published Shot milestone’s final native verification. No backend/model/project-format change or new dependency is needed.

## Outcome and existing architecture

With existing supplied lyric cues and an actual loaded Original, Vocals or Backing track, begin a transient timing session. Listen and explicitly mark each line's Start and End, leaving instrumental gaps when needed. Review all captured intervals before one cues-only lyric-history Apply. Save remains a separate existing revision-checked request. This is manual line-level timing, with no word detection or automatic alignment.

Current main.ts owns projectGeneration/loadedProjectGeneration/editGeneration/mediaGeneration, one native audio element, currentTrack, a waveform controller, jobs and archive/SRT owners. Every lyric input already updates history/intent. LyricHistory retains complete title/cues/pastedText/pastedDirty and optional rawTimings; SRT Apply demonstrates cues-only replacement and raw-spelling restoration. Current per-row Mark start/end rounds to milliseconds and rebuilds the rows; this new session captures represented native media times without modifying existing marking semantics. Python project schema1, current WAV routes, PUT expected revision, saved SRT/MP4 and clip archives remain unchanged.

Use the existing 1–300-second duration, 1–200 nonempty supplied cues, 240 Unicode code points per cue and 20,000 total lyric code points. Keep accepted cue text exactly, including spacing and intra-cue newlines; never invoke pasted-text splitting/trimming to construct this session. Existing unapplied paste/title/raw timing values are independent and stay intact. Only existing cue text is timed; clearly disclose this when unapplied pasted words exist.

## Pure domain (`src/sequential-timing.ts`)

Export the following exact interfaces and class:

```ts
export type TimingPhase = 'start' | 'end' | 'review' | 'cancelled';
export interface TimingState {
  phase: TimingPhase;
  lineIndex: number; // completed.length; review/cancelled may equal text count
  pendingStart: number | null;
  texts: string[];
  completed: Cue[];
}
export class TimingCapture {
  constructor(cues: readonly Cue[], duration: number);
  get state(): TimingState;             // detached every time
  markStart(time: number): void;
  markEnd(time: number): void;
  review(): Cue[];                      // only when complete, detached
  cancel(): void;                       // terminal/idempotent
}
```

The constructor requires a dense ordinary array of 1–200 cue records and validates all current `cue.text` values with existing model text semantics. Existing numeric start/end values need not be valid because they are not imported into the new capture. Admit duration1–300 and all text/count/Unicode limits before publishing state. Refuse missing/accessor text, inherited/sparse indices, non-string text, invalid Unicode/NUL and overlimits; no new text-control blacklist. Clone accepted text. No title or project identifiers belong in this class.

Initial state is `phase:'start',lineIndex:0,pendingStart:null,completed:[]`. markStart is allowed only in start phase; require finite `0 <= time < duration` and `time >= previousCompletedEnd` (or0 for the first line). Store the exact represented number, canonicalizing numeric -0 to +0, and enter end phase. markEnd is allowed only in end phase; require finite `pendingStart < time <= duration`. Append that exact interval with the frozen original text, clear pendingStart, increment lineIndex and enter start or final review. No rounding, clamping, epsilon, implicit adjacency or inferred end. Invalid actions leave every field unchanged. Endpoints can be adjacent or separated by gaps; zero-length intervals and overlaps cannot enter the review.

review requires phase review and exactly one interval per captured text; validate the whole list with validateCues and return detached cues. The class cannot partially drop unmarked lines or reopen a terminal review. cancel sets cancelled, clears pendingStart, retains the detached texts/completed list and lineIndex=completed.length for status, and forbids subsequent mark/review. It is idempotent, and the UI must not Apply cancelled state. No native audio, clock, DOM, history, storage or backend work occurs in this module.

All times supplied to the pure class are caller-owned actual media positions. UI media identity, pause/seek and stale ownership are specified separately; the pure class must not infer wall elapsed time or claim authenticity of manually constructed input.

## Session identity and admission

main.ts owns at most one timing session and an increasing timingEpoch. A session captures working.id, loadedProjectGeneration, editGeneration, mediaGeneration, currentTrack, exact expected audio source URL, current project duration and detached cue text, plus its TimingCapture. Use the current project object only after matching every captured identity; do not publish a captured original Project wholesale.

Begin is synchronous and introduces no async File/request/worker operation. Require working+LyricHistory, valid supplied cue texts, no existing media/job/save/archive load/upload/recheck operation, document visible, and actual loaded media. Require audio.readyState>=HAVE_CURRENT_DATA, no audio.error, currentSrc matching the selected project's authenticated local audio route, finite audio.duration matching project duration within one44,100-Hz sample, no seeking/ended state, finite currentTime within `[0,project.duration)`, audio.loop===false and playbackRate===1. Normalized three-track WAVs already share this exact media timeline. If not ready, give Play/load/track guidance without mutating or replacing editor values; do not substitute0 for unavailable currentTime.

Existing invalid numeric cue drafts or unrelated invalid title do not prevent transient timing: they remain available for correction and explicit Undo. Unapplied paste is preserved, is not timed and continues to block Save until separately resolved. A pending waveform gesture must end or cancel before Begin; Begin cancels a remaining gesture and retires SRT review, but does not record a history state or clear redo. Do not automatically seek, change track, enable loop, start audio or rewrite pasted words. The user can position the native player before Begin, then explicitly Play/Resume. If audio was already playing, it continues at its actual position.

## Playback/boundary transition policy

During start/end phases, Mark reads audio.currentTime synchronously on the explicit action. Require the same identity, visible page, loaded media, not seeking, normal rate, nonlooping, !paused and !ended. Reject a nonfinite/outside-project value without changing pendingStart/completed. Never use performance.now, animation-frame elapsed time, displayed rounded labels or old cue times as the mark.

Maintain a session media-clock floor from the last observed finite position, checked on media timeupdate and immediately before marking. A backward position retires the entire owner rather than guessing a new baseline. Ordinary repeated equal observations are harmless; markEnd still requires a strictly later position. Event checks and synchronous checks are both necessary because seeking/source changes can precede queued events.

- **Pause:** preserve the session, pendingStart and completed intervals. Disable marking and say Resume playback to continue. Resume of the same source/rate keeps the session; nothing is marked or padded by either event. Buffering/waiting similarly disables marking until real current data/playing resumes.
- **Seek/seeking:** retire capture and review immediately, with staged-times-not-applied guidance. This includes waveform seek and Play line, native controls, script-origin native seeks and loop wrap detected as backward time. Position the player, then deliberately Begin again. Never silently retain a partly timed sequence through seeking.
- **Track/source/metadata replacement, emptied/error:** retire capture/review before existing track/open handlers. A late loadedmetadata/play promise can update only its existing media owner, never revive a timing owner or mark a line.
- **Rate/loop:** Begin requires1×/no loop. ratechange or a detected loop flag retires the session; do not quietly rescale intervals. Loop has no reliable change event, so inspect it on each mark/timeupdate. Native looping cannot create a second pass into the same capture.
- **Natural ended:** do not mark anything automatically. If and only if the pending open line is the last supplied line, expose the explicit **End final line at clip end** action, which uses the exact validated project duration after rechecking ended/current source/duration identity. This is deliberate endpoint selection, not an inferred vocal end. Otherwise show how many lines remain and require Cancel/new session; no partial Apply. An ended session cannot resume from a new seek without retirement.
- **Completion:** after explicit last End, pause the same owned audio and enter complete review. The pause is a deliberate completion action, not automatic resume. Review stays transient; ordinary seeking or changing source still retires it under the same policy. Existing committed preview remains the authority until Apply.

The UI need not start new async playback promises for this milestone. Native player Play/Resume remains user-controlled, avoiding an extra nonabortable startup chain. No session watchdog is needed for intentionally paused manual work; retained state/listeners are bounded by200 texts and one owner. Page departure/hidden retires that owner rather than preserving a possibly discontinuous stream. Do not call the lack of a wall timer a real-time accuracy claim.

## Stable accessible UI

Add a sibling section **Time lines while listening** outside cue-list replacement with stable IDs:

- `#timing-begin`: **Begin timing session**.
- `#timing-status`: polite status; distinguish unstarted, listening, paused/waiting, incomplete end, review, canceled and applied.
- `#timing-line`: literal current text, preserving whitespace/newlines, plus line number/count. This is the captured next line, while the existing canvas still displays committed lyrics.
- `#timing-mark`: one stable button labeled **Mark line start** or **Mark line end** from current phase. Change text/disabled state without replacing the node or automatically moving focus.
- `#timing-end-final`: **End final line at clip end**, hidden except the explicit natural-end case.
- `#timing-cancel`: **Cancel timing session** (available while capturing/reviewing).
- `#timing-review`, `#timing-summary`, `#timing-review-list`: complete current text and intervals, instrumental gaps and previous/incoming count. Render every accepted text as textContent, never HTML.
- `#timing-apply`: **Apply captured timings**.

No global character shortcut may intercept lyric/title/paste typing, native audio keys or waveform controls. Pointer click activates once. On the focused Mark button, Enter or Space keydown performs one mark and prevents the native duplicate click; ignore repeat/composition/modifier events and maintain a held-key Set until matching keyup. Keyup never marks. A held Enter/Space cannot mark Start then the following End, even after the label changes. Keep a separate blocked-until-keyup latch for pressed keys when blur, session retirement or hidden/pagehide clears control ownership; window keyup releases that latch. A repeated or still-held keydown after focus/owner change remains suppressed until actual release/new deliberate press. Assistive native click activation remains usable without a timing-specific shortcut.

Begin may focus the stable Mark button following the deliberate Begin action. Subsequent automatic label/status/progress updates never steal focus. Cancel/error leave actual editor nodes, raw values, caret and unrelated focus intact. Failed Begin does not rerender cue rows. Keep controls/touch targets usable at390px and announce phases once; do not announce audio clock every RAF.

## Editor/actions, history and Apply

Every actual editor input intent (including changed-back title/paste/cue text/raw timing), Undo/Redo, draft generation/discard, waveform boundary gesture, SRT selection/apply, project selection/open/delete, import/media job admission and pagehide/hidden retires the timing session/review before proceeding. Existing confirmation rules for replacing ordinary editor drafts remain. Explicit input intent never restores an earlier review merely because the resulting data equals its original value.

Save/export mutations are disabled while an active timing capture or complete review exists; Cancel or Apply first. Do not classify transient marks as already saved/working.cues, or export them before Apply. Audio player Pause/Resume remains available; waveform view changes that do not seek or edit a boundary may remain available. Archive backups remain saved-only and must retire timing on admission without replacing editor values. An observed job or async open result that locks/replaces the editor retires the owner under its existing project/media epochs.

Cancel/error/stale retirement only clears transient timing controls/state. It must not call renderCues, changed, lyricHistory.record, working replacement, Save or videoUrl invalidation. If the ordinary editor itself changes, its existing handler owns those effects. No routine timer/status/media event may change the editor or history.

Apply requires current session identity, complete validated cues, no other busy action and matching loaded project/edit/media generations. Immediately before touching history or live model, synchronously recheck actual current source, readyState/error, duration, seeking, normal rate, no loop, page visibility and the media-clock floor. Queued events are not sufficient evidence of ownership. A completed review may be paused or naturally ended, so this final guard deliberately omits the active Mark gate’s !paused/!ended requirements. It is synchronous: validate the whole candidate and text/count/duration/connected session caps before touching history or live model. Capture the exact current pre-Apply LyricDraft including rawTiming strings; record it only through the existing history baseline pattern so already current raw spellings create no extra phantom step. End the prior field group. Replace only working.cues, canonical-render their accepted boundaries and record once via the existing changed path. Title, pastedText and pastedDirty are not assigned from captured originals. Retire the timing owner before changed() triggers ordinary invalidations.

If all text/timing values already equal the current cues, complete Apply as a no-op: retire review without rebuilding rows, canonicalizing existing raw spelling, changing dirty/video/history or pruning redo. Otherwise it is exactly one lyric edit; Undo restores all prior numeric semantics and raw spelling, including NaN/blank fields, and Redo restores captured cues. Current video becomes unavailable only through the ordinary changed mechanism. Save stays explicit and performs the unchanged PUT expected revision; stale/failed Save preserves complete draft/history and cannot replay automatically. Unapplied pasted words still require separate use/discard before saving.

## Verification and acceptance

Pure producer and independent oracles pin literal times/text before reading new implementation. Cover gaps/adjacency, exact represented fractional boundaries, zero/reversed/over-duration/nonfinite marks, phase misuse, invalid-atomic cursor/pending state, detachment, cancel terminality and complete-only review. Admit200 cues/20,000 code points at300 seconds; reject201/240+1/total+1/NUL/surrogate/sparse/accessor inputs without partially publishing. Include literal multiline/spacing/emoji and invalid old numeric timings whose text remains eligible. Do not quantize these captures to SRT milliseconds in the kernel.

Native integration must use actual local WAV playback and trusted button/keyboard actions with read-only observations of native currentTime. No fabricated timeupdate or injected clock replacement may substitute for playback evidence. Test focused held/repeated Enter/Space, gaps, Pause/Resume, immediate seek/source/rate retirement, complete natural-end explicit closure, premature end with remaining lines, hidden/pagehide ownership, raw changed-back edits and stale source load. Controlled hidden/read callback races must be labeled separately from real media playback.

Exercise actual editor Apply→Undo→Redo→explicitSave→reopen; invalid prior raw timing spelling restores exactly, title and unapplied paste survive, no-op keeps redo and nodes/focus. SRT/File/archives/waveform/jobs/history interactions keep their existing regression scope. All old tests remain meaningful; no weakening saved revision or raw draft guards to make the new UI pass.

Separate maximum acceptance uses a complete original300-second local fixture and200 supplied lines/20,000 code points. Capture all intervals through actual playback (no seek/currentTime injection to pretend a five-minute pass), include real instrumental gaps and explicit last-line clip-end closure, then apply/save. Record actual observed native boundary receipts and timing tolerances instead of claiming click-time precision beyond browser/media scheduling. Preserve all three original audio hashes. Download exact cues/SRT/complete clip archive, perform a full service and Chromium restart and check persisted boundaries/text/revision. Export real300-second H.264/AAC MP4; independently decode relevant lyric/gap/cue boundary samples and final frame/AAC tail. Existing font and24-fps/SRT-millisecond limitations remain disclosed. Routine short CI fixtures can be smaller; the actual maximum is a separate reproducible native smoke, not a five-minute test forced into every case.

No new separation/inference is needed or claimed. Existing real-separated source can be reused; a fake-separator supplied fixture is explicitly software timing/export evidence, not separation-quality evidence. No automatic completion, lyric truth or synchronization accuracy claim beyond observed media-clock behavior.

## Proposed ownership after review

- Pure domain: `src/sequential-timing.ts`, new focused producer tests. Existing lyrics.ts/model semantics stay unchanged unless a tiny reusable text-validation export is specifically approved.
- UI/history integration: main.ts/style.css only; existing backend/API/project/archive formats untouched. No waveform controller rewrite.
- Independent domain/history oracle: new uniquely named tests, original literal text/clock fixtures; no producer fixture reuse.
- Native tests/maximum media: new independent browser spec and reproducible smoke helper; root owns build/service slots and complete regression gates.
- Root: spec/plan/tracker/release, version/README/catalog/evidence/Git/CI. Final read-only reviewer checks coherent UI owner/keyboard/media edges.
