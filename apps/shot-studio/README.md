# Shot Studio

A local 3D filmmaking sketchbook for idea #7. Stage two block characters in a
courtyard, choose looping actions or author timed movement, visibility and action cues, adjust lighting, compose static or
traveling cameras, rehearse or scrub the shot list, retain alternate recorded takes, assemble copied scenes into editable sequences, add a local sequence soundtrack, and export WebM films. Native browser
JavaScript/WebGL: no accounts, external assets, services or paid APIs.

## Run

Requirements: Python 3 and a modern WebGL-capable browser. From this directory:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open http://127.0.0.1:4173. No npm install is needed to run. Drafts are scoped to
the browser origin/port; **Save project** downloads a JSON backup. Invalid backups
preserve the scene; failed storage reports an error. An unreadable or failed-read startup
draft blocks all automatic writes while you work in memory. **Download unreadable draft**
exports a recovery JSON envelope whose `raw` string retains the exact saved contents;
this is not a normal project backup. When reading is denied, a recovery download is
unavailable. Save your current project before reload or replacement. **Replace browser
draft** asks for confirmation and enables autosave only after a successful write;
cancellation or failure preserves the old record. Reloading preserves the
film, not the current playhead, selected camera endpoint, performer or cue.

New saves use schema 3. Genuine schema-1 static films and schema-2 camera-travel
films migrate to explicit looping performers without changing their existing
composition or animation formulas. Loading an old draft does not write storage;
the next valid edit or explicit draft replacement writes schema 3. Older readers
reject this version rather than silently dropping performer blocking. Unknown
fields, unsupported versions, camera-travel fields in schema 1 and new performer
fields in schema 1/2 are rejected and retain raw recovery.

Typing into scene settings while a project file is still opening cancels that
pending replacement, even before blur commits the edit. The exact focused draft
and existing saved film are retained; open the backup again when you intend to
replace them. Typing alone does not commit an edit or create a history entry. An unfinished or
invalid form stays visible, including raw coordinates that would create an unsafe
camera path. Correct it or confirm **Discard unsent edits** before changing the
selected performer/cue/shot/endpoint or using actions that would replace or encode it.
Opening another project also waits for this choice. Scrubbing previews the committed
film; **Save project** downloads that committed film, not unsent fields. Leaving the
page warns about unsent edits and pending imports; raw form input is not autosaved.

## Workflow and limits

Select a performer, edit position/costume/action, adjust lighting. Compose a shot
with a preset or numeric camera/target controls. Name/time it, add/select/remove
shots, move the selected shot earlier/later, then rehearse or scrub the cut.

Choose **Authored blocking** under **Performer motion** to give the selected
performer a global film timeline. Conversion begins with a visible cue at 0 seconds,
using the looping base position/action. Costume and name apply to the whole performer.

- Scrub the committed film and choose **Add cue at preview**. The new cue captures
  that time's evaluated position, action and visibility; its action phase restarts.
  Each performer supports 1–32 unique, strictly ordered cues within the film.
- Select a cue to edit its time, X/Z position, action and **Performer visible**.
  Edits commit on change/blur and are reversible. The first cue stays at 0 and
  cannot be removed. Retiming sorts the cues while retaining the edited selection.
- Selecting a cue only changes the editing target. **Preview cue** stops rehearsal
  and shows that exact global time with the film camera. A cue on a shot cut uses
  the next shot. Camera endpoint previews still evaluate performers at global time.
- Positions interpolate linearly between cues; equal positions hold still.
  Visibility and actions change exactly at the next cue, with no fading. Wave/walk
  limb phase restarts at every cue, even when the action name is unchanged. **Walk
  in place** animates limbs without adding the looping mode's sinusoidal pacing.
  After the last cue, position/action/visibility remain in effect through film end;
  limb animation continues from that cue. Performers keep their fixed facing.
- Shortening/removing shots cannot silently discard later cues: first move or
  remove those cues. Reordering shots leaves cue times unchanged. A close-up camera
  preset targets the selected editing cue, as labeled, rather than the current
  preview position.
- Switching back to **Looping performance** keeps the first cue's position/action.
  Discarding other cues or hidden state asks for confirmation; Undo restores the
  committed blocking. Unsent form edits still need correction or explicit discard.

Choose **Linear travel** under **Camera motion**, then choose **Start** or **End**
under **Editing endpoint** and edit its camera position and look target. Travel
starts with identical endpoints, so selecting the mode preserves the picture. Eye
and target move linearly over the shot duration; field of view stays fixed for the
whole shot. Presets replace the selected endpoint and the shot-wide lens.
**Copy other endpoint** copies its position/target, and **Use current preview**
captures the evaluated view when it belongs to the selected shot.

**Preview endpoint** explicitly shows the selected Start or End. At a hard cut, an
End preview still shows that shot; scrubbing the same exact time shows the next
shot in the film. The labels distinguish the editing endpoint from the displayed
view. Choosing an editing endpoint alone does not move the preview. Rehearsing
from an endpoint starts at that shot’s Start and continues through the film.
Switching back to Static keeps Start; discarding a different End asks for
confirmation and can be undone.
Undo scene / Redo scene restores up to 30 prior valid scene states in this session,
including edits, sequencing and imports. Invalid/identical edits preserve redo; a
new edit after undo clears it. Reload keeps the draft but starts fresh history.
History and sequencing controls are locked during recording and immersive sessions. Export WebM with authored 30 fps timestamps while keeping the
tab visible. Cancel drains native encoders and closes every input sample. Unsupported encoders
give guidance to save a project instead.

One courtyard, two block performers, 1–20 shots, 1–15 seconds each, **60 seconds
total**. Backups are limited to **64 KiB** with bounded names, positions, angles
and enum values. Cues use global film time rather than restarting at camera cuts.
Imports never execute code or fetch media. Hard cuts; looping performances
use continuous film time. WebM is silent at 960 × 540, authored 30 fps, with a
browser-selected VP9/VP8 encoder. Exact timing/dropped frames depend on hardware.
Travel validates the entire path against coincident or vertical look directions,
not only its endpoints. Eye/target coordinates stay within ±15, Y is at least 0.3,
eye–target separation is at least 0.3 and horizontal separation at least 0.1; FOV
is 25–80 degrees. Boundary decisions use JavaScript’s represented numbers. These
limits do not prevent moving through set geometry or performers. No easing, roll,
animated lens, transitions between shots, scene audio, skeletal assets, dialogue,
generative animation, recorded-clip splicing or immersive video export yet.

