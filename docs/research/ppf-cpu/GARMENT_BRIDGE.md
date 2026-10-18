# Actual garment bridge (#288)

## Outcome and current admission

The native candidate must evaluate the garment the designer edited. The accepted contact/tensile/bending fixtures are prerequisites, not garment acceptance. This research-only capture now carries an actual fixed application tee through `teeMesh`, `buildCloth` and `bodyProxy`, rather than authoring another synthetic coupon. It is **not yet a native solver input**. The shipping workspace/worker is unchanged.

The fixed case is the existing Blank tee,104cm chest/72cm body/21cm sleeves, crew neck and entered94cm body chest with the original derived waist/hip/depth. No uploaded art, user project, photograph or private measurement is read. Capture supports validated tees without carried pockets; sweatshirt/hoodie/bottoms refuse rather than lose parts.

The versioned packet retains every render part's original ordered triangles, local-to-welded-particle map, original shell positions and authored UVs; all welded initial positions, inverse masses, structural and distance-bending constraints; seam memberships; library materials and areal mass labels; per-particle collision clearance; and the actual analytic body primitives. Geometry is in metres, inverse mass in1/kg and areal density inkg/m². Design/body measurement metadata explicitly says `_cm`; the retained material object preserves its named `gsm`/`tileCm` library fields. Browser compliance remains explicitly in s²/g and is **not** copied to a native constitutive coefficient. Its distance-bending and mass conventions remain browser approximations, not measured physical parameters.

`export-native-garment.ts` records hashes of all runtime source dependencies, itself and the pinned dependency lock. `garment_admission.py` independently reconstructs seam/topology membership, structural edge/rest metrics, triangle areas and vertex gaps to the captured analytic body. It can verify current source hashes with `--app`. CI also regenerates and compares the **entire decompressed packet**, then compares the recomputed report with the retained report. This prevents a self-consistent but altered packet or stale summary from passing as the fixed capture. Gzip bytes may depend on Node/zlib; decoded content must be identical. The retained archive has its own exact hash below.

## Actual first capture

[Complete packet](results/garment-first.json.gz),148675bytes, SHA-256 `9d42e001549f4dc8b4558b14b33a58404c02204a22a93b2c16fda31db17fc045`. [Independent admission report](results/garment-first-admission.json):

| Measured item | Actual result |
| --- | ---: |
| Welded cloth particles |2331|
| Authored render triangles |4484|
| Triangles collapsed after welding |4, all neck rib|
| Structural edges / distance-bending constraints |6833 /6607|
| Seam membership groups |198|
| Nonmanifold edges / boundary edges |0 /226|
| Intrinsic triangle rest area / inflated initial shell area |0.831797 /1.094939m²|
| Direct-shell rest mismatches (>2µm absolute) |3553 edges, maximum76.022mm|
| Flattened-XY rest mismatches (>2µm absolute) |58 edges, maximum21.659mm|
| Initial vertices inside full analytic body (1µm tolerance) |0|
| Minimum initial vertex gap to analytic body |15.989mm|

Four collapsed render faces are preserved in the capture and reported; `buildCloth` already skips them. There is no claim that they have been admitted to a native mesh. The intrinsic area is reconstructed from the actual structural edge lengths; it is not physical measured fabric consumption. A positive vertex gap does **not** establish triangle-interior/continuous clearance or validity of a triangulated native collider.

## Why neither naive native mapping is acceptable

