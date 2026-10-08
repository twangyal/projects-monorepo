# Melody section arrangement

Issue #141. The intended user outcome is to repeat a layered verse/phrase as one arrangement edit. The existing single-track Repeat phrase cannot do this; the full DAW vision remains in docs/PRODUCT_DIRECTION.md.

Use #140's one-based start and exclusive end, without frame-quantizing note timing. Insert a copy of every contained note across all tracks immediately after the selected end; shift every note starting at or after that end by the exact range span. Preserve original IDs, track settings, timing offsets, rests, velocity and reference assets/bindings; copied notes get new UUIDs.

Refuse atomically if any note crosses either boundary, no contained notes exist, or the result exceeds existing 256-notes-per-track or 128-beat guards. Muted notes participate. Do not split/clamp notes or rewrite reference audio.

Guard all unapplied editor fields and continuation proposals before pointer blur can commit them. Success is one complete-project history edit, autosave and existing MIDI/WAV/project export. Undo/Redo restore exact complete documents. Bounds remain session-only. No schema/dependency changes or full-DAW completion claim.
