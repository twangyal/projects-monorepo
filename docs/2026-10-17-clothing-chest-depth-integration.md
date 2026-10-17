# Clothing chest-depth integration — #276

Optional straight front-to-back chest depth changes the actual top proxy at fixed girth, reaches worker draping and captured garment exports, and is retained by matched fabric comparisons. Blank input preserves original geometry. Coupled validation, raw drafts, owned retirement and existing material/contact limitations remain. Clothing stays ACTIVE; this is not anatomical or physical-fit acceptance.

Base main: `ecb51ea39d223a5ed70266e1fdcb7cdb947f2f9a`. Source `fcf91516bf001326b6d4cfd4a20d344612fb710c`, tree `520e80c3b62370f4646e5a4529d08ae67b7196fa`, on `autonomous/clothing-body-depth-276`. No PR requested or created.

Four new geometry/receipt cases fail before implementation. A further failing guidance case catches an inadmissibly rounded maximum; rounding is corrected without relaxing the exact bound. The complete local check passes 145 units, lint, types and build. Five new native cases pass, followed by all 177 browser cases (5.4m), including GLB positions, native badInput, draft recovery, held-result retirement and comparison JSON. Desktop and phone layouts are checked. Local Chromium is143; it does not provide physical-fit validation.

Fresh review reports no findings. Independent checks pass 11 focused units and confirm exact baseline torso/capsule geometry in 48 cases when depth is omitted.

[Complete source CI 38995559876](https://github.com/twangyal/projects-monorepo/actions/runs/38995559876), job `117287226803`, passes 145 units and all177 native cases, lint, types and build. Canonical main CI remains pending and #276 remains open. Subsequent integration documentation does not change runtime, tests or workflows. See [geometry and workflow limits](../apps/clothing-studio/docs/2026-10-17-chest-depth.md).