## Retained takes

The take notebook pairs an actual recording with the exact editable film captured
when recording began. Finish or explicitly discard unsent scene fields, enter a
**Take name**, then choose **Record take**. Keep the tab visible until recording
and saving finish. Keep four takes, each with a WebM of at most **32 MiB**, plus
its bounded film and metadata. Encoding bounds actual container writes and stops
if that limit is exceeded; requested bitrate is not a size guarantee. Direct
**Export WebM** remains available with the same bound.

Select a saved take to **Play recording**, **Restart recording**, or **Stop
recording playback**. Playback leaves the current scene and unsent fields intact.
Renaming changes its notebook label, not the captured film title. Deleting asks
for confirmation and removes a take only after storage completes. Take deletion
is not scene Undo.

**Open editable film** asks before restoring the captured film. Correct or
explicitly discard unsent scene edits first. Restore is one ordinary history
edit; Undo returns to the previous committed film. The retained take stays
available. Edit the film and record another take to compare an alternative. The
ordered shot list assembles authored camera cuts; the notebook does not splice
already recorded clips.

**Download take backup** saves one complete `.shot-take` file with the film,
metadata and exact WebM. **Import take backup** validates and appends under a new
local identity. It never replaces the current film or another take. Export each
take before deleting it or moving browsers. Ordinary **Save project** JSON holds
the current editable film only; it does not include this separate notebook.

The notebook uses IndexedDB on this browser origin/port, independently of the
protected scene draft in localStorage. Saved status requires a completed storage
transaction. A failed save retains the completed take in memory with **Retry
saving take**, a complete backup download and explicit discard. Download it
before leaving; unsaved recordings do not survive reload. An unreadable library
is protected and offers **Retry take library**, never silent replacement. A
change in another tab rejects a stale write; reload/review before retrying.
Browser data clearing or eviction can remove saved takes; keep portable backups.

A backup has a 16-byte header, at most 80 KiB of UTF-8 JSON manifest and 32 MiB
of WebM. Its film stays strict schema 3 within 64 KiB. Framing, field shapes,
Unicode, byte lengths and SHA-256 are checked. Imported film/video pairing and
timestamps are supplied and unverified; hashes prove integrity, not authorship
or correspondence. No external media is fetched. Bounded WebM-header checks
and an actual decoded 960×540 first frame establish basic playback admission,
not validity of every codec frame. Playback errors preserve bytes for backup.

Native recorder WebM may have unknown/infinite duration or lack seekable ranges.
**Restart recording** restarts actual media; arbitrary seeking is not promised.
Older recordings were silent at a requested 30 fps; dropped frames and timing
depend on the browser/hardware. Page departure cancels owned work and releases
video URLs. Late reads, hashing, decoding or saves cannot replace newer fields
or take selections. No upload, remote service, automatic eviction or destructive
library reset is included.

## Scene sequences

Use **Scene sequence** to assemble shots or trimmed excerpts from up to four complete copied
films. **Add current scene** copies your committed scene; **Import scene source**
opens an ordinary project backup. A saved take also offers **Copy editable scene
to sequence**. These are detached copies: later scene edits, take renames or take
deletion do not change them. Each source keeps both performers, costumes, light,
every original shot and all movement cues.

Choose a source shot, then **Add shot to sequence**. Select clips to rename,
reorder, repeat or remove them. Set **Clip In** and **Clip Out** in original-shot seconds,
then choose **Apply clip range** to keep an excerpt as one Undo edit. **Use whole
shot** restores that clip’s full original range. Repeat preserves the chosen range.
Rename sources without changing their films.
Remove a source after removing all clips that refer to it. Sequence Undo/Redo
retains up to 30 prior edits independently of scene history. Finish or explicitly
discard unsent sequence fields before actions that replace their contents; typing
alone does not save them. Correct invalid fields without losing their exact text.

**Rehearse sequence**, scrubbing and **Preview clip start/end** use the separate
sequence canvas. Every clip preserves its original source-film clock, including
later blocking cues and looping phases. A repeated shot repeats that source clock.
At a hard cut, scrubbing selects the next clip; explicit End preview still shows
the selected clip's exact Out camera. The interface displays both sequence and source
time. The ordinary scene remains separately editable.

**Save sequence** downloads the complete committed sequence. Without a soundtrack,
it remains a `.shot-sequence.json`; with audio, the `.shot-sequence` binary archive
includes exact original WAV bytes, soundtrack settings and every copied film.
**Open sequence** accepts both complete archives and older JSON backups. Opening
or starting a new sequence asks before replacement and remains reversible.
The inner editable sequence stays schema3 with explicit clip In/Out. Both genuine
schema1 forms and schema2 migrate to full-shot ranges without changing source
films. Loading an older browser draft never rewrites its saved bytes. Ordinary
scene schema3 and the separate silent-take archive remain independent.

Complete sequence documents save atomically in a separate IndexedDB record.
The scene panel and take notebook stay usable during sequence loading. A saved
status requires the complete transaction to finish for the current edit; a failed
save keeps the whole sequence and audio in memory for backup. If another tab
changes the saved record, stale writes refuse. Keep the preserved saved archive
and your current complete backup before **Replace saved sequence**: replacement
reviews the current record, asks for confirmation, and checks its exact bytes
again before writing. Cancellation and failures retain protection and raw fields.
Unsupported or unreadable storage never becomes an empty writable draft.

When no new complete record exists, the old localStorage sequence can be opened
without a write. Its first successful deliberate edit saves the complete new
record; the old text stays untouched. Changes made by an older tab protect the
new save until reviewed. IndexedDB transactions are atomic; the additional check
against legacy localStorage is not a transaction across both storage systems.
Browser eviction or clearing can still remove local drafts. Keep portable backups.

Limits are **4 sources, 20 clips and 60 seconds**, with each complete source film
at most 64 KiB and complete sequence input/output at most 320 KiB. The original
name-based schema1 input retains its 300 KiB limit. Titles/source labels allow 80
UTF-16 units; clip labels allow 40. Reordering uses an order-independent compensated
duration total, without rounding authored durations or widening the 60-second cap.
Original chronological cut/source boundaries retain represented-number arithmetic.

