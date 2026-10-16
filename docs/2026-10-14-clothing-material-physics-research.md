# Material-dependent drape: research and next measured milestone — #256

Research checked 2026-10-14 against owner direction in PRODUCT_DIRECTION section 5. This is a research/design deliverable, not a calibrated engine release. No fabric sample was measured, no reference garment was captured, and no published coefficients were copied into the product. Clothing remains ACTIVE.

## Recommendation

Keep the worker-based XPBD foundation, but replace the material-to-edge heuristics in a separately tested swatch milestone before claiming realistic material-dependent garment drape. Preserve the current approximate garment preview during that work. Establish material coordinates, dimensional energy definitions and reproducible coupon tests first; do not tune the whole garment until it merely looks different. The present renderer texture name is not a physical material identifier.

The user outcome is the same cut and body exhibiting defensible differences when fabric changes. Current code distinguishes texture presets, but cannot explain those differences through measured directional properties, construction or cloth contact. A swatch harness closes the parameter/units gap without pretending a new preset closes the entire garment-physics requirement.

## Primary sources and their implications

1. [Macklin, Müller and Chentanez, XPBD (MiG, October 2016)](https://mmacklin.com/xpbd.pdf), equations 5, 18 and 26. Compliance belongs to a specified constraint energy; its timestep scaling is alpha/dt². Dissipation is treated explicitly. **Our implication:** a coefficient is meaningless without its constraint definition, geometry normalization and units. The solver name alone does not validate a material.
2. [Macklin et al., Small Steps in Physics Simulation (SCA, July 2019)](https://mmacklin.com/smallsteps.pdf). The authors investigate many small substeps with one XPBD sweep versus a large step with many sweeps. **Our implication:** the current one-sweep-per-substep loop is not inherently a defect. Test convergence and cost on our meshes; do not add iterations or reset rules merely to resemble another implementation.
3. [Wang, O'Brien and Ramamoorthi, Data-Driven Elastic Models for Cloth (TOG/SIGGRAPH, 2011)](https://wanghmin.github.io/publication/wang-2011-dde/Wang-2011-DDE.pdf). Their model and measurement work addresses nonlinear, directional stretching and bending, with fitted measurements for ten specimens. **Our implication:** mass and a single isotropic stretch scalar do not identify fabric behavior. Start with a documented directional approximation, retaining the ability to represent measured curves later.
4. [The authors' material-parameter supplement](https://jamesobrien.com/papers/Wang-DDE-2011-08/material_parameters.pdf) explicitly uses metres, kilograms and seconds. Its published specimen densities include Gray Interlock 0.187 kg/m² and 11oz Black Denim 0.324 kg/m². These correspond to 187 and 324 g/m², respectively. They identify particular specimens, not universal cotton/denim defaults. Their model-specific coefficients are not directly interchangeable with our edge compliance. The [author page](https://jamesobrien.com/papers/Wang-DDE-2011-08/index.html) links data; check redistribution terms and implementation compatibility before importing any. The large raw archive was not downloaded.
5. [Bridson, Fedkiw and Anderson, Robust Treatment of Collisions, Contact and Friction for Cloth Animation (SIGGRAPH, 2002)](https://visionsystems.stanford.edu/papers/cloth-sig02/) treats contact, friction and cloth thickness as a substantial separate problem. **Our implication:** body projection alone cannot establish layered garment realism. This research used the author-hosted abstract; full-paper retrieval failed, so this note does not claim to reproduce its algorithm.

These sources motivate the work; the proposed architecture, tests and acceptance targets below are engineering decisions for this repository, not published experimental results.

## Audit of the current implementation

Audited `apps/clothing-studio/src/garment-drape.ts` at main `0dcfa75ae6840a5a23c03e5b56e1a99bae7fbba3`; #255 changes view organization, not this solver.

| Quantity | What the code actually does | Gap to address |
| --- | --- | --- |
| Mass | Triangle area in cm² × gsm / 10000, divided among three vertices, produces grams. Modelled hood/neck pieces use spatial triangle area. | Valid dimensional mass conversion; audit area against flat rest geometry and construction layers. GSM is currently a library value, not a measured specimen receipt. |
| In-plane response | Each texture supplies one stretch compliance; shared edges average adjacent values. No explicit grain coordinates, warp/weft law or shear term. | Separate directional strain/shear energy and normalization from mesh triangulation. |
| Bend | Opposite-vertex distance constraints use `1/(bend*40)`; bend is texture preset × gsm/180, with a hood multiplier of 4. | A distance proxy with a heuristic mass multiplier is not a measured bending rigidity. Use an area/edge-normalized shell bend model and record its derivation. |
| Integration | cm, g, s; gravity 981 cm/s²; 60 visual frames/s, default 10 substeps and 240 frames. One sequential constraint sweep per substep; lambda starts at zero each substep. | Report discretization sensitivity rather than assuming timestep/mesh invariance at finite solve cost. |
| Damping | Exponential velocity decay uses 12 s⁻¹ during growth and 1.2 s⁻¹ afterward, shared by all fabrics. | Separate initialization stabilization from measured free-decay/material damping; numerical dissipation must also be reported. |
| Body/contact | Chest-derived stadium torso/capsules grow for 45 frames; uniform body clearance 0.35 cm, hood 1.1 cm. Contact removes 35% of displacement before reprojection. | Clearance is not measured fabric thickness, and the removal fraction is not a Coulomb coefficient. Body dimensions/pose and contact law need independent validation. |
| Construction | Meeting vertices are sewn together. Hood/neck use special rest lengths; pockets are carried offsets on front triangles. No cloth self-contact. | Seam stiffness/allowance, hems, multiple layers and free pockets require explicit construction models; hood clearance is a workaround, not layer contact. |
| Reported metrics | Ease, body clearance/contact share, maximum structural-edge extension, final maximum speed. | Useful numerical diagnostics; they do not measure directional coupon response, physical silhouette error or personalized fit. |

## Parameter contract for the next implementation

Use SI internally at the solver boundary while keeping the user's cm/gsm interface. A versioned physical profile should distinguish `illustrative`, `published-specimen` and `measured-specimen`; include source URL/receipt, method, specimen ID, date, orientation, uncertainty, supported strain/curvature range and unavailable fields. Keep visual texture/print/color separate. Do not silently fill unknown physical fields with asserted measurements.

| Field | Proposed representation / units | Calibration evidence |
| --- | --- | --- |
| Areal density | kg/m²; gsm / 1000 | Weigh known-area conditioned coupons; include scale and area uncertainty. |
| Grain | Per-piece material basis mapped from flat pattern coordinates; angle in radians | Mark warp/weft or knit wale/course and cutting direction; rotating a print must not rotate physical grain. |
| Stretch and coupling | Initially a stable orthotropic membrane energy, coefficients N/m; dimensionless strain | Load/extension per specimen width along both axes plus bias/shear and transverse contraction observations. Later piecewise curves retain valid strain ranges. |
| Bend | Directional shell bending rigidity N·m with rest-curvature convention | Controlled strip/cantilever geometry, known density and photographed deflection in both directions; fit only to stated protocol. |
| Damping | Explicit chosen law, e.g. modal decay rate s⁻¹ for an initial demonstrator | Release-and-decay sequence at fixed geometry; separate solver dissipation using timestep sweeps. |
| Thickness/contact | Thickness m; dimensionless friction coefficients with named counter-surface | Pressure/method-specific thickness; sliding/incline protocol, body fabric versus cloth-cloth distinction. Unknown remains unknown. |
| Seams/layers | Rest connection, stitch spacing m, dimensional seam energy and layer construction | Sewn versus unsewn paired coupon; stitch, seam allowance, hem/lining specification. No universal hood multiplier. |

Dimensional checks derived here: 1 cm = 0.01 m; 1 g = 0.001 kg. A 20 × 20 cm coupon at 180 gsm weighs 7.2 g (0.0072 kg). For a distance constraint C measured in metres and energy C²/(2 alpha), alpha has units m/N = s²/kg; alpha/dt² has inverse-mass units. The same distance-compliance numeric value in current g/cm/s units must be multiplied by 1000 to express s²/kg. Do not use that factor for dimensionless strain constraints or angular bend constraints: derive their energy/area factors independently. A conversion test must cover both representations and the same physical response.

## Next usable milestone and acceptance

Build a worker-backed **material swatch comparison**, sharing the future garment material law. It should load a documented profile, show grain orientation, run a hanging/cantilever or controlled tensile coupon, and export inputs plus numerical results. Offer clearly labeled illustrative profiles until legitimately reusable measured references exist. Avoid a commercial engine migration before this small harness identifies what the current approach cannot meet.

Completion criteria for that implementation:

- Unit/energy checks, total coupon mass, finite states, reproducibility and known limiting cases pass. Changing mass with all elasticity fixed must not silently change bending coefficients.
- Swapping a 0° and 90° grain orientation swaps the directional coupon response; changing only triangle diagonals should not redefine the material. Measure two resolutions and multiple timesteps/substep budgets with identical physical inputs and elapsed time. Set convergence tolerances from recorded sensitivity, not after seeing desired screenshots.
- Fit and validation observations are separate. Report load/extension residuals, tip/silhouette distances in physical units, repeatability and reference uncertainty. Do not claim physical validation without actual or suitably licensed reference observations.
- For a subsequent garment gate, freeze one pattern, body dimensions/pose, grain/cut, seams, mesh, camera and lighting. Compare at least a light knit and a stiff woven specimen, with both simulation and reference setup disclosed. Report hem/silhouette/landmark distances and deformation, not just that screenshots differ.
- Add contact milestones separately: body contact, cloth self/layer contact and construction. Test folded/layered cloth, collar/hood, seams and carried-versus-free pockets, penetration and friction sensitivity. Until then, show the limitations beside Body & drape.
- Preserve current saved projects, cancellation, owned worker disposal, phone responsiveness and export snapshots. Existing physical-fit limits stay visible.

Physical coupon/garment measurements and reuse rights are missing, but development of the unit-aware harness is unblocked. This research closes #256's investigation only; it does not complete the owner's material-physics requirement or justify a MAINTENANCE status.

### Axial first implementation — #266 (2026-10-15)

The controlled tensile harness now implements a narrowly stated static axial strip, with SI energy/mass/force checks,0°/90° illustrative coefficients,8/16element comparisons, independent material/coupon stiffness and numerical JSON. It is available in Body & drape without changing garment physics. See `apps/clothing-studio/docs/2026-10-15-tensile-swatches.md` and the integration receipt for actual gates. This does not fulfill the above membrane/shear/bending/time-integration/diagonal/contact/physical-reference acceptance criteria; those remain the next substantive stages.
