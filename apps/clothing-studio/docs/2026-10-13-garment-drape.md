# Drape tops on a body — issue #248

## Intended outcome and gap

Designers should see how a styled top hangs on a body in the same 3D view where they style it, as Fabra does, with fabric and fit edits affecting the result. Before this change, tops were an inflated styling shell: not worn, and unaffected by fabric weight or stiffness. Only the measured skirt had a cloth simulation.

## Design (`src/garment-drape.ts`)

- **Cloth from the product's own parts.** The parts `teeMesh` builds become one cloth: body panels, sleeves, cuffs, hem band, neck rib and hood. Coincident vertices are merged, so the shoulders, side seams, armholes and neckline are sewn.
  - Body, sleeve, cuff and band edges rest at their flat lengths in the silhouette plane.
  - Bending pairs across a front-to-back seam are measured with both triangles unfolded about the shared edge, so seams hold no crease.
  - The neck rib's lengths follow the flat neckline.
  - The hood's horizontal lengths shrink by the neckline's flat-to-modelled ratio, keeping its height.
  - Pockets are carried on the front body at their flat position, lifted 0.5 or 0.35 cm along its normal.
- **Fabric.** Mass comes from flat area × g/m². Stretch compliance and bending stiffness are set by construction: jersey and slub stretch most, rib more still, then piqué and terry, linen, then twill and canvas, which are stiffest. Stiffness scales with weight. These are relative values, not measured fabric data.
- **Body proxy** (from the body chest girth and standard proportions):
  - The torso is made of stadium-shaped sections at the shoulder, chest, waist and hip.
  - Sloped shoulder capsules carry the garment's shoulder line; the neck and head are capsules too.
  - Arms are posed along the sleeves, slightly above their centre lines, and tapered so they never exceed the sleeves' flat circumference.
  - The default body is the garment chest minus 10 cm; 70–140 cm is supported.
- **Solver (XPBD).** 240 frames of 1/60 s, with 10 substeps each.
  - For the first 45 frames the body grows from half size inside the shell. The arms, neck and head grow in place, while the torso scales about the chest. Meanwhile every rest length eases from its shell length to its flat length, so the fabric shrinks onto the body instead of snapping.
  - Gravity and frictional contact then act. Fabric keeps 0.35 cm from the body.
  - There is no cloth-to-cloth contact, so the hood keeps 1.1 cm and lies over the back instead of passing through it.
- **Editor.** **Drape on a body** runs the simulation in a worker and shows the result in the 3D view with the body. The result is kept while only colours or prints change. A change of measurements, fit, modules, neckline, a part's fabric or the body drapes the garment again after a 250 ms pause. Exports stay garment-only: the body is kept out of the exported group.

## Results (Node, idle 4-core container)

| Template | Particles | Time | Contact share | Clearance | Residual speed |
| --- | --- | --- | --- | --- | --- |
| Ringer tee | 2,331 | 2.6 s | 54% | 0.35 cm | 2.3 cm/s |
| Breton stripe tee | 2,963 | 3.5 s | 59% | 0.35 cm | 1.9 cm/s |
| Crew sweatshirt | 2,877 | 3.8 s | 59% | 0.35 cm | 1.6 cm/s |
| Pullover hoodie | 3,150 | 3.8 s | 55% | 0.35 cm | 1.8 cm/s |

All four are with the default body (10 cm ease).

- **Shape.** Hems hang within 2 cm of where they were cut, and shoulders stay on the shoulders.
- **Stretch.** Median edge stretch is under 1%. The largest local stretch is 0.74–0.79 on tops and 1.57 on the hoodie. It sits at the four-way underarm junction and, on the hoodie, where hood, back and neckline meet. These are local artefacts of the proxy, not whole-garment stretch.
- **Body size.** A smaller body leaves more ease and less contact: 80 cm against 100 cm on the ringer tee.
- **Determinism.** Results are deterministic.
- **Fixes during development:**
  - Starting from the shell's own lengths removed a 4× initial strain at the seams.
  - Posing arms along the sleeves and growing them in place removed tangling at the underarm.
  - Body queries with bounding-sphere rejection made the solver 2.4× faster.

## Verification (local, 2026-10-13)

- **`npm run check`:** 99 unit tests, 5 of them new in `tests/garment-drape.test.ts`, plus lint and build. The new tests cover:
  - sewing and flat rest lengths;
  - a settled tee: clearance, residual speed, stretch, hem and shoulder heights;
  - ease and contact by body size, and determinism;
  - hoodie pocket and hood placement;
  - the body fitting its sleeves, and input checks.
- **Native Chromium:** the full suite passes; `tests/garment-drape.spec.ts` adds 2 cases.
  - A tee drapes, changes the view, and keeps its drape when recoloured. It drapes again with 18 cm ease after its chest grows. An impossible body is refused, and the styling shell returns.
  - A hoodie drapes, and trousers explain that draping is for tops.
- **Screenshots:** draped tee (front and side) and hoodie (front and back) were inspected.

## Not established

- **Fabric data.** Values are not calibrated against measured properties such as drape coefficients or tensile tests.
- **Body.** The proxy comes from one measurement, not a personal avatar. Its arms are posed to suit the sleeves. On steep-sleeved sweatshirts and hoodies they are slimmer than a real arm.
- **Contact.** There is no cloth-to-cloth contact or fabric thickness beyond the contact offsets. A hood lies down rather than up.
- **Coverage.** Bottoms are not draped. There is no strain or fit-pressure map yet.