Each excerpt stays within its original shot and lasts at least 0.1 seconds.
Values are not snapped or rounded. The minimum applies to the actual represented
Out−In difference; an error shows that full value when decimal subtraction falls
just below the limit. Trim fields apply together only when you choose Apply.
Invalid or unfinished values remain visible; previews and backups keep the
committed range. A successful trim leaves complete source films unchanged, uses
the original camera travel and preserves performer cue/loop phases. There is no
speed change or restart of a performance at the trimmed beginning.

**Export sequence WebM** freshly renders the complete cut at authored 30 fps using the
existing 960×540 encoder and 32 MiB recording limit. Keep the tab visible; Cancel,
page departure, hiding the tab or graphics loss stops the owned export. Scene and
sequence recording cannot run together. The result downloads directly and is not
added to the ordinary take notebook. This is editable-scene rendering; recorded
media splicing, retiming and transitions are not included. A configured sequence
soundtrack is included in direct export; ordinary scene exports and retained takes
remain silent.

## Sequence soundtrack

Import one local **PCM16 WAV** into the sequence. Supported input is little-endian
RIFF/WAVE, mono or stereo at 44.1 or 48 kHz, **1–60 seconds** and at most **12 MiB**.
Compressed WAV, floating-point WAV, RF64 and other audio formats are refused with
conversion guidance. Valid ancillary WAV chunks stay in the exact retained file.
No upload, microphone capture, remote media or paid service is involved.

Set **In**, **Out**, **Start** and **Gain**, then apply them together. Source seconds
round once to the nearest sample frame; the displayed effective range must span
at least 0.1 seconds. Start is sequence time from 0 to 60 seconds; gain is 0–1.
Audio follows the assembled sequence clock across cuts, while copied performers
and cameras retain their original film clocks. It plays once without stretching,
looping or normalization. Any portion beyond the sequence end is visibly cropped;
an empty sequence or a start beyond the film can retain an inaudible soundtrack.
Editing clips never silently changes the audio settings or extends the film.

**Rehearse sequence** deliberately starts audio at the current sequence position.
Scrubbing and endpoint previews are silent. Stop, raw field input, selection,
editing, import, Undo/Redo, hidden tabs and page departure stop owned playback.
A soundtrack export requires an audiovisual WebM encoder and an available audio
context; unsupported browsers receive an error instead of a silent substitute.
Rendering and source scheduling share the audio clock. Native encoding and device
latency still depend on the browser and hardware; sample-exact muxing is not promised.

Import, adjustment and removal are ordinary single Undo edits. Complete history
shares immutable audio bytes and retains up to 30 prior states and **64 MiB of
unique WAVs**. A replacement that exceeds the audio budget refuses without changing
history; keep a complete backup, then deliberately clear sequence Undo history
if needed. No-op and invalid edits keep Redo. Reload starts fresh session history.

Portable audio sequences use a 16-byte framing header, at most **324 KiB** of
complete metadata and at most **12 MiB** of exact WAV, within a **16 MiB** file
limit. The embedded sequence keeps its separate 320 KiB limit. Lengths, framing,
strict metadata, full WAV structure and SHA-256 are checked before replacement.
Hashes establish byte integrity, not authorship or permission to use supplied audio.
The backup contains editable scenes and original soundtrack audio, not exported
video or the separate take notebook. Unapplied fields are visibly excluded.

## Experimental VR

**Enter VR** requests an `immersive-vr` WebXR session with a `local-floor` reference
space and renders tracked stereo headset views of the actual 3D stage. Select the
floor marker with a tracked controller to place the desktop-selected performer.
For blocking, this edits only the cue selected when entering VR, identified by its
exact cue time. The placement label identifies that fixed target while the
performer animates; no current/nearest cue is substituted. Other cues stay intact.
Squeeze a controller to capture the headset position and forward direction into
the endpoint selected on desktop when entering VR. Its other endpoint, name,
duration and lens stay unchanged. The whole resulting path must validate; a
rejected capture preserves the film. Exit VR to inspect that endpoint, undo or
refine the camera. Captured shots use a level world-up camera, so
headset roll is not reproduced and framing follows the existing lens rather
than the headset field of view. Straight up/down or out-of-bounds views and
missing tracking preserve the shot with guidance. Looping performers animate
continuously beyond film end. Blocking performers use the same evaluated film
poses and clamp at the final film time; headset
views do not rehearse the authored camera travel. Exit via
the headset/browser session control; desktop editing is available afterwards.

Requires supported hardware/browser and a secure context (HTTPS or trusted local
development); a LAN HTTP address is insufficient. No camera permission is requested.
Rejected/unavailable sessions retain desktop access; setup failures end accepted
sessions. Controlled tests **do not** establish device compatibility, comfort,
tracking quality or controller accuracy. Physical headset verification is outstanding;
desktop CI does not complete the intended VR directing experience. Reference:
[WebXR startup/shutdown](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Startup_and_shutdown).

## Verify

Node 22+. Domain/math and controlled lifecycle checks need no dependencies:

```sh
npm test
npm run check
```