Pinned upstream [`builder.rs::compute_inv_rest`](https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/crates/ppf-cts-solver/src/builder.rs#L371-L429) constructs shell rest tangents from3D rest vertices. Per-face UVs rotate that tangent basis toward the first UV edge; they do not replace its lengths/area. Therefore supplying the inflated styling shell plus flat UVs makes the wrong unstretched garment. This is a source-derived conclusion supported by the captured edge differences, not a native experiment.

The existing main panels use flatXY structural lengths. The neck rib uses wrapped flat-neckline distances and a modelled width. Flattening the entire welded mesh also changes those58 rib edges. A faithful candidate needs an explicit rest-preserving cut/unwrap/stitch representation or a validated per-face intrinsic-metric path; silently deleting the rib, changing its rest lengths or treating appearance UVs as a rest shape is not acceptance.

The captured body is an analytic union of stadium sections and tapered capsules. It is not yet a closed, oriented, independently admitted native static-triangle collider. Contact initialization, triangle-interior clearance, seam/contact exclusions and native rest/mass/bending mapping must be verified before the one-garment/two-material CPU comparison. No garment native run was attempted at this stage because both naive rest mappings fail the preflight. Normalized native coefficients still need explicit provenance/calibration; library names and GSM labels alone do not supply them.

## Reproduce

From repository root, with Node24, Python3 and the Clothing dependencies installed:

```sh
npm ci --prefix apps/clothing-studio
node --experimental-strip-types apps/clothing-studio/scripts/export-native-garment.ts /absolute/new-packet.json.gz
python docs/research/ppf-cpu/garment_admission.py /absolute/new-packet.json.gz --app apps/clothing-studio
python -m unittest discover -s docs/research/ppf-cpu -p 'test_garment*.py'
npm run check --prefix apps/clothing-studio
```

The CLI requires a new `.json.gz` output path and refuses overwrite. It reads only the fixed synthetic template. It needs no native build, model, GPU or service. `.github/workflows/clothing-ppf-garment.yml` reproduces the packet/report; the separate existing research harness workflow covers all Python oracles. Neither runs a native solver.

Actual tests were written against deliberate capture/admission stubs first; [capture RED](results/garment-capture-red.txt) and [admission RED](results/garment-admission-red.txt) are retained. An initial test assumed body-vertex overlap; the actual capture disproved that assumption (zero inside,15.989mm gap), and the test/report were corrected without claiming triangle clearance. Review caught omitted collision clearance and ambiguous design centimetres; both are repaired, with an [actual units regression](results/garment-design-units-red.txt). Source and actual packet received independent read-only review. Hosted gates and canonical integration are recorded when complete.

This is useful native-adapter groundwork, not engine adoption, calibrated material behavior, garment-runtime/settling acceptance, anatomical fit or manufacturing validation. #288 remains open for the rest/seam/body adapter and actual two-material comparison; Clothing remains ACTIVE.

## Rest-preserving cut-rib candidate

The next coherent step resolves the structural-rest blocker without pretending it resolves native physics. `garment_rest_adapter.py` keeps the main panel welds, unwraps the rib as an explicit open strip, retains its duplicated closing row, and emits22 semantic zero-distance sewing pairs. Only the4 render faces already collapsed by the original weld are skipped, with part/render-face identities retained. Every other ordered triangle and its authored UVs are preserved. Sewing equivalence classes recover exactly the original2331 particles at exactly the original initial positions.

[Complete candidate](results/garment-rest-candidate.json.gz) contains2353 candidate vertices and4480 faces; [summary](results/garment-rest-candidate-summary.json) records99147bytes, SHA-256 `65b7803437d3c6cdddd81fe23118b222a2bd2ee5b6f3b428e5d50093ae14041e`. Independent tests check all6833 structural edges against the captured browser rest lengths. Maximum error is5.23248e−8m (52.3nm, below the unchanged2µm tolerance), from original Float32 rounding. All valid source faces appear exactly once, and all candidate vertices are referenced. An independent reviewer rebuilt and compared the actual retained candidate. CI protects the complete decoded candidate and its retained summary.

```sh
python docs/research/ppf-cpu/garment_rest_adapter.py docs/research/ppf-cpu/results/garment-first.json.gz /absolute/new-rest-candidate.json.gz
```

The candidate is **not the native6-wide barycentric stitch ABI**, and no native solver has executed it. Finite-stiffness stitches/contact exclusions and cross-seam hinge behavior need explicit validation; recovering a topological quotient is not evidence of dynamic equivalence. Native rest-area mass also differs from the browser’s modelled-rib shell-area convention. Body triangulation/contact, material coefficients, settling/runtime and actual two-material comparison remain open. The original preflight correctly continues to reject both naive mappings; this candidate does not erase its measured failures. [Actual adapter RED](results/garment-rest-adapter-red.txt) precedes the three passing adapter tests.

## Closed faceted body candidate

`garment_body_mesh.py` now converts the same captured analytic proxy to a closed, outward-oriented marching-tetrahedra surface at a declared2cm lattice step. The source torso continues below its last section; an explicit cap at−0.6m closes this candidate below the garment. Bounds, asymmetric grid origin and grid dimensions are retained. It samples the existing stadium/tapered-capsule field, including its approximations/discontinuities, rather than substituting an anatomical avatar.

[Complete body candidate](results/garment-body-candidate.json.gz),436020bytes, SHA-256 `bd9ea2954855b0ba2db985c27feb0079af6eaac73806a581046ee0831e431965`, has19574 vertices/39144 triangles and signed volume0.0977467566m³. [Summary](results/garment-body-candidate-summary.json) retains those measurements. Every edge has exactly two oppositely oriented incident faces. Independent review also found one connected component, no duplicate faces and Euler characteristic2, and rebuilt the entire actual candidate identically. Those topology checks do not establish native contact accuracy.

The maximum absolute **proxy-field residual** at candidate vertices is0.0126061977m. This is not a Hausdorff/geometric-error bound: the source field is not an exact Euclidean signed-distance field, and torso/capsule joins include sharp transitions. The39k-triangle cost and12.6mm residual are explicit reasons to keep collider accuracy, convergence and CPU performance open. Garment triangle interiors, continuous contact, native static-collider ingestion and fitted drape have not been admitted or executed.

```sh
python docs/research/ppf-cpu/garment_body_mesh.py docs/research/ppf-cpu/results/garment-first.json.gz /absolute/new-body-candidate.json.gz
```

Four body-mesher tests cover an independent sphere’s closed orientation/volume and surface error, the actual body’s closed topology/explicit limits, invalid/clipped grids and wrong-unit packet refusal before output. [Initial RED](results/garment-body-mesh-red.txt) and [review-caught units RED](results/garment-body-units-red.txt) are retained. The CLI now audits the complete source packet before meshing; no wrong-unit candidate is written. CI regenerates and compares this entire candidate and summary as well.

## Software verification so far

Initial reviewed capture source `6aa97eacfc7034a074fa0427a5073d4c1a7a9da2` passes [application CI39096525216](https://github.com/twangyal/projects-monorepo/actions/runs/39096525216), job117584032509:159 units, lint, production build and all195 native browser cases (4.4min). The research module is not imported by the shipping workspace, whose built asset hashes stay unchanged. Its [preflight CI39096525244](https://github.com/twangyal/projects-monorepo/actions/runs/39096525244) passes packet/report reconstruction. Reviewed cut-rib source `850f2060780c01cf162990d1fea5e92b0ab4c73d` passes [preflight CI39096808156](https://github.com/twangyal/projects-monorepo/actions/runs/39096808156). Final body source83c714f passes preflight39096930890/job117585217529 with12 research tests and complete artifact replay. Canonical commit6a29662 passes159 app units/all195 browser cases,66 research tests and complete preflight replay; [canonical integration evidence](../../2026-10-18-clothing-native-garment-integration.md) retains exact commits, jobs and counts. No native solver runs are hidden behind these software checks.

## Native frontend follow-through

The first actual CPU/frontend attempt now refuses original scene admission; see [native evidence and controlled follow-up](GARMENT_NATIVE.md). The capture/rest/body candidates alone do not establish solver motion.
