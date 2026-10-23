# Hood side-height acceptance — #315

Source: `b0191675b1dbc00eaf3d0de8d7e0bce065be04f8`, integrated directly on canonical `main`. [Issue #315](https://github.com/twangyal/projects-monorepo/issues/315) tracks the coherent milestone; no PR was created.

The hoodie Fit panel now accepts a side-pattern base-to-top height of 24–44 cm. The optional `fit.hoodHeight` defaults to 32 cm and feeds the side pattern, loft rise/UVs, cloth rest inputs, tech-pack K/assembly, estimated fabric use and current exports. Other garment parts remain unchanged. The ordinary Apply/Discard/Reset, raw-draft protection, history, recovery and saved-design paths are reused. Unsupported garments and malformed values refuse atomically.

## Evidence

- Local final source: all 180 unit tests, ESLint, TypeScript and Vite build passed. Three new domain cases check geometry, defaults, cloth rest, material consumption, tech-pack wording, round trips, bounds and garment scope.
- Local focused native cohort: all three cases passed in 40.2 seconds. Desktop compares actual SVG polygon height and independently decoded GLB float positions through editing, Undo/Redo and reload; phone checks invalid drafts, keyboard input, refusal, Reset/Undo, containment and template scope. The worker case actually drapes 40 cm then 24 cm and compares finite captured GLB outputs.
- Fresh independent review found no blocking source issue, independently passed the three domain cases and checked cloth cache identity and the corrected confirmation fixture.
- Canonical [Clothing Studio run 40037968720](https://github.com/twangyal/projects-monorepo/actions/runs/40037968720), source `b0191675`: success. Its job log records 180 tests / 180 passes / zero failures, ESLint, TypeScript/Vite and all 224 native browser cases in 5.5 minutes.
- Canonical [native-preflight run 40037968716](https://github.com/twangyal/projects-monorepo/actions/runs/40037968716), source `b0191675`: success. All 163 Python tests passed in 499.041 seconds. The unchanged gate reproduced the complete frozen historical packet and growth endpoint, checked independent admission/provenance, verified both complete current-app default packets against their historical counterparts, and reproduced the reviewed rest/body candidates. The historical admission still reports `blocked_native_mapping`; passing this gate preserves that limitation rather than accepting a native solver.
- Local complete browser cohort: all 224 cases passed in 12.3 minutes with portable Chromium 143, two workers and an unchanged application/test configuration. This independently repeats the final-source native suite; no failures or retries occurred in that full run.

## Retained failures and limits

The initial domain attempt lacked cached Delaunator dependencies; after selecting the exact-lock dependency tree, the actual RED was three refusals of the unsupported new Fit field. A test's wrong tech-pack property prevented an initial build and was corrected to `howToMeasure`. A truncated portable Chromium crashed before launch; a fresh extraction of the existing runtime supplied working Chromium 143 without changing shipping dependencies or browser configuration. The actual native RED reached the absent field. The first phone run had two fixture confirmation handlers; removing the unused setup listener fixed that test-only conflict. These earlier attempts are retained, not relabeled as passing checks. See the [implementation checkpoint](../apps/clothing-studio/docs/2026-10-23-hood-height.md).

The measure excludes seam allowance and is not anatomical hood clearance. The existing illustrative loft still adds 3 cm at the crown and retains its neck-edge assumptions. This milestone does not change or validate the physical construction, material calibration or native research solver. #290 remains open, and Clothing remains ACTIVE against the full product direction. Older application readers may refuse backups with the optional field. Project #8 remains skipped.
