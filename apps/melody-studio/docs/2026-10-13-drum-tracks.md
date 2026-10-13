# Drum tracks — issue #221

## Intended outcome and gap

Melody's direction is a full production DAW whose roadmap includes "instruments and sounds" and complete productions. Before this milestone Melody had three oscillator instruments (soft keys, warm flute, bright synth) and no percussion. MIDI import labelled channel 10 unsupported. Without drums, no song made in Melody could carry its own rhythm section.

This milestone adds a drum instrument, a step sequencer to program it, and General MIDI percussion in and out.

## Design

- **Representation.** `drums` is a fourth `Instrument` value. A drum hit is an ordinary `Note` whose pitch is a General MIDI percussion key. No new document fields are needed, so autosave, project files, the composition library and undo history keep working unchanged. So do sections, quantize, repeat, velocity ramps, mute and solo, stereo pan and reverb sends, volume automation, stems, and WAV and MIDI export.
- **Kit.** `src/drums.ts` synthesizes each key deterministically from seeded noise and oscillators:
  - kick: sine with a pitch sweep and a click;
  - snare: tone plus high-passed noise;
  - clap: three bursts and a short tail;
  - closed, open and pedal hats;
  - six tuned toms;
  - crash, china and splash; ride and ride bell;
  - rim, cowbell, and shakers (tambourine, cabasa, maracas);
  - a tuned percussion tone for any other key.

  Each voice is normalized to peak 1, like the oscillators, so volume × velocity × 0.4 means the same thing on every track. Voices are cached per key and sample rate. High-pass cutoffs are clamped below Nyquist, so low sample rates stay finite.
- **One-shot rendering.** In `renderDry`, a drum hit mixes its kit voice. The voice length is the kit piece's natural ring (0.08–1.8 s), not the note's duration, and the ADSR envelope is not applied. The render still covers each note's full duration, so section and stem alignment are unchanged. Filter, echo, volume ramp and volume curve apply as for other tracks. Existing projects without drum tracks render exactly as before.
- **Step grid.**
  - Rows: Crash, Open hat, Closed hat, High tom, Low tom, Clap, Snare, Kick. Columns: 16 sixteenth-note steps per four-beat bar.
  - A step is a native button with `aria-pressed` and a label such as "Kick, beat 3 step 1". It works with the keyboard, and focus returns to it after the re-render.
  - Toggling adds a sixteenth-length hit at velocity 0.8, or removes the hit that starts exactly on that step. Each toggle is one undoable edit.
  - **Copy bar to next** replaces the following bar with the shown bar's hits.
  - **Start with a basic beat**: kick on 1 and 3 plus the "and" of 3, snare on 2 and 4, eighth-note hats with lighter offbeats.
  - The grid offers the track's extent plus one empty bar.
- **MIDI.** Export places drum tracks on channel 10 (index 9). Melodic tracks keep their track-index channels 0–7, so nothing collides. Import no longer flags channel 10 as unsupported; instead, a channel-10 part must be mapped to **Drum kit**, and the review rejects any other choice with an explanation. For drum parts:
  - key 35 becomes 36, the kit's kick, inside the editor's C2–C7 range;
  - hits shorter than the editor's 0.25-beat minimum are held for a sixteenth, which the kit does not hear;
  - a review warning discloses both and notes that same-key rolls faster than sixteenths merge on re-export.

## Verification (local)

- Unit (`tests/drums.test.ts`, 5 cases):
  - every grid voice is finite and normalized, and voices are deterministic and cached;
  - kick, snare and hat differ in brightness as measured by zero-crossing rate;
  - a crash's tail outlasts its sixteenth note, while held notes, envelopes and durations do not change the hit's samples;
  - gain follows volume × velocity;
  - hard-left drums leave the right channel silent in a mixed song;
  - toggling, limits, bar copying and the starter beat behave as specified;
  - documents round-trip, and MIDI note-ons go to channel 10 with melodic channels unchanged.
- MIDI review and oracle tests are updated: channel 10 is now a supported lane, and a new review test covers the drum-kit requirement, the key-35 mapping, short-hit holding and the warning.
- Browser (`tests/drums.spec.ts`, 2 cases, production Chromium):
  - add a track, choose Drum kit, start a basic beat, click and keyboard-toggle steps (focus kept), and copy a bar;
  - play, export WAV (energy present, ring included) and export MIDI (channel-10 note-ons for exactly the programmed keys);
  - four Undo/Redo edits restore the exact saved documents, and drums survive a reload;
  - at 390 px the page does not widen and the grid scrolls within its panel.
- `npm run check`: 422 unit tests, eslint, typecheck and build.

## Limits

- The kit is synthesized, not sampled. There is no sample import, kit choice or per-piece tuning yet.
- A track holds at most 256 hits, about eleven bars of a busy groove. Longer patterns use more tracks or Repeat phrase.
- The grid shows eight common pieces. Other keys are edited in the piano roll.
- There is no swing per pattern beyond the existing section quantize swing, no flams and no per-step probability.
- Sound quality has not been evaluated with musicians.
