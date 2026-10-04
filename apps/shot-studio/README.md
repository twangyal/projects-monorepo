# Shot Studio

A local 3D filmmaking sketchbook for idea #7. Stage two block characters in a
courtyard, choose looping actions or author timed movement, visibility and action cues, adjust lighting, compose static or
traveling cameras, rehearse or scrub the shot list, and export a silent WebM film. Native browser
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
History and sequencing controls are locked during recording and immersive sessions. Export WebM in real time while keeping the
tab visible. Cancel stops the encoder and capture tracks. Unsupported encoders
give guidance to save a project instead.

One courtyard, two block performers, 1–20 shots, 1–15 seconds each, **60 seconds
total**. Backups are limited to **64 KiB** with bounded names, positions, angles
and enum values. Cues use global film time rather than restarting at camera cuts.
Imports never execute code or fetch media. Hard cuts; looping performances
use continuous film time. WebM is silent at 960 × 540, requested 30 fps, with a
browser-selected VP9/VP8 encoder. Exact timing/dropped frames depend on hardware.
Travel validates the entire path against coincident or vertical look directions,
not only its endpoints. Eye/target coordinates stay within ±15, Y is at least 0.3,
eye–target separation is at least 0.3 and horizontal separation at least 0.1; FOV
is 25–80 degrees. Boundary decisions use JavaScript’s represented numbers. These
limits do not prevent moving through set geometry or performers. No easing, roll,
animated lens, transitions between shots, audio, skeletal assets, dialogue,
generative animation, separate take library or immersive video export yet.

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
requires a device. The suite contains **107 unit tests and 43 Chromium browser
checks**. Independent oracles include 18 camera/geometry cases and 14 performer
timing/migration cases. Native acceptance covers decoded camera and performer
motion against a separate pinhole projection, stationary controls, literal wave
pose envelopes, hidden intervals, strict migration, raw draft/import races,
controlled immersive camera/cue capture, reversible edits and exact preview cuts.
The workflow repeats these checks for subsequent edits.
CI screenshots were reviewed at desktop and mobile sizes. Page restoration is
covered using controlled page lifecycle events; physical headset tests remain outstanding.

`history.js` owns bounded scene history and shot ordering; `model.js` validates versioned snapshots/whole paths and evaluates cameras/cuts/performances; `math.js` owns column-major camera
transforms; `renderer.js` draws native WebGL; `xr.js` manages immersive views and
controller floor hits; `export.js` owns recording/cleanup; `app.js` manages DOM
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
