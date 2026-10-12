# Retained point correction (#194)

The revised ACTIVE animation vision needs contour editing, beyond moving whole paths. Numbered vertex selection now identifies a committed point with a pose-transformed stage ring. Explicit Apply corrects its exact local coordinates; Discard restores raw point/appearance fields. Point selection is session-only. Committed geometry uses the unchanged complete-project schema.

Only one vertex changes. Other points, brush appearance, other strokes, detached cels, pose keys and original imported PNG bytes are preserved. The entire held exposure changes; independent later drawings do not. Each axis accepts finite −1280..1280 coordinates; fractional values are retained. Invalid indices, malformed coordinate objects/accessors and invalid project targets reject before publication. Unchanged Apply does not erase Redo.

## Verification

Local Node24 gate:267 unit tests, lint, TypeScript and production build passed. Official Chromium153.0.8010.12 full production suite:181 passed. Independent original literal projects prove complete backup/Undo/Redo/autosave/reload equality. PNG at stage(320,200) is opaque red after correcting local endpoint(60,40); decoded GIF frame0 and held frame5 retain red while independent cel frame6 stays white at that pixel. A 90-degree,2× pose places the selected local(60,0) marker at stage(320,300); actual overlay pixels distinguish it from the other endpoint and it is excluded from project artwork/exports. Native no-op Apply retains Redo.390px layout has no horizontal overflow.

RED/GREEN:two units initially failed on absent API; two browser cases initially failed on absent UI. Independent review found a P2 label-focus gap. A new native test reproduced it: clicking a point label blurred and committed an unrelated valid pose draft. Capture guards on both pointerdown and label default click fixed the root cause; all point labels/coordinate input and button entry paths now preserve that raw pose and focus. Final independent review found no unresolved issues. The first broad suite passed179 before added regressions; final181 is the complete gate, not a relaxed subset.

This is precise deterministic polyline editing. It does not provide semantic objects, learned artwork, freehand vertex dragging, path erasing or arbitrary curve topology. Motion remains ACTIVE under the full product direction. No project#8 work or paid services were used.
