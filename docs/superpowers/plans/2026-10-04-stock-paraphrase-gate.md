# Stock learned-paraphrase feasibility

Issue #36; contract `../specs/2026-10-04-stock-paraphrase-gate-design.md`. Root owns docs, Git/GitHub, freeze approval based on independent evidence and actual release decisions. User's autonomous authorization applies; no user confirmation gate.

- [x] Inspect available local dependencies and product/canonical-query constraints; deduplicate/create issue. Independently review acceptance risks including per-intent coverage and strict-sign semantics.
- [x] Independently review the written experiment/evaluation contract; require complete screen scoring, fixed centroid math and tolerance, threshold boundaries and realistic unsupported holdouts before edits.
- [x] **next_project_assessment:** own training/development corpus, training/inference reference and artifact export, under `experiments/paraphrase/`. No held-out file access or output tuning. Publish exact tokenizer/policy/threshold selection contract before fitting.
- [x] **git_reader:** own original held-out supported corpus, exactly 20 clear examples per six intents, distinct phrase families. No training/model reads or model-output feedback.
- [x] **audio_engine:** own original held-out unsupported corpus, at least 160 explicitly labeled reasons across the published scope exclusions. No training/model reads or output feedback.
- [x] **git_history_review:** independent corpus/mapping/leakage audit and release-gate review, read-only unless root assigns a specific correction. Do not send held-out phrases to training owner.
- [x] **recorder:** independent bounded inference/evaluation runner and artifact validation, reproducing fixed preprocessing/math contract without using fitted-model code. Do not run held-out evaluation before the freeze.
- [x] Root reviewed development evidence, hashes and independent audit; recorded a complete failed-trial manifest. No runtime/UI imports. The held-out gate remains closed.
- [x] Development failed its prerequisite; skip held-out inference, commit blocker evidence and leave feature unavailable. No post-outcome corpus/policy/threshold tuning.
- [ ] Product integration deferred: candidate failed readiness. Issue #36 remains open; no release claim.
- [ ] Preserve durable progress, update tracking and immediately reassess the next useful work.

Independent static audit approved all 610 original requests before fitting: 180 training, 60 supported/80 unsupported development, 120 supported/170 unsupported held-out. Construction/label fixes were completed without model feedback. Contract and corpus hashes are committed at `b8a7a24`; this is not authorization to run held-out inference before the complete artifact/evaluator freeze.

## Recorded trial outcome

Development failed: 0/60 supported requests accepted; the unsupported development set contains79 admissible ASCII language cases plus one Unicode-format input, so it also fails the required80-case admission. Independent diagnostic parity matches all140 vectors within2.78e-16;31 persisted stdlib tests pass. Model/report regenerate byte-for-byte. The full release gate was never opened, no held-out inference ran, no product shortcut/UI was added, and issue36 stays open with the blocker. Final hashes and limitations are in experiments/paraphrase/trial-manifest.json and README.md. Continue with reviewed Melody milestone42; no tuning against these outcomes in this trial.
