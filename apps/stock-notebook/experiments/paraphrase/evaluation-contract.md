# Independent evaluation contract — stock paraphrase gate, Stage 1

This evaluator is an independent Python standard-library implementation. It does not import or inspect `reference.py` or `train.py`. Its arithmetic and six whole-screen mappings are authored from the reviewed design and the frozen `training-contract.json` interface. There are no package downloads, financial services, or product changes.

## Scope and declared inference

Class order is `profitable`, `lossMaking`, `growing`, `declining`, `lowDebt`, `highMargin`. `screen-mapping.json` specifies the entire expected screen, including sector/currency null, exactly one filter, stale exclusion, ticker ascending sort, and filter currency null. The loss-making and declining-revenue precise shortcuts are future mapping contracts; this experiment does not add them to the product parser.

Input admission and normalization follow `ascii-words-1` exactly. A complete bounded ASCII phrase is normalized; a rejected phrase is never partially salvaged. The declared ordered vetoes run before the model, including negation, composition, unsupported constraints, multiple canonical anchors, unknown content, and empty features. Unigrams and adjacent bigrams use binary presence, frozen IDF, and L2 normalization. Logits are the ascending-column dot product plus intercept. Softmax subtracts the largest logit before exponentiation. Ties select the first class. Margin is the winning probability minus the largest other probability. Similarity is the dot product with the winning normalized centroid, clamped only to the mathematical [-1,1] range. Acceptance requires all three unrounded thresholds with inclusive `>=` comparisons. Numerical comparison tolerance is never added to an acceptance threshold.

## Bounded data and safety

The artifact is strict UTF-8 JSON at most 1 MiB, with no BOM, duplicate fields, nonfinite numbers, NUL, lone surrogates, or nesting above 12 levels. Schema, hashes, dependency metadata, normalizer, rejection policy, class ordering, vocabulary ordering, feature count, matrix shapes, finite coefficient/IDF bounds, centroid normalization, and threshold-grid membership must match the training contract. Booleans are not numbers. Vocabulary has at most 2048 features.

Corpus admission is intentionally broader than model admission: a normal benchmark phrase is printable ASCII, 5–240 characters. Financial requests containing digits, dollar signs, percent signs, or punctuation remain valid unsupported examples and count in the denominator even when the normalizer deterministically abstains. Non-string, NUL, surrogate, oversized, malformed artifact and similar safety fixtures are tested separately; they cannot replace unsupported language examples. Each corpus is at most 1 MiB and 2000 examples; IDs and raw texts are unique. Supported held-out data requires exactly 120 examples, twenty per class; unsupported data requires at least 160 examples. Development requires at least ten per supported class and eighty unsupported examples.

Reports and development reference documents are capped at 8 MiB. A report is fully serialized and bounded before its temporary file is atomically published. Failure preserves an existing report. Output may not replace an experiment input. Validation errors produce no partial benchmark report.

## Required complete development parity

Before any held-out access, read the explicit development corpus and require its exact byte hash to match both artifact and development report. Require one reference row for every development example, sorted by ASCII ID, with identical ID, complete raw text, and expected intent. Missing, extra, duplicated, substituted, or reordered rows fail; deterministic veto rows are mandatory. A small handpicked subset cannot qualify.

Compare normalized text, tokens, first veto, winning intent, acceptance decision, canonical query and complete screen exactly. Compare every sparse feature value, all six scores, winning score, margin and similarity with absolute tolerance `1e-10`. Sparse column identities and order are exact. Every supplied numeric reference must be finite, including fields that cannot be compared because independent inference vetoed. Decision mismatches fail even when scores differ by less than tolerance.

Bind the reference report to the exact artifact bytes/hash, contract/training/development hashes, dependency versions, seed, development counts and selected thresholds. Independently recompute selected accepted counts, wrong accepted whole screens and unsupported acceptances. A ready development model requires zero wrong accepted supported screens, zero unsupported acceptance, and at least 75% accepted in **each** supported class. `notReady` diagnostic models can pass arithmetic parity without permitting held-out access.

Development-only command (safe before held-out freeze):

