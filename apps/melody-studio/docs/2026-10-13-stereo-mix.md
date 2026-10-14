# Stereo mix, pan and a shared reverb bus — issue #218

## Intended outcome and gap

The product direction asks for a capable DAW with mixing, effects and routing. Melody Studio's engine was mono: every track summed straight into one buffer, with no pan, sends, bus or reverb.

## Design

- **Fields.** Optional track fields `pan` (−1 to 1) and `reverbSend` (0 to 1), and an optional song-level `reverb` (`size`, `level`), each in steps of 0.01.
  - They are validated in `src/mix-settings.ts` and allowed by the strict document whitelist.
  - Absent fields mean centred, no send and the default bus (size 0.5, level 0.5).
- **Rendering.** `renderDry` in `src/audio.ts` is the former renderer without its final limiter, optionally for one track, with an extra tail. `renderComposition` is unchanged in output: it is `renderDry` plus `limitPeak`.
- **Mixing.** `renderMix` in `src/mix.ts`:
  - uses the exact legacy mono path when no audible track is panned or sends;
  - otherwise renders each audible track dry, applies balance-law pan gains, and sums the sends into a Freeverb-style stereo reverb (feedback 0.7 + 0.28 × size, damping 0.35, stereo spread 23 samples, scaled to the sample rate);
  - adds the reverb return and peak-limits both channels jointly.
- **Worker and export.** The worker's `mix` mode returns one or two channels, or a mono or stereo WAV (`encodeWavChannels`). Playback, sections, solo, stems and WAV export use it; the reference comparison path stays mono. MIDI adds CC10 and CC91 at tick 0 only when the fields are set.

## Verification (local, 2026-10-13)

Node.js 22, Chromium 141 via `CHROMIUM_PATH`.

- `npm run check` passes: **416** unit tests, 5 of them new in `tests/mix.test.ts`, plus ESLint and the build. The new tests cover:
  - Unchanged mono samples for legacy projects, and for muted or panned-but-silent tracks or a bus with no sends.
  - Pan gains. A hard-left bass plus a centred melody equals the separately rendered stems summed exactly into left and right, within 1e-5.
  - Reverb: tail length, audible tail, decorrelated channels, joint limiting, determinism, longer energy for larger rooms and silence at zero return.
  - Validation, JSON and document round trips, and strict unknown-field refusal.
  - Stereo WAV header and interleaving.
  - MIDI CC10 and CC91, present only when set.
- Native Chromium: the 2 new cases in `tests/stereo-mix.spec.ts` drive the real sliders.
  - Hard-left pan exports a stereo WAV whose left channel equals the original mono WAV sample for sample, with a silent right channel.
  - Send and size produce the expected tail length and an audible right-channel tail.
  - Playback creates a 2-channel AudioBuffer.
  - Three Undos restore the original project and byte-identical mono WAV; Redo and reload keep the mix.
  - Centring the pan removes the field, and the panel fits a 390 px screen.
  The complete native suite passes: **all 223 cases**.

## Not established

- Listening evaluation by musicians: reverb character and pan law preference.
- Insert effect chains, more buses, stereo delay, effect automation and a dedicated mixer view.
- MIDI import of CC10 and CC91.
