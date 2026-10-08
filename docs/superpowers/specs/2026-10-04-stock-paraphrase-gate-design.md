# Gated learned screening paraphrases

Issue [#36](https://github.com/twangyal/projects-monorepo/issues/36). Improve the working Stock research workflow with a real, bounded learned interpretation component only if independent evidence supports release. This experiment does not create an investment-quality model, generated financial outlook, general language engine or remote dependency. Stock remains ACTIVE.

## Scope and exact meaning

Six single-intent English paraphrases map to exactly one inspectable filter:

| Intent | Metric/operator/value | Canonical sentence |
| --- | --- | --- |
| profitable | netIncome > 0 | companies with profitable |
| lossMaking | netIncome < 0 | companies with loss making |
| growing | growthPct > 0 | companies with growing |
| declining | growthPct < 0 | companies with declining revenue |
| lowDebt | debtEquity <= 1 | companies with low debt |
| highMargin | marginPct >= 10 | companies with high margin |

All currencies are null, sector is null, freshness excludes stale, sorting defaults to ticker ascending and no other filter is implied. The two new exact shortcuts must be added and tested before any final product release; existing undefined-input/zero-denominator semantics remain. “Not profitable” does not mean strictly loss-making, and “not growing” does not mean strictly declining. Negation, compound/multi-intent requests, explicit numeric thresholds, sector/currency constraints, sorts, forecasts, valuation and ambiguous investment goals are outside this model and must abstain.

## Stage 1: independent, frozen feasibility gate

Keep all experimental work under `apps/stock-notebook/experiments/paraphrase/`; no UI import or new runtime dependency before the gate passes. Installed local Python has scikit-learn 1.8.0, NumPy 2.3.5 and SciPy 1.17.0; no model or package download is needed. All phrases are original authored examples, not scraped or real user/financial data.

The training owner authors at least 180 supported training examples (30 per intent), a separate development set of at least 60 supported examples (10 per intent), and at least 80 unsupported development examples. Independent authors create 120 held-out supported examples (20 per intent) and at least 160 unsupported examples across negation, compounds, numeric constraints, sector/currency/sort, forecasts/valuation, ambiguous goals and unrelated inputs. Distinct phrase/template families matter: changing punctuation, politeness or company nouns alone is not sufficient independence. Audit exact normalized duplicates and near-duplicate token/bigram overlap; manually review suspect pairs and replace evaluation examples before the freeze, without any model-output feedback. Publish counts, family IDs, provenance and hashes.

Training owner must not read held-out examples. Evaluation authors must not adapt cases to model outputs. Before any held-out run, freeze and commit training/dev data, architecture, fitted vocabulary/IDF/weights, rejection policy, selected thresholds, intent mapping, evaluator and held-out corpus hashes. After the freeze, no model/policy/threshold adjustment is allowed in response to held-out failures. A genuinely new independent dataset would be required for a later distinct release gate. Published evaluation data subsequently becomes regression evidence, not reusable unseen evidence.

Frozen architecture: word unigram/bigram TF-IDF with binary term frequency, smooth IDF and L2 normalization; maximum 2,048 features; multinomial logistic regression with C=1, lbfgs, max_iter=2000, tol=1e-10, fixed seed and class order. Fit vocabulary and IDF on training only. Export finite vocabulary, IDF, coefficients/intercepts and normalized class centroids in at most one MiB. Export normalizer/rejection metadata as versioned exact data, not executable source. No scikit-learn runtime enters the browser.

Predeclare a shared ASCII tokenization/normalization contract, raw input length/character limits, deterministic unsupported-request rejection and unknown-content-word abstention before corpus training. Do not strip unsupported clauses then classify the remainder. Model acceptance uses a top score, top/runner-up margin and class-centroid similarity. Select thresholds only from development evidence under a recorded finite grid, prioritizing zero unsupported acceptances and zero incorrect accepted intent/filter mappings; publish the selection rule and chosen values. Scores are not calibrated correctness probabilities. The trainer may report failure if these constraints produce inadequate coverage.

Centroids are L2-normalized arithmetic means of each class's normalized training TF-IDF rows. Threshold comparisons are inclusive (`>=`) without inference-time rounding. Independent numerical parity uses absolute tolerance `1e-10`; all acceptance decisions must match exactly, including threshold boundaries. The evaluator compares the entire canonical screen mapping (defaults and exact filter), separately from the later production-parser integration gate.

Unsupported holdouts emphasize near-boundary financial requests: negations and contractions, implicit compounds, digits and spelled quantities, sector/currency/time qualifiers, gross/net/operating-income and price/revenue-growth confusion, rankings, forecasts and ambiguous shorthand. Malformed or overlength cases are separate safety tests, not counted toward the unsupported-language benchmark. Publish exact observed counts; these examples do not establish population-wide accuracy or zero false acceptance.

Independent held-out release requirements:

- At least 15 of 20 supported examples accepted for EACH intent, at least 90 of 120 overall, and at least 98% exact-filter accuracy among all accepted examples. Publish per-class coverage, errors, confusion and abstentions.
- Every unsupported held-out example must abstain (zero accepted requests), even when a partial filter would resemble its wording.
- Evaluate the exact filter and canonical mapping, not just a class label. Before product release, rerun parity through the real canonical parser and confirm its entire screen has the prescribed defaults and no extra filters.
- Independent implementation reproduces Python probabilities/margins/similarities within a declared small floating tolerance and exactly matches acceptance/abstention decisions. Malformed/nonfinite/oversized artifacts and invalid inputs fail without altering current state.

If any release requirement fails, keep product behavior unchanged, commit the measured failure and reproducible experiment, leave #36 open with the concrete blocker and move to another useful task. Do not relax the gate, edit the test set after inspecting outcomes or label a deterministic fallback as a learned success.

## Stage 2 only after a passing gate

Write/review the product integration contract after the feasibility result. It must cover a clearly labeled “Learned paraphrase suggestions” draft, visible editable criteria, explicit apply, canonical-query persistence and provenance limitations, reliable input changes/cancellation, undo/redo, strict JSON/recovery compatibility and production-browser tests. Original prose stays a draft unless a separately reviewed provenance schema is introduced. Suggestions never auto-apply, replace the existing precise parser or claim financial analysis. Failed/unsupported input keeps current results and all user drafts. Final source/model/data/evaluation metadata must be reproducible, bounded and documented.
