# Note articulation — 2026-10-12

Milestones [#190](https://github.com/twangyal/projects-monorepo/issues/190) and [#191](https://github.com/twangyal/projects-monorepo/issues/191) support deliberate note editing toward Melody's full-DAW direction. Melody remains ACTIVE; these checks do not establish musician usability or physical vocal accuracy.

## Behavior

Splitting inserts a second attack at a chosen song beat, preserving the selected identity on the first half, pitch, velocity, outer interval and unrelated note order. Both durations must be at least a quarter beat and the track must have room below 256 notes. Splits do not use the roll snap grid.

Joining removes exactly one uniquely touching successor with matching pitch and velocity, retaining the selected identity and outer interval. Different pitches remain independent voices. Ambiguous same-pitch chords, real gaps/overlaps and joined durations above 16 beats refuse atomically.

Floating-point subtraction can put a mathematically exact quarter or sixteen-beat boundary just outside validation. Only values within four machine-epsilon units scaled by the boundary magnitude are canonicalized; meaningful undershoot/overflow regressions still refuse. Adjacent minimum durations can differ at their shared boundary by one floating-point unit, with no frame/tick effect in the exercised examples.

Each split half starts a fresh synthesized envelope/filter/echo. Join produces one continuous held voice with one attack/release and one set of echoes. A join deliberately changes articulation; it does not mix velocities or tie distinct voices across tracks.

## Verification

- Split domain tests began with a failing no-op implementation; join tests likewise failed before implementation. Independent review identified decimal minimum and maximum cases; both regressions failed before their boundary fixes and pass afterward.
- Local `npm run check` passes **402 unit tests**, lint, TypeScript and production build for the combined implementation.
- Four native Chromium 143 workflows pass: actual project imports, fractional split, sustained join, independent MIDI event decoding and scalar sine/PCM WAV comparison, complete reference bytes, one-edit Undo/Redo, autosave/reload, pointer/keyboard raw-draft refusal, invalid-operation redo preservation and 390px layout. A real mobile screenshot was inspected.
- Split commit `cdb3a1f634f23b93db4163df916228f76541efaa` passed hosted [CI 38194711289](https://github.com/twangyal/projects-monorepo/actions/runs/38194711289): **398 unit and 212 native Chromium 153 tests**, lint, typecheck and build. Exact checkout and actual counts were checked in job logs.

The first full local Chromium 143 run at four workers retained **208 passes and four failures**: two backed-recording timing cases and two reference-playback timing cases. The two recording cases pass alone; the reference cases still fail locally at one worker. Hosted Chromium 153 passes all four. Baseline investigation and final published join CI outcomes are recorded in the linked issues; no original audio assertions or deadlines were weakened. Controlled browser audio and exported numerical checks do not prove physical output latency or broad browser compatibility.
