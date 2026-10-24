# Clothing hood side width — verification handoff (#322)

Source `0c943339649c2afdf95a1d4c1987d1354c4a3f0d` adds a hoodie-only 20–34cm side-width control, default26cm. Apply/reset, raw-draft protection, history/reload, linked side pattern/POM N/material area, proportional illustrative projection and modelled drape all consume the same field. The neck base, x/y coordinates and unrelated parts retain their existing geometry.

Local verification completes: **183 units**, lint/types/build and **227 browser cases** (7.6m). The three new native cases exercise actual downloaded SVG sewing-line width (within existing0.01cm serialization), decoded GLB and POM, complete saved history, phone drafts/reset/template visibility and finite changed drape. Six focused width/height cases also pass31.1s. Baseline180units and observed unsupported-field/absent-width RED regressions precede implementation; the initial partial native fixture had an unused-helper build failure before the meaningful absent-control RED.

Both complete current default cold and warm garment packets reproduce exactly, with all current source hashes verified against retained historical captures. The full local garment-preflight Python test set is running; its result is not inferred from packet equivalence.

Canonical [application run40108893843](https://github.com/twangyal/projects-monorepo/actions/runs/40108893843) and [garment-preflight run40108893842](https://github.com/twangyal/projects-monorepo/actions/runs/40108893842) remain in progress at this checkpoint. The application job has passed npm ci and check and is installing Chromium; preflight has reproduced the historical packet and is checking provenance/geometry/tests. No complete canonical pass is claimed. #322 stays open pending observed final gates; follow the exact source runs before starting unrelated work. A later final receipt may supersede this truthful pending snapshot.

Fresh independent review found no blockers, independently passed all three new units and isolated width-only cloth-rest changes at20/34cm with unchanged topology and changes confined to hood constraints. Deferred minor: the committed rest unit varies height and width together, so independent width-only evidence comes from review. The reviewer did not rerun browsers.

No solver/rest law, workflow, deadline, dependency or format-version changes. This accepts a linked creative construction parameter, not a new flattening/seam solution, native physical solve or physical-fit guarantee. Clothing remains ACTIVE and #290 remains open. Project #8 remains skipped; no PR.

## Later observed gates

The complete local Python garment-preflight suite finishes successfully: **163 tests in367.498s**. Canonical garment-preflight40108893842/job120916256369 also completes successfully: **163 tests in493.498s**, plus historical/current cold/warm packet provenance, rest candidate and faceted-body candidate reproduction. The application job has completed Chromium installation and is running browsers; that final outcome remains pending until observed.
