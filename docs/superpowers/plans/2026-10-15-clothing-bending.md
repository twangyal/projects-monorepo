# Cantilever swatch plan (#267)

Goal: compare independent illustrative bending response before garment integration.
Architecture: SI Euler–Bernoulli cubic beam elements, clamped displacement/rotation and end force; separate module worker and mounted Body & drape experiment. Reuse strict coupon inputs and the independent-experiment boundary from266. No garment solver/project-schema change or dependencies. Spec: issue267 and material research256. Autonomous inline execution is authorized.

- [x] Test then implement bending.ts: solveBending(profile,input), compareBending(input), D in N·m and EI=D*width in N·m²;8/16 cubic elements, separate force/moment residual units.0°/90° illustrative profiles, default20cm square/.001N; no gravity/dynamics. Refuse tip displacement above10% length or slope above.15rad. Independent tip/rotation/energy/reaction, density/width, grain, resolution, zero/invalid tests.
- [x] Test then implement bending.worker.ts / bending-view.ts under Body & drape: compare/cancel/retry/JSON, common-scale side-view curve, current-input-only export, actual-worker late replies and desktop/phone backup/draft preservation. Preserve independent-experiment intent and actual pending project/photo owners. No calibrated-material claim.
- [x] Run verified121-unit/146-browser base plus new checks, independent read-only review and full source/main CI. Record failures/limits, README/roadmap/research; commit and close267 only to actual evidence. No PR/paid service/project8/deferred-app work.

Energy: integral(EI*w''²/2)dx - F*w(L). Standard cubic Hermite4×4 stiffness, reduced linear solve fixing both clamp DOFs. Closed form w(x)=F*x²*(3L-x)/(6EI), theta(L)=F*L²/(2EI), U=F*w(L)/2. Primary reference: MIT2.002 David Parks,2004 lecture2 tip-loaded cantilever. Coefficients are our illustrative values, not measured fabrics.

Intermediate progress:126 units/check and five focused native cases passed after review repairs; its full151-case local run was interrupted after30 cases for the boundary repair, not accepted as a full pass. Curve polyline and reaction-sign ambiguities have actual RED→GREEN checks. Ruling: show signed support reactions and explicit magnitudes; ambiguous force conventions would mislead a future calibration. Existing cloth solver remains unchanged.

Boundary follow-up: exact nominal3mN equality fails due floating-point evaluation of the declared limit. RED→GREEN test admits an8*machine-epsilon relative comparison allowance, not a physical deformation margin, and refuses0.003001N.127 units/check and five native flows pass before the final complete151-case run. Backup parity now seeds a real garment.

Final local evidence:127 units/check and all151 browser cases pass (6.2m); final source CI38829728384 passes127/151 with completed logs inspected. Exact source77ce3749c00a3ae26534702cbfd4bb57060605d6 is integrated into main; final main CI38830304880 passes127/151 and project checks, with completed logs inspected. See root integration receipt for hashes and remaining physical-validation limits.
