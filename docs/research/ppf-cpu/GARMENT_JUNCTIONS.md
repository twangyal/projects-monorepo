# Intrinsic underarm junctions — #290

The three-second native study localizes its largest edge and principal strain to the underarms. Before changing rest geometry, this follow-through checks whether native welding introduced a disconnected/nonmanifold junction, and whether the captured original metric already carries the large corner budget. It changes no garment, solver, material, rest length, body/contact, seam, native source patch or frozen evidence.

## Reproducible source

The input is the strictly admitted [fixed-material requested-four soft archive](GARMENT_FIXED_MATERIAL_STUDY.md), artifact12201778448, SHA256 `fc2c0de508864f468b7a8669de0bcf2309db3c57611c02e6e46a280476a6bf70`. The existing full audit verifies the official archive, source/input/patch bytes, all181native frames and prior-prefix references before the new rest-only analysis runs. This adds no native execution. [The retained receipt](results/garment-junction-audit.json) includes all original incident face IDs/part/render-triangle provenance for the selected junctions. Original `authored_uv_m` coordinates are independently compared with the corresponding native rest triangles. These are captured styling-surface charts, not a claim that the separately generated exported 2D production patterns use this same metric.

```sh
python3 docs/research/ppf-cpu/garment_junctions.py docs/research/ppf-cpu/results/garment-fixed-four-soft.zip /tmp/garment-junction-audit.json
python3 -m unittest discover -s docs/research/ppf-cpu -p 'test_garment_junctions.py'
```

For each vertex, incident triangles form an undirected link graph. A connected cycle is an interior fan; a connected path with exactly two endpoints is a boundary fan. Duplicate faces, edges with more than two incident triangles, disconnected/branched links, unused vertices, degenerate/nonfinite rest or supplied authored triangles refuse. This is a combinatorial manifold check; it does not test orientability, embedding/self-intersection or continuous contact. Native finite-penalty stitches remain separate and are not welded by this audit.

Each triangle corner uses `atan2(norm(cross), dot)` in3D, or absolute2D determinant for the original chart. The intrinsic deficit is `2π − angle sum` at interior vertices and `π − angle sum` on the boundary. Per-part sums keep the original corner attribution. The summed budget is checked against `2π(V−E+F)` as a consistency identity, not independent physical validation.

## Findings

The native triangle complex has2353vertices,6834edges and4480faces;2125interior and228boundary vertices. All vertex links are connected valid fans. There are2connected components and5boundary loops: the cut neck-rib strip remains separate from the main welded shirt until the finite-penalty stitches act. Euler characteristic is−1; the summed interior deficits plus boundary turns are−2π (numerical residual about2.5e−14radians). These counts do not describe the fully stitched quotient.

| Underarm vertex | Fan | Native rest angle | Original authored angle | Native deficit |
| --- | --- | ---: | ---: | ---: |
|571, sleeveRight junction|10-face cycle|627.984479881°|627.984400836°|−267.984479881°|
|643, sleeveLeft junction|10-face cycle|627.984479881°|627.984400836°|−267.984479881°|

At each underarm, front and back contribute173.878274396° each and the sleeve contributes280.227931089°. The corresponding original chart sums agree within0.000079046° (about1.38e−6radians). This is measured finite-precision disagreement, not an adopted strain/geometry tolerance. The two underarms are the most negative interior deficits. Neighboring back vertices1639/1640 have flat360° budgets; peak principal-strain triangle3091 contains both and junction643. The earlier peak edge[561,571] reaches the other junction.

This rules out a disconnected/nonmanifold native vertex fan in this captured fixture and shows the large intrinsic saddle budget already exists in its source styling metric. Negative intrinsic curvature is legitimate sewn geometry: a separate known saddle-star regression is accepted. It is not proof of a construction defect, impossible embedding, excessive physical strain, or the cause of the native peak. Body contact, bending, pose and numerical effects have not been isolated here. Flattening the corner budget or rewriting rest lengths would change the design rather than establish a fix.

The next useful construction experiment should explicitly define an alternative source pattern/seam geometry and compare its native outcomes under preserved material/body/contact controls, or isolate a declared contact/pose control. Do not silently modify this fixture or call the current source-chart result production-pattern equivalence. Representative garments/bodies, physical material/fit references, sustained settling and shipping-engine adoption remain open. Clothing remains ACTIVE; project#8 remains skipped.

## Verification record

Baseline179research tests pass in287.839seconds. The first new-module run failed at missing `garment_junctions`; the initial4analytic geometry/refusal cases then passed. Authored-chart comparison and invalid-chart admission separately failed with two assertion failures before their implementation, then passed. Component/boundary-loop admission similarly first failed before implementation. The first report CLI and frozen replay exposed an assumed `run_url` field absent from the existing fixed-material auditor; removing that unsupported field retains archive/artifact identity and fixes the actual exception. All8focused analytic/frozen tests now pass, including flat disk, closed octahedron, rigid/scale invariance, genuine saddle, duplicate/nonmanifold/disconnected links, bad charts and exact retained underarm reproduction. Independent review found no Critical/Important/Minor findings. A separate `acos` calculation reproduced both underarm budgets and both10-vertex degree-two link cycles; the reviewer ran the7analytic/refusal cases without editing source. The complete expanded local suite passes187tests in290.702seconds. Source hosted [garment preflight39513822206](https://github.com/twangyal/projects-monorepo/actions/runs/39513822206) and [application39513822240](https://github.com/twangyal/projects-monorepo/actions/runs/39513822240) pass at `9678203c3f982db4ed49cec60b6b9980e15016cc` (tree `f220df0e9452851ef3b7168364dd8d48fd2bdb75`). The source preflight executes130garment tests plus actual cold capture, warm endpoint, rest/body reproduction and source/geometry admission. Application163unit tests, lint/types/build and209native browser cases pass. This verification addendum changes documentation only; implementation, tests and retained receipt remain the verified source bytes. Canonical research/preflight/application CI follows main integration; its actual results are tracked in issue#290.
