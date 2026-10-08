# Melody Studio: continuation from your selected ending

Issue [#42](https://github.com/twangyal/projects-monorepo/issues/42). Reviewed implementation contract before product edits. Based on the current `apps/melody-studio/src/main.ts`, `types.ts`, `model.ts`, `arrangement.ts`, `history.ts`, `audio.ts` and `render.worker.ts`.

## Product decision and honest usefulness

Add a **Continue this phrase** panel to the selected track. Fit small variable-order transition counts exclusively to an explicitly chosen ending of that track. Suggest four or eight further notes, audition the selected ending plus the proposal, then discard or append once. No bundled style corpus, pretrained checkpoint, remote calls, automatic application, musical-quality score or general composition claim.

This is useful for variation of a short repeated motif, particularly when interval/rhythm patterns recur. It is weak at harmonic planning, phrase endings and original structure. Eight input notes yield only seven transitions: backoff, repetitive output and identical successive suggestions are expected. Describe it as a “local pattern suggestion learned from this ending,” not a model of the person's general style. Do not promise that rejection teaches preferences: the training data changes only when the user changes the selected notes. Existing **Repeat phrase** remains the predictable alternative.

## Existing integration constraints

- Composition v1 has up to eight tracks and 256 notes per track. MIDI pitches are integers 36–96, durations 0.25–16 beats, and all notes end by beat 128. Notes may otherwise have arbitrary finite beat positions and overlap; this feature must reject unsuitable seeds without tightening the general project schema.
- IDs are nonempty bounded strings, globally unique across tracks and notes. `createNote` always starts with duration1 and limits its start to127, so continuation should construct complete notes directly and then call `validateComposition`, rather than misuse `createNote` for fractional late positions.
- `CompositionHistory` stores up to 50 changes and returns detached validated compositions. `commit` in main handles history, playback stopping, project replacement and local saving. `restoreHistory` separately changes the project and must also invalidate proposals.
- Main already owns one render/transcription Worker through `runWorker`, a 30-second timeout, `operation`, `playbackGeneration`, `busy`, and one AudioBufferSourceNode. Reuse those resources. `render.worker.ts` validates compositions and renders 22050 Hz PCM; ordinary MIDI/WAV/project export already consumes committed notes.
- Main replaces its innerHTML during render and only restores focus. Unapplied note-form values are not retained in project state. New continuation actions must not erase those drafts.

## Selection and controls

1. Label: **Learn from the last [N] notes of [track name]**, integer N, 8–64; default min(16,track note count) when eligible, otherwise8 with a clear insufficient-notes message. Explicitly show selected count, first/last pitch and beat range; highlight seed notes separately from the ordinary selected note.
2. **Add [4 / 8] notes**; default4. **Suggest continuation** fits the currently displayed ending. **Another suggestion** draws a fresh nonzero32-bit random seed from Web Crypto and refits the same current selection; a repeat result is allowed and disclosed rather than silently retried.
3. Show a read-only proposal note list/piano-roll overlay with pitch, start, duration and rests, and a boundary labelled **Suggested notes — not saved**. Show data support: N source notes, N−1 transitions, and per-output backoff order, raw context successor count before boundary filtering, and retained eligible count used as the sampling denominator (expandable). Do not present a confidence percentage.
4. **Audition ending + suggestion**, **Apply continuation**, **Discard suggestion**. Normal export continues exporting only the committed project; the proposal panel says this explicitly.
5. If note form values differ from the selected committed note, continuation actions report “Apply or discard your note edits first” without rerendering the editor. Add a local **Discard note edits** action if needed; it is explicit. Do not silently apply numeric drafts or replace them while updating the continuation panel. Preserve draft values through asynchronous audition-start/end redraws as well as button actions. Preserve invalid seed-length input visibly and disable suggestion until corrected.

Selection uses a detached chronological copy of all selected-track notes, ordered by start then end then ID with code-unit comparison. Take exactly the lastN, retaining their existing IDs; do not change project array order. The selected suffix must satisfy:

- each start and duration multiplied by4 is an exact integer (no epsilon rounding or quantization); pitches already meet project validation;
- no simultaneous starts or overlapping selected notes; adjacency and rests are allowed;
- every unselected note ends at or before the selected first start, so a sustaining earlier voice cannot intrude into the selected ending;
- the selected span from first start to last end is at most16 beats;
- every selected note has velocity>0; reject silent seed notes with guidance instead of silently treating them as pitch examples. Muted tracks remain valid training data, but audition is unavailable as described below.

The proposal follows the selected last note's end, including any generated leading rest. Since the selection is an eligible suffix, that end is also the track end. No arbitrary excerpt inserted into the middle, implicit shortening to64, automatic chord reduction, or quantization in this milestone.

## Exact fitted model and generation

Use integer quarter-beat ticks throughout. For each selected note i from1 throughN−1, form one joint token:

`(interval = pitch[i]−pitch[i−1], durationTicks = duration[i]*4, restTicks = (start[i]−end[i−1])*4)`.

These jointly learned events preserve observed interval/rhythm/rest associations. Do not learn an artificial end-to-start transition. Initial silence before the selected first note and its duration are not transition outcomes. Generated velocity is the median selected velocity (mean of the middle two when even); it is a fixed disclosed choice, not learned dynamics.

Fit occurrence counts for context lengths0,1,2: at token positionj count token[j] after each available suffix token[j−k:j]. Contexts and outcomes use exact integer tuples. No smoothing, invented tokens, external data or altered counts. At most63 training tokens and189 total counted occurrences; fitting and generation can run synchronously without another Worker.

For each output note, context is the last generated/training tokens. Try order2, then1, then0. A nonzero-order context requires at least two observed successors in total; otherwise back off. Within a supported context, remove outcomes whose resulting pitch leaves36–96, whose resulting note ends past tick512 or more than64 ticks after the selected ending, or whose end leaves fewer than one tick per remaining requested note within both bounds. If no eligible outcomes remain, try the lower order. Do not clamp, transpose, stretch, suppress rests or invent a boundary token. If even order0 has no eligible outcome, fail the entire proposal with the pitch/time reason; publish no partial list. The remaining-time check is only a lower bound: later failure is possible and must still be atomic; no hidden retry/backtracking.

Sample proportionally to retained integer counts. Order candidates lexicographically by numeric `(interval,durationTicks,restTicks)`, independent of insertion order. Deterministic PRNG: nonzero uint32 initial seed, each draw applies xorshift32 (`x ^= x<<13; x ^= x>>>17; x ^= x<<5; x >>>= 0`), and uses `u=x/4294967296`; choose the first cumulative count strictly greater than `u*total`. No Math.random, temperature or beam ranking. Tests may inject a seed; UI need not expose it as a musical control. Identical seed/model/options produce identical pitches/timing and support diagnostics.

Preflight note capacity (`track.notes.length+requested<=256`) before fitting. Validate all generated durations/endpoints and the complete candidate composition before returning anything. New notes must never overlap each other. Existing tracks, notes and IDs remain byte-for-byte equivalent in value/order until Apply.

Suggested pure module contract (`continuation.ts`, no DOM/audio imports):

- `selectEnding(project, trackId, count) -> SeedSelection` with detached notes and tick boundaries.
- `fitEnding(selection) -> FittedEnding` with bounded count tables and diagnostics.
- `suggestEnding(project, trackId, count, length:4|8, randomSeed) -> ContinuationProposal` with a detached validated base snapshot, selection/options, seed, `Omit<Note,'id'>[]`, and per-step order/support.
- `applyContinuation(current, proposal) -> Composition`: validate/recheck exact canonical current snapshot against proposal base; allocate fresh globally distinct UUIDs only now; append all generated notes once to the selected track; validate and return detached candidate. Mismatch rejects before mutation. Proposal objects are internal ephemeral state, not importable persisted artifacts.
- `auditionComposition(proposal) -> Composition`: one detached selected-track copy containing only seed+proposal, shifted so seed first start becomes0, preserving relative gaps, instrument, volume, tempo and selected velocities. Create bounded distinct scratch IDs for the uncommitted notes; no effect on project IDs.

## Ownership, invalidation and playback

One ephemeral proposal per page. On every successful changed composition commit, successful undo/redo, track switch, seed-count/length change, or start of capture/project replacement: discard proposal and stop any proposal audition. This intentionally includes title/tempo/instrument/volume/mute edits for simple reliable semantics. Changing only the ordinary selected note does not alter the seed; protect its draft before rendering. Failed validation must preserve project, history and any still-current proposal.

Apply checks the captured composition generation and exact snapshot again, calls the existing commit once, then clears the proposal synchronously on success. Double clicks or replay against a changed composition reject; undo restores exactly the old composition, redo restores the same inserted IDs. Do not persist fitted tables/proposals or change Composition v1/local-storage schema. Accepted notes alone survive save/reload and enter all existing exports.

Audition is explicitly solo seed+proposal, not the whole mix. Respect the selected track's mute and volume: if muted or volume0, disable audition and explain “Unmute or raise volume, then regenerate to audition.” Never silently override the user's mix. Seed velocity0 was rejected earlier. Muted proposals may still be applied deliberately; ordinary playback/export retain mute semantics.

Factor existing playback into a helper that takes a validated scratch composition and a label, retaining current Worker timeout/cancellation. Capture proposal identity, operation token and playback generation before awaiting AudioContext.resume and Worker output; test all again before creating/starting a source. Stop/cancel, track switch, discard and editing invalidate pending audition; stale replies cannot play. A source's onended must clean up only that captured source, not a newer global source. Use existing busy UI during render; once sound is playing, allow edits but stop it when they invalidate the proposal. Never autosave an audition composition. No new audio engine or media permission request.

## Verification and release evidence

- Independent count oracle with hand-worked seeds verifies exact tokens, joint rhythm/rest association, order2→1→0 support/backoff, candidate ordering and weighted-draw boundaries. Synthetic fixtures are musical plumbing, not taste/quality evidence.
- Two original seeds with distinct repeated interval/rhythm patterns produce corresponding distinct fitted distributions/continuations under matched options; changing one seed transition changes the expected counts. This proves data dependence, not population generalization. Test transposition equivariance away from bounds and onset-shift invariance.
- Cover8/64 selection,7/65 rejection, arbitrary source array order, off-grid start/duration, duplicate start, overlapping earlier note, zero velocity, integer pitch limits, rests, zero count probabilities, uint32 seeds, remaining128-beat capacity and note256. No clipping or partial output when generation fails midway.
- Snapshot immutability, collision-free fresh IDs, exact Apply-once, stale proposal rejection, one undo/redo entry, no-op reject/regenerate and unchanged unrelated tracks. A proposal must never appear in storage/JSON/MIDI/WAV before Apply.
- Native browser: load original8+note fixture, explicitly choose suffix, generate, inspect distinct overlay, real worker audition seed+proposal, discard without edits, regenerate/apply/undo/redo, save/reopen, independently decode MIDI note events and WAV timing/nonzero signal. Assert renderer includes the selected instrument/tempo and excludes other tracks during audition.
- Delayed real Worker delivery tests cover stop/discard/edit/new-project races; muted/zero-volume audition stays unavailable. Unapplied invalid note drafts and invalid suffix-count text remain intact. Desktop/mobile controls are keyboard reachable with no added page overflow.
- Measure64-note fitting/generation and worker audition at 40 BPM within existing resource limits. Seed and proposal are each bounded to16beats, so the note span is at most 48 seconds at 40 BPM; the existing 0.08-second release tail makes rendered PCM at most 48.08 seconds (rounded up to a sample). Record the real limits and observed failure/repetition cases. Human musical usefulness remains unestablished unless an actual documented listening assessment is performed; objective signal tests cannot substitute for it.

## Release scope

This milestone is a personal motif-variation aid; broader generative arrangement remains future work. The technical feasibility is high with current dependencies; musical novelty/usefulness is uncertain because the fitted sample is tiny. Keep scope centered on transparent proposal/audition/reject/apply and accurate learned counts. If objective tests show output mostly copying a single suffix, disclose that rather than adding an unrelated toy corpus to manufacture variety.
