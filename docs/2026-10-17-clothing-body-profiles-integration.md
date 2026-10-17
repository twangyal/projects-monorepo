# Reusable top-body profiles integration — #280

The user can explicitly save applied chest/optional waist/hip/depth as named local profiles, select a measurement preview, deliberately Use it for another top, update/rename, confirm deletion, and download/import a separate versioned JSON library. Profiles preserve proportional/null dimensions and remain outside garment data/history. Body drafts guard application, and actual drape/comparison/export pipelines receive the reused settings. This is a useful reuse workflow for the existing approximate body, not anatomical reconstruction or calibrated physical fit.

## Source and review

Canonical starting main: `11d3dad0037da6ead8323b6fb15ab81b0effd7bd`. Reviewed source: `14d6fd86bfcbb69fd5808e81f75261f364bc4609`, app/source tree `e8b2ed7cfdc9d3002f05a0832785e6ac4e59c7fb` (whole repository). Local156 units, lint/types/build pass. The complete local production-browser suite passes all195 cases in4.5minutes. Seven focused Chromium cases also pass, including desktop/phone persistence/backup and real worker retirement/matched fabric receipts. Independent read-only review found no actionable correctness/security/ownership/a11y issues; it did not claim rerunning browser builds. Cross-tab writes retain localStorage's last-writer limitations.

[Source CI39035400230](https://github.com/twangyal/projects-monorepo/actions/runs/39035400230), job117404074305, passes156 unit tests and all195 production-browser cases plus lint/types/build. New source implementation is unchanged during main integration; only documentation/acceptance records change.

## Retained first outcomes

- Initial browser RED: Saved body profiles is absent in the baseline. Initial module-import RED records the absent feature module, not an analytical assertion pass.
- First implementation156 units pass, then lint refuses a control-character regex; replaced it with explicit character-code admission. Typecheck later catches a test-only unknown-array type; fixed the generic helper.
- First focused roundtrip lookup times out despite an accessible combobox. The role-based exact accessible-name selector exercises the native control; all7 focused cases then pass.
- First full local run incorrectly serves Vite development assets:191 pass, four existing bending/garment-comparison/membrane/tensile worker-failure cases fail because their request-abort routes match production hashed worker names. No production code or fixture guard is weakened. The fresh production-build local rerun passes all195 cases in4.5minutes, including all four worker-error fixtures. The product and test gates are unchanged.

## Canonical acceptance

Canonical integration `83d6d3314306a469560259d53e8052e23a0b32d5` passes [main CI39035900708](https://github.com/twangyal/projects-monorepo/actions/runs/39035900708), job117405485462:156 unit tests, all195 native browser cases in4.8minutes, lint/types/build. The complete local production suite passes195 in4.5minutes. A390px production profile-panel view was also visually inspected; controls/messages remain contained in the collapsible profile section. These are software checks, not intended-user or physical-fit acceptance. Final receipt changes are root documentation only; the accepted application subtree is retained. #280 is complete.

[Workflow, privacy, storage recovery and limits](../apps/clothing-studio/docs/2026-10-17-top-body-profiles.md). No new material law, native physics engine, anatomy or physical-manufacture claim. Clothing remains ACTIVE; project8 remains skipped.
