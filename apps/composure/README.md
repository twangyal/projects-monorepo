# Composure

An original short observatory escape game for catalog project #17. Use declared simulated readings or explicitly connect a device broadcasting the standard Bluetooth Heart Rate Service. Rising game tension slows movement, increases noise and adds aim jitter. Find the fuse and key, restore power, steady the lock, and escape before the corridor seals.

The simulator works without a sensor. The Bluetooth software flow is tracked in [#61](https://github.com/twangyal/projects-monorepo/issues/61); **physical smartwatch compatibility and measurement accuracy remain unverified** in [#62](https://github.com/twangyal/projects-monorepo/issues/62). The catalog stays ACTIVE. Inputs influence an authored game mechanic, not an inference about emotions or health. The original simulated milestone is recorded in [#39](https://github.com/twangyal/projects-monorepo/issues/39).

## Run

Node 22.18+ (CI: Node 24), a modern desktop/touch Chromium browser:

```sh
cd apps/composure
npm ci
npm run dev
```

Open `http://127.0.0.1:4280`. Production: `npm run build`, then `npm run preview -- --port 4280 --strictPort`. There is no backend, account, paid service, model download or external artwork. All geometry is original canvas drawing.

## Play

Calibrate & start uses five declared copies of the selected simulated baseline, between 40 and 120 BPM; it is not an actual resting-heart-rate measurement. The baseline stays fixed for that run. Current readings range from 35 to 220 BPM and can be sent once or every active second. Stop sampling to exercise signal loss: after ten active seconds the signal is stale and tension smoothly returns to neutral. No missing-reading penalty is invented.

- WASD / arrows or onscreen arrows move. Standing within 70 world units puts an object in reach.
- Hold E or **Hold to interact** to collect a fuse/key, restore the panel, work the lock or exit. Touch holds tolerate finger movement; if multiple fingers hold the button, interaction continues until the final contact releases.
- Shift or **Steady** reduces movement noise and aim jitter, at the cost of slower movement. The lock needs four seconds with aim error at most 18 world units; slips lose progress and add bounded noise.
- Keyboard aim automatically targets the nearest reachable objective. Click/move in the corridor for pointer aim; **Keyboard aim** restores the keyboard mode.
- Collect fuse at (250,110), restore power at (520,230), collect key at (740,110), open lock at (1030,160), then interact with exit at (1160,160). The exit stays physically blocked until unlocked.
- Noise reaching 100 or 180 active seconds loses. Restart resets all run state. Pause, window blur and hidden pages suspend active time and release holds.

The authored scare is optional, has no flash, and contributes a temporary explicit game shock. Sound is optional and muted by default. Reduced visual motion removes crosshair oscillation; the nearby-object error display still exposes the actual gameplay steadiness rule. The canvas is accompanied by readable objectives, status, meters, position and controls. It is a spatial visual game, not a fully nonvisual game.

## Bluetooth input

**Next run source** selects the source for a new run. **Current run source** continues to identify the existing run; changing the selection cannot relabel its samples. The simulator remains available when Bluetooth is unavailable or a connection is still being cancelled.

1. Select **Bluetooth heart-rate sensor**, enable standard heart-rate broadcasting on your device, and choose **Connect heart-rate sensor**. The browser's chooser requests only the Heart Rate Service. Connection requires an explicit click; there is no automatic reconnect. The app does not read, display, save or export the device name or ID.
2. Choose **Collect baseline**. This pauses an existing running game and collects five notifications at least one second apart, spanning at least four seconds within a 30-second collection window. The game's baseline range is 40–120 BPM with at most 12 BPM spread. These are game admission rules, not a health assessment. Fast, repeated or ineligible notifications cannot manufacture a completed baseline.
3. Choose **Start Bluetooth run** within ten seconds of the completed collection. The app confirms replacement when an old run/report exists and rechecks the connection and baseline afterward. The fixed baseline is the mean of those five values. Calibration readings are not replayed as game samples; gameplay waits for a new notification.
4. During the run, the game accepts device-reported integer values from 35–220 BPM at most once per second. Contact detection, when provided, is respected; unsupported contact detection is explicitly different from reported lost contact. Lost contact invalidates the usable reading immediately, even during the one-second interval. Energy-expended and RR-interval fields are checked for valid structure but do not drive the game.

A live reading is fresh for ten seconds of elapsed clock time, independently of paused game time or a stalled frame. Missing/stale input returns the reading's contribution toward neutral with the existing smoothing; authored scares still contribute their stated game shock. Pause discards incoming gameplay readings and Resume requires a new notification. Reports retain the accepted history. Hiding the page disconnects and invalidates pending calibration; reconnection needs a new collection and new run, preserving the previous report until replacement is confirmed. Bluetooth Restart also requires a new collection.

**Cancel connection** invalidates the app's attempt immediately. Browser chooser and GATT promises cannot be physically aborted. While an old operation drains, the app refuses another attempt and shows that it is waiting; a native operation that never settles may require reloading the page before another connection. **Disconnect sensor** removes the app's notification listeners and disconnects its acquired connection. Startup after device selection has a shared 15-second deadline. Late completions cannot publish a new ready connection or start a game. Ordinary window blur pauses the game but does not cancel a chooser; hidden pages do cancel pending work.

Web Bluetooth requires a secure context such as localhost/HTTPS and an OS/browser/device combination that supports it. Target browsers include supported Chrome/Edge and Chrome Android; Linux Chromium does not enable the API by default. Firefox, Safari/iOS and Android WebView are not supported targets. API presence alone does not prove a working Bluetooth adapter. This app needs a device that exposes service `0x180D` and characteristic `0x2A37` notifications/indications; many watches do not broadcast that service. No particular watch is claimed as verified yet.

The parser accepts bounded 2–512-byte Heart Rate Measurement packets, including 8/16-bit little-endian BPM, contact flags and structurally valid optional fields. Reserved flags, malformed tails and oversize packets are rejected. Contact flags `0x02` mean detection is unsupported and are valid. See the [protocol and lifecycle design](../../docs/superpowers/specs/2026-10-04-composure-bluetooth-design.md) for the exact software contract and references.

## Model and records

Relative increase is `(current − baseline) / (baseline × 0.75)`, clamped with authored shock to [0,1], then analytically smoothed with a two-second response. This is an authored mechanic, not a validated physiological relationship. Simulation uses fixed 1/60-second steps and caps each frame's catch-up at 0.25 seconds. Long stalls cannot jump the game ahead. A pause does not age simulated samples; Bluetooth freshness uses elapsed monotonic clock time and is invalidated on pause.

Only bounded versioned simulator preferences and the best completed simulated active time save in localStorage. Bluetooth baselines and wins never overwrite those simulator values. Corrupt records are preserved and block automatic writes until explicitly reset. Storage failures leave the game usable in memory. Samples/events never autosave. **Download run report** exports the current run's fixed baseline, accepted samples, authored/game events, outcomes and timing. Simulated reports retain schema 1 and `source: "simulated"`. Bluetooth reports use schema 2 and `source: "bluetooth-hr"`, with the five calibration inputs and receipt times relative to calibration start. They omit device identifiers, raw packets, absolute clock origins, energy and RR data. Each stream retains at most 256 entries and reports truncation. The report is not a replay engine or emotional-state assessment. Changing browser origin opens separate preferences.

## Verify

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

The production suite uses port 4281, native settings storage, real downloads and actual keyboard/pointer controls. Its browser clock controls elapsed animation time without exposing or mutating private game state. Unit oracles cover calibration, sample freshness, bounded tension, frame-rate behavior, prerequisites, wins/losses and report/settings bounds. Set `CHROMIUM_PATH=/path/to/chromium` to use an installed Chromium executable instead of the Playwright download. Original simulator evidence is tracked in #39; no physical sensor or subjective horror-quality result is claimed.

Original simulated milestone, verified 2026-10-04: eight unit tests, lint/typecheck/build, and all six production Chromium flows passed in [run 37171786378](https://github.com/twangyal/projects-monorepo/actions/runs/37171786378) on `554a04cdb2c1006208f6079e741c452189e46330`. The independent review findings were reproduced and corrected; source hashes, scope and limits are recorded in [the verification record](docs/2026-10-04-mvp-verification.json).


Bluetooth software milestone #61, verified 2026-10-04: **97 unit tests and 23 production browser cases** passed, including all six original simulator flows, plus lint/typecheck/build. All twelve project workflows passed implementation `a73f866a475f775cce4644af49674f7db0c97373`; [Composure CI](https://github.com/twangyal/projects-monorepo/actions/runs/37189037388) independently passed 97/23. The [Bluetooth verification record](docs/2026-10-04-bluetooth-verification.json) records source commits, observed regressions and harness corrections, exact report/build hashes, screenshots, and limits.

An independent production-browser probe checks unmodified capability first: this Linux Chromium 151 build has no Bluetooth API, displays unavailable guidance, and still starts the simulator. Separate controlled-provider profiles deliver actual `DataView` notifications for 68–72 BPM at one-second intervals, collect a 70 BPM baseline, start with no replayed calibration samples, and download source-labeled reports. Native keyboard controls complete the desktop escape; mobile emulation checks startup/layout and a new reading. Preferences remain byte-identical, device identity getters are never read, and genuine page navigation disconnects the owned connection. Only `navigator.bluetooth` and the clock are controlled; the probe does not import production modules or inject game state. A unique fixture-only sessionStorage counter observes teardown. This is software acceptance, not physical sensor verification.

To reproduce against a separately started production preview:

```sh
npm run build
npm run preview -- --port 4292 --strictPort
# In a second terminal in apps/composure:
COMPOSURE_BLE_BASE_URL=http://127.0.0.1:4292/ node scripts/smoke_bluetooth_input.mjs
```

Set `CHROMIUM_PATH` for an installed browser and optionally `COMPOSURE_BLE_OUTPUT` to a **new** output directory. Otherwise the script creates a fresh temporary directory. It never overwrites existing evidence, builds the app or starts a server. Reports, PNGs, isolated profiles, hashes and timing stay in the output directory; owned browser contexts close on completion. The tracked script passed in 11.94 wall seconds. Native hidden-document transitions and physical watches still require separate verification in #62.


Cached browser history return (#71): the game pauses, releases held controls, invalidates calibration and disconnects the sensor on suspension. If the browser retains the page, it keeps pending native cleanup ownership rather than permanently closing input. Returning preserves the previous report, requires explicit connection and a new baseline, and never resumes gameplay or opens a chooser automatically. Navigation that discards the page still performs terminal cleanup.

The full gate passed **97 unit and 26 production browser cases**, lint/typecheck/build at [71d0090](https://github.com/twangyal/projects-monorepo/actions/runs/37199527045). Two failure-first lifecycle regressions cover connected and pending operations. A separate full-Chromium/real-clock history test proves the original heap and a persisted pageshow survive actual navigation, then checks explicit connection and zero identity reads/page errors. It removes Playwright's cache-disable launch switch and waits for commit, because a cached return has no new document load. This controls only the Bluetooth provider; physical watches and wider browser/device cache policies remain unverified. See [the cached-return verification record](docs/2026-10-04-cached-return-verification.json).


Native touch acceptance (#83), verified locally on 2026-10-04: **97 unit and 32 browser cases** pass, including six new cases using trusted Chromium touch events at 390×844. Complete simulator and controlled-Bluetooth escapes download actual winning reports without keyboard movement or game-state injection. Two reproduced defects are fixed: finger travel no longer hands interaction to browser panning, and lifting a newer finger no longer cancels an older hold. Per-pointer release/cancel, native pause/resume and preference isolation are verified. Page time and the Bluetooth provider are controlled; this does not verify a physical phone/watch or genuine hidden-page transitions.

The integrated local run passed 31 cases and exposed a hard-coded port in the older cached-history fixture; that fixture now respects Playwright's configured base URL and passed separately on the same production build. This is collective 32-case acceptance, not a single 32/32 invocation. Lint/typecheck/build pass. Exact reports, trusted input receipts, initial failures, selected screenshot and source/build hashes are in [the native touch verification record](docs/2026-10-04-native-touch-verification.json). Physical acceptance stays open in #62.
