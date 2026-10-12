# Contour topology editing (#195)

The existing numbered point editor can now insert one midpoint after a selected vertex and select it immediately. Editing the new vertex adds a bend to a formerly straight segment. Delete removes a single vertex, joins remaining neighbors and selects the next vertex, clamping to the preceding endpoint when necessary. A stroke retains at least one point. These are deterministic retained-polyline edits, not semantic object manipulation or learned artwork.

Candidates are detached and completely validated before editor intent changes. Insertion refuses at the last point or existing1000points/stroke,10000points/project and serialized project limits. Deletion refuses invalid indices and sole-point strokes. Brush appearance, all other geometry/exposures/poses and original image data remain unchanged. Whole held exposures share the edited artwork. Changed operations each use one complete Undo/Redo/autosave edit; raw geometry/appearance and pose fields guard pointer and keyboard actions before blur.

## Verification

Local Node24:269 units, lint, TypeScript and build passed. Official Chromium153 full production suite:184 passed. New unit cases first failed on absent APIs, native cases on absent controls. One initial unit fixture used the two-point yellow stroke rather than the intended sole-point green stroke; corrected its index3→2. No implementation gate was weakened.

Original literal red endpoints(-60,0)/(60,0) receive midpoint(0,0); moving it to(0,40) yields independently decoded opaque-red PNG pixel at stage(320,220). Complete backups prove exact source preservation after removing that point, three independent Undo states, Redo and actual bent-artwork autosave/reload.390px native checks retain raw7e- and focused valid pose321, refuse endpoint insertion/sole-point deletion and allow deliberate keyboard insertion. Additional last-endpoint deletion checks remaining(-60,0), clamped selected index0, disabled sole-point operations, exact full project and one-edit Undo.

Independent review found no correctness blockers and requested the endpoint clamp case, which now passes. Motion remains ACTIVE toward richer artwork editing, useful learned assistance and the complete animation vision. Project#8 remains skipped.