Browser verification requires Chromium and FFprobe (FFmpeg):

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:browser
```

To use an installed Chromium or another free local test port:

```sh
CHROMIUM_PATH=/usr/bin/chromium SHOT_TEST_PORT=4282 npm run test:browser
```

Tests start their own server and refuse to reuse an occupied port.

CI checks real WebGL pixels, desktop/mobile controls, persistence, invalid imports,
unavailable VR and an actual WebM export decoded by FFprobe. Controlled unit checks
cover encoder failure/cancellation and XR unavailability/setup failure. Actual VR
requires a device. The pre-trimming suite contains **232 unit tests and 72 Chromium browser
checks**; current milestone verification is recorded below. Independent oracles include 18 camera/geometry cases and 14 performer
timing/migration cases. Native acceptance covers decoded camera and performer
motion against a separate pinhole projection, stationary controls, literal wave
pose envelopes, hidden intervals, strict migration, raw draft/import races,
controlled immersive camera/cue capture, reversible edits and exact preview cuts.
The workflow repeats these checks for subsequent edits.
CI screenshots were reviewed at desktop and mobile sizes. Page restoration is
covered using controlled page lifecycle events; physical headset tests remain outstanding.

`history.js` owns bounded scene history and shot ordering; `model.js` validates versioned snapshots/whole paths and evaluates cameras/cuts/performances; `math.js` owns column-major camera
transforms; `renderer.js` draws native WebGL; `xr.js` manages immersive views and
controller floor hits; `export.js` owns bounded recording/cleanup; `takes.js`, `take-archive.js`,
`take-video.js` and `take-store.js` validate, transfer and preserve the separate
notebook; `take-ui.js` owns its controls and playback. `app.js` manages DOM
state, local drafts and imports. `performer.js` owns standalone validated pose
evaluation; all renderer views use the same global-time performer adapter.

Draft recovery was verified on 2026-10-04 in [run 37172319440](https://github.com/twangyal/projects-monorepo/actions/runs/37172319440) on `cae7d16d09b011b60a0057895c705497116a08ba`: all 28 unit tests, syntax checks and nine production Chromium flows passed. The new regression failed before the fix. See [the verification record](docs/2026-10-04-draft-recovery-verification.json) and issue [#44](https://github.com/twangyal/projects-monorepo/issues/44).

Pending-import draft protection ([#57](https://github.com/twangyal/projects-monorepo/issues/57)) passed 28 unit tests, syntax checks and all twelve native browser cases locally on Chromium 151 and in [Chromium 153 CI](https://github.com/twangyal/projects-monorepo/actions/runs/37180331421) at `6eb2666`; all twelve project workflows passed. Two new regressions first reproduced lost text/numeric input, then passed without weakening the existing guards. They delay delivery of genuine native file bytes and verify focused raw spelling, unchanged saved film, later blur, ordinary import and Undo. This establishes the timing-dependent race, not its frequency on an ungated local file read. See [the measured repair evidence](docs/2026-10-04-import-draft-verification.json).

Camera travel ([#58](https://github.com/twangyal/projects-monorepo/issues/58)) passed all 65 unit tests, syntax checks and 29 browser cases on local Chromium 151 and [Chromium 153 CI](https://github.com/twangyal/projects-monorepo/actions/runs/37181949482) at `afb52c9`; all twelve project workflows passed. Independent math cases first failed against the old/stub model and passed unchanged. Actual four-second camera-only WebMs were decoded against a separate pinhole projection: local moving landmarks traveled 229–232 pixels, maximum projection error was 3.213 pixels, and static/identical-endpoint controls drifted at most 0.081 pixels. The frozen bounds were 16 pixels, 4 pixels and at least 180 pixels of motion respectively; these single-run measurements do not guarantee encoder timing on other hardware. Root inspected decoded frames, desktop/mobile views, native JSON and reload. See [the measured camera-travel evidence](docs/2026-10-04-camera-travel-verification.json).


Performer blocking ([#63](https://github.com/twangyal/projects-monorepo/issues/63))
passed 107 unit tests, syntax checks and 43 native browser cases on Chromium 151
and [Chromium 153 CI](https://github.com/twangyal/projects-monorepo/actions/runs/37190620562)
at `3624f7ebbf8d8e5211a742428d3fedd016ff612b`; all twelve project workflows passed.
The independent 14-case temporal oracle passed on its first actual run after
expectations were authored. Producer tests observed meaningful RED→GREEN. Genuine
legacy inputs and old camera thresholds remain intact; three initial old-browser
failures required schema3 output expectations, then the full suite passed.

An actual six-second performance exported to a 168,645-byte VP9 WebM with 173
decoded frames spanning 5.946 seconds of actual presentation timestamps. Separate
FFmpeg/Pillow inspection exactly reproduced the original color measurements:
maximum independent projection error 2.640 pixels, held-position drift 0,
stationary-control drift 0.0202, arrival 49.142 and departure 32.674 pixels, and
zero red costume pixels during the hidden interval. Frozen limits were 16 pixels
projection error, 4 pixels hold/control drift, at least 32/20 pixels of movement,
and at most 20 hidden red pixels. Literal wave-angle WebGL silhouettes differed by
24 pixels in width against a minimum16-pixel threshold. These are measured local
software results, not hardware or universal encoder guarantees. The
[blocking verification record](docs/2026-10-04-performer-blocking-verification.json)
retains hashes, exact fixtures, measurements, test history and limitations.


Retained takes ([#86](https://github.com/twangyal/projects-monorepo/issues/86))
pass all 146 unit cases, syntax checks and 53 distinct browser cases locally
(43 existing plus 10 new). Native checks cover actual opposite-moving recordings,
immutable snapshots, replay, restore/Undo, native storage abort/retry and cross-tab
conflict, protected corrupt reads, raw-caret/late-read ownership, cancellation,
four-slot refusal and complete backup transfer through a full browser restart.
Independent decoded projections differ by at most 2.357 pixels in the two short
films, within the frozen 16-pixel bound; control drift stays below 0.072 pixels.

A separate actual 60-second film fills all 20 shots and 32 cues per performer. Its
2,178,876-byte VP9 recording has 1,706 decoded frames spanning 59.936 seconds, and
ten independent landmark samples differ by at most 2.202 pixels. Four saved
pairs (one recording plus three imported copies) retain 8,715,504 video bytes
through a complete Chromium process restart; the original 2,185,527-byte backup
is byte-identical afterwards. Separate synthetic domain tests cover exact 32 MiB
media, 80 KiB manifests and four-Blob 128 MiB accounting; these are not native video
or memory-peak measurements. Desktop/390px screenshots were inspected.

The [verification record](docs/2026-10-04-retained-takes-verification.json) retains
actual failed attempts, corrections, source/artifact hashes and limits. Reproduce
the original full-minute fixture with a separately running normal app server:

```sh
CHROMIUM_PATH=/usr/bin/chromium SHOT_TAKES_BASE_URL=http://127.0.0.1:4173 \
  node scripts/smoke_retained_takes.mjs
```

The runner writes to a fresh temporary directory by default. Set
`SHOT_TAKES_OUTPUT` to a new directory to retain artifacts at a chosen location.
It needs Chromium and FFmpeg, records for a real minute and never builds, starts
a server, imports producer oracles or uses a remote service.

Scene sequences ([#90](https://github.com/twangyal/projects-monorepo/issues/90))
pass **232 unit tests**, syntax checks and **71 distinct native browser cases**
locally: 18 new sequence flows plus all 53 prior cases. Genuine legacy backups,
unchanged startup records, two-tab protection, actual source-file/current-scene/take
copying, editable history, raw-field ownership, cancellation and 390px keyboard
flows are covered. Independent short-video samples have at most 3.408 pixels of
projection error against the frozen 16-pixel limit; portable schema2 backups are
byte-identical across three complete browser processes.

A separate maximum probe uses four complete 20-shot films with 256 total authored
cues, assembling 20 clips and exactly 60 seconds. Its 36,256-byte complete sequence
survives a full browser-process restart byte-for-byte. The actual 6,386,568-byte
VP9 video contains 1,395 decoded frames spanning 59.865 seconds; all 40 independent
source-clock/costume/light/camera/visibility samples and five endpoint previews
pass. An actual 320 KiB whitespace-padded input succeeds, while one extra byte and
a 21st clip refuse atomically. This verifies maximum topology, not maximum encoded
video bytes, peak memory or exact frame rate. Run it against a separately served app:

```sh
CHROMIUM_PATH=/usr/bin/chromium SHOT_SEQUENCES_BASE_URL=http://127.0.0.1:4173 \
  node scripts/smoke_scene_sequences.mjs
