# Melody Studio

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
- Up to sixteen source channel parts are shown; choose 1–8 supported parts with 1–256 included notes each in a window of at most 128 beats. Different-pitch polyphony is supported. Shared channels across raw tracks, ambiguous same-pitch pairing, percussion, pitch bend, pressure and unsupported controllers are visible but unselectable.
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

The learner uses joint semitone-interval/duration/rest events with order-2, order-1 and unconditional occurrence-count backoff. Contextual orders need repeated observations; boundary filtering happens before weighted seeded sampling. It fits 7–63 transitions from your 8–64 selected notes, uses their median velocity, and adds at most 16 beats within the existing pitch, note-count and 128-beat bounds. If generation cannot complete the requested length, the whole request fails without source edits; it does not clamp pitches, invent notes or retry invisibly. It does not infer a key, harmony, preference or general personal style, and rejecting a suggestion does not train it. Musical novelty or quality has not been measured. There is no bundled music corpus, pretrained download or remote service.

## Timing and limits

The interface counts beats from **1**. Saved project JSON uses zero-based note starts: displayed beat 1 is `start: 0`, and displayed beat 2.5 is `start: 1.5`. Durations are in beats. Changing tempo changes playback speed while preserving the edited musical positions.

- Tempo: 40–240 BPM; 1–8 tracks; at most 256 notes per track.
- Pitches: MIDI 36–96 (C2–C7); note duration: 0.25–16 beats; note ends must be at or before internal beat 128.
- Velocity and track volume: 0–1. Zero velocity and muted tracks are silent.
- Capture/import: 20 seconds; audio file/blob limit: 10 MiB. The decoder allows a small duration tolerance for encoded recording tails; analysis processes at most 20 seconds.
- Complete project JSON: at most 12 MiB, including audio. The notes/reference document is bounded to 2 MiB, and each reference to 882,000 PCM bytes. Legacy notes-only input remains at most 1 MiB. Strict schemas, finite values, UTF-8, duplicate-key/depth checks, canonical base64 and PCM checksums reject malformed or incomplete backups before replacement. Old saved note values, including escaped text, remain reversible; ambiguous duplicate-key or deeply nested ignored-extension files are not accepted.

## Save and export

The complete current project autosaves to IndexedDB in one transaction containing its notes, reference bindings and audio. **Saved in this browser** appears only after that transaction completes. Rapid edits keep the newest pending complete save. A failed save leaves the in-memory project and Undo history usable; **Retry save** and **Save project file** remain available. Closing while a save is pending or failed triggers the browser's unsaved-work protection where supported.

Browser storage belongs to that profile and site address; it can be cleared or become unavailable. Each tab saves only against the complete saved copy it last accepted or successfully wrote. If another tab saves first, the stale tab keeps its notes, reference audio, Undo history and unapplied fields, and pauses autosave. Download a complete backup before choosing **Retry load** to adopt the saved project or **Replace saved copy** to review and deliberately replace it. Replacement compares the reviewed copy again within its write transaction; another intervening save refuses the replacement. Cancelled or failed replacement keeps recovery protected. If you edit while replacement is pending, the newer local work stays unsaved until you explicitly choose **Retry save**.

There is no account backup or cloud synchronization. A successful read of an absent new database can recover the old notes-only localStorage project. Legacy saved copies remain untouched by reads; the next successful edit or explicit save retry writes the current saved-row format. Portable backup formats remain unchanged. A corrupt or unreadable complete project enters protected recovery without silently falling back or overwriting it. **Retry load** rereads it; **Replace saved copy** reviews a safely comparable saved descriptor and explicitly confirms overwriting it with the committed in-memory project. If the damaged record cannot be safely compared, replacement refuses and project-file recovery remains available. Download a backup before replacing or abandoning work.

**Save project file** downloads a complete `.melody.json` containing current committed notes and normalized reference PCM, with SHA-256 checksums. It excludes undo history, raw editor drafts, suggestions, comparison windows and original encoded recordings. Open it on another compatible browser with **Open project**; old Composition v1 notes-only files remain supported. Opening shows replacement counts and confirms discarding unapplied work. Canceled, invalid or stale file reads keep the current project and drafts. Checksums detect damaged bytes; they do not authenticate the supplied source metadata. Export complete backups regularly.

**Export MIDI** writes a standard format-1 `.mid` file with track names, tempo, note timing, velocity, volume, and approximate General MIDI instrument choices. Overlapping notes of the same pitch within one track merge into one sustained MIDI note at the highest velocity; adjacent notes retain separate attacks. This avoids ambiguous note-off behavior in MIDI players. The local WAV mix layers those notes independently. Another music app's instruments may sound different. **Export WAV** renders the current local instruments and mix as mono, 22,050 Hz, 16-bit PCM audio. Synthesis runs in a cancellable worker to keep large compositions responsive. Muted tracks are omitted from audible output. Audio transcription, reviewed MIDI phrase import and complete Melody project backups have separate import flows and limits.

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

`npm run check` runs unit tests, lint, and the build (which includes type checking). Browser tests run separately, build the production assets, and start their own preview server on port 4174. Their build enables a constructor-only storage test page through `MELODY_TEST_HARNESS=1`; ordinary `npm run build` omits that page. Install Playwright's Chromium if needed:

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
