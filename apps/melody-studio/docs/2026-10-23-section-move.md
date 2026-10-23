# All-track section relocation — #311

Move section uses the existing one-based, end-exclusive source range and a session-only destination beat. Every whole selected note, including muted tracks, moves by one common offset. No copied IDs, ripple, overwritten notes or reference/audio movement. The destination window must fit512 beats and be empty of unselected notes on all tracks. Overlap with the vacated source is allowed; exact boundary contact is allowed. Existing source bounds stay where entered. Same-position movement is a no-op.

## Verification checkpoint

- Five focused domain tests initially fail because moveSection is absent; native browser test initially fails on the missing destination control. Added strict validation and guarded UI afterward.
- Domain fixture corrections: an initial note duplicated its track ID, and one collision note was shorter than the existing0.25-beat minimum. Both were corrected to legal authored data. Domain cases now cover literal fractional offsets, anchored automation/sound metadata, detached output, muted-track/window collisions, source splits, empty source, invalid/capacity bounds, edge contact, source overlap and same-position movement.
- Initial project check passed463 units, lint, TypeScript and build. Three of four initial native cases passed, including complete backups/history/reload, independent MIDI/WAV, phone keyboard movement/no-op and refusal/Redo. The draft fixture's keyboard setup deliberately blurred a valid basic title, which commits by existing design before Enter. It now uses a valid explicit-Apply note draft for keyboard refusal while retaining the valid-title pre-blur pointer check. No production field semantics changed.
- Fresh independent review found no Important/Critical defect; identified navigation and metadata coverage gaps were addressed with real Arrange→Compose→Arrange raw-destination navigation and explicit sound/automation data.
- Final project check passes463 units plus lint/TypeScript/build. All four final native cases pass, including actual raw destination retention across focused navigation, phone keyboard/no-op/Redo, complete-project backup/history/reload and independent MIDI/WAV oracles. The domain test also verifies a literal backward move restores the original complete graph.
- Final local full-browser suite and canonical CI acceptance are pending at this checkpoint.

## Limits

This moves musical notes, not retained audio clips. References/assets, envelopes, effects, mix and song-time automation stay unchanged, so users must check their alignment after relocation. No snapping, ripple, collision merging or silent partial edit. File format, project/note limits, generation/privacy/permissions and synthesis remain unchanged. Native software workflows do not establish physical listening quality or musician usefulness. Melody remains ACTIVE toward the DAW vision; project#8 remains skipped.
