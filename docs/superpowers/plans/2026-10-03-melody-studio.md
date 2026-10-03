# Melody Studio Implementation Plan

> **For agentic workers:** Use test-first implementation with independent domain agents and a final fresh code review. Autonomous execution is explicitly authorized.

**Goal:** Deliver the complete local melody capture → edit → layer → export flow.
**Architecture:** Pure model/audio/file-format modules, a transcription worker, and a browser UI; no runtime dependencies or backend.
**Tech Stack:** TypeScript, Vite, Web Audio, Node test runner, Playwright/Chromium.
**Spec:** `docs/superpowers/specs/2026-10-03-melody-studio-design.md`.

## Global constraints

Follow the spec's exact limits and types in `src/types.ts`; keep excluded projects untouched. Node >= 22.18. No paid/network audio services. All project writes go through validation. Use branch Astra and reference issue #8.

## Review focus

- Malformed imports must not replace prior saved work; test invalid JSON, duplicate IDs, NaN, bounds, and extra fields.
- Silence/noise must not fabricate a melody; test silent and seeded noise fixtures.
- Permission cancellation must stop late microphone streams; test cancellation during a pending permission request.
- Tempo changes and overlapping tracks must export/play consistent timing; test parsed MIDI events and rendered duration.
- Local-storage failures and narrow layouts must remain usable; test blocked storage and 390 px browser layout.

## Task 1: Model and export formats

Files: `src/model.ts`, `src/midi.ts`, `src/wav.ts`, `tests/model.test.ts`, `tests/exports.test.ts`.
Interfaces: shared types; `createComposition(): Composition`, `createTrack(name?: string): Track`, `createNote(pitch?: number, start?: number): Note`, `createDemoComposition(): Composition`, `validateComposition(value: unknown): Composition`, `parseComposition(json: string): Composition`, `serializeComposition(project: Composition): string`, `compositionDurationBeats(project: Composition): number`, `encodeMidi(project: Composition): Uint8Array`, `encodeWav(samples: Float32Array, sampleRate: number): Uint8Array`.

- [ ] Write and run failing validation/export tests covering review focus and limits.
- [ ] Implement model and bounded interoperable export formats; MIDI uses distinct channels and track program changes, emits tempo and volume/velocity.
- [ ] Run domain tests and typecheck; review changes and commit.

## Task 2: Local audio engine

Files: `src/audio.ts`, `tests/audio.test.ts`.
Interfaces: `detectPitch(samples: Float32Array, sampleRate: number): number | null`, `transcribe(samples: Float32Array, sampleRate: number, tempo: number): Note[]`, `renderComposition(project: Composition, sampleRate?: number): Float32Array`, `createDemoMelody(sampleRate?: number): Float32Array`. Default sample rate 22050. Transcription yields validated note ranges and quarter-beat grid timing; valid silence returns no notes.

- [ ] Write and run failing tests with known frequencies, rests, noise, mixed tracks, tempo, mute and clipping bounds.
- [ ] Implement pitch estimation/segmentation and bounded deterministic instrument synthesis with attack/release envelopes.
- [ ] Run domain tests and typecheck; document limits and commit.

## Task 3: Recorder lifecycle

Files: `src/recorder.ts`, `tests/recorder.test.ts`.
Interface: `MelodyRecorder` exposes `start(onLimit: (blob: Blob) => void): Promise<void>`, `stop(): Promise<Blob | null>`, `cancel(): void`, `state: 'idle' | 'requesting' | 'recording' | 'stopping'`; uses browser MediaRecorder, default 20-second cap. Inject browser dependencies for lifecycle testing.

- [ ] Write and run failing denial, normal stop, cancellation, cap and late permission resolution tests.
- [ ] Implement lifecycle; disconnect/stop every track on stop, cancel and failure; never deliver cancelled audio.
- [ ] Run lifecycle tests and typecheck; review and commit.

## Task 4: Complete browser experience

Files: `index.html`, `src/main.ts`, `src/style.css`, `src/transcribe.worker.ts`, `src/storage.ts`, `tests/browser.spec.ts`, `README.md`, independent workflow and repository catalog.

- [ ] Write failing browser flow and storage tests, then implement capture/import/demo, piano roll/numeric editing, tracks, transport, autosave, and downloads.
- [ ] Run unit suite, typecheck, lint, production build, and browser tests; inspect desktop/mobile rendering.
- [ ] Fresh code review; fix meaningful findings with regression tests.
- [ ] Commit/push complete milestone, close issue #8 with evidence, and reassess the next valuable milestone.
