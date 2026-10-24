# Melody chord octave placement — final acceptance (#320)

Source c6be69e616362d3ad9612abe72eb77c83cca040a. Canonical [run 40086076010](https://github.com/twangyal/projects-monorepo/actions/runs/40086076010), job120849177220, completed successfully on2026-10-24:469units, ESLint/TypeScript/build and all267browser cases (3.9m). Full local Chromium143 also passed267/267 in3.9m with two workers before the subsequent workspace reset. No dependency/schema/workflow/deadline changes.

The three new native cases verify ordinary-note octave placement, actual MIDI/WAV with independent decoders/oracles, complete backup/reference equality, Undo/Redo/reload, selected-note editing, phone pointer/keyboard raw-draft refusal, range admission and atomic refusal/history. Six helper cases cover unsorted/exact-onset grouping, wide/exact octaves, exact C2/C7 and overflow, collision/touching, unchanged overlaps, malformed/stale/drum/unison/direction and256-note capacity. The source checkpoint retains missing-module/action RED.

Fresh read-only review found no blocker and independently passed6helper cases; it did not run browsers. This accepts explicit authored octave placement, not learned harmony, musician quality or physical recording acceptance. #300 stays open; Melody stays ACTIVE; #8 remains skipped. No PR. These observed gates supersede pending acceptance in the source checkpoint.
