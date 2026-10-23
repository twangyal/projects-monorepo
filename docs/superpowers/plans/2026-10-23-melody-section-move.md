# Melody all-track section relocation — #311

Autonomous execution under the owner's standing instruction; no clarification or PR.

Outcome: move an existing musical section elsewhere without copying or rebuilding notes. Existing duplicate/remove tools cannot do this. Add a session-only destination beat alongside the current one-based, end-exclusive section bounds. Move whole notes across all tracks, including muted parts, by one common offset; keep IDs, durations, pitch, velocity, sounds, reference assets and song-time automation anchored. Leave the source gap and all other notes in place. Destination bounds may extend beyond the current song but must fit 512 beats. Refuse intersecting unselected notes anywhere in the destination window, source-boundary splits, empty source and invalid values atomically. Overlap with the vacated source is allowed. Same destination start is a no-op.

Architecture: pure validated moveSection in the existing section-arrangement domain; existing commit/history/storage/export pathways; button joins sectionEditAction and its pre-blur/keyboard guards. No new dependency, schema, permission or audio behavior.

- [x] Red domain cases for exact all-track/fractional movement, identity/no-op, atomic collision/boundary/capacity refusal.
- [x] Implement validated immutable domain edit.
- [x] Red native missing-control case, then session destination + guarded Move section integration.
- [x] Native complete backup/history/reload and independent MIDI/WAV evidence; phone keyboard, raw draft, collision and no-op Redo coverage.
- [x] Full checks/browser, independent review, docs/roadmap, connected GitHub commit/CI and issue completion using actual evidence.

Final acceptance: [canonical/local receipt](../../2026-10-23-melody-section-move-acceptance.md); 463 units and 264 browser cases.
