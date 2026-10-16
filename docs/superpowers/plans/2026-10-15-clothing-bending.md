# Cantilever swatch plan (#267)

Goal: compare independent illustrative bending response before garment integration.
Architecture: SI Euler–Bernoulli cubic beam elements, clamped displacement/rotation and end force; separate module worker and mounted Body & drape experiment. Reuse strict coupon inputs and the independent-experiment boundary from266. No garment solver/project-schema change or dependencies. Spec: issue267 and material research256. Autonomous inline execution is authorized.

- [x] Test then implement bending.ts: solveBending(profile,input), compareBending(input), D in N·m and EI=D*width in N·m²;8/16 cubic elements, separate force/moment residual units.0°/90° illustrative profiles, default20cm square/.001N; no gravity/dynamics. Refuse tip displacement above10% length or slope above.15rad. Independent tip/rotation/energy/reaction, density/width, grain, resolution, zero/invalid tests.
- [x] Test then implement bending.worker.ts / bending-view.ts under Body & drape: compare/cancel/retry/JSON, common-scale side-view curve, current-input-only export, actual-worker late replies and desktop/phone backup/draft preservation. Preserve independent-experiment intent and actual pending project/photo owners. No calibrated-material claim.
- [ ] Run verified121-unit/146-browser base plus new checks, independent read-only review and full source/main CI. Record failures/limits, README/roadmap/research; commit and close267 only to actual evidence. No PR/paid service/project8/deferred-app work.

Energy: integral(EI*w''²/2)dx - F*w(L). Standard cubic Hermite4×4 stiffness, reduced linear solve fixing both clamp DOFs. Closed form w(x)=F*x²*(3L-x)/(6EI), theta(L)=F*L²/(2EI), U=F*w(L)/2. Primary reference: MIT2.002 David Parks,2004 lecture2 tip-loaded cantilever. Coefficients are our illustrative values, not measured fabrics.

Progress:126 units/check and five focused native cases pass after review repairs. Full151-case local run is in progress. Curve polyline and reaction-sign ambiguities have actual RED→GREEN checks. Ruling: show signed support reactions and explicit magnitudes; ambiguous force conventions would mislead a future calibration. Existing cloth solver remains unchanged.
