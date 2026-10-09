# Drawing exposure timing — 2026-10-09

Issue: [#161](https://github.com/twangyal/projects-monorepo/issues/161).

## Delivered outcome

Artists can move the active non-first drawing's start without recreating its retained artwork. The native frame-entry prompt identifies its existing start, uses displayed frames 2 through the timeline end, and explains that other drawing starts and pose keys stay fixed. Crossing another start deliberately changes exposure order; the complete candidate is sorted and validated before a single history/autosave edit. Success selects the moved drawing at its new start. The first drawing remains at frame zero.

Cancellation, unchanged input, malformed or occupied targets, and capacity refusal preserve the project and Redo. An unchanged start also preserves the current interior frame and an independently reviewed in-between proposal. Preblur pointer admission and keyboard admission preserve other raw pose/name/stroke drafts. No project schema, renderer or image resource lifecycle changed.

## Verification evidence

- Missing module/control tests first failed, then three domain cases and five focused native cases passed. Strict parsing also has a separate failing-then-passing case for nonfinite or invalid timeline counts.
- Domain checks compare the detached complete project, crossing and sorting boundaries, blank drawings, unchanged keys, missing/first/occupied targets, no-op history and exact canonical JSON capacity. At exactly 6 MiB, a longer frame digit refuses atomically.
- Native checks use actual browser prompts, literal independently expected project downloads, and a decoded PNG at the old exposure time: the original red dot appears, the moved blue dot is absent, and a magenta imported image remains. Undo/Redo, native saved-project readback and reload retain the exact graph.
- Canceled, unchanged, occupied and invalid prompts preserve an existing Redo branch and current frame. A real reviewed in-between proposal remains reviewable after unchanged input, with no second confirmation dialog.
- Pointer activation preserves a valid uncommitted pose value before native blur; keyboard activation preserves an invalid stroke-width draft without opening a dialog. The 390px screenshot was visually inspected: drawing controls remain readable and contained.
- Independent read-only review found that pending file/library/recovery reads were not included in the new action locks. A held genuine File read reproduced the enabled-action failure before the fix. Restore/retry/library flags now guard both controls and handlers for retiming, drawing-layer copy and neighboring-drawing guides. The regression verifies disabled controls, forced clicks that cannot mutate or retire the load, and successful completion of the original incoming project.
- Final `npm run check`: lint, typecheck, 254 unit tests and production build passed. Full `CHROMIUM_PATH=/tmp/motion-chromium-wrapper npm run test:browser`: 164 passed (1.4m), exit 0. Existing exports, recovery, private links, project library and tween workflows remain included.

The native browser checks use CPU Chromium 153. They do not establish physical-device behavior or completion of the wider animation product. Motion Studio remains ACTIVE; learned motion, deeper drawing tools and broader creative workflows still require product development.

Hosted CI for the published commit is recorded in issue #161 after its actual result is available.
