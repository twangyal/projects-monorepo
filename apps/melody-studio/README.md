# Melody Studio

**Product direction (2026-10-08): ACTIVE.** The destination is a full music-production DAW with the depth and creative control associated with FL Studio. See [the portfolio direction](../../docs/PRODUCT_DIRECTION.md) for the full vision and acceptance expectations. The implementation and verification described below are current milestones, not completion of that destination.

A local browser music sketchbook: record or import a single hummed melody, turn it into editable notes, compare corrections with a retained reference take, layer tracks, and export a composition. Pitch detection and synthesis remain deterministic. A small local statistical learner can continue an explicitly selected ending with inspectable, reversible note proposals; broader generative arrangement remains future work.

## Run locally

Use Node.js **22.18 or newer** and npm:

```sh
cd apps/melody-studio
npm ci
npm run dev
```

Open the localhost URL printed by Vite. No account, API key, backend, paid service, or downloaded model is required. `npm run build` creates the static production site in `dist/`; `npm run preview` serves that build locally.

## Make a composition

1. Select a track, then **Record melody** or **Import audio**. Set the tempo before capture; transcription quantizes timing to quarter beats at that tempo. **Try demo melody** exercises audio detection without microphone access; **Load example** opens a prepared two-track composition.
2. Sing or hum one clear melody in a quiet room. Recording stops automatically after 20 seconds; **Finish recording** stops sooner and transcribes it. Imports must be browser-decodable audio, at most 10 MiB and about 20 seconds long. WAV is a useful fallback if another format cannot be decoded.
3. Drag a piano-roll note to move its pitch/time, or drag its right edge to resize. Use **Draw note** to add notes on empty grid space. For exact values, select a note, edit its MIDI pitch, start beat, duration or velocity, and press **Apply note**. Keyboard users can reach notes with Tab and use arrows or the labeled form fields.
4. Add tracks to layer parts. Each track has a name, volume, mute switch, and one of three synthesized instruments: **Soft keys** (sine), **Warm flute** (triangle), or **Bright synth** (sawtooth). These are simple waveform sounds, not sampled acoustic instruments. Play and stop the combined composition.
5. Save a project backup or export MIDI/WAV. Recording, importing, or trying the demo on a populated track asks before replacing its notes and reference take. Opening a project, loading an example, or starting a new composition also asks before replacing existing notes.

Arrangements can span **512 beats**: 4 minutes 16 seconds at 120 BPM, or 12 minutes 48 seconds at 40 BPM, before the synthesized release tail (up to two seconds per track). Editing, section repetition, MIDI review and whole-song exports share this timeline. Captures and retained reference takes remain 20 seconds each; they are source ideas rather than full-song audio clips. Earlier project files remain compatible. Melody remains ACTIVE toward capable sound design, audio editing, mixing, routing and effects.

## Design a track sound

Each track has a **Sound envelope** with linear **Attack**, **Decay**, **Sustain** and **Release**. Attack rises from silence to full level; decay falls to the sustain level; release fades from the level reached when the note ends. Attack, decay and release accept 0–2 seconds; sustain accepts 0–1. A note ending during attack or decay releases from its actual level. Zero-length phases are supported.

Edit the fields, then choose **Apply sound envelope** for one undoable, autosaved track edit. Until Apply, playback and exports use the committed sound. Blank, nonfinite or out-of-range values remain editable and cannot affect the project. Switching tracks retains each track's sound drafts. **Discard sound edits** restores only the selected track's committed sound. Apply/discard other editor drafts and suggestions and finish piano-roll gestures before applying sound settings; a pointer click cannot blur and commit an unrelated raw field.

Applied settings survive complete project backups, saved compositions, track duplication, Undo/Redo and reload. All synthesized playback, backing, edited-note comparison and WAV exports use the same renderer. Whole-song WAV and aligned stems include the complete release tail; section exports retain their exclusive crop bounds. MIDI keeps its existing note/program representation and does **not** carry custom envelopes. Earlier projects retain their original 0.01-second attack, full sustain and 0.08-second release, with unchanged rendered PCM.

This provides per-track amplitude shaping for the three existing waveform instruments. Sample instruments, effects and mixer routing remain future DAW work. See [sound-envelope verification](docs/2026-10-08-sound-envelope.md).

### Shape the tone with a resonant filter

Enable **low-pass filter**, set **Filter cutoff (Hz)** from 20–10,000 and **Filter resonance (Q)** from 0.5–8, then choose **Apply sound filter**. Lower cutoff softens bright harmonics; higher Q emphasizes frequencies near the cutoff. Disable Enable and Apply to bypass the filter and restore the unfiltered oscillator sound. Bypass removes the saved filter settings; re-enabling starts from 8,000 Hz and Q 0.707.

Filter changes are explicit, undoable, autosaved track edits. Blank, nonfinite and out-of-range drafts remain editable and do not change playback or exports. Track selection retains each track's raw filter drafts. **Discard filter edits** restores only that track's committed filter. Finish other raw editor fields, envelope drafts, suggestions and piano-roll gestures before Apply; these are never silently committed by the sound button.

Projects, saved compositions, duplicated tracks, Undo/Redo and reload retain applied filters. Playback, solo, synthesized backing, edited-note comparison and WAV/stem/section exports share the renderer. MIDI does not carry this custom filter. Older projects bypass filtering and retain their original PCM. The two-pole filter processes each oscillator voice before its amplitude envelope; state starts fresh with each note and release length is unchanged. At lower render sample rates the effective cutoff is capped at 45% of the rate. Existing mix peak limiting remains active; strong resonance can make it reduce the whole mix's gain.

