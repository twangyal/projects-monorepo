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

## First native execution and raw-input replay — 2026-10-17

[CI39056778354](https://github.com/twangyal/projects-monorepo/actions/runs/39056778354), job117466246316, passes the real locked CPU build,17 harness tests, both frozen native cases, supervisor and complete evidence collection. Source `ea2db166b136480474646275312b856b4838b5ca` records the protocol before execution. [Pristine archive](results/curved-first.zip), [receipt/manifest](results/curved-first.json) and [recomputed audit](results/curved-first-audit.json) are durable in git. The ZIP is215185 bytes; SHA256 `66f5c7eff0cab10f815db3a377a154456c2cbcd7b733eaa178474f615fa2b54a`, artifact12109373688.

| Saved-state metric | Contact enabled | Contact disabled |
| --- | ---: | ---: |
| Inside vertex-frames | 0 | 813 |
| Penetrating triangle-frames | 0 | 1454 |
| First penetrating frame | None | 5 |
| Minimum halfspace separation (m) | 0.0007437696422240014 | −0.1894595508383694 |
| Mean descent (m) | 0.055321044392055985 | 0.44757580757141113 |
| Final y-range (m) | 0.06871366500854492 | 0 |

Each case checks1539 vertex-frames and2432 full triangle-frames. Actual native input buffers contain114 static vertices/224 triangles and81 dynamic vertices/128 triangles, with zero per-object displacement and the frozen object maps. Raw rest vertices and mapped native cloth topology match the authored sheet. All262 native files verify against recorded bytes/SHA256; exact38 raw output frames contain9234 finite float32 coordinates. Full native logs and actual/static/input geometry are retained. Supervisor exit0, no remaining children,4.076236739s including cleanup against300s.

Observed build wall255.15s; full fixture wall3.991267913s includes preparation, both native cases and oracle analysis, not pure solve time. Per-process peak RSS1422836KiB build /72900KiB fixture, not aggregate memory. The original archive retains exact environment/dependency versions and resources. These are public-runner tiny-fixture costs, not garment performance.

### Replay assurance and review history

The standalone replay command was added after first source launch; it does not change the frozen native fixture or acceptance thresholds. Source review found no important/critical issues. Review of the first replay found it trusted exported geometry JSON without independently decoding native scene inputs. A regression expecting missing native inputs to refuse failed (`ValueError not raised`), then passed after decoding actual float64 vertices/displacements, uint64 triangles and uint32 object maps, comparing native and frozen topology/world geometry and checking pinned upstream/source hashes. Complete local validation now passes20 tests plus Python compilation and whitespace checks; native CI ran its original17. Independent re-review repeated all20 tests and the actual archive replay, confirmed that native case parameters differ only in contact enablement and found no remaining important/critical findings. Synthetic replay tests are not real native runs. Initial module-import failures are not numerical RED evidence.

Reproduce the complete archive audit from this checkout without loading any native solver or pickle:

```sh
python docs/research/ppf-cpu/curved_audit.py docs/research/ppf-cpu/results/curved-first.zip --sha256 66f5c7eff0cab10f815db3a377a154456c2cbcd7b733eaa178474f615fa2b54a
```

The result supports this pinned curved convex-body case: the moving enabled sheet forms a nonplanar drape outside the body at every saved state; the disabled control falls through it. Next evaluate unit-aware material mapping/coupons, seams/layers and a fixed garment/body across two documented materials, resolutions and timesteps with independent physical references. This result does not establish anatomical fitting, calibrated fabric accuracy, continuous-time nonpenetration, self-collision acceptance or garment-scale performance. Clothing remains ACTIVE; the shipping XPBD application is unchanged and no native engine is selected.
