# Learned screening paraphrase experiment

This is a preregistered feasibility experiment for [issue #36](https://github.com/twangyal/projects-monorepo/issues/36), isolated from Stock Notebook's application. No product module imports these files. The existing precise query grammar remains the available screening interpreter.

The proposed model learns six bounded English intents from original authored examples: positive net income, negative net income, positive revenue growth, negative revenue growth, low debt/equity and high net margin. Its suggestions must expose exact editable criteria. This is not investment analysis, a general language model, calibrated correctness probability or an evaluation on real users.

The [reviewed design](../../../../docs/superpowers/specs/2026-10-04-stock-paraphrase-gate-design.md) defines the independent gate and release policy. `training-contract.json` specifies preprocessing, unsupported-request vetoes, training math, finite development threshold search and artifact shape before fitting. Training/development authors do not inspect held-out data. Two independent authors supply supported and unsupported holdouts, and a separate reviewer audits labels and phrase-family overlap without model feedback. An independent evaluator checks the complete canonical screen mapping and inference math.

The release requirements are at least 15 of 20 supported examples accepted in each of six classes, at least 98% exact-screen accuracy among accepted supported examples, and no accepted unsupported example. Development must first meet its own per-class coverage and zero-error constraints. Malformed-input safety tests are separate from these language counts. Ordinary unsupported financial requests containing quantities or punctuation remain part of the language benchmark even when preprocessing rejects them.

All corpora, preprocessing, weights, thresholds, mapping, evaluation code and hashes must be committed before any held-out inference. Failed gates keep the feature unavailable; no thresholds or test examples may be adjusted in response to held-out failures. Published data becomes regression evidence, not a reusable unseen benchmark. The experiment uses installed local Python packages and no model download, hosted inference or service charge.

Status: implementation and pre-freeze independent audit in progress. No held-out inference or product release has been authorized. Reproduction commands, frozen hashes and measured results will be recorded after the audit.