```

Use `SHOT_SEQUENCES_OUTPUT` for a new output directory or `--fixtures-only` to
prepare inputs without a browser. Chromium and FFmpeg are required for the actual
full-minute recording. [Integration evidence](docs/2026-10-04-scene-sequences-verification.json),
[native evidence](docs/2026-10-04-scene-sequences-native.json) and
[maximum evidence](docs/2026-10-04-scene-sequences-maximum.json) retain exact
hashes, failed attempts, independent thresholds and scope. Both [push](https://github.com/twangyal/projects-monorepo/actions/runs/37219616959)
and [PR](https://github.com/twangyal/projects-monorepo/actions/runs/37219620332) CI
at `6eef208710871171e8fe78b9ffdf9a2d84aab9be` pass all **232 units and 71 native
browser cases**, plus syntax checks, on Chromium153. All thirteen project PR
workflows pass. The [CI receipt](docs/2026-10-04-scene-sequences-ci.json) records
actual checkouts. Physical headset acceptance remains open.

Retained-take CI at `6b2efeb3` passed all **146 unit tests, syntax checks and 53 browser tests** in both [push](https://github.com/twangyal/projects-monorepo/actions/runs/37211773638) and [PR](https://github.com/twangyal/projects-monorepo/actions/runs/37211776395) runs; all thirteen project PR workflows passed. The [CI receipt](docs/2026-10-04-retained-takes-ci.json) records exact checkouts. The [first CI failures](docs/2026-10-04-retained-takes-ci-first.json) remain documented: a test assumed native hashing finished after one event-loop turn, and a persistent-browser download closed for an unconfirmed reason. The corrected fixtures wait for the real database request and inherit the configured browser; all original archive/restart assertions remain.

A subsequent all-project run exposed the fresh-profile archive test injecting a
File before the library was ready. A deterministic probe confirms that native
`setInputFiles` can bypass a disabled input while the genuine initial IndexedDB
read is held. The helper now waits for the input to become enabled, and a new
native regression verifies this ordering with an actual recorded archive. Both
the affected portable flow and new case pass locally (2/2); no product guards or
timeouts changed. The original CI artifact cannot prove its precise triggering
interleaving. [Failure evidence](docs/2026-10-04-import-readiness-ci-first.json) and
[repair evidence](docs/2026-10-04-import-readiness-verification.json) preserve that
limit and the actual archive hashes.

The readiness repair passes **232 units and all 72 native cases** in both
[push](https://github.com/twangyal/projects-monorepo/actions/runs/37222152746) and
[PR](https://github.com/twangyal/projects-monorepo/actions/runs/37222156547) CI at
`9a4f08f6e3e415d29ca5c113979f91bb4d68711c`, with syntax checks and Chromium153.
All thirteen project PR workflows pass. The [exact CI receipt](docs/2026-10-04-import-readiness-ci.json)
also retains a separate Melody push test failure found by that run.


## Sequence trimming acceptance (#114)

Source-range trimming adds strict sequence schema3 migration, unchanged complete
source films and one-edit range history. The [design](../../docs/superpowers/specs/2026-10-04-shot-sequence-trimming-design.md)
fixes camera-local and performer-global clock semantics, exact endpoint previews,
raw-field ownership and existing recovery/export bounds. Final local verification
passes **261 units**, syntax checks and **all 87 native browser cases** in one
full regression. The first new-case run passed 14/15; its remaining numeric-notice
assertion ran after a backup intentionally replaced that notice. Moving the same
assertion before download repaired the test. An independent source-hash fixture
also required canonical property order, with values and hash assertions retained.
The published trim core passes 255 units and 87 browser cases in both push and PR
CI, with all thirteen project PR workflows green. The final shared capture repair
at `265d8809eb3ecd0f7e5451a14e0e4149950c5735` then passes **261 units and 87
native cases in both push and PR CI**, with all thirteen project workflows green.
The actual PR checkout has the same implementation tree. See the
[local receipt](docs/2026-10-04-sequence-trim-verification.json),
[preserved core CI](docs/2026-10-04-sequence-trim-ci.json) and
[final capture CI](docs/2026-10-04-sequence-trim-capture-ci.json).

The independent maximum fixture contains four complete 20-shot films, 256 total
blocking cues and twenty three-second excerpts. Each keeps seconds 0.5 through
3.5 of an original four-second shot, for exactly 60 output seconds. Canonical
JSON is 36,796 bytes; the separate 320 KiB raw input uses declared trailing
whitespace. Both actual maximum attempts preserved exact full-process restart,
capacity refusal and endpoint checks, but produced only 119 video frames over
about 59.6 seconds, below the unchanged frame-rate acceptance threshold. These
failures and short diagnostic comparisons remain preserved. The shared exporter
now requests frames explicitly after real draws when native manual capture is
available, with a bounded 30 Hz request cadence and the existing automatic-capture
fallback. It retains cancellation, deadline and 32 MiB limits.

A separate final production run passes the original unchanged maximum fixture:
**1,040 decoded frames over 59.901 seconds**, a **4,949,079-byte VP9 WebM**, all
forty independent source-clock/color/projection samples, five endpoint previews
and byte-exact 36,796-byte backup recovery across two Chromium processes. This is
measured acceptance on Chromium 151, not a guarantee of 30 encoded frames per
second on every device. See the [maximum receipt](docs/2026-10-04-sequence-trim-maximum.json)
and [capture review](docs/2026-10-04-sequence-trim-capture-review.json).

To freeze inputs and run the maximum against a separately served app using fresh
directories:

```sh
SHOT_TRIMS_OUTPUT=/tmp/shot-trim-fixtures \
  node scripts/smoke_sequence_trimming.mjs --fixtures-only
