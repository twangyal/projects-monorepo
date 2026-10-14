# Top-drape integration plan — #248

Goal: integrate the pinned4fdcc56 top-drape feature into current canonical Clothing while preserving247/250 repairs. Architecture: existing XPBD solver and module worker; view-only body settings with explicit Apply/Discard; immutable export scene receives the captured settled result and excludes the proxy. Stack: TypeScript, Three.js, Vite, native Worker and Playwright. Issue248 and PRODUCT_DIRECTION define scope; autonomous execution is authorized by the owner.

- [x] Selectively apply only the top-drape commit, resolve import/document conflicts, retain current raster/draft/geometry/export guards. Keep prompt-style work separate.
- [x] Reproduce body-input retention, departure/bottoms cancellation and draped-export gaps with native worker/encoding tests before repairs.
- [x] Body drafts survive unrelated rendering and block replacement; Apply validates and commits session settings, Discard restores them. New/import/history retire simulation state; recoloring retains a settled result.
- [x] Timers and workers own one generation/key, release on stop/departure, refuse late events and expose deliberate retry after errors. Proxy geometry is disposed with the scene.
- [x] PNG/GLB/printable tech pack capture settled geometry with the committed product/title. Refuse during a pending simulation and keep body out of snapshot scenes. Verify actual GLB position accessors and PNG render differences.
- [ ] Run all units/lint/types/build, focused native regressions, independent review and full hosted suite. Integrate app-only delta into main; update README, roadmap and issue with actual evidence/limits.

Review focus: blank/out-of-range body values, raw drafts during redraw, late worker messages after replacement/departure, retries after construction/worker errors, snapshot exports while the visible drape changes. Proxy anatomy, arbitrary fabric calibration, local extreme strain and no cloth-to-cloth collision remain explicit limitations; no physical manufacturing claim. Preserve project8 skip, no PR or paid service.
