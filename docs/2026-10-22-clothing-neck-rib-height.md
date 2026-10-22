# Editable finished neck-rib height — #301

## User outcome

Tees and crew sweatshirts now expose finished neck-rib height in the existing focused Fit tools. A finite1–4cm optional sparse `fit.neckRibHeight` retains default2cm when omitted. Actual cutting-strip height is twice the finished height; neckline sewing path/length, body, sleeves, styling data and all other construction remain. The same dimension drives the actual neckband mesh, existing garment-cloth rest construction, GLB and tech-pack K across size grades. Hoodies have no neck rib: the field hides/disables and supplied overrides refuse. Bottoms keep their existing rejection of top-fit fields.

Apply/reset follow existing complete Fit draft admission and history. Invalid raw drafts survive navigation and refuse atomically. Undo/Redo, project backups, saved designs, autosave and reload retain the applied value. This supplies construction precision in the owner's linked 3D/pattern workflow; it does not establish rib-material calibration, physical fit or production readiness. Clothing remains ACTIVE; project8 stays skipped and deferred projects remain untouched.

## Verification and retained first failures

Three new model cases first fail at unsupported new Fit data. After implementation, they pass exact cut-strip dimensions, actual neckband positions, unchanged non-rib meshes/pieces and sewing length, tech-pack K, complete sparse round trips, exact omitted/default2cm legacy geometry, actual cloth rest-edge growth, inclusive bounds and atomic invalid/hood/bottom refusal. All173app unit cases pass, plus lint/types/build.

Two actual browser cases first fail at the missing control before UI implementation. The first combined native regression invocation then passes9/10: all existing back-neck/shoulder cases and the new real strip/GLB/tech-pack/history flow pass. The new phone/template case incorrectly dismissed the existing native template-replacement confirmation, leaving a tee active. The test was corrected to accept that confirmation and verify the actual hoodie base before checking hidden/disabled behavior; no product guard was relaxed. Both corrected new cases pass in19.0seconds (7.2/3.1seconds case times); existing8regressions already passed unchanged. This is staged passing coverage of10distinct cases, not a claim of one final all-green local10-case invocation.

Independent read-only review finds no Critical/Important issues and reruns all9targeted rib/back-neck/shoulder unit cases. Actual390px screenshot inspection confirms readable fields and no horizontal overflow. Native checks independently decode actual GLB position buffers, inspect exact SVG strip height and rendered tech-pack K, compare complete backups through Undo/Redo/reload, retain invalid raw drafts and verify reset plus actual hoodie replacement. Existing back-neck/shoulder actual drape-worker regression cases pass; new model cases verify the changed rib rest construction. No physical fit/material test was run.

Canonical source and full-suite acceptance are pending until the integrated run finishes. No unrun check is claimed.
