# Melody Studio

A local browser music sketchbook: record or import a single hummed melody, turn it into editable notes, layer tracks, and export a composition. This MVP uses deterministic pitch detection and synthesized sound. Generative AI arrangement assistance is future work.

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
3. Select a note in the piano roll, edit its MIDI pitch, start beat, duration, or velocity, and press **Apply note**. You can also add or delete notes. Keyboard users can reach notes with Tab and edit through the labeled form fields.
4. Add tracks to layer parts. Each track has a name, volume, mute switch, and one of three synthesized instruments: **Soft keys** (sine), **Warm flute** (triangle), or **Bright synth** (sawtooth). These are simple waveform sounds, not sampled acoustic instruments. Play and stop the combined composition.
5. Save a project backup or export MIDI/WAV. Recording, importing, or trying the demo on a populated track asks before replacing its notes. Opening a project, loading an example, or starting a new composition also asks before replacing existing notes.

**Cancel** discards an in-progress capture or analysis and preserves the existing notes. Microphone tracks are released on stop, cancellation, or recording failure. Cancelling while permission is pending also releases a stream that arrives afterward; it cannot close the browser's permission prompt. Leaving the page stops capture and playback.

## Timing and limits

The interface counts beats from **1**. Saved project JSON uses zero-based note starts: displayed beat 1 is `start: 0`, and displayed beat 2.5 is `start: 1.5`. Durations are in beats. Changing tempo changes playback speed while preserving the edited musical positions.

- Tempo: 40–240 BPM; 1–8 tracks; at most 256 notes per track.
- Pitches: MIDI 36–96 (C2–C7); note duration: 0.25–16 beats; note ends must be at or before internal beat 128.
- Velocity and track volume: 0–1. Zero velocity and muted tracks are silent.
- Capture/import: 20 seconds; audio file/blob limit: 10 MiB. The decoder allows a small duration tolerance for encoded recording tails; analysis processes at most 20 seconds.
- Imported project JSON: at most 1 MiB, with version and value validation. Invalid imports leave the current composition intact.

## Save and export

The current composition autosaves to this site's `localStorage`, when available. Browser storage belongs to that browser profile and site address; it can be cleared or become unavailable. There is no account backup or cloud synchronization. Storage errors appear in the interface, and **Save project file** remains available. Export `.melody.json` backups regularly and reopen them with **Open project**. Saved projects contain notes and settings, not the source recording; captured/imported audio is discarded after transcription.

**Export MIDI** writes a standard format-1 `.mid` file with track names, tempo, note timing, velocity, volume, and approximate General MIDI instrument choices. Overlapping notes of the same pitch within one track merge into one sustained MIDI note at the highest velocity; adjacent notes retain separate attacks. This avoids ambiguous note-off behavior in MIDI players. The local WAV mix layers those notes independently. Another music app's instruments may sound different. **Export WAV** renders the current local instruments and mix as mono, 22,050 Hz, 16-bit PCM audio. Synthesis runs in a cancellable worker to keep large compositions responsive. Muted tracks are omitted from audible output. MIDI and WAV are exports; this MVP imports audio or its own project JSON, not MIDI compositions.

## Browser requirements and accuracy

Microphone capture requires a secure context (localhost or HTTPS), explicit browser permission, `getUserMedia`, and `MediaRecorder`. Playback and audio decoding require Web Audio; transcription uses a Web Worker. Supported import formats depend on the browser's codecs. If microphone access is denied or unavailable, use imported audio, manually added notes, or the generated demo. Downloads and local storage must also be permitted by the browser.

Chromium is the browser verification target. Safari, Firefox, and mobile device recording/codec behavior need separate real-device evaluation; a narrow Chromium viewport does not establish mobile browser compatibility.

Pitch detection is for a **single pitched voice or instrument**, not chords, full songs, or polyphonic separation. Background noise, breath, vibrato, harmonics, and unclear note boundaries can cause missed notes, octave mistakes, or inaccurate timing. Listen back and correct the result. Tests and the generated demo use synthetic audio; they demonstrate deterministic detection behavior and do **not** measure real humming/singing accuracy. Real microphone evaluation and generative arrangement assistance remain outstanding.

## Verification

```sh
npm run test
npm run lint
npm run typecheck
npm run build
npm run test:browser
```

`npm run check` runs unit tests, lint, and the build (which includes type checking). Browser tests run separately, build the production assets, and start their own preview server on port 4174. Install Playwright's Chromium if needed:

```sh
npx playwright install chromium
npm run test:browser
```

Alternatively, point Playwright at an existing Chromium executable:

```sh
CHROMIUM_PATH=/path/to/chromium npm run test:browser
```

Unit coverage includes bounded project validation, local storage errors, recorder cleanup/cancellation, synthetic pitch and timing fixtures, synthesis, and MIDI/WAV structure. Browser coverage exercises composition editing, layering, playback, persistence, imports/exports, generated-audio transcription, permission failure, and a 390 px layout. These checks do not replace real vocal or device testing.
