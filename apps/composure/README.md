# Composure

An original short observatory escape game for catalog project #17. Declare a simulated resting baseline and current readings; rising game tension slows movement, increases noise and adds aim jitter. Find the fuse and key, restore power, steady the lock, and escape before the corridor seals.

This first playable milestone uses **simulated inputs only**. It does not connect to a smartwatch, infer emotions or measure health. A supported physical smartwatch transport, real-device lifecycle testing and observed hardware behavior remain future work; the catalog stays ACTIVE. Issue [#39](https://github.com/twangyal/projects-monorepo/issues/39) tracks this milestone.

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
- Hold E or **Hold to interact** to collect a fuse/key, restore the panel, work the lock or exit.
- Shift or **Steady** reduces movement noise and aim jitter, at the cost of slower movement. The lock needs four seconds with aim error at most 18 world units; slips lose progress and add bounded noise.
- Keyboard aim automatically targets the nearest reachable objective. Click/move in the corridor for pointer aim; **Keyboard aim** restores the keyboard mode.
- Collect fuse at (250,110), restore power at (520,230), collect key at (740,110), open lock at (1030,160), then interact with exit at (1160,160). The exit stays physically blocked until unlocked.
- Noise reaching 100 or 180 active seconds loses. Restart resets all run state. Pause, window blur and hidden pages suspend active time and release holds.

The authored scare is optional, has no flash, and contributes a temporary explicit game shock. Sound is optional and muted by default. Reduced visual motion removes crosshair oscillation; the nearby-object error display still exposes the actual gameplay steadiness rule. The canvas is accompanied by readable objectives, status, meters, position and controls. It is a spatial visual game, not a fully nonvisual game.

## Model and records

Relative increase is `(current − baseline) / (baseline × 0.75)`, clamped with authored shock to [0,1], then analytically smoothed with a two-second response. This is an authored mechanic, not a validated physiological relationship. Simulation uses fixed 1/60-second steps and caps each frame's catch-up at 0.25 seconds. Long stalls cannot jump the game ahead. A pause does not age samples.

Only bounded versioned preferences and best completed active time save in localStorage. Corrupt records are preserved and block automatic writes until explicitly reset. Storage failures leave the game usable in memory. Samples/events never autosave. **Download run report** exports actual current simulated baseline, accepted samples, authored/game events, outcomes and timing. Each stream retains at most 256 entries and reports truncation. The report is not a replay engine or emotional-state assessment. Changing browser origin opens separate preferences.

## Verify

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

The production suite uses port 4281, native settings storage, real downloads and actual keyboard/pointer controls. Its browser clock controls elapsed animation time without exposing or mutating private game state. Unit oracles cover calibration, sample freshness, bounded tension, frame-rate behavior, prerequisites, wins/losses and report/settings bounds. Remote CI is the browser acceptance gate in environments where Chromium download is unavailable. Current evidence is tracked in #39; no physical sensor or subjective horror-quality result is claimed.
