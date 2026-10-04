# Stock annual-history implementation

Issue #35; contract `../specs/2026-10-04-stock-annual-history-design.md`. Root owns docs/catalog, Git/GitHub and final integration/runtime evidence. Existing autonomous authorization applies; no user approval gate.

- [x] Inspect source/catalog/issues and resolve higher-priority CI failure first; commit verified test synchronization fix `88866fd`.
- [x] Independently review written data/migration/comparability/API contract.
- [ ] **next_project_assessment:** `src/types.ts`, `validation.ts`, `model.ts`, `history.ts`, new `periods.ts`; `tests/validation.test.ts`, `model.test.ts`, `history.test.ts`, new `periods.test.ts`. Publish schema/limit/selectors first, then v1 compatibility and v2 strict validation; no UI/research/CSV ownership.
- [ ] **audio_engine:** `src/csv.ts`, `demo.ts`; `tests/csv.test.ts`, `demo.test.ts`. Multi-period duplicate/count validation, real source ordering, fictional multi-period demo and import bounds. Preserve eleven-column format and existing atomic gates.
- [ ] **git_history_review:** `src/research.ts`, `query.ts`, new `annual-history.ts`; existing research/query tests plus new `annual-history.test.ts`. Latest-only screens/comparisons, exact history interface, conservative comparison arithmetic and neutral all-period summaries. Coordinate selector/types with domain owner.
- [ ] **recorder:** `src/exports.ts`; export/storage tests and `tests/browser/storage.spec.ts` as needed, native harness only if required. Whole-history appendix, existing report cap and latest watchlists, actual v1 raw retention/v2 save checks. `storage.ts` only if a demonstrated migration defect requires it; storage location stays unchanged.
- [ ] **git_reader:** `src/main.ts`, `style.css`. Latest-only UI and filter choices, period/company counts, safe dated history/evidence/formulas/links, accessible desktop/mobile flow. Preserve drafts/history/import/save request ownership. No concurrent shared build/server use.
- [ ] **git_runner:** `tests/browser/workflow.spec.ts`, new `tests/annual-history-oracle.test.ts` and owned browser fixtures. Independent numeric/raw-source oracle, unsorted multi-period upload, latest-only selection, source-linked history, native JSON/report download/reimport/reload and legacy migration workflow. Own shared browser port 4271 only when root releases it.
- [ ] Full unit/lint/type/build checks and production browser suite; independent review and fix demonstrated regressions. Root owns final maximum 500-row production measurement and exported/reopened data evidence.
- [ ] Update docs/catalog/evidence; fetch Astra, commit/push without force, inspect CI and update draft PR12/issue #35 to actual state.
- [ ] Immediately reassess the next high-value unblocked task.