CHROMIUM_PATH=/path/to/chromium SHOT_TRIMS_BASE_URL=http://127.0.0.1:4173 \
  SHOT_TRIMS_FIXTURE_DIR=/tmp/shot-trim-fixtures \
  SHOT_TRIMS_OUTPUT=/tmp/shot-trim-acceptance \
  node scripts/smoke_sequence_trimming.mjs
```

The runner needs FFmpeg/FFprobe, verifies the original input bytes, owns its browser
profile and records for a real minute. It starts no server and imports no
production evaluators. It checks full-process restart, guarded capacity refusal,
actual cancellation, endpoint previews and forty independently projected decoded
video samples. Requested frame rate does not guarantee a frame in every short
excerpt; physical headset acceptance remains open in #21.

## Sequence soundtrack acceptance (#124)

The complete document keeps exact original WAV bytes with the editable sequence,
protected atomic browser saves, portable recovery, and bounded reversible history.
The [design](../../docs/superpowers/specs/2026-10-05-shot-sequence-soundtrack-design.md)
fixes sample-frame trimming, sequence-time placement, capture ownership and legacy
preservation. Final local verification passes **328 unit cases**, syntax checks and **all 99
native browser cases** in one regression. See the [root verification](docs/2026-10-05-sequence-soundtrack-verification.json).
Native cases exercise real WAV selection, raw drafts, complete backup/restart,
two-tab conflicts, mono 44.1 kHz resampling, stereo tones and encoder cancellation.

The first published PR run passed all **328 units and 99 browser cases** on the
same tree as the push run, which passed 97/99 browser cases. One test imported
before startup storage admission; its ordinary-import fixture now waits for
completed admission, and readback refuses to create an absent database. The
other recording contained an initial 361 ms frame gap. Its original pixels and
timeline origin were correct, so the production scheduler and 150 ms timing gate
remain unchanged. Both focused checks pass after that diagnosis. The
[CI receipt](docs/2026-10-05-sequence-soundtrack-ci.json) preserves the first
failures and hashes. The follow-up PR passes 328/99, but its push run
passes 328/98 and repeats a 352 ms initial frame gap. The storage case is fixed;
video startup investigation remains open. A bounded test-only observer now saves
first-second draw/RAF/capture/encoder timings in CI while retaining every original
acceptance gate. The local instrumented case passes. A third push reproduces a
338 ms gap between requested frames, matching the media gap; short draw/setup
calls do not explain the absent animation-frame callbacks. A bounded timer
heartbeat, long-task and visibility observer now distinguishes renderer-thread
blocking from compositor-only starvation. Its focused local case passes;
production timing and the original acceptance gates remain unchanged pending
that evidence.

The independent maximum uses four complete 20-shot scenes, 256 performer cues,
twenty clips and 60 seconds of stereo PCM. Its complete **11,554,385-byte** archive
survives a full browser restart byte-for-byte, alongside an unchanged ordinary
scene and actual silent saved take. Separate exact 12 MiB WAV and 324 KiB raw
metadata inputs admit; their +1 variants refuse without changing committed work.
The resulting **5,761,015-byte VP9/Opus WebM** passes independent decoding:
**1,101 video frames**, **2,880,000 stereo audio frames**, all forty original
camera/performer/light/color samples, fixed pitch/gain/silence checks and all
sixteen audio transitions within **40 ms** of their shared timeline positions.
No fitted audio or video offset is used. This measures Chromium 151 in this
environment; it does not promise sample-exact muxing on every device.

First failures are preserved in the [maximum receipt](docs/2026-10-05-sequence-soundtrack-maximum.json).
The first audio stream stopped at the soundtrack's end, before the sequence ended.
A native regression reproduced the missing silent tail; capture now keeps a
zero-valued source active until owned cleanup, without changing the imported PCM
or audible playback. A separate reopened headless page delivered only two frame
callbacks per second; the runner now explicitly activates its own page. Production
video scheduling and all original acceptance thresholds remain unchanged. A
mobile full-page screenshot protocol failure is retained; focused viewport
captures and the full-document horizontal-overflow assertion verify mobile layout.

To prepare original fixtures and capture/decode the maximum against a separately
served app, use fresh output directories:

```sh
node scripts/smoke_sequence_soundtrack.mjs --prepare --output /tmp/shot-soundtrack-fixtures
CHROMIUM_PATH=/path/to/chromium node scripts/smoke_sequence_soundtrack.mjs \
  --capture --fixtures /tmp/shot-soundtrack-fixtures \
  --output /tmp/shot-soundtrack-acceptance --origin http://127.0.0.1:4173
