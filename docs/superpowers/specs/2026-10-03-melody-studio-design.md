# Melody Studio: local melody-to-composition MVP

## Intent and scope

Implement project #3 as a self-contained, useful music sketchbook in `apps/melody-studio`, tracked by GitHub issue #8. Users capture a single hummed melody, correct detected notes, choose synthesized instruments, layer parts, and save/export the result. All processing stays in the browser. No account, server, paid service, or external model is needed. The autonomous goal authorizes product decisions and continued execution without approval gates.

Project #2 needs macOS/Xcode, iPhone verification, and distribution entitlement approval (issue #9). A browser restriction simulation cannot meet its core promise. Gaze Nav and project #8 remain excluded.

## Architecture and alternatives

A vanilla TypeScript/Vite application provides a small static distributable. Pure domain modules make deterministic signal processing, project validation, synthesis, and file formats testable with Node. A Web Worker runs transcription; Web Audio handles microphone decoding and playback. This avoids backend costs and privacy overhead. Native/mobile-first DAW and hosted ML inference add deployment dependencies without improving this initial vertical slice.

## Experience

- Start with an empty composition or load a two-part example. Record up to 20 seconds with explicit microphone permission, cancel/stop controls and resource cleanup; import a browser-decodable audio file capped at 10 MiB and 20 seconds.
- Detect only monophonic pitched audio. Show silence/no-notes errors, and explain that noisy or polyphonic inputs need correction. Include a generated audio demo to exercise transcription without a microphone. No claims of measured vocal accuracy or generative AI.
- Edit title and tempo (40–240 BPM). Up to eight independent tracks, each with a name, instrument (sine, triangle, sawtooth), volume and mute. Select a track for recording/import. New captures replace notes only after explicit confirmation when a track already has notes.
- Render a labeled piano roll and an accessible note editor. Each note has pitch, start beat, duration and velocity. Add/delete notes; edit through standard form fields. Musical timing is in beats, displayed from beat 1; internal starts are zero-based. Tempo changes preserve musical positions.
- Play/stop layered synthesis; stop playback before edits. Local autosave, versioned JSON import/export, standard MIDI export, and 16-bit PCM WAV export. Invalid imports never overwrite the current composition. Failed persistence is visible.
- Responsive layout at 390 px and desktop widths, visible keyboard focus, explicit labels, polite status announcements, no horizontal page overflow.

## Data contract

`Note = { id: string, pitch: number, start: number, duration: number, velocity: number }`.
`Track = { id: string, name: string, instrument: 'sine' | 'triangle' | 'sawtooth', volume: number, muted: boolean, notes: Note[] }`.
`Composition = { version: 1, title: string, tempo: number, tracks: Track[] }`.

All numeric values must be finite. MIDI pitches 36–96; start >= 0; duration >= 0.25 and <= 16; start + duration <= 128 beats; velocity and volume 0–1. At most 256 notes/track and eight tracks, at least one track. IDs are nonempty, at most 100 characters, and unique across the composition. Names/title are nonempty trimmed strings <= 80 characters. Project JSON is limited to 1 MiB. Validation returns a reconstructed safe value, never arbitrary properties. Parsing errors leave the prior project intact.

## Verification and boundaries

Node tests cover validation, malformed and oversized imports, deterministic pitch fixtures, silence/noise, rests/timing, MIDI event order/tempo, and valid WAV headers/sample bounds. Chromium tests cover demo detection, note editing, tracks/instruments, save/reload/import/export, playback, microphone denial and cancellation, and mobile layout. TypeScript strict checking, ESLint, and Vite production build run in an independent path-filtered workflow.

Real microphone quality, Safari/mobile audio differences, polyphonic transcription, external sample instruments, and generative arrangement assistance remain outside the MVP. Keep project status ACTIVE until subsequent high-value work is assessed.
