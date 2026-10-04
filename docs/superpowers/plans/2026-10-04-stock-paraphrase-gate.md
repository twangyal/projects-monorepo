# Stock learned-paraphrase feasibility

Issue #36; contract `../specs/2026-10-04-stock-paraphrase-gate-design.md`. Root owns docs, Git/GitHub, freeze approval based on independent evidence and actual release decisions. User's autonomous authorization applies; no user confirmation gate.

- [x] Inspect available local dependencies and product/canonical-query constraints; deduplicate/create issue. Independently review acceptance risks including per-intent coverage and strict-sign semantics.
- [x] Independently review the written experiment/evaluation contract; require complete screen scoring, fixed centroid math and tolerance, threshold boundaries and realistic unsupported holdouts before edits.
- [ ] **next_project_assessment:** own training/development corpus, training/inference reference and artifact export, under `experiments/paraphrase/`. No held-out file access or output tuning. Publish exact tokenizer/policy/threshold selection contract before fitting.
- [ ] **git_reader:** own original held-out supported corpus, exactly 20 clear examples per six intents, distinct phrase families. No training/model reads or model-output feedback.
- [ ] **audio_engine:** own original held-out unsupported corpus, at least 160 explicitly labeled reasons across the published scope exclusions. No training/model reads or output feedback.
- [ ] **git_history_review:** independent corpus/mapping/leakage audit and release-gate review, read-only unless root assigns a specific correction. Do not send held-out phrases to training owner.
- [ ] **recorder:** independent bounded inference/evaluation runner and artifact validation, reproducing fixed preprocessing/math contract without using fitted-model code. Do not run held-out evaluation before the freeze.
- [ ] Root reviews development evidence, hashes and independent audit; commits complete freeze before opening the held-out gate. No runtime/UI imports before a pass.
- [ ] Run held-out acceptance exactly once, record all coverage/errors/abstentions and independent parity. If failed, commit blocker evidence and leave feature unavailable; do not tune against held-out data.
- [ ] If passed, write/review and execute a separate complete product integration plan, canonical parser tests, browser workflows and CI before closing #36.
- [ ] Preserve durable progress, update tracking and immediately reassess the next useful work.
