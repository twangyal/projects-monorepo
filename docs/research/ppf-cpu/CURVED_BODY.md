# Curved static-body admission — #282

The user outcome is credible material-dependent garment/body drape. #279 and #281 admit tiny cloth/cloth and planar static contact; neither measures wrapping over a curved body. This bounded candidate experiment measures a free sheet deforming around a closed convex triangulated sphere, outside the shipping app. It is not a garment, anatomical avatar or fabric calibration.

## Frozen protocol before first native execution

Use `st-tech/ppf-contact-solver` at `6b30976f86e6b94d68d459e5237d59704c7d1384`, Apache-2.0, with its locked real CPU build. Reuse the #281 public Ubuntu build/dependency recipe and dedicated synthetic cache/supervisor. No user files, paid compute, network service or app backend is introduced.

- Static body: sphere radius0.20m, centre(0,0.90,0)m,8 latitude divisions/16 segments,114 vertices/224 outward triangles. The oracle measures the actual faceted convex mesh, not the smooth analytic sphere. Require closed consistently wound manifold edges, convex outward unit planes, actual native static promotion, matching world triangles and zero object transforms.
- Cloth:9×9 square,81 vertices/128 triangles, halfspan0.12m at y1.13m. Require the solved rest output to match authored vertices bijectively; remap cloth faces into the actual solved namespace. Static vertices must be absent from solved output.
- Identical enabled/disabled contact cases: dt1/120s, fps60, gravity(0,−9.8,0)m/s²,18 frames plus rest0,0.3 simulated seconds; Young modulus2000/bend20 upstream authoring values. These are illustrative upstream settings, not measured fabric properties or an established material-to-SI mapping.
- Full-triangle oracle: clip every cloth triangle against all body halfspaces offset inward by1µm. A nonempty intersection is penetration beyond the tolerance, even when all three vertices are outside. Count inside vertices separately. Maximum signed outward-plane separation at each vertex is a convex halfspace measure, not Euclidean distance outside the body.
- Enabled admission: zero inside vertex-frames and zero penetrating triangle-frames; mean descent greater than0.25×30mm and less than0.6×theoretical0.441m free fall; final y-range greater than5mm, excluding a flat/frozen result.
- Disabled admission: positive inside vertex and penetrating triangle counts, mean descent greater than0.8×0.441m. Both cases require exact saved frames0..18,81 finite vertices each; all1539 vertex-frames and2432 triangle-frames per case are checked.

Saved states do not establish continuous-time nonpenetration, self-collision acceptance, friction quality, folds/layers, seams, physical fabric accuracy or garment-scale runtime/convergence. The finite mesh/timestep is a single controlled admission case, not a general body solver acceptance.

## Validation and reproduction

Run `python -m unittest discover -s docs/research/ppf-cpu -p 'test_*.py'` and Python compilation. Analytic tests independently exercise cube crossings with every triangle vertex outside, tangent/outside/inside cases, malformed/open/inverted/nonconvex bodies, frozen/flat/ineffective controls, exact frozen meshes and missing/nonfinite/wrong-rest frames. Initial analytic-test execution fails at missing module import (not a numerical RED). The new collector execution-status regression fails with an actual `passed_curved_fixture` versus `failed_execution_gate` assertion before repair. The original planar/cloth tests remain unchanged.

Reproduce the #279 documented CPU build/dependencies, then replace `probe.py` with `curved_probe.py` in the same bounded supervisor command and run the separate always-run collector. `.github/workflows/clothing-ppf-curved.yml` does this on its short-lived source branch or explicit dispatch, not every main commit. Full native logs/frames, authored and actual geometry, solved rest mapping, hashes, dependencies, toolchain, build/fixture resource receipts and license are retained after failure as well as success.

Actual native outcome is pending. Build success or analytic synthetic tests alone cannot admit contact. Preserve the first native artifact and any failed gate unchanged before repairs. Clothing remains ACTIVE and the shipping XPBD application is unchanged; no native engine is selected.
