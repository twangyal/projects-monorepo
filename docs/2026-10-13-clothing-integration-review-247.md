# Clothing canonical integration review — #247

Selected immutable source: `68273c3d9e970e9762680092df9b55e51da0f11c`, completed Fabra-style work through POM and drag handles #243. Later prompt styling/top drape work is outside this snapshot. Canonical main retains its existing Clothing implementation until these integration blockers are repaired and verified.

Independent state and geometry reviews found the following:

1. **Pending skirt draft loss:** drape fabric bypasses construction/grading draft guards. Applying waist80, typing90 without Apply, then choosing denim resets the visible value to80. A native regression reproduced expected90/actual80. The task-branch repair refuses drape changes while pattern/grading drafts are pending; after Discard, ordinary fabric editing remains allowed. See task branch verification before claiming this correction accepted.
2. **Late product image ownership:** motif/artwork handlers await decoding then mutate the current project/selected part without a generation fence. New/imported projects and newer uploads can receive an older completion. Freeze target/project/generation; retire on relevant new editing intent and always close acquired bitmaps.
3. **Aggregate backup admission:** individually admitted product assets can yield a validateProject-admitted 8,101,554-byte graph, beyond the existing6MiB serialize/import limit. Autosave lacks aggregate admission. The review's model-level reproduction establishes an inconsistent graph budget, not successful native image decoding. Preserve recoverability and existing asset/header limits before admitting new uploads.
4. **Raw product draft loss:** product rendering resets unapplied measurement, fit, artwork-placement, tech-pack and costing fields during unrelated edits/part selection. Add intentional draft ownership/Apply/Discard behavior and original-draft regression evidence.
5. **Mixed tech-pack export:** specifications snapshot once, but front/back captures await the mutable visible scene. A newer template/style can appear in exported images beside old tables. Export from one immutable scene/snapshot and retain filename ownership.
6. **Neckband mismatch:** fit neck widths12/28 yield measured opening perimeters35.242/63.653cm while flat binding remains48.64cm. The3D collar follows fit; pattern/export/consumption/tech-pack binding does not. Derive the band from the revised neckline with an explicit rib reduction.
7. **Tapered chest POM mismatch:** accepted chest150,length55,sleeve21,hemWidth95 produces80.103cm at the documented2.5cm-below-armhole line but the tech pack says77cm, outside its±1cm tolerance. Derive measured POM and diagram endpoints from actual side seams.
8. **Raster import validation:** syntax-only data URLs such as invalid PNG `AA==` and caller-declared dimensions are accepted. Product assets need bounded header/dimension and decode verification on import/restore, matching existing photo safeguards. Do not treat a safe MIME/data-URL prefix as verified raster content.

Original photo/sketch/recovery generations, body profiles, grading and waistband functionality remain in the frozen snapshot; their presence does not resolve these new boundaries. The simulation documentation appropriately discloses approximate presets, missing physics and physical evaluation limits. Unit tests checking nominal dimensions/shared vertices miss the two measured-geometry inconsistencies above.

Source baseline and guarded source both pass88 units, ESLint, TypeScript and production build locally. The first guarded browser attempt timed out during its cold web-server build; this is not acceptance evidence. The focused correction is checked against the already verified ordinary production build. The broader native suite and remaining blockers must pass before main integration. These findings and the partial correction are tracked in GitHub issue247; it remains open. All apps remain ACTIVE and project8 stays explicitly skipped.

The focused corrected drape case now passes in Chromium143 against the ordinary verified production build: the unapplied waist90 remains visible and the full committed backup stays unchanged after rejected fabric selection; after Discard, denim applies normally. The same case failed before repair with actual80. Full local88-unit/lint/TypeScript/build checks pass on guarded source. This resolves one integration blocker only; no broad browser/physical garment acceptance or main Clothing integration is claimed.

Durable guarded candidate: [`2583d63776a436c920fc7d086eb2bf33a7e57d3e`](https://github.com/twangyal/projects-monorepo/commit/2583d63776a436c920fc7d086eb2bf33a7e57d3e), on `autonomous/clothing-integration-247`, based on canonical main with the accepted Gaze changes. Its [hosted gate](https://github.com/twangyal/projects-monorepo/actions/runs/38422722282) passed on 2026-10-13: 88 unit tests, lint, TypeScript, production build and all 89 native browser cases. The pending grading refusal was inspected but has no dedicated new native regression. Passing this gate does not resolve the other seven review findings; canonical Clothing remains unchanged and #247 remains open.

## Continued repairs — 2026-10-13

The integration branch now reaches `1052bd941fe2e0ab5db9883e025ab8bbc2b06123`. Five of the eight original findings are repaired there, with canonical Clothing unchanged:

| Original finding | Task-branch state |
| --- | --- |
| 1. Pending skirt/grading drape guard | Repaired in `2583d637`; 88 unit/89 hosted browser tests passed. Dedicated new grading refusal case remains absent. |
| 2. Late motif/artwork ownership | Repaired in `e519b097`; captured generation/project/target, stale feedback suppression and finally bitmap cleanup. 90 unit/96 hosted browser tests passed in [38426304952](https://github.com/twangyal/projects-monorepo/actions/runs/38426304952). |
| 3. Aggregate recovery budget | Repaired in `1052bd94`; complete canonical UTF-8 graph admission precedes history/storage and editor success feedback. 93 units plus focused production-native import refusal and geometry/download/reload pass locally. |
| 4. Raw product drafts | Open. Preserve Apply/Discard drafts across unrelated edits, selection and asynchronous repaints. |
| 5. Mutable tech-pack image export | Open. Use one immutable design/scene and filename for every image/table. |
| 6. Neck rib mismatch | Repaired in `2e2b8ade`; exact flat front/back sewing path ×0.85, with explicit fabric-confirmation assumption. |
| 7. Chest POM mismatch | Repaired in `2e2b8ade`; side-seam intersections at the documented 2.5cm-below-armhole line, including diagram endpoints. Geometry hosted gate [38424621499](https://github.com/twangyal/projects-monorepo/actions/runs/38424621499) passes90 units/90 browser tests. |
| 8. Raster admission | Open. Verify container/header/decode bounds rather than trusting data-URL syntax/dimensions. Also repair existing sub128px artwork encoding-loop rejection discovered during test preparation. |

The final combined [hosted gate38426887294](https://github.com/twangyal/projects-monorepo/actions/runs/38426887294) is running at this handoff; do not claim its final result until observed. Separate exact-cap budget fixtures use synthetic raster strings and establish schema/recovery behavior only. Near-cap interactive serialization cost is unprofiled. Physical fit, material stretch and exact3D opening-perimeter equality are not established by these flat pattern corrections.

Independent read-only reviews found no scoped blockers for geometry, upload ownership and budget corrections. App-level evidence documents are committed on the task branch: `2026-10-13-measured-geometry-247.md`, `2026-10-13-product-asset-ownership-247.md` and `2026-10-13-project-budget-247.md`. Their first failures and corrected test-fixture/order mistakes are retained. Resume remaining work from the immutable candidate/current task branch, reconcile any newer main direction, and keep #247 open until review findings and final acceptance are resolved. Later style/top-drape branches remain outside this selected snapshot.
