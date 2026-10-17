# Clothing Studio: PPF Contact Solver evaluation

Research date: 2026-10-17. The owner asked to investigate [st-tech/ppf-contact-solver](https://github.com/st-tech/ppf-contact-solver) for Clothing Studio.

**Recommendation:** evaluate PPF as an optional native, higher-quality drape backend. Keep the responsive Three.js workspace and current browser preview while measuring that option. This is a research recommendation, not an engine selection, completed integration or authorization to purchase GPU compute.

## Evidence and scope

Reviewed upstream at **`6b30976f86e6b94d68d459e5237d59704c7d1384`**: README, license, Rust workspace, server protocol, Python scene interface, fitting example and calibration sources. Compared with Clothing Studio on canonical main **`69ca6c4`**, including its independent tensile/bending/membrane experiments, paired fabric comparison, entered body dimensions and artwork placement. No upstream executable was built or run; no independent runtime, memory or accuracy benchmark was performed. Upstream results remain upstream evidence.

This supplements [the material-physics research](2026-10-14-clothing-material-physics-research.md). Its units, provenance and independent physical-validation requirements remain in force.

## Relevance to Clothing Studio

PPF offers finite-element deformables, shell materials, bending, friction, strain limiting and continuous collision detection with a contact barrier. Cloth self-contact and contact between layers are particularly relevant to our solver's gaps. Its Python interface and Blender add-on provide reference workflows. The fitting notebook stitches imported panels; it is not a complete pattern editor.

| Current application | Question for a PPF evaluation |
| --- | --- |
| Browser-worker XPBD, heuristic texture-specific stretch/bend values and library GSM. | Does a shell material law improve drape enough to justify its solve cost? |
| Body projection with fixed clearance and a sliding-removal fraction; no cloth self-collision, extra hood clearance. | Can body/self/layer contact resolve folds credibly, and how sensitive is it to friction/thickness? |
| Meeting vertices are merged; pockets ride on front triangles. | How should seams and independently simulated layers be represented? An engine change alone does not make carried pockets free sewn cloth. |
| Chest, optional waist/hip girths and chest depth drive an approximate body proxy. | Can a captured proxy mesh work first? Better simulation does not validate anatomy or personalized fit. |
| Separate SI tensile, bending and orthotropic membrane experiments with illustrative profiles. | Can controlled coupons validate parameter mapping? Those laws are not yet the garment law or directly interchangeable with PPF parameters. |

Sources: upstream [overview][overview], [scene direction/rest geometry][scene], [fitting example][fitting]; local `apps/clothing-studio/src/garment-drape.ts` and app swatch documentation.

## Runtime, reliability and license

- **Native execution:** Rust workspace, native compute backends and Python/PyO3 bindings. No documented browser WASM/WebGPU backend was found. A browser port would be a separate substantial project.
- **Hardware:** current upstream supports NVIDIA CUDA, Apple-silicon Metal and SIMD CPU. It advertises ROCm but says it has never run on real AMD hardware. Upstream describes CPU and Metal as slow, suitable for small evaluations; larger scenes need a powerful GPU. Measure on available hardware before promising latency.
- **Offline and experimental:** upstream explicitly disclaims real-time operation and production readiness; it is not differentiable. Its published 2–3× speedup compares its own revisions on an L40S, not against our worker or an end-to-end garment flow.
- **Conditional contact claim:** “penetration-free” applies when a solution succeeds. Runs can stall/fail or encounter bugs. Impossible initial configurations do not become feasible. Audit initialization and independently check intersections.
- **Browser bridge:** the reviewed server uses custom raw TCP (`TCMD`, `JSON`, `BDAT`), not a browser HTTP API. Integration needs a local companion or separate native compute worker with a narrow job interface, progress, cancellation and captured-result delivery. A static frontend alone cannot run it. Keep notebook/general control interfaces out of the browser-facing API.
- **Apache-2.0:** promising for commercial integration, subject to its terms and applicable license/notices. Review dependencies and imported-asset licenses before distribution. External example garment data needs its own reuse assessment.

Sources: [overview/requirements][overview], [workspace][workspace], [server protocol][wire], [performance comparison][performance], [license][license].

## Fabric calibration: useful approach, limited transfer

The shell presets are Silk, Flag, Cotton, Wool, Denim and Leather. They use Baraff–Witkin, strain limits and **the same density, 1.0 kg/m²**, with density-normalized stiffness enabled. Documentation calls the modulus a calibrated membrane value in its normalized convention, not textbook Pa. It says density under that convention affects inertia/contact without changing static draped shape.

Do not copy these coefficients into XPBD compliance or our SI membrane/bending fields. Derive the model's energy, area/thickness and density conventions and check controlled coupon responses. Preserve real GSM separately: 180 gsm is 0.180 kg/m², not the preset's 1.0 kg/m². Retain specimen IDs, orientation, sources and illustrative/measured labels.

The checked-in Cusick targets combine published values with broad material-class ranges. The tensile reference is a literature-informed relative ranking; its report records a Wool/Flag ordering exception and an unreliable projected-width Poisson diagnostic. These are not measured equivalents of our user's fabrics. The Cusick script pins the central disc flat without a collider, so that result does not independently validate difficult body or layer contact. Fold count is explicitly qualitative.

Upstream also notes that non-unit shell Shrink X/Y disables strain limiting. Do not use shrink as an undocumented rest-shape shortcut. Verify directional mapping explicitly; a UV/direction API does not prove parity with our orthotropic law.

Sources: [preset conventions][presets], [values][materials], [calibration methodology][calibration], [Cusick targets][targets], [Cusick implementation][cusick], [tensile limitations][tensile].

## Recommended evaluation milestone

The intended outcome is fabric-dependent draping with credible body and cloth contact while the main 3D editor stays responsive. The remaining gap is nonlinear garment materials and self/layer contact with evidence. Evaluate that gap before choosing an engine.

1. **Reproducible native experiment, outside the shipping app.** Pin the revision, record backend/hardware/toolchain and start with small tensile/bending coupons and folded cloth contact. CPU can establish basic execution on available hardware; record unsupported features/failures. Larger evaluations need available authorized GPU resources, not purchased compute.
2. **Versioned scene/result adapter.** Capture flat rest geometry, initial 3D geometry, grain, part/triangle IDs, seams, profiles and body surface/pose. Convert cm to m and g to kg. Top geometry is y-up; the separate skirt export uses a different y convention, so define axes/winding per format. Audit intersections and the current growing-body initialization before reuse. Preserve UVs, seam mappings and artwork coordinates through returned vertices.
3. **One fixed top/body, two documented fabrics.** Hold cut, grain, mesh, seams, pose, camera, physical duration and stopping criteria fixed. Record wall time, preparation/transfer cost, memory, residual motion, directional strain, intersections and failures. Compare XPBD and PPF while disclosing material-model differences; different preset names do not establish equivalent inputs. Repeat at two resolutions and multiple timesteps. Add a separate folded/layer case before claiming layering improvement.
4. **Independent observations.** Reproduce upstream coupon experiments where feasible, then validate against appropriately licensed measured specimens or physical references. Separate numerical correctness from held-out silhouette/landmark errors and reference uncertainty. Without those observations, results remain numerical/visual evaluation, not validated fit or manufacturing readiness.
5. **Integration decision after evidence.** If improvement and latency justify it, propose an explicit higher-quality drape action in Body & drape with progress, cancel, failure/retry and continued editing. Apply only to the exact captured design/body/material version; retire stale jobs. Preserve Undo, local projects, comparisons and independent PNG/GLB/tech-pack snapshots. A remote option additionally needs an upload/data-handling and compute-cost decision. Keep fast styling/preview available.

The evaluation receipt should report actual inputs/results and recommend adopting, deferring or rejecting PPF. No latency or accuracy threshold is asserted without measurements. Clothing Studio remains ACTIVE. The owner requested investigation; a deployment model and new engine have not been selected.

[overview]: https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/README.md
[workspace]: https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/Cargo.toml
[wire]: https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/crates/ppf-cts-server/src/wire/mod.rs
[scene]: https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/frontend/_scene_object_.py
[fitting]: https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/examples/fitting.ipynb
[performance]: https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/articles/performance.md
[license]: https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/LICENSE
[presets]: https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/docs/blender_addon/workflow/params/fabric_presets.md
[materials]: https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/blender_addon/presets/materials.toml
[calibration]: https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/calibration/README.md
[targets]: https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/calibration/cusick_drape/targets.csv
[cusick]: https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/calibration/cusick_drape/cusick_drape.py
[tensile]: https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/calibration/tensile/README.md