Coefficients follow the [W3C Audio EQ Cookbook low-pass filter](https://www.w3.org/TR/audio-eq-cookbook/). This is static subtractive sound shaping, not filter automation, a filter envelope, a track effects bus or musician-quality evaluation. Those remain part of the ACTIVE full-DAW destination.

## Audition an arrangement section

Set **Section start beat** and **Section end beat (exclusive)**, then choose **Play section** or **Loop section**. Beats start at 1: start 9, end 17 selects eight beats starting at internal beat 8. Fractional beats are supported. The end must fit the last note's end plus one; the range must contain at least one 22,050 Hz audio frame. Blank, nonfinite, reversed and out-of-song bounds are refused and remain available for correction. The effective duration is announced when playback starts.

**Stop playback** stops either mode. Changing a bound or committing a composition edit stops playback and retires pending rendering/resume work. **Export section WAV** downloads one pass as `-section.wav`; ordinary Play composition, Export WAV and Export MIDI still use the whole composition. The range is session-only and is not saved in project files, autosave or undo history.

Sections crop the fully rendered committed synthesized mix, using the nearest audio-frame boundaries. Crossing notes retain their existing phase/envelopes, and peak limiting uses the whole composition. Reference takes and unapplied edits are excluded. A section omits the release tail beyond its exclusive end. Loops use native audio-buffer repetition with hard boundaries; abrupt waveform joins can click. There is no crossfade, tempo automation, playlist section management, or measured musician-quality claim in this milestone. These remain intermediate controls toward the full DAW destination.

### Repeat a layered section

**Duplicate section** inserts a copy immediately after the selected exclusive end and shifts later notes on **every track**, including muted tracks, by the section's beat length. With start 1 and end 9, the first eight beats repeat at beat 9 and later material moves eight beats forward. Fractional timing, rests, pitches, velocities and track sounds are retained; copied notes get independent IDs. The current range stays selected so you can repeat it again.

Choose bounds that include whole notes. A note crossing either boundary refuses the entire operation; nothing is split, shortened or silently quantized. Empty sections and results beyond current 256-notes-per-track/512-beat guards also refuse. Apply/discard unfinished editor fields and continuation proposals and finish any piano-roll gesture first. A pointer click on Duplicate section cannot commit a focused unsent field by blurring it.

Success is one **Undo/Redo** edit and autosaves through the existing complete-project flow. Reference takes and bindings keep their original bytes and capture timing; they are not duplicated or shifted audio regions. Full MIDI/WAV/project exports include the resulting committed synthesized arrangement. This adds an arrangement building block; editable audio clips, playlist/section management and broader DAW production controls remain to be built.

### Trim a layered song

**Remove section and close gap** removes whole notes in the selected range on **every track**, including muted tracks, then moves notes starting at or after the exclusive end left by the exact range length. For start 9 and end 17, the eight selected beats disappear and a note at beat 17 moves to beat 9. Surviving IDs, order, pitch, duration, velocity and sound settings remain unchanged. An empty rest can be removed when later notes move; a range beyond the last note refuses under the existing section bounds.

Choose whole-note boundaries: any crossing note on any track refuses the entire edit. Apply/discard raw editor fields and continuation suggestions and finish roll gestures first. Pointer admission protects focused unsent fields; keyboard actions refuse retained drafts. Blank or invalid range text stays available for correction. Success is one complete-project **Undo/Redo** edit and autosaves, stopping old playback and timing review. Removing the entire song keeps empty tracks and original reference captures; captured audio is never cut or time-shifted. Save a project backup for longer-term recovery. See [section-removal evidence](docs/2026-10-08-section-removal.md).

## Record with backing

Select the destination track, apply or discard unfinished editor fields and suggestions, then choose **Record with backing**. Confirm replacing that track when it already contains notes or a reference. Use headphones: speaker playback can leak into your microphone and confuse single-voice pitch detection.

After preparation and microphone permission, listen to the four-beat count-in, then start your part at the beginning of the composition. The backing uses the other committed tracks at the captured tempo, preserving their instruments, volumes, mute settings and note timing. It excludes the destination track and all reference recordings. At least one other audible part must begin within the first 20 seconds. A short backing ends in silence while recording continues.

**Finish recording** keeps the take so far after the count-in; recording finishes automatically at 20 seconds. **Cancel** or **Stop playback** discards it. Hiding or leaving the page also cancels this mode. A successful transcription replaces the destination notes and normalized reference together as one Undo edit. The other tracks and their reference samples stay unchanged. Empty/failed/cancelled takes preserve the previous complete project; a conflicting saved copy uses the existing explicit recovery flow.

Backing playback and microphone capture share an audio-frame clock. The retained reference begins at composition beat zero and excludes the count-in. This aligns the browser graph; input/output devices and acoustic paths still add latency. There is no automatic latency correction or measured physical microphone accuracy. Captured note timing still uses the existing quarter-beat transcription. Backing rendering uses the ordinary whole-composition peak limiting before cropping/padding the first 20 seconds, so later loud notes can affect backing gain.

This mode requires AudioWorklet in addition to secure-context microphone access and Web Audio. It requests disabled microphone processing as a best effort; browsers/devices may override those constraints. Ordinary **Record melody** and audio import remain available. The backed take's decoded metadata describes the browser audio graph, rather than a microphone hardware clock. Setup and processing each have a 30-second deadline; pending native permission/module/resume work must drain after cancellation before another capture starts. Save a project backup and reload if the browser never finishes that native work.

## Edit directly in the piano roll

Choose **Move notes** or **Draw note** with **Piano roll tool**. In Move mode,
drag a note body to move it in time and pitch; its right-edge handle changes only
duration. A normal click selects the note for numeric editing. Draw on empty
space: click for a one-beat note at velocity 0.8, or drag right to choose its
duration. Existing notes keep their velocity when moved or resized.

**Snap movement** defaults to a quarter beat, with eighth-beat and Off choices.
Move/resize snaps the change from the original value, preserving imported
fractional offsets. Drawing snaps the absolute start and duration. Ties round
away from zero. Off keeps the represented pointer-derived timing; use numeric
fields for exact values. Untouched notes are never quantized.

A dashed preview is unsaved. Release to apply one Undo edit; Escape cancels.
Invalid pitch, duration, start, note-count or end bounds refuse the whole edit.
Nothing is silently shortened or clamped. Scrolling, resizing, lost pointer
capture, leaving/hiding the page or another editor action cancels the gesture.
Exports contain committed notes only. Finish or explicitly discard unsent fields
before dragging; their exact text remains available for correction.

With a note focused, Left/Right moves by the chosen snap increment, Up/Down moves
one semitone, and Shift+Left/Right resizes. Off uses an eighth beat for keyboard
timing steps. Enter/Space opens the existing numeric editor; **Add note** remains
available without dragging. Inputs retain normal text editing and Undo. Scroll
the contained roll to reach distant notes; gestures do not automatically scroll.

Committed edits use the same complete-project history and autosave as numeric
edits, retain every reference sample unchanged, and stop old audition playback.
Cancelled or zero-change gestures preserve the redo branch and suggestion.

## Review whole-track timing

Use **Timing grid (beats)**, **Timing strength (%)** and **Timing swing (%)**, then **Review timing**. Grids are 1, ½, ¼ or ⅛ beat intervals. Strength 100% moves each onset to its nearest grid point; 50% moves halfway; 0% keeps the original timing. Swing 0–50% delays odd subdivisions in each pair by that fraction of one grid interval: grid ½ beat with swing 25% places the first pair at internal beats 0 and 0.625, then starts the next pair at 1. This is a grid-delay percentage, not a displayed swing-ratio convention. Nearest-grid ties choose the later onset.

The review lists exact old/new displayed starts for changed notes. **Apply timing** makes one Undo/Redo edit and autosaves; **Discard timing** and review alone keep committed exports and history unchanged. Unchanged results preserve the redo branch. Note IDs, order, pitch, duration and velocity, other tracks and original reference samples are retained. Durations are never quantized; onsets can create or alter overlaps. A shift extending any note beyond internal beat 512 refuses the whole proposal rather than clipping it.

Apply/discard unsent editor fields and continuation suggestions and finish roll gestures first. Review/Apply pointer actions guard before focused fields can commit by blurring. Source edits, track changes and settings input retire the review; raw settings remain available for correction. Timing settings/review are session-only. **Audition timing** plays the reviewed notes in the current mix at the current tempo before Apply. It includes only synthesized notes; reference audio and unapplied drafts remain excluded. Save, MIDI and WAV exports still use committed notes. Changing the source/settings or choosing **Discard timing** stops only this review’s own audio or pending render; a newer Solo or ordinary playback keeps its ownership. Natural playback completion allows another audition. Apply remains one Undo edit. This has native synthetic-audio coverage, without a measured musician-quality claim. See [timing audition evidence](docs/2026-10-08-timing-audition.md).

## Arrange and undo

**Duplicate track** copies its notes and sound settings into a new independent track, sharing the same immutable reference take when present. Use the **−12 / −1 / +1 / +12** controls to move the selected track down or up an octave or semitone. **Repeat phrase** adds one copy after the last note, preserving internal rests and overlaps; leading silence occurs only before the first phrase. Out-of-range transformations leave the composition unchanged.

**Undo** and **Redo** restore up to 50 committed edits during this session, including notes and reference takes from recording replacements, deleted tracks, and opened/new projects. Restored versions autosave just like edits. Editing after an undo replaces the redo branch. Reloading starts a fresh history from the saved composition. Use Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z to redo, or Ctrl+Y on Windows/Linux. Inputs keep their normal text undo behavior; shortcuts outside inputs operate on the composition. Controls pause while audio is recording or processing. Keep project-file backups for changes older than the session history.

**Cancel** discards an in-progress capture or analysis and preserves the existing committed notes and reference take, unapplied fields and continuation suggestion. Microphone tracks are released on stop, cancellation, or recording failure. Cancelling while permission is pending also releases a stream that arrives afterward; it cannot close the browser's permission prompt. Leaving the page stops capture and playback.

## Compare with the recorded take

A successful recording, audio import or demo keeps a listen-back copy on its selected track. **Reference take** shows its source kind, capture tempo, decoded properties and retained duration. A take must yield detected notes before either notes or audio are committed. The original uploaded container, filename and device details are not saved.

Set **Comparison start (seconds)** and **Comparison end (seconds)**, then choose **Play reference** or **Play edited notes at capture tempo**. Bounds round to the nearest 22,050 Hz frame; the effective bounds are displayed. Invalid or empty fields stay available for correction. Reference playback runs at its original speed, independent of track volume and mute. Edited-note comparison uses only that track's applied notes, current instrument/velocity/volume/mute, and its capture tempo. It renders the complete solo first, then crops or pads the exact same window, retaining synthesis envelopes and full-track peak limiting. Changing a comparison window or selecting another track stops an active comparison. Ordinary composition playback and MIDI/WAV exports continue to use the current project tempo and synthesized notes only.

Transposing, repeating, editing notes or changing tempo never rewrites the reference. **Remove reference** leaves notes intact and can be undone. New/example/MIDI replacement creates notes-only tracks; Undo recovers prior references. Clearing the explicitly confirmed undo history keeps the current project and its takes, but frees audio retained only by old edits. History allows 50 prior edits and at most 64 MiB of unique audio. A change that would exceed that budget is rejected without dropping older history; save a backup and clear history before trying again.

The copy is mono, 22,050 Hz, signed 16-bit PCM, at most 20 seconds per take and eight distinct current takes. Channels are averaged before resampling, so opposite-phase stereo can cancel. Resampling and quantization are lossy; reference playback is not the untouched original file. Decoder metadata describes the browser's decoded sample rate/channels, not the source codec or microphone clock. Up to 100 ms of encoded tail padding may be dropped, with a visible notice. Native decoding or resampling cannot always be aborted: cancellation takes effect immediately in the UI, but another take waits for that native operation to drain. If it never completes, save your project and reload.

## Bring in a MIDI phrase

Choose **Import MIDI file** to inspect a local `.mid` or `.midi` file without changing the current composition. Include the channels you want, choose a local instrument and name for each, and set **Source start beat** and **Source end beat (exclusive)**. These are whole-beat positions, not bars: displayed beats 9 to 17 select source beats 9–16 and move source beat 9 to destination beat 1.

**Review MIDI phrase** shows the selected notes, excluded source note attacks, source settings and omitted metadata. A note crossing either window boundary prevents the review; change the window or deselect its channel. Included pitches, durations and counts must fit the normal composition limits. Note timing retains source ticks divided by its PPQN, without quarter-beat quantization. Leading and internal rests remain; the composition ends at its last note, so trailing window silence and MIDI end-of-track padding are not retained.

**Replace composition** confirms the reviewed selection and creates one Undo/Redo edit. If any unsent editor fields or continuation suggestion remain, an additional explicit checkbox acknowledges discarding them on successful replacement. Undo restores the previous committed composition, not discarded scratch fields or a suggestion. Canceling, rejecting a file or declining replacement keeps the existing editor, history and proposal. Editing the composition or its raw fields invalidates an older review, even if the field is changed back; review again before replacing.

The supported subset is deliberately bounded:

- Standard MIDI formats 0/1, PPQN timing, one constant tempo of 40–240 BPM; absent tempo means 120 BPM. Maximum file size is 1 MiB, with 32 raw tracks, 32,768 events and 8,192 positive note attacks.
- Up to sixteen source channel parts are shown; choose 1–8 supported parts with 1–256 included notes each in a window of at most 512 beats. Different-pitch polyphony is supported. Shared channels across raw tracks, ambiguous same-pitch pairing, percussion, pitch bend, pressure and unsupported controllers are visible but unselectable.
- Static initial program and CC7 volume are shown separately from note velocity. Missing values use disclosed program 0 and CC7 100 defaults. Local instrument mapping is always explicit; it does not reproduce General MIDI sounds. CC7 zero remains silent.
- Tempo changes, SMPTE timing, SysEx, ports and unknown global metadata reject the file. Supported but omitted text/time/key metadata and note-off release velocities are counted in the review; they do not become performance controls.
- Names use strict UTF-8 and the existing 80-UTF-16-unit destination limit. Unusable or ambiguous source names need a visible name choice; they are never silently shortened. Safe fallback titles and part names are shown explicitly.

Imported notes support ordinary editing, layering, playback, continuations, autosave and JSON/MIDI/WAV downloads. JSON retains their represented timing. MIDI re-export rounds to the existing 480-tick resolution, uses approximate programs and merges same-pitch overlaps; WAV contains the local synthesized mix and its release tail. Use the original MIDI file for source performance data and a Melody project backup for this edited composition.

## Continue your own phrase

Select a track with a usable melody, then use **Continue this phrase** below the note editor:

1. Choose **Learn from last notes** (8–64) and request four or eight new notes. The highlighted ending must contain audible, nonoverlapping notes on exact quarter-beat timing and span at most 16 beats. A sustaining earlier note cannot overlap it. The app explains unsuitable input and never silently quantizes it.
2. **Suggest continuation** fits interval, duration and preceding-rest counts only to that ending. The unsaved note overlay and table show every proposed pitch and timing. **Observed pattern support** exposes the available counts and backoff. Small phrases often repeat, and **Another suggestion** can produce the same result.
3. **Audition ending + suggestion** plays that ending and its proposal solo, with the selected instrument and volume. Unmute or raise a zero-volume track, then regenerate if needed. Stop, Cancel or Discard prevents late rendering/resume callbacks from starting sound.
4. **Apply continuation** appends ordinary editable notes as one undoable change. **Discard suggestion** leaves the project untouched. Only applied notes enter autosave, project backups, MIDI and WAV. Editing the source, changing tracks/options, undo/redo or successfully replacing the project invalidates the proposal. Failed or canceled captures and project-file staging keep it.

Unapplied note fields remain drafts through redraws. Apply or explicitly **Discard note edits** before acting on a proposal. Invalid source-count text also remains visible for correction. Playback and proposal rendering never save a scratch composition.

The learner uses joint semitone-interval/duration/rest events with order-2, order-1 and unconditional occurrence-count backoff. Contextual orders need repeated observations; boundary filtering happens before weighted seeded sampling. It fits 7–63 transitions from your 8–64 selected notes, uses their median velocity, and adds at most 16 beats within the existing pitch, note-count and 512-beat bounds. If generation cannot complete the requested length, the whole request fails without source edits; it does not clamp pitches, invent notes or retry invisibly. It does not infer a key, harmony, preference or general personal style, and rejecting a suggestion does not train it. Musical novelty or quality has not been measured. There is no bundled music corpus, pretrained download or remote service.

## Timing and limits

The interface counts beats from **1**. Saved project JSON uses zero-based note starts: displayed beat 1 is `start: 0`, and displayed beat 2.5 is `start: 1.5`. Durations are in beats. Changing tempo changes playback speed while preserving the edited musical positions.

- Tempo: 40–240 BPM; 1–8 tracks; at most 256 notes per track.
- Pitches: MIDI 36–96 (C2–C7); note duration: 0.25–16 beats; note ends must be at or before internal beat 512.
- Velocity and track volume: 0–1. Zero velocity and muted tracks are silent.
- Capture/import: 20 seconds; audio file/blob limit: 10 MiB. The decoder allows a small duration tolerance for encoded recording tails; analysis processes at most 20 seconds.
- Complete project JSON: at most 12 MiB, including audio. The notes/reference document is bounded to 2 MiB, and each reference to 882,000 PCM bytes. Legacy notes-only input remains at most 1 MiB. Strict schemas, finite values, UTF-8, duplicate-key/depth checks, canonical base64 and PCM checksums reject malformed or incomplete backups before replacement. Old saved note values, including escaped text, remain reversible; ambiguous duplicate-key or deeply nested ignored-extension files are not accepted.

## Save and export

The complete current project autosaves to IndexedDB in one transaction containing its notes, reference bindings and audio. **Saved in this browser** appears only after that transaction completes. Rapid edits keep the newest pending complete save. A failed save leaves the in-memory project and Undo history usable; **Retry save** and **Save project file** remain available. Closing/reloading while a save is pending or failed, or while a changed note/field draft or continuation suggestion is unapplied, requests the browser’s leave-page warning where supported. Dismissing it keeps that work in memory. Apply/discard drafts and let saves complete before leaving normally. This never applies or autosaves draft values; project downloads still contain committed notes only. Browsers generally require prior interaction and may suppress warnings; forced termination is not protected. See [departure-guard evidence](docs/2026-10-08-draft-departure.md).

Browser storage belongs to that profile and site address; it can be cleared or become unavailable. Each tab saves only against the complete saved copy it last accepted or successfully wrote. If another tab saves first, the stale tab keeps its notes, reference audio, Undo history and unapplied fields, and pauses autosave. Download a complete backup before choosing **Retry load** to adopt the saved project or **Replace saved copy** to review and deliberately replace it. Replacement compares the reviewed copy again within its write transaction; another intervening save refuses the replacement. Cancelled or failed replacement keeps recovery protected. If you edit while replacement is pending, the newer local work stays unsaved until you explicitly choose **Retry save**.

There is no account backup or cloud synchronization. A successful read of an absent new database can recover the old notes-only localStorage project. Legacy saved copies remain untouched by reads; the next successful edit or explicit save retry writes the current saved-row format. Portable backup formats remain unchanged. A corrupt or unreadable complete project enters protected recovery without silently falling back or overwriting it. **Retry load** rereads it; **Replace saved copy** reviews a safely comparable saved descriptor and explicitly confirms overwriting it with the committed in-memory project. If the damaged record cannot be safely compared, replacement refuses and project-file recovery remains available. Download a backup before replacing or abandoning work.

**Save project file** downloads a complete `.melody.json` containing current committed notes and normalized reference PCM, with SHA-256 checksums. It excludes undo history, raw editor drafts, suggestions, comparison windows and original encoded recordings. Open it on another compatible browser with **Open project**; old Composition v1 notes-only files remain supported. Opening shows replacement counts and confirms discarding unapplied work. Canceled, invalid or stale file reads keep the current project and drafts. Checksums detect damaged bytes; they do not authenticate the supplied source metadata. Export complete backups regularly.

**Export MIDI** writes a standard format-1 `.mid` file with track names, tempo, note timing, velocity, volume, and approximate General MIDI instrument choices. Overlapping notes of the same pitch within one track merge into one sustained MIDI note at the highest velocity; adjacent notes retain separate attacks. This avoids ambiguous note-off behavior in MIDI players. The local WAV mix layers those notes independently. Another music app's instruments may sound different. **Export WAV** renders the current local instruments and mix as mono, 22,050 Hz, 16-bit PCM audio. Synthesis runs in a cancellable worker to keep large compositions responsive. Rendering refuses allocations above 40,000,000 Float32 frames before allocation; the browser’s 22,050 Hz output supports the full 512-beat song at every supported tempo. Public rendering helpers can refuse longer songs at unusually high sample rates rather than truncate them. Muted tracks are omitted from audible output. Audio transcription, reviewed MIDI phrase import and complete Melody project backups have separate import flows and limits.

## Solo and export individual tracks

**Solo track** auditions the selected committed part at the current composition tempo from song beat 1. Use the shared **Stop playback** control; natural completion makes Solo available again. **Export track WAV** downloads that part as `-track-N-name.wav`, with a numbered, sanitized track name. Select each desired track and export it separately to bring aligned synthesized parts into another music editor.

Both controls use a detached snapshot with every other track muted. Original note positions on all tracks remain in that snapshot so the output retains the full composition endpoint, including leading rests and trailing silence when this part ends early. Each mono 22,050 Hz WAV has the same song origin and frame count as the whole-song export. A muted, zero-volume or note-silent selected part refuses with guidance; unmute/raise its level before exporting.

Current instrument, track volume and note velocity apply. Reference audio and unapplied edits/reviews are excluded. Saved mixer settings, complete notes/reference bytes and Undo/Redo stay unchanged. Each part uses independent peak limiting, so exported stems are not guaranteed to sum numerically to the separately peak-limited whole mix. There is no automatic all-track ZIP, stereo pan, routing or effects in this milestone.

## Keep a library of complete compositions

Use **Saved compositions** to keep up to eight named copies in this browser. Choose **Refresh copies** to list them, enter a saved-copy label, then choose **Save new copy**. A copy includes the committed composition and all retained reference takes. Unapplied fields, MIDI review and continuation suggestions stay outside the copy. Labels are separate from composition titles; duplicate labels are allowed.

Current-workspace autosave remains separate. Saved copies change only when you explicitly choose **Update selected copy** and confirm replacing that copy. Refreshing or selecting a copy does not open it. **Open selected copy** reviews the complete backup and asks before replacing the workspace, including any scratch that would be discarded. It creates one Undo edit; existing audio-history limits and protected-autosave recovery still apply.

**Download selected copy** preserves the exact stored complete-backup bytes. Keep portable backups outside the browser before clearing site data. If a safely bounded copy is damaged, downloading its original bytes remains available while Open is refused. Updating or deleting it still requires explicit confirmation. Invalid catalog metadata protects the library from writes instead of clearing records.

Each copy uses the existing 12 MiB backup bound, eight tracks, 256 notes per track and up to eight 20-second reference takes. The library allows at most 96 MiB of backup payload plus bounded metadata. Browser storage capacity may be lower. A failed, cancelled or conflicting mutation requires **Refresh copies** before another attempt; it is never replayed automatically. Operations have a ten-second deadline, but native browser storage work must finish draining before another operation is admitted. Cancellation cannot undo a transaction that already committed.

## Browser requirements and accuracy

Microphone capture requires a secure context (localhost or HTTPS), explicit browser permission, `getUserMedia`, and `MediaRecorder`. Playback and audio decoding require Web Audio; transcription uses a Web Worker. Supported import formats depend on the browser's codecs. If microphone access is denied or unavailable, use imported audio, manually added notes, or the generated demo. Downloads, IndexedDB and Web Crypto must also be permitted by the browser. If storage is unavailable, complete project downloads preserve your in-memory work.

Chromium is the browser verification target. Safari, Firefox, and mobile device recording/codec behavior need separate real-device evaluation; a narrow Chromium viewport does not establish mobile browser compatibility.

Pitch detection is for a **single pitched voice or instrument**, not chords, full songs, or polyphonic separation. Background noise, breath, vibrato, harmonics, and unclear note boundaries can cause missed notes, octave mistakes, or inaccurate timing. Listen back and correct the result. Tests and the generated demo use synthetic audio; they demonstrate deterministic detection behavior and do **not** measure real humming/singing accuracy. Real microphone evaluation and broader generative arrangement assistance remain outstanding; the bounded continuation learner does not resolve those limits.

## Verification

```sh
npm run test
npm run lint
npm run typecheck
npm run build
npm run test:browser
```

`npm run check` runs unit tests, lint, and the build (which includes type checking). Browser tests run separately, build the production assets, and start their own preview server on port 4174. Set `MELODY_TEST_PORT` to use another free loopback port. Their build enables storage, composition-library and real AudioWorklet test pages through `MELODY_TEST_HARNESS=1`; ordinary `npm run build` omits those pages. Install Playwright's Chromium if needed:

```sh
npx playwright install chromium
npm run test:browser
```

Alternatively, point Playwright at an existing Chromium executable:

```sh
CHROMIUM_PATH=/path/to/chromium npm run test:browser
```

Unit coverage includes bounded project validation, local storage errors, recorder cleanup/cancellation, synthetic pitch and timing fixtures, synthesis, and MIDI/WAV structure. Browser coverage exercises composition editing, layering, playback, persistence, imports/exports, generated-audio transcription, permission failure, and a 390 px layout. These checks do not replace real vocal or device testing.

Direct piano-roll authoring ([#99](https://github.com/twangyal/projects-monorepo/issues/99))
passes **252 unit tests**, lint/typecheck/build and **80 distinct native browser
cases** locally, including 22 new gesture, keyboard, touch, recovery and export
cases. Actual mobile feedback movement and minimum-note handle conflicts were
reproduced and repaired without changing the frozen geometry checks. Independent
fractional/polyphonic exports retain exact reference PCM, expected 480-PPQN MIDI
events and synthesized WAV samples (zero measured error at 1,091 sampled positions
against a fixed two-PCM16-unit tolerance).

A separate original fixture retains **2,048 notes and eight 20-second references**
(7,056,000 PCM bytes). Native move and resize each make one Undo/Redo edit; all
unrelated notes and audio remain unchanged. Its **9,580,720-byte** final project
survives closing and relaunching the full browser process byte-for-byte. Actual
MIDI has the independently expected pitch72 attack/release at ticks302/542. The
707,364-frame WAV has the exact expected silence/onset bounds; measured pitch is
523.251144 Hz versus 523.251131 Hz expected, and RMS differs by 0.061%. This is
maximum count/reference topology, not the file-size ceiling or a memory benchmark.

With a normal production preview already running, reproduce the separate probe:

```sh
MELODY_ROLL_BASE_URL=http://127.0.0.1:4173 CHROMIUM_PATH=/usr/bin/chromium \
  node scripts/smoke_direct_roll.mjs
```

`MELODY_ROLL_OUTPUT` can name a new output directory; `--fixtures-only` prepares
the original inputs without a browser. The runner starts no server and imports no
producer expected-output helpers. [Integration evidence](docs/2026-10-04-direct-roll-verification.json),
[native evidence](docs/2026-10-04-direct-roll-native.json) and
[maximum evidence](docs/2026-10-04-direct-roll-maximum.json) preserve exact hashes,
failed attempts, targeted reruns and limits. Both [push](https://github.com/twangyal/projects-monorepo/actions/runs/37221137451)
and [PR](https://github.com/twangyal/projects-monorepo/actions/runs/37221140459) CI
at `d582c0dd7286992bfb8fea47918cede209a34c44` pass all **252 units and 80 native
browser cases**, lint, type checking and build on Chromium153. The [CI receipt](docs/2026-10-04-direct-roll-ci.json)
records exact checkouts and the separate Shot import-readiness test failure found
by the broader run; twelve of thirteen project workflows passed at that head.

### Saved-copy conflict verification

Issue [#98](https://github.com/twangyal/projects-monorepo/issues/98) passes **255
unit tests and 97 distinct native browser cases**, lint, type checking and build.
The three original two-tab regressions failed on the published baseline and now
pass unchanged. Five additional UI races and nine independent genuine IndexedDB
cases cover competing complete writes, private receipt ownership, legacy read-only
behavior, actual transaction abort after request success, deliberate replacement,
newer raw/committed edits and exact PCM retention. The prior suite exposed a startup
lifecycle regression; its targeted repair keeps editing blocked until the native
read settles, then requires explicit Retry load for retired publication authority.

A separate original maximum probe retains 2,048 notes and eight 20-second
references (7,056,000 PCM bytes) in each of two distinct complete projects. A stale
tab's direct roll edit cannot alter any of the other tab's eight newer PCM assets.
Its complete local backup remains available; cancelling replacement preserves both
copies. Reviewed replacement and a complete browser-process restart preserve the
chosen **9,580,700-byte** backup exactly, including all notes and audio. This reaches
maximum note/reference topology, not the 12 MiB input ceiling or peak memory. The
actual first run passed in 10.323 seconds on Chromium151 without external requests
or page errors. Reproduce against a separately running ordinary production app:

```sh
CHROMIUM_PATH=/usr/bin/chromium MELODY_CONFLICT_BASE_URL=http://127.0.0.1:4174 \
  node scripts/smoke_save_conflicts.mjs
```

Use `MELODY_CONFLICT_OUTPUT` for a new output directory or `--fixtures-only` to
freeze original inputs without launching a browser. The runner never builds,
starts a server, writes IndexedDB directly, or imports product serializers.
[Integration evidence](docs/2026-10-04-saved-copy-conflicts-verification.json),
[UI evidence](docs/2026-10-04-saved-copy-conflicts-native.json),
[transaction evidence](docs/2026-10-04-saved-copy-conflicts-storage.json) and
[maximum evidence](docs/2026-10-04-saved-copy-conflicts-maximum.json) preserve exact
hashes and failed attempts. The prior direct-editor CI's [premature save assertion](docs/2026-10-04-direct-roll-retry-ci-first.json)
now requires exact successful status before reload; musical and PCM expectations
are unchanged. Both [push](https://github.com/twangyal/projects-monorepo/actions/runs/37223103033)
and [PR](https://github.com/twangyal/projects-monorepo/actions/runs/37223106786) CI
at `e856e3bf1845716cb176cee136d31315e444effd` pass all **255 units and 97 browser
cases**, lint, type checking and build on Chromium153. All thirteen project PR
workflows pass. The [exact CI receipt](docs/2026-10-04-saved-copy-conflicts-ci.json)
records separate branch-head and synthetic-merge checkouts.

### Learned-continuation verification

Issue [#42](https://github.com/twangyal/projects-monorepo/issues/42) adds 19 engine cases and 11 independently derived numerical cases. The complete suite passes **113 unit tests and 20 production Chromium cases**, plus lint, type checking and build. Hand-worked token/count/backoff and PRNG boundary cases verify learned data dependence, exact constraints and atomic application. Real worker/Web Audio checks cover transient proposals, delayed replies/resume, stale source callbacks, preserved drafts, undo/redo, native reopen, mute/volume behavior and independently decoded downloaded MIDI/WAV.

A separate Chromium 151 run selected a 16-beat original ending and generated an eight-note, 16-beat continuation at 40 BPM. The actual solo audition contained 1,060,164 frames at 22,050 Hz: **48.08 seconds including the release tail**. After Apply, a 2,649,572-byte WAV retained the original leading timing and unrelated track; independent Python PCM/FFT checks matched nine sampled note frequencies across audition and export within 0.053%. The original notes and unrelated track were unchanged, JSON/native reopen matched, and the 390-pixel layout had no page overflow or external requests/errors. These are fixture/runtime measurements, not subjective listening or musical-quality evidence. The [Melody workflow](https://github.com/twangyal/projects-monorepo/actions/runs/37173453233) passed at `e4472fb6e7ee891460f7649100c5b850ef301d7f`. See [the verification record](docs/2026-10-04-learned-continuation-verification.json).

### Reviewed MIDI import verification

Issue [#60](https://github.com/twangyal/projects-monorepo/issues/60) expands the suite to **173 unit tests and 35 production Chromium cases**, with lint, type checking and build passing. The new cases cover strict bytes and channel state, independent timing/count oracles, stale or mutated reviews, raw editor drafts, delayed native File reads, explicit replacement, Undo/Redo, storage failure and real downloaded artifacts. The existing 20 browser cases remain unchanged.

An independent Chromium 151 probe imported an original off-grid phrase through the normal file chooser and review, then decoded its native JSON/MIDI/WAV downloads. Source starts became beats 0.13 and 2.13; the exported MIDI contained the expected 480-PPQN rounded ticks, CC7 volume and distinct velocities. The 36,273-frame WAV had exact leading/internal silence and independently measured note frequencies within one 5.383 Hz FFT bin, with RMS errors below 0.04%. This checks local synthesized output, not the source instrument's sound.

A separate exact **1 MiB** source imported all **8 × 256 notes**. Its native downloads were 397,322-byte JSON, 16,766-byte MIDI and 2,820,460-byte WAV (1,410,208 frames). Closing and relaunching the entire persistent Chromium process preserved the same project ID and byte-identical JSON without storage injection. Desktop and 390-pixel views had no horizontal overflow; no page errors or external requests were observed. See the [measured verification record](docs/2026-10-04-midi-import-verification.json) for hashes, thresholds, test history and limitations.

The complete implementation passed all twelve repository workflows at `e281bb869fef1ebb284709ca66952c4cabd748f0`; [Melody CI](https://github.com/twangyal/projects-monorepo/actions/runs/37186726359) passed 173 unit and 35 browser cases. To reproduce the separate independent artifact check, start a production preview and run:

```sh
MELODY_MIDI_BASE_URL=http://127.0.0.1:4239 CHROMIUM_PATH=/usr/bin/chromium node scripts/smoke_midi_import.mjs
```

Use the origin of your running preview. Omit `CHROMIUM_PATH` to use Playwright's installed Chromium. The script creates its own original sources, browser profile and retained artifacts in a new temporary directory; optional `MELODY_MIDI_OUTPUT` must name a new directory. It never rebuilds or starts the server. `--prepare-only` writes the original source fixtures without a browser.

## Retained reference verification (2026-10-04)

All twelve repository workflows passed the complete v0.4 implementation at `6169ade9a15fcb412223326e95fad3c565615392`; [Melody CI](https://github.com/twangyal/projects-monorepo/actions/runs/37197627280) passed 233 unit cases and 58 native Chromium 153 cases (40.4 seconds), plus lint, type checking and build.

Issue [#66](https://github.com/twangyal/projects-monorepo/issues/66) passes **233 unit tests and all 58 production Chromium cases**, including the previous 35 flows, with lint, type checking and build. Independent literal PCM, complete-file, history-budget and analytic synthesis checks complement genuine native decoding, MediaRecorder, workers, audio buffers and IndexedDB transactions. Native failures covered request-success followed by transaction abort, rapid edits while real writes were held, corrupted audio, protected recovery, canceled work, stale callbacks, startup cancellation and first-click/focus preservation. Existing test adaptations read the real new durable backend and validate the complete backup envelope; original musical assertions remain.

A separate original eight-take maximum fixture retained **7,056,000 PCM bytes** in a **9,412,621-byte complete backup**, identical after normal file import, download, reopen and full persistent-browser process restart. A 2,205-frame reference window matched every stored sample; the edited-note window at captured 40 BPM, with current tempo 120 BPM, matched an independently derived full-track limiter calculation within 4.30 × 10⁻⁸. Later loud notes outside the window still affected that limiter. A window beyond the solo's release contained exactly 2,205 zero samples. Ordinary exports retained current-tempo synthesized notes without mixing the reference.

Original 44.1/48 kHz source WAVs containing 440/1,000 Hz tones, DC and impulses passed fixed numerical thresholds. This Chromium runtime decoded both input rates at 44.1 kHz; those measurements do not separately establish 48 kHz decoded-input conversion. Maximum measured pitch error was 0.000131 Hz, relative RMS error 0.0078%, DC error below one PCM16 step and impulse position error zero frames. These synthetic results do not measure vocal accuracy or real-device compatibility. The prior exact 1 MiB MIDI probe also passed with its original source bytes and unchanged signal/timing assertions, including all 2,048 notes after a full browser restart.

See the [complete reference verification record](docs/2026-10-04-reference-takes-verification.json) for exact measurements, source hashes, regression history and limitations. To reproduce the independent reference artifact gate against your own running production preview:

```sh
MELODY_REFERENCE_BASE_URL=http://127.0.0.1:54083 CHROMIUM_PATH=/usr/bin/chromium node scripts/smoke_reference_takes.mjs
```

The script creates original fixtures and retains native downloads, audio buffers, screenshots and its report in a fresh output directory. Set `MELODY_REFERENCE_OUTPUT_DIR` to a new directory if desired. It neither starts a server nor imports product serializers/renderers.

## Record-with-backing acceptance (#113)

The complete local check passes **301 unit tests**, ESLint, type checking and production build. Independent direct AudioWorklet cases verify actual 44.1/48 kHz frame intersections, delayed Finish trimming, silent output, cancellation, topology/missing-input refusal and bounded progress. Editor cases verify real microphone-stream capture, frozen target-excluded backing, raw drafts/suggestions, count-in cancellation, complete reference Undo/Redo, silence refusal, saved-copy conflict and actual MIDI/WAV exports. The [implementation receipt](docs/2026-10-04-backed-recording-verification.json) links producer, independent oracle, native and review evidence.

The first combined native run passed 14/19 cases. Five editor cases exposed a real startup issue: Chromium can skip render quanta before arming the recorder, while channel topology remains unchanged. Preparation now accepts monotonic nonoverlapping forward gaps; armed count-in/capture still requires contiguous frames. All five original failing cases pass unchanged. A separate completion regression checks the deadline again after bounded sample validation/copy. The reviewed [design](../../docs/superpowers/specs/2026-10-04-melody-backed-recording-design.md) documents these ownership and timing boundaries.

The independent maximum starts with **eight tracks, 2,048 notes and eight 20-second reference takes** in a frozen **9,562,719-byte** complete backup. An actual automatic 20-second take replaces only the selected track, producing three independently checked notes at the expected beats. Seven other tracks and reference assets remain exact. One Undo restores the complete original bytes; Redo and a complete Chromium process restart retain the exact captured backup. Independent checks cover four count-in clicks, the actual target-excluded backing, retained microphone PCM, all MIDI tracks/ticks and the synthesized WAV. Backing error is below 0.011 signed-16 units and WAV error is at most one unit against a separately authored sine/envelope/whole-mix oracle. Capture-to-saved took 22.904 seconds; the complete successful run took 29.838 seconds on this fixture and machine.

The first maximum run correctly captured stereo browser-graph metadata from the authored mono input. Its runner incorrectly expected one graph channel; actual MediaStream settings establish two. Only that expectation was corrected, with the original failure and downloads retained. Original audio, timing, amplitude and numerical tolerances are unchanged. Synthetic MediaStream buffering/resampling and these measurements do not establish physical microphone latency, vocal accuracy, arbitrary browser compatibility or peak memory. See [maximum evidence](docs/2026-10-04-backed-recording-maximum.json).

To reproduce the independent maximum using fresh directories and a normal production build:

```sh
npm run build
npm run preview -- --port 4308 --strictPort
# In another terminal, from this project directory:
node scripts/create_backed_recording_fixtures.mjs /tmp/melody-backed-fixtures
MELODY_BACKED_BASE_URL=http://127.0.0.1:4308 \
  MELODY_BACKED_FIXTURE_DIR=/tmp/melody-backed-fixtures \
  MELODY_BACKED_OUTPUT_DIR=/tmp/melody-backed-acceptance \
  CHROMIUM_PATH=/path/to/chromium node scripts/smoke_backed_recording.mjs
```

The generator reproduces the original input hash without production imports. Existing output directories are refused. The runner uses its own browser profile and closes its own processes; it expects you to start and stop the preview server. Local acceptance covers all **116 distinct browser cases**: the first full invocation passed 115/116, including all 19 new cases. The remaining pre-existing stale-tab test set a File while startup still disabled importing. Its helper now waits for the actual enabled control; the original case then passes with every storage, reference, history assertion and timeout unchanged. This is staged passing coverage, not a claim of one final all-green local invocation. The [readiness receipt](docs/2026-10-04-backed-recording-readiness.json) retains exact first trace timestamps and the focused pass. Both the [push](https://github.com/twangyal/projects-monorepo/actions/runs/37241975731) and [PR](https://github.com/twangyal/projects-monorepo/actions/runs/37241977979) at `b96cdfd389ba9a7145089aa42319cfc3e1ccfd3d` pass all **301 units and 116 native cases**, with lint, type checking and production build. All thirteen project PR workflows pass. The [CI receipt](docs/2026-10-04-backed-recording-ci.json) verifies that the actual PR checkout tree matches the published implementation.

## Composition-library acceptance (#126)

The v0.7 library passes **315 unit tests and all 138 native Chromium cases**, plus lint, type checking and production build. Independent native cases cover exact bytes, eight-copy races, stale revisions, corrupt recovery, raw fields/caret/MIDI/proposals, native rollback, the real ten-second deadline, cancellation before and after native commit, pending microphone cleanup, protected current storage and full browser restart. The [verification receipt](docs/2026-10-05-composition-library-verification.json) preserves first failures and corrections. The new status region required scoping older editor-notice assertions; their expected text and deadlines remain unchanged. Both first [push](https://github.com/twangyal/projects-monorepo/actions/runs/37272014006) and [PR](https://github.com/twangyal/projects-monorepo/actions/runs/37272019924) CI at `568e29df01f9a454d6436cca0f544466357f6963` pass all315units and138native cases with lint/type/build. The actual PR checkout has the identical implementation tree, and all thirteen project PR workflows succeed. The [CI receipt](docs/2026-10-05-composition-library-ci.json) retains run IDs, exact checkouts and log hashes.

The independent maximum retained **eight compositions, 16,384 notes and 64 distinct twenty-second references**. Initial stored backups total **76,700,576 bytes**; one explicit replacement changes that to **76,700,584 bytes**. All eight exact copies reopen after the original browser process terminates. Seventeen downloaded backups match original bytes; Refresh reads only bounded metadata and Blob handles. Selected reopened MIDI matches original pitches/ticks, and synthesized WAV matches an independent scalar oracle within one signed-16 unit, with exact silence and measured 440/523.25 Hz tones. Parser admission at exactly 12 MiB and refusal one byte above are separate from musical capacity. See the [maximum receipt](docs/2026-10-05-composition-library-maximum.json).

To reproduce the maximum, start an ordinary production preview and use fresh fixture/output directories:

```sh
node scripts/smoke_library.mjs --prepare-only /tmp/melody-library-originals
MELODY_LIBRARY_BASE_URL=http://127.0.0.1:4173 \
MELODY_LIBRARY_FIXTURE_DIR=/tmp/melody-library-originals \
MELODY_LIBRARY_OUTPUT_DIR=/tmp/melody-library-result \
CHROMIUM_PATH=/usr/bin/chromium node scripts/smoke_library.mjs
```

The runner owns its two browser processes, requires fresh directories and retains first results; it does not start or stop the preview server. Allow 768 MiB of free disk for fixtures, downloads and browser storage. Its 240-second deadline and payload bounds are limits, not a measured peak-memory guarantee.

## Phrase dynamics

Choose a section range (one-based beats, end exclusive), select a track, then enter start/end velocities from 0 to 1 under **Shape a crescendo** and Apply. The first and last distinct note onsets receive the exact endpoints; intermediate onsets interpolate by musical time, and simultaneous chord notes share a velocity. Notes crossing a boundary remain whole; membership uses the onset. Other tracks, timing, sound settings and retained references are unchanged. Zero velocity is silent and omitted from MIDI. Empty and single-onset selections refuse without changing the project.

The range and ramp parameters are session-only; Apply produces one Undo/Redo step and autosaves the resulting notes. Apply guards unapplied fields, continuation suggestions and active piano-roll edits before pointer blur and click activation. Ordinary focus transfer still follows the editor's existing valid-field commit behavior. Native tests verify actual project downloads, MIDI velocities, independent PCM amplitude, Undo/Redo, IndexedDB reload, invalid-input refusal and 390px draft protection. See [verification evidence](docs/2026-10-08-velocity-ramp.md).
