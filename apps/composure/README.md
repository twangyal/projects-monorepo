# Composure

A short original escape game in a dark observatory, driven by heart rate. Readings come from a built-in simulator or a Bluetooth device broadcasting the standard Heart Rate Service. As heart rate rises above your baseline, game tension slows movement, adds noise and makes aiming shakier. Find the fuse and key, restore power, steady the lock and escape before the corridor seals. Heart rate drives a game mechanic only; it is not an emotion or health measurement.

**Status:** DEFERRED by the owner (2026-10-14). Direction: [docs/PRODUCT_DIRECTION.md](../../docs/PRODUCT_DIRECTION.md)

The owner found that it does not work as a browser app. The platform must be reconsidered before work resumes.

## What works today

- Playable canvas escape: move (WASD/arrows or on-screen buttons), hold to interact (E or **Hold to interact**), **Steady** (Shift) to reduce noise and jitter, and keyboard or pointer aim.
- Objectives in order: fuse, power panel, key, lock (hold steady for four seconds), exit. You lose if noise reaches 100 or time runs past 180 seconds.
- Simulated heart rate: choose a baseline (40–120 BPM) and current readings (35–220 BPM), sent once or every second; stopping readings tests signal loss.
- Bluetooth heart-rate input (Web Bluetooth): explicit connect, five-reading baseline collection, live readings at most once per second, contact-loss and stale-signal handling.
- Optional scare (no flash), optional sound (muted by default) and a reduced-motion setting.
- Pause on blur or hidden page; touch controls that tolerate finger movement and multi-touch.
- **Download run report** of accepted readings for the current run.
- Preferences and the best simulated completion time saved in localStorage, coordinated across tabs.

## Known gaps

- The owner found the browser experience unsuitable; a different platform (for example native mobile or watch) has not been chosen.
- No physical smartwatch or chest strap has been verified. Many watches do not broadcast the standard Heart Rate Service, and Web Bluetooth is unavailable in Firefox, Safari/iOS and default Linux Chromium.
- The tension formula is an authored game mechanic, not a validated physiological model.
- One short level, with no tested horror quality or replay value.
- A visual game: text status and meters help, but it is not playable without sight.

## Run locally

Requires Node.js 22.18 or newer (CI uses Node 24) and a modern Chromium-based browser. Bluetooth input needs a secure context (localhost or HTTPS) and supported hardware.

```sh
cd apps/composure
npm ci
npm run dev                 # http://127.0.0.1:4280
```

Production build and preview:

```sh
npm run build
npm run preview -- --port 4280 --strictPort
```

No backend, account or external artwork; all graphics are drawn on canvas.

## Verify

```sh
npm run check            # unit tests + ESLint + typecheck + production build
npx playwright install chromium
npm run test:browser     # Playwright against the production build on port 4281
```

Individual steps: `npm run test`, `npm run lint`, `npm run typecheck`, `npm run build`. Set `CHROMIUM_PATH` to use an existing Chromium. Browser tests replace `navigator.bluetooth` with a controlled provider; they do not use a real sensor.

Optional Bluetooth flow smoke against a running preview: `node scripts/smoke_bluetooth_input.mjs` with `COMPOSURE_BLE_BASE_URL` (required) and `COMPOSURE_BLE_OUTPUT`.

CI: `.github/workflows/composure.yml`.

## Project layout

- `src/main.ts` — game loop, canvas rendering, controls and UI.
- `src/model.ts` — game state, objectives, tension and win/loss rules.
- `src/heart-rate.ts` — Heart Rate Measurement parsing, calibration and freshness.
- `src/bluetooth.ts` — Web Bluetooth connection lifecycle.
- `src/settings.ts` — localStorage preferences, best time and cross-tab locking.
- `tests/*.test.ts` — unit and oracle tests; `tests/browser/` — Playwright specs.

## Data & privacy

The Bluetooth chooser requests only the Heart Rate Service, and the app never reads, stores or exports the device name or ID. Heart-rate readings stay in memory and appear only in a run report you download. Only preferences and the best simulated time are saved, in localStorage.
