# Linked measured construction — 2026-10-09

Tracks #167, following the physical two-panel milestone #166. The same strict waist/hem/slant draft now supplies the 2D net, 64-vertex/32-quad rigid shell and OBJ surface. Circumferences describe continuous underlying circles; polygonal approximation shortens the faceted rims. This is a construction study, not cloth simulation or validated fit.

## Executed verification

- `npm run check` in Clothing Studio: **48/48 units**, lint, TypeScript and production build pass.
- `CHROMIUM_PATH=/tmp/clothing-chromium-wrapper npm run test:browser`: **56/57 native Chromium cases** pass in 18.6s against the production build.
- Five shell domain cases independently check radii/circumferences, 60cm meridian lengths, slant/height relation, seam pairing, deterministic finite projections over extreme admitted parameters, outward cross-product normals and valid OBJ indices/groups/coordinates.
- Five new native cases check actual SVG polygon coordinates against independent equations; both views through Apply/Undo/Redo/saved reload; raw drafts retained during session rotation; focused blank placement protected before pointer blur; real OBJ bytes/groups/geometry unchanged by yaw; refused raw-draft export; keyboard access and 390px no-overflow layout.
- Inspected the complete 390px shell screenshot: viewport, readable status/limitations and all rotation/export buttons are visible.

## Failed evidence and scope

Initial shell domain tests failed because the module did not exist; implementation passed. The outward-normal regression then failed on inward winding and passed after reversing quad ordering. The OBJ test failed because its export was absent and passed after implementation. Earlier native measured-pattern launch attempts ran no app cases because the temporary Chromium wrapper was missing; recreated it with the existing native executable. A root npm check cannot run because this monorepo has no root package; the complete affected-app check above was explicitly executed. No limits or tolerances were weakened.

OBJ is unitless by specification: its header and UI explain centimetres and waist-centre origin with +Y toward hem. No external material files, thickness, body, cloth physics, allowances, waistband or closure are supplied. Far-side seam guides are intentionally shown. Mathematical identities and automated retention checks do not establish sewing or physical fit acceptance. No paid services or new dependencies.

Fresh independent whole-branch review found one Important defect: equal/absent construction settings retained old raw measurements after accepted whole-project import. A native regression failed first; accepted import now explicitly resets construction controls, including identical backups. The full 48-unit/57-browser gate above passed after that fix. Failed/stale imports retain drafts; photo-only imports do not reset them. No Critical or deferred Minor findings. The coarse surface and visible far-side guides remain disclosed constraints, not simulation claims. Exact-head hosted [run37937396303](https://github.com/twangyal/projects-monorepo/actions/runs/37937396303) at 2ff23cbea594478fc7a82b16db624dc6cbe652b6 succeeded. Actual job logs confirm48units/57browser cases with lint/typecheck/build. Issue167 is closed.