node scripts/smoke_sequence_soundtrack.mjs --inspect --output /tmp/shot-soundtrack-acceptance
```

The runner starts no server. It owns and closes fresh browser processes, retains
the original recorded video for independent inspection, and needs FFmpeg/FFprobe.
Physical headset acceptance remains separate in #21.


## Earlier timestamped input milestone (#124)

The absolute deadline guard refuses expired encoder payloads, frames and Blob
publication even when browser timers arrive late. Its published push and PR CI
both pass 335 unit cases and syntax checks, but each still fails one of 99
native cases at the original 150 ms video timing gate. The actual source and
trim recordings are preserved with hashes and decoded PTS in
[the failure directory](docs/failures/2026-10-05-deadline-ci/).

A separate [input module](src/export-timeline.js) provides complete 30 Hz video
timestamps and bounded 48 kHz planar PCM blocks, with explicit linear resampling,
source trim/gain and leading/trailing silence. Fourteen original fixture tests
include a complete stereo minute, cancellation and late-read refusal; the full
local suite passes 349 cases plus syntax checks. This module is a prerequisite,
not a production export replacement. The [input contract](docs/timestamped-export-inputs.md)
and [verification receipt](docs/2026-10-05-export-timeline-verification.json)
record numerical semantics and unfinished muxer/native acceptance work.

## Timestamped production export (#124)

Ordinary films, retained silent takes and complete soundtrack sequences now use
the same timestamped VP9/VP8 pipeline and locally served unchanged Mediabunny1.61.1
muxer. Frame time comes from the authored30Hz schedule, so a delayed task does
not skip frames. Original trimmed PCM becomes bounded48kHz blocks on that same
origin; export creates no AudioContext or audible playback. Rehearsal keeps its
existing owned audio graph. Native backpressure,32MiB write admission, absolute
deadlines, closed samples and cancellation drain protect publication. Scene/take/
sequence authoring stays locked until cancelled native work drains.

The separately callable candidate passed363unit and102native cases in both
first push and PR CI at05269ec8aff1f2be2e857e382a95a423ff6aa155. Its new original
silent and Opus fixtures independently decode every one of60frames through an
intentional350ms stall, including exact authored PTS and red/blue pixel gates.
A subsequent controlled regression reproduced late encoder initialization after
cancellation; the adapter now drains pending source adds before closing output.
Cancellation and failed finalization also wait for every track flush; two reviewed
regressions cover abort during flush and a failing audio track with a pending video
flush. The adapter deliberately uses a pinned source-close hook for sibling drain.
The integrated local suite passes345units plus syntax.25MediaRecorder-specific
cases were replaced by the timestamped lifecycle/input suite; the original media,
storage and recovery gates remain. Native cancellation observers retain genuine
encoders while deliberately delaying zero-time UI yields250ms. This is controlled
cancellation coverage, not a latency claim.

The first integrated failures remain preserved, including the obsolete live-playback
assertion and full Chromium 153 browser crashes during the maximum post-restart
download. The maximum harness now inherits Playwright's configured headless
browser when no explicit CHROMIUM_PATH is provided, matching the normal native
suite without changing fixtures or acceptance thresholds.

Both first [push](https://github.com/twangyal/projects-monorepo/actions/runs/37321512812)
and [PR](https://github.com/twangyal/projects-monorepo/actions/runs/37321518978)
checks at `9f4e3b673dd43214b7724a7370896f46dded9d0a` pass 345 units, syntax,
105 native cases and the original full-minute/restart gate. The actual minute
contains all 1,800 authored video frames and 2,880,648 decoded PCM frames including
Opus padding. All 40 original visual samples, 16 audio transitions and exact
complete backup recovery pass. The 11,554,385-byte sequence archive survives a
full browser-process restart byte-for-byte; the unrelated scene and silent take
also remain intact. A separate local FFmpeg reinspection of that captured artifact
passes the same original gates; its [receipt](docs/2026-10-05-independent-export-decode.json)
records exact source/artifact provenance and limits. This is an independent decode
of the same native capture, not another capture or physical-device verification.
Issue #124 is accepted and closed. Physical WebXR acceptance remains in #21.

The [complete CI receipt](docs/2026-10-05-timestamped-export-ci.json) records the
identical branch and actual PR checkout trees and all thirteen passing project
workflows. Original [push](docs/2026-10-05-timestamped-maximum-push.json) and
[PR](docs/2026-10-05-timestamped-maximum-pr.json) maximum receipts retain full
archive/media hashes and finite fixture limits. Both captured WebMs have the same
9,879,042 bytes and SHA256; this is a measured observation, not a general
deterministic-encoder claim. The largest audio transition error is 10 ms.

An independent [comparison of all 1,800 video timestamps](docs/2026-10-05-timestamped-maximum-pts.json)
to `index / 30`, from a fixed zero origin without fitting, finds maximum error
below 0.334 ms and maximum gap 34 ms. Full/headed Chromium compatibility is not
established by these software-WebGL headless checks; the forced full-Chromium153
`SIGTRAP` process log remains preserved alongside the original failed captures.

### Sequence startup fixture repair — 2026-10-05

Healthy sequence persistence fixtures now wait for positive initial storage readiness
before importing. The new native delayed-startup regression fails with the earlier
fixture and passes with the repair; complete browser-process restart and independent
stored-archive assertions remain intact. Fresh local checks pass 345 unit and 106
browser cases plus syntax checks. [Verification and retained first failures](docs/2026-10-05-sequence-startup-verification.md)
record the browser provenance and exact limits; separate compatibility #128 remains open.

### Passive maximum-export diagnostics — 2026-10-06

The independent maximum probe now retains at most 24 DOM snapshots, sampled
every five seconds during export and at the first failure before cleanup. Each
records visible status, rendered progress, control availability and tab visibility.
Renderer reads expire after 500 ms; unavailable diagnostics preserve the original
error. The 95-second download gate, exporter deadline and independent media gates
remain unchanged, with no retries or production instrumentation. These samples
describe the interface, not internal encoder state or physical performance.

The [local receipt](docs/2026-10-06-export-diagnostics-local.json) retains exact
archive restart, all 1,800 decoded video frames and 2,880,648 audio frames with
the observer enabled. That software-WebGL Chromium153 run does not resolve the
original full Chromium155 timeout. Issue #128 remains open pending its diagnosis;
the compatibility workflow also runs when the maximum probe or observer changes.

### Instrumented full Chromium timeout recurrence — 2026-10-07 (#128)

The [first instrumented recurrence](docs/failures/2026-10-07-chromium-155/README.md)
is retained from PR run37569571709 at04ead28. The original complete archive survives
browser restart exactly. Full Chromium155.0.8059.12 renders to58.9 seconds of the
sixty-second authored timeline at70.063 wall seconds, then the application reports
its export timeout before the unchanged95-second download waiter expires. The
page remains visible/focused and the browser connected, with no page errors.
DOM progress is not a completed encoded-frame count. This localizes this attempt
to the70-second product deadline; render/encoder cost is still unisolated. It does
not prove the earlier uninstrumented timeout had the same cause. No gate increase,
retry or production fix is claimed. Raw verification, browser log and artifact
hashes are committed. All thirteen normal portfolio checks, including the separate
standard configured Shot maximum, pass at the same integration head. The separate
full-Chromium experiment is failed and #128 remains open.


### Separate native stage timing — 2026-10-07 (#128)

The maximum driver accepts explicit `--stage-timing` only for a separately
labelled diagnostic variation. Test-only observers measure ten fixed aggregate
buckets: capability probe, encoder creation/start, renderer draw, native video/audio
sample construction, addVideo/addAudio waits, finalize and cancel. They preserve
original encoder objects, receivers, return values, promise identity and errors;
shared methods restore after capture. No frame, PCM block or promise result is
retained. Reads remain bounded; no production source, deadline, fixture or media
acceptance gate changes. The compatibility workflow keeps the original maximum
and diagnostic artifacts separate. A successful diagnostic cannot clear an
original maximum failure.

The [local raw receipt](docs/2026-10-07-stage-timing-local.json) and
[provenance](docs/2026-10-07-stage-timing-local-provenance.json) preserve a successful
software-WebGL Chromium153.0.8010.0 variation: exact11,554,385-byte archive across
full browser restart,1,800 decoded video frames and2,880,648 decoded audio frames.
Export/download took40.885 seconds;1,800 addVideo operations observed38.678 seconds
in total elapsed waits (largest575.7ms), versus1.107 seconds across1,805 draw calls,
246.6ms constructing1,800 video samples and74ms finalization. All observed operations
completed without errors. These are elapsed waits including scheduling/native work,
not additive CPU times; draw can exclude later GPU work and includes UI draws.
The standard browser suite ran concurrently, so this is not a performance baseline.
It identifies native video backpressure as the next investigation target in this
environment; it does not explain the full155 timeout or establish a production fix.
Issue #128 remains open pending full155 evidence and a safe repair if warranted.

To reproduce the diagnostic, prepare the unchanged fixture with
`node scripts/smoke_sequence_soundtrack.mjs --prepare --output NEW_FIXTURES`, serve
the app locally, then capture with `--capture --stage-timing --fixtures NEW_FIXTURES
--output NEW_CAPTURE --origin LOCAL_APP_URL`. Run the same driver's `--inspect
--output NEW_CAPTURE` to apply the original independent media gates. Without
`--stage-timing`, the original passive probe remains unchanged.


The [first full155 stage receipts](docs/2026-10-07-stage-timing-155/README.md)
preserve successful original/diagnostic push and PR pairs at0f4c1de. Diagnostic
exports take44.965s/69.798s, including43.100s/66.966s addVideo elapsed waits.
All four complete archive/restart and independent media gates pass; all13normal
portfolio PR workflows and both Shot workflows pass350units/109native cases.
The near-deadline PR observation motivates a separately labelled VP8-first
source-copy experiment. Its first local candidate fails the unchanged color gate;
production remains VP9-first. Candidate CI keeps source patch provenance and
failures separately. Native cancellation now has an observer regression;110cases
pass locally. These passing timing observations do not explain the prior timeout
or establish a production fix, so #128 remains open.


The [first stage-timed155 timeout](docs/2026-10-07-stage-timing-recurrence/README.md)
now reproduces at2cfc610:1,794 video submissions complete with67.451s addVideo waits,
zero finalization calls and a completed26.3ms cancel. The product deadline expires
before movie publication while the browser stays alive; six samples remain
unconstructed. Both VP8-first155 candidates reject the original visual gate and
show no clear portable speed benefit. Separate local decoder comparisons identify
BT709 stream versus BT470BG FFmpeg-frame interpretation; a native fixed-pixel
check and separately labelled explicit-matrix inspection support further diagnosis,
without replacing the original rejection. All13normal portfolio checks and both
standard Shot350unit/110native workflows pass; the separate push155 experiment
fails. Production and all original gates remain unchanged; #128 stays open for a
safe measured throughput repair and independent decoder discrepancy verification.


The [isolated realtime-latency candidate](docs/2026-10-07-realtime-candidate/README.md)
passes the local original maximum in26.069s, including all1,800 planned decoded
video frames and unchanged media/archive gates. This is a separate experiment,
not a controlled speed benchmark or production change. Full155 CI additionally
requires exact complete-frame count. Realtime mode can permit drops, so adoption
requires bounded complete-frame accounting before any movie publication.
Its first full155 PR passes all1,800 frames in46.439s; push times out before
finalization after1,670 submissions/67.666s addVideo waits. This mixed evidence
rejects production adoption. Both raw receipts/provenance are retained; the two
inconclusive source-copy candidate jobs are retired. Original155 maximum and
separately labelled diagnostic jobs remain, now triggered by export source/tests.

Native output admission now compares bounded timestamp sets against the complete
immutable authored frame plan before movie publication. It refuses missing,
duplicate, unexpected or malformed output after native flushes drain, then clears
accounting; cancellation preserves owned cleanup. It retains no packets/frames.
The actual native controlled omission regression previously downloaded an
incomplete sequence; now it refuses publication, closes native encoders and
preserves the exact saved scene and complete sequence. This is export safety,
with original quality/VP9-first preference, limits and deadlines unchanged.
The remaining155 throughput timeout remains open in#128.

[Complete-frame admission verification](docs/2026-10-07-complete-frame-admission/README.md)
passes357local units/syntax and all111native browser cases. The unchanged original
maximum independently decodes all1,800video/2,880,648audio frames, all40 original
visual/audio gates and exact complete archive restart. First771e17b PR configured153
and full155 original/diagnostic maxima pass all1,800frames; push153 and155 maxima
recur at the product deadline. Paired raw receipts are retained. Native regression
CI passes357units/syntax in push and PR,111native in PR,110native plus one new
five-second omission-harness timing failure in push. That fixture is corrected
to a legal one-second shot and waits through its unchanged product deadline;
focused local verification passes. First context/trace is preserved. All13normal
portfolio PR workflows pass; push maxima stay red. The guard is not claimed as a
throughput fix. Corrected-head7e316fb push37607024055 and PR37607028764
pass357 units/syntax,111 native cases and configured maximum gates; separate
full155 original maxima remain red in push37607024080 and PR37607028881.


The [native queue diagnostic](docs/2026-10-07-native-queue-timing/README.md)
adds bounded once-dequeue timing for both real codecs and exact sink writes to
the separate stage variation. Small independently decoded audiovisual/video
exports verify behavior and retirement; it does not assign exclusive CPU time
or cover all upstream muxer backpressure. Original production and maximum gates
remain unchanged. Issue128 remains open for the full155 timeout.

Corrected queue-observer head447a6f7 passes362 units/syntax and114 native cases
in both first standard push and PR CI. The [paired full155 receipts](docs/2026-10-07-native-queue-timing/corrected-447a6f7/README.md)
retain successful push exports and PR deadline failures. Native dequeue waits
dominate the failed diagnostic's awaited video path; this is measured
backpressure, not exclusive CPU time or a production throughput fix.

The [process CPU extension](docs/2026-10-07-process-cpu/README.md) to the labelled
stage diagnostic brackets export with native cumulative counters, excludes
lifetime usage/churn/invalid or zero-only counters, and reports unavailable
rather than inventing zero CPU. It measures whole observed process work, not
exclusive codec CPU. Production settings and original media gates are unchanged.

The [bounded native media trace](docs/2026-10-08-native-media-trace/README.md)
adds an explicit `--media-trace` maximum-probe variation, separate from original
acceptance and stage timing. It retains fixed event aggregates with loss,
missing-counter and ownership disclosures, rather than raw trace payloads.
Native emitting-thread CPU excludes worker threads and does not partition GPU
process work. The first local maximum passes unchanged media gates; full155 CI
remains pending and issue128 remains open for throughput repair.