```sh
python3 experiments/paraphrase/evaluate.py --check-development \
  --artifact MODEL.json --development experiments/paraphrase/development.json \
  --parity DEVELOPMENT_REPORT.json [--output DEVELOPMENT_CHECK.json]
```

This mode forbids held-out arguments and never reads held-out paths. Exit 0 means complete arithmetic/decision parity passed; `developmentReady` separately states readiness. Exit 1 means parity differed. Exit 2 means malformed or inconsistent input. Omitting `--output` prints the bounded result only.

## Explicit non-gating development diagnostic

For a frozen corpus with an out-of-benchmark row, strict `--check-development` must continue rejecting it. A separate command can still check all original rows' bounded inference mathematics without declaring them valid benchmark language:

```sh
python3 experiments/paraphrase/evaluate.py --diagnostic-development \
  --artifact experiments/paraphrase/model.json \
  --development experiments/paraphrase/development.json \
  --parity experiments/paraphrase/development-results.json
```

This mode checks strict bounded JSON, original IDs/texts/intents, complete sorted reference coverage, all hashes and numerical/decision fields. It allows bounded Unicode text solely to compare original diagnostic inference; the printable-ASCII benchmark admission rule is unchanged. It emits `diagnosticOnly:true`, always `developmentReady:false`, `benchmarkAdmissible`, invalid benchmark IDs, and separate **admissible** supported/unsupported counts. Invalid language/safety-format rows do not count toward an unsupported benchmark minimum. It forbids held-out arguments and cannot qualify the normal gate. Exit 0 means mathematical diagnostic parity only.

The frozen candidate has 140 development inference rows, of which 60 supported and 79 unsupported are benchmark-admissible; one Unicode-format row is outside benchmark admission. The candidate is `notReady`, with zero accepted supported rows. The diagnostic is useful reproducibility evidence and does not repair either limitation. No corpus, model, policy or threshold changes are made from these outcomes.

## Frozen release gate

The parent must confirm a committed freeze covering corpora, mappings, training contract, inference/evaluation code, artifact, thresholds and development evidence **before** running the following command. The evaluator author does not inspect held-out files before that confirmation. No architecture, veto, threshold, corpus, vocabulary or mapping adjustment may use held-out outcomes. A failed/not-ready gate leaves the product unchanged and the issue open; an independently motivated future experiment needs a new reviewed protocol and fresh held-out data.

```sh
python3 experiments/paraphrase/evaluate.py \
  --artifact MODEL.json --development experiments/paraphrase/development.json \
  --parity DEVELOPMENT_REPORT.json \
  --supported experiments/paraphrase/heldout-supported.json \
  --unsupported experiments/paraphrase/heldout-unsupported.json \
  --output EVALUATION_REPORT.json
```

The normal command independently requires development readiness and complete parity **before opening** either held-out file. Then every admitted phrase is counted. Success requires at least 15 accepted examples in every supported class, at least 90 overall, at least 98% exact whole-screen accuracy among accepted supported examples, zero unsupported acceptance, and complete development parity. Accuracy uses integer cross multiplication (`correct * 100 >= accepted * 98`), avoiding rounded percentages. Exit 0 means all requirements passed; exit 1 means a completed gate failed; exit 2 means the gate could not validly run. The machine report includes all predictions, per-class confusion/coverage, unsupported family totals, veto counts, parity and provenance hashes.

Scores are not calibrated correctness probabilities. Authored corpora do not establish population-wide accuracy, universal zero false acceptance, financial quality or forecasting ability. A passing gate only authorizes the next separately reviewed product stage.

## Independent synthetic verification

```sh
python3 -B -m unittest discover -s experiments/paraphrase -p test_evaluate.py
```

Tests use analytic dot products/softmax, tiny synthetic artifacts, and temporary synthetic corpora. They cover full mappings, threshold equality and immediately-below boundaries, deterministic vetoes, strict bounds, complete development identity/hash coverage, required parity including malformed reference values, isolated development CLI, refusal before held-out reads, all-class gate coverage, exact-screen errors, zero unsupported acceptance, and atomic report failure. No test opens actual held-out corpora or consumes trainer/reference implementation.
