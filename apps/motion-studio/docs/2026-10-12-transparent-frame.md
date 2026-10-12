# Transparent frame PNG (#196)

Artists can export the current committed640×360 frame with a transparent background for compositing elsewhere. This explicit PNG control shares the ordinary renderer: complete admitted snapshots, held drawings, layer poses/opacity and original image bitmap bindings. It clears the background then draws normal source-over artwork. Opaque PNG remains unchanged; GIF and PNG frame ZIP retain their background. No schema/project/history/autosave change is made. Frame/title capture and pngRequest/operation/generation checks retire stale async blobs exactly as in the established single-frame exporter.

Both PNG buttons now guard pointer activation before a focused pose field can blur and auto-commit. Their keyboard handlers also admit pending drafts. This repairs an existing opaque-export admission defect alongside the new action.

## Verification

Local Node24:270units plus lint, TypeScript and build passed. Official Chromium153 complete production browser suite:187 passed. Original literal fixture establishes half-opacity red ink RGBA(255,0,0,128), opaque imported magenta and moving cyan, zeroRGBA at empty pixels, unchanged640×360 dimensions, and opaque white at empty pixels in the original PNG action. The selected-stroke overlay really has alpha at stage(251,180), while exported transparent PNG has zeroRGBA there. At the last frame, cyan moves exactly from(450,280) to(494,280) with transparent pixels at its original location. Complete backup/autosave equality and disabled Undo prove exporting made no saved edit.390px keyboard export uses the explicit frame-specific transparent filename and has no horizontal overflow.

RED/GREEN:invalid transparent-option unit initially failed before validation. Native tests failed on missing transparent controls and on the existing opaque PNG blur-commit interaction. Two first browser starts failed on test-only TypeScript issues; corrected the premature parameter call type and unused import before the meaningful failing browser run. No gate was relaxed. Independent review found no implementation blockers and requested the stronger overlay-pixel check, now present. Full187 suite includes all original opaque media and project workflow tests.

This is one-frame RGBA export, not transparent GIF, alpha PNG frame archives, video/compositor integration or learned artwork. Motion remains ACTIVE under the complete animation product direction; project#8 stays skipped.
