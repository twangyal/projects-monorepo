"""Independent analytic/synthetic safety checks; never opens held-out corpora."""

import copy
import hashlib
import json
import math
from pathlib import Path
import tempfile
from unittest.mock import patch
import unittest

import evaluate

HERE = Path(__file__).resolve().parent


def fixture():
    raw = (HERE / "training-contract.json").read_bytes()
    contract = json.loads(raw)
    artifact = {
        key: copy.deepcopy(contract[key])
        for key in [
            "classOrder",
            "canonicalMappings",
            "screenDefaults",
            "normalizer",
            "rejectionPolicy",
            "limits",
        ]
    }
    artifact.update(
        schemaVersion=1,
        contractSha256=hashlib.sha256(raw).hexdigest(),
        trainingSha256="1" * 64,
        developmentSha256="2" * 64,
        dependencies=contract["training"]["dependencies"],
        knownContentTokens=["benefit", "gain", "income"],
        vocabulary=["gain", "income"],
        idf=[2.0, 3.0],
        coefficients=[[2.0, 1.0]] + [[0.0, 0.0] for _ in range(5)],
        intercepts=[1.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        centroids=[[1.0, 0.0]] + [[0.0, 1.0] for _ in range(5)],
        thresholds={"minScore": 0.55, "minMargin": 0.1, "minSimilarity": 0.1},
    )
    return artifact


def model(artifact=None):
    data = fixture() if artifact is None else artifact
    return evaluate.Evaluator.from_bytes(json.dumps(data, allow_nan=True).encode())


def development_report(scorer, examples, artifact_raw):
    counts = {
        "total": len(examples),
        "supported": sum(row["intent"] is not None for row in examples),
        "unsupported": sum(row["intent"] is None for row in examples),
        "intents": {
            intent: sum(row["intent"] == intent for row in examples)
            for intent in evaluate.CLASSES
        },
        "families": len({row["family"] for row in examples}),
    }
    return {
        "schemaVersion": 1,
        "contractSha256": scorer.artifact["contractSha256"],
        "trainingSha256": scorer.artifact["trainingSha256"],
        "developmentSha256": scorer.artifact["developmentSha256"],
        "artifactSha256": hashlib.sha256(artifact_raw).hexdigest(),
        "dependencies": scorer.artifact["dependencies"],
        "seed": 20261004,
        "corpusCounts": {
            "training": {
                "total": 180,
                "supported": 180,
                "unsupported": 0,
                "intents": dict.fromkeys(evaluate.CLASSES, 30),
                "families": 60,
            },
            "development": counts,
        },
        "audit": {},
        "fit": {
            "iterations": [1],
            "converged": True,
            "vocabularyFeatures": 2,
            "trainingRows": 180,
            "exportedFitScoreMaxAbsoluteError": 0.0,
        },
        "artifactBytes": len(artifact_raw),
        "status": "notReady",
        "selected": {
            "thresholds": scorer.artifact["thresholds"],
            "acceptedPerClass": [0] * 6,
            "wrongAccepted": 0,
            "unsupportedAccepted": 0,
        },
        "grid": [],
        "perIntent": {
            intent: {
                "total": counts["intents"][intent],
                "accepted": 0,
                "correct": 0,
                "incorrect": 0,
                "abstained": counts["intents"][intent],
            }
            for intent in evaluate.CLASSES
        },
        "unsupportedByReason": {
            "Numeric constraint": {
                "total": counts["unsupported"],
                "accepted": 0,
                "abstained": counts["unsupported"],
            }
        },
        "vetoCounts": {"invalidInput": len(examples)},
        "acceptedConfusion": {
            intent: dict.fromkeys(evaluate.CLASSES, 0) for intent in evaluate.CLASSES
        },
        "limitations": "Synthetic fixture",
        "parityVectors": [
            {
                "id": row["id"],
                "text": row["text"],
                "expectedIntent": row["intent"],
                **scorer.predict(row["text"]),
            }
            for row in examples
        ],
    }


class EvaluatorTests(unittest.TestCase):
    def test_binary_tfidf_bigrams_and_normalization_have_analytic_values(self):
        vector = evaluate.vectorize(
            ["gain", "gain", "income"], ["gain", "gain gain", "income"], [2, 3, 4]
        )
        self.assertEqual(len(vector), 3)
        for actual, expected in zip(
            vector, [2 / math.sqrt(29), 3 / math.sqrt(29), 4 / math.sqrt(29)]
        ):
            self.assertAlmostEqual(actual, expected, delta=1e-15)
        self.assertEqual(evaluate.vectorize(["gain"] * 8, ["gain"], [7]), [1.0])
        self.assertEqual(evaluate.vectorize(["missing"], ["gain"], [7]), [0.0])

    def test_softmax_stability_and_frozen_class_tie_order(self):
        scores = evaluate.softmax([1000, 999, -1000])
        self.assertAlmostEqual(scores[0], 1 / (1 + math.exp(-1)), delta=1e-15)
        self.assertEqual(scores[2], 0)
        artifact = fixture()
        artifact["coefficients"] = [[0, 0]] * 6
        artifact["intercepts"] = [0] * 6
        prediction = model(artifact).predict("gain")
        self.assertEqual(prediction["topIntent"], "profitable")
        self.assertFalse(prediction["accepted"])
        self.assertEqual(prediction["vetoReason"], "modelThresholds")

    def test_analytic_logits_scores_margin_similarity_and_entire_screen(self):
        scorer = model()
        prediction = scorer.predict("GAIN!")
        expected = math.exp(3) / (math.exp(3) + 5)
        self.assertAlmostEqual(prediction["topScore"], expected, delta=1e-15)
        self.assertAlmostEqual(
            prediction["margin"], expected - 1 / (math.exp(3) + 5), delta=1e-15
        )
        self.assertEqual(prediction["similarity"], 1)
        self.assertEqual(prediction["features"], [[0, 1.0]])
        self.assertEqual(prediction["normalized"], "gain")
        self.assertTrue(prediction["accepted"])
        self.assertEqual(prediction["canonicalQuery"], "companies with profitable")
        self.assertEqual(
            prediction["screen"],
            {
                "sector": None,
                "currency": None,
                "filters": [
                    {
                        "metric": "netIncome",
                        "operator": "gt",
                        "value": 0,
                        "currency": None,
                    }
                ],
                "includeStale": False,
                "sortBy": "ticker",
                "direction": "asc",
            },
        )
        prediction["screen"]["filters"][0]["value"] = 999
        self.assertEqual(scorer.predict("gain")["screen"]["filters"][0]["value"], 0)

    def test_thresholds_are_inclusive_with_no_parity_epsilon_at_inference(self):
        thresholds = {"minScore": 0.55, "minMargin": 0.1, "minSimilarity": 0.1}
        self.assertTrue(evaluate.accepts(0.55, 0.1, 0.1, thresholds))
        for values in [
            (0.55 - 1e-12, 0.1, 0.1),
            (0.55, 0.1 - 1e-12, 0.1),
            (0.55, 0.1, 0.1 - 1e-12),
        ]:
            self.assertFalse(evaluate.accepts(*values, thresholds))

    def test_complete_ascii_normalization_and_first_veto_never_salvage_clauses(self):
        scorer = model()
        for text, reason in [
            (None, "invalidInput"),
            ("gain\0income", "invalidInput"),
            ("gáin", "invalidInput"),
            ("gain 10%", "invalidInput"),
            ("gain, income", "invalidInput"),
            ("gain\n", "invalidInput"),
            ("\ud800", "invalidInput"),
            ("gain " * 200, "invalidInput"),
            ("gain isn't income", "negation"),
            ("non-gain", "negation"),
            ("gain and income", "composition"),
            ("gain forecast", "unsupportedConstraint"),
            ("profitable growing", "multipleCanonicalAnchors"),
            ("gain quux", "unknownContent"),
            ("show companies", "unknownContent"),
            ("benefit", "emptyFeatures"),
        ]:
            with self.subTest(
                reason=reason, length=len(text) if isinstance(text, str) else None
            ):
                prediction = scorer.predict(text)
                self.assertFalse(prediction["accepted"])
                self.assertEqual(prediction["vetoReason"], reason)
                self.assertIsNone(prediction["screen"])
                self.assertIsNone(prediction["canonicalQuery"])
                self.assertIsNone(prediction["scores"])
        self.assertEqual(
            scorer.predict("  Gain-income?\t")["tokens"], ["gain", "income"]
        )

    def test_artifact_shape_finiteness_metadata_hash_and_normalized_centroids_are_strict(
        self,
    ):
        changes = [
            ("schemaVersion", True),
            ("contractSha256", "0" * 64),
            ("extra", "source"),
            ("idf", [float("nan"), 3]),
            ("idf", [2]),
            ("idf", [0, 3]),
            ("coefficients", [[1, 2]]),
            ("intercepts", [float("inf")] * 6),
            ("centroids", [[0, 0]] * 6),
            ("vocabulary", ["income", "gain"]),
            ("vocabulary", ["gain", "gain"]),
            ("knownContentTokens", ["show"]),
            ("thresholds", {"minScore": 0.56, "minMargin": 0.1, "minSimilarity": 0.1}),
        ]
        for key, value in changes:
            artifact = fixture()
            artifact[key] = value
            with self.subTest(key=key), self.assertRaises(evaluate.EvaluationError):
                model(artifact)
        raw = json.dumps(fixture()).encode()
        with self.assertRaises(evaluate.EvaluationError):
            evaluate.Evaluator.from_bytes(raw[:-1] + b',"schemaVersion":1}')
        for raw in [
            b"x" * (1048576 + 1),
            b"\xef\xbb\xbf{}",
            b'{"x":' + b"[" * 13 + b"0" + b"]" * 13 + b"}",
        ]:
            with self.assertRaises(evaluate.EvaluationError):
                evaluate.Evaluator.from_bytes(raw)

    def test_every_whole_screen_mapping_has_exact_defaults_and_future_shortcuts(self):
        mappings = evaluate.load_mapping(HERE / "screen-mapping.json")
        expected = {
            "profitable": ("netIncome", "gt", 0),
            "lossMaking": ("netIncome", "lt", 0),
            "growing": ("growthPct", "gt", 0),
            "declining": ("growthPct", "lt", 0),
            "lowDebt": ("debtEquity", "lte", 1),
            "highMargin": ("marginPct", "gte", 10),
        }
        for intent, (metric, operator, value) in expected.items():
            self.assertEqual(
                mappings[intent]["screen"],
                {
                    "sector": None,
                    "currency": None,
                    "filters": [
                        {
                            "metric": metric,
                            "operator": operator,
                            "value": value,
                            "currency": None,
                        }
                    ],
                    "includeStale": False,
                    "sortBy": "ticker",
                    "direction": "asc",
                },
            )
        self.assertEqual(
            mappings["lossMaking"]["canonicalQuery"], "companies with loss making"
        )
        self.assertEqual(
            mappings["declining"]["canonicalQuery"], "companies with declining revenue"
        )

    def test_printable_financial_constraints_remain_unsupported_benchmark_cases(self):
        examples = [
            {
                "id": f"constraint-{i}",
                "family": "numeric-constraint",
                "text": f"margin above {i}% in USD $",
                "intent": None,
                "reason": "Explicit numeric and currency constraints",
            }
            for i in range(160)
        ]
        document = {
            "schemaVersion": 1,
            "split": "heldout-unsupported",
            "provenance": "Original synthetic safety fixture",
            "examples": examples,
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic-fixture.json"
            path.write_text(json.dumps(document))
            admitted = evaluate.load_corpus(path, "heldout-unsupported")
        self.assertEqual(len(admitted), 160)
        self.assertEqual(
            model().predict(admitted[0]["text"])["vetoReason"], "invalidInput"
        )

    def test_parity_uses_absolute_tolerance_but_requires_exact_decisions_and_defaults(
        self,
    ):
        scorer = model()
        prediction = scorer.predict("gain")
        row = {
            "id": "synthetic-parity",
            "text": "gain",
            "expectedIntent": "profitable",
            **prediction,
        }
        good = copy.deepcopy(row)
        good["scores"][0] += 5e-11
        self.assertTrue(evaluate.check_parity(scorer, [good])["passed"])
        bad = copy.deepcopy(row)
        bad["scores"][0] += 2e-10
        self.assertFalse(evaluate.check_parity(scorer, [bad])["passed"])
        for key, value in [
            ("accepted", False),
            ("canonicalQuery", "companies"),
            ("screen", {**row["screen"], "includeStale": True}),
        ]:
            bad = copy.deepcopy(row)
            bad[key] = value
            self.assertFalse(evaluate.check_parity(scorer, [bad])["passed"])

    def test_complete_development_parity_binds_every_row_and_hash(self):
        examples = []
        for intent in evaluate.CLASSES:
            for i in range(10):
                examples.append(
                    {
                        "id": f"{intent.lower()}-{i:02}",
                        "family": "synthetic",
                        "text": f"{intent} request {i}",
                        "intent": intent,
                    }
                )
        for i in range(80):
            examples.append(
                {
                    "id": f"unsupported-{i:02}",
                    "family": "numeric",
                    "text": f"margin above {i}% $",
                    "intent": None,
                    "reason": "Numeric constraint",
                }
            )
        examples.sort(key=lambda row: row["id"])
        document = {
            "schemaVersion": 1,
            "split": "development",
            "provenance": "Synthetic safety fixture",
            "examples": examples,
        }
        raw = json.dumps(document).encode()
        artifact = fixture()
        artifact["developmentSha256"] = hashlib.sha256(raw).hexdigest()
        scorer = model(artifact)
        rows = [
            {
                "id": row["id"],
                "text": row["text"],
                "expectedIntent": row["intent"],
                **scorer.predict(row["text"]),
            }
            for row in examples
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic-development.json"
            path.write_bytes(raw)
            result = evaluate.verify_development_parity(scorer, path, rows)
            self.assertTrue(result["passed"])
            self.assertTrue(result["completeDevelopment"])
            self.assertEqual(result["vectors"], 140)
            for bad in [rows[:-1], list(reversed(rows)), [rows[0]] + rows[:-1]]:
                with self.assertRaises(evaluate.EvaluationError):
                    evaluate.verify_development_parity(scorer, path, bad)
            for field, value in [
                ("text", "different complete text"),
                ("expectedIntent", "highMargin"),
            ]:
                bad = copy.deepcopy(rows)
                bad[0][field] = value
                with self.assertRaises(evaluate.EvaluationError):
                    evaluate.verify_development_parity(scorer, path, bad)
            path.write_bytes(raw + b" ")
            with self.assertRaises(evaluate.EvaluationError):
                evaluate.verify_development_parity(scorer, path, rows)

    def test_huge_integer_artifact_is_safely_rejected(self):
        artifact = fixture()
        artifact["idf"][0] = 10**1000
        with self.assertRaises(evaluate.EvaluationError):
            model(artifact)

    def test_nonfinite_parity_is_invalid_even_on_deterministic_veto(self):
        scorer = model()
        row = {
            "id": "invalid-numeric-reference",
            "text": "gain 10%",
            "expectedIntent": None,
            **scorer.predict("gain 10%"),
        }
        row["topScore"] = float("inf")
        with self.assertRaises(evaluate.EvaluationError):
            evaluate.check_parity(scorer, [row])

    def test_development_only_cli_never_reads_heldout_and_notready_blocks_gate(self):
        examples = [
            {
                "id": f"{intent.lower()}-{i:02}",
                "family": "supported",
                "text": f"{intent} request {i}",
                "intent": intent,
            }
            for intent in evaluate.CLASSES
            for i in range(10)
        ]
        examples += [
            {
                "id": f"unsupported-{i:02}",
                "family": "numeric",
                "text": f"margin above {i}%",
                "intent": None,
                "reason": "Numeric constraint",
            }
            for i in range(80)
        ]
        examples.sort(key=lambda row: row["id"])
        document = {
            "schemaVersion": 1,
            "split": "development",
            "provenance": "Synthetic safety fixture",
            "examples": examples,
        }
        raw = json.dumps(document).encode()
        artifact = fixture()
        artifact["developmentSha256"] = hashlib.sha256(raw).hexdigest()
        artifact_raw = json.dumps(artifact).encode()
        scorer = model(artifact)
        report = development_report(scorer, examples, artifact_raw)
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            artifact_path, development_path, parity_path = [
                base / name
                for name in ("artifact.json", "development.json", "reference.json")
            ]
            artifact_path.write_bytes(artifact_raw)
            development_path.write_bytes(raw)
            parity_path.write_text(json.dumps(report))
            arguments = [
                "--artifact",
                str(artifact_path),
                "--development",
                str(development_path),
                "--parity",
                str(parity_path),
            ]
            with (
                patch("builtins.print"),
                patch("evaluate.read_bytes", wraps=evaluate.read_bytes) as reads,
            ):
                self.assertEqual(evaluate.main(["--check-development", *arguments]), 0)
                self.assertEqual(
                    evaluate.main(
                        [
                            *arguments,
                            "--supported",
                            str(base / "NEVER-OPEN-supported"),
                            "--unsupported",
                            str(base / "NEVER-OPEN-unsupported"),
                            "--output",
                            str(base / "output.json"),
                        ]
                    ),
                    2,
                )
            self.assertFalse(
                any("NEVER-OPEN" in str(call.args[0]) for call in reads.call_args_list)
            )
            self.assertFalse((base / "output.json").exists())
            with patch("builtins.print"):
                self.assertEqual(
                    evaluate.main(
                        [
                            "--check-development",
                            *arguments,
                            "--output",
                            str(artifact_path),
                        ]
                    ),
                    2,
                )
            self.assertEqual(artifact_path.read_bytes(), artifact_raw)
            bad_reports = []
            bad = copy.deepcopy(report)
            bad["fit"]["converged"] = False
            bad_reports.append(bad)
            bad = copy.deepcopy(report)
            bad["status"] = "ready"
            bad_reports.append(bad)
            bad = copy.deepcopy(report)
            bad["corpusCounts"]["development"]["families"] = {
                "supported": 60,
                "numeric": 80,
            }
            bad_reports.append(bad)
            bad = copy.deepcopy(report)
            bad["perIntent"]["profitable"]["total"] = True
            bad_reports.append(bad)
            bad = copy.deepcopy(report)
            bad["selected"]["thresholds"]["minScore"] = 0.6
            bad_reports.append(bad)
            for bad in bad_reports:
                parity_path.write_text(json.dumps(bad))
                with patch("builtins.print"):
                    self.assertEqual(
                        evaluate.main(["--check-development", *arguments]), 2
                    )

            report["artifactSha256"] = "0" * 64
            parity_path.write_text(json.dumps(report))
            with patch("builtins.print"):
                self.assertEqual(evaluate.main(["--check-development", *arguments]), 2)

    def test_diagnostic_only_keeps_unicode_corpus_invalid_for_benchmark(self):
        examples = [
            {
                "id": f"{intent.lower()}-{i:02}",
                "family": "supported",
                "text": f"{intent} request {i}",
                "intent": intent,
            }
            for intent in evaluate.CLASSES
            for i in range(10)
        ]
        examples += [
            {
                "id": f"unsupported-{i:02}",
                "family": "numeric",
                "text": f"margin above {i}%",
                "intent": None,
                "reason": "Numeric constraint",
            }
            for i in range(80)
        ]
        examples[-1]["text"] = "😀 request with emoji"
        examples.sort(key=lambda row: row["id"])
        document = {
            "schemaVersion": 1,
            "split": "development",
            "provenance": "Synthetic Unicode diagnostic fixture",
            "examples": examples,
        }
        raw = json.dumps(document).encode()
        artifact = fixture()
        artifact["developmentSha256"] = hashlib.sha256(raw).hexdigest()
        artifact_raw = json.dumps(artifact).encode()
        scorer = model(artifact)
        report = development_report(scorer, examples, artifact_raw)
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            arguments = []
            for name, content in [
                ("artifact", artifact_raw),
                ("development", raw),
                ("parity", json.dumps(report).encode()),
            ]:
                path = base / (name + ".json")
                path.write_bytes(content)
                arguments += ["--" + name, str(path)]
            with (
                patch("builtins.print") as printed,
                patch("evaluate.read_bytes", wraps=evaluate.read_bytes) as reads,
            ):
                self.assertEqual(evaluate.main(["--check-development", *arguments]), 2)
                printed.reset_mock()
                self.assertEqual(
                    evaluate.main(["--diagnostic-development", *arguments]), 0
                )
                diagnostic = json.loads(printed.call_args.args[0])
                self.assertTrue(diagnostic["passed"])
                self.assertTrue(diagnostic["diagnosticOnly"])
                self.assertFalse(diagnostic["benchmarkAdmissible"])
                self.assertFalse(diagnostic["developmentReady"])
                self.assertEqual(diagnostic["invalidBenchmarkIDs"], ["unsupported-79"])
                self.assertEqual(diagnostic["vectors"], 140)
                self.assertFalse(
                    any("heldout" in str(call.args[0]) for call in reads.call_args_list)
                )

    def test_all_reference_arrays_are_finite_and_strict_even_when_not_comparable(self):
        scorer = model()
        row = {
            "id": "strict-reference",
            "text": "gain 10%",
            "expectedIntent": None,
            **scorer.predict("gain 10%"),
        }
        for field, value in [
            ("scores", [float("inf")] * 6),
            ("scores", [0.5]),
            ("features", [[0, float("nan")]]),
            ("features", [[True, 1]]),
            ("accepted", 1),
            ("tokens", [5]),
        ]:
            bad = copy.deepcopy(row)
            bad[field] = value
            with self.subTest(field=field), self.assertRaises(evaluate.EvaluationError):
                evaluate.check_parity(scorer, [bad])

    def test_gate_uses_full_screen_accuracy_each_class_and_zero_unsupported(self):
        scorer = model()
        supported = [
            {
                "id": f"{intent}-{i}",
                "family": intent,
                "text": f"{intent}:{i}",
                "intent": intent,
            }
            for intent in evaluate.CLASSES
            for i in range(20)
        ]
        unsupported = [
            {
                "id": f"unsupported-{i}",
                "family": "constraint",
                "text": f"unsupported:{i}",
                "intent": None,
                "reason": "Constraint",
            }
            for i in range(160)
        ]
        changes = {}

        def predict(text):
            intent = text.split(":")[0]
            if intent not in evaluate.CLASSES:
                result = scorer.predict("gain 10%")
            else:
                result = scorer.predict("gain")
                result.update(
                    topIntent=intent, **copy.deepcopy(scorer.mappings[intent])
                )
            for key, value in changes.get(text, {}).items():
                result[key] = value
            return result

        fake = type(
            "FixturePredictor",
            (),
            {"mappings": scorer.mappings, "predict": staticmethod(predict)},
        )()
        parity = {"passed": True, "completeDevelopment": True, "developmentReady": True}
        self.assertTrue(
            evaluate.evaluate_examples(fake, supported, unsupported, parity)["passed"]
        )
        self.assertFalse(
            evaluate.evaluate_examples(fake, supported, unsupported, {"passed": True})[
                "passed"
            ]
        )
        for i in range(6):
            changes[f"profitable:{i}"] = {
                "accepted": False,
                "vetoReason": "modelThresholds",
            }
        report = evaluate.evaluate_examples(fake, supported, unsupported, parity)
        self.assertFalse(report["criteria"]["perClassCoverage"])
        self.assertTrue(report["criteria"]["overallCoverage"])
        changes.clear()
        for i in range(2):
            changes[f"profitable:{i}"] = {
                "screen": {
                    **scorer.mappings["profitable"]["screen"],
                    "includeStale": True,
                }
            }
        self.assertTrue(
            evaluate.evaluate_examples(fake, supported, unsupported, parity)[
                "criteria"
            ]["exactScreenAccuracy"]
        )
        changes["profitable:2"] = changes["profitable:0"]
        report = evaluate.evaluate_examples(fake, supported, unsupported, parity)
        self.assertEqual(report["supported"]["incorrect"], 3)
        self.assertFalse(report["criteria"]["exactScreenAccuracy"])
        changes.clear()
        changes["unsupported:0"] = scorer.predict("gain")
        report = evaluate.evaluate_examples(fake, supported, unsupported, parity)
        self.assertEqual(report["unsupported"]["accepted"], 1)
        self.assertFalse(report["criteria"]["unsupportedAbstention"])

    def test_report_cap_failure_keeps_previous_output_intact(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.json"
            path.write_bytes(b"previous complete evidence")
            with self.assertRaises(evaluate.EvaluationError):
                evaluate.write_report({"oversized": "x" * (8 * 1024 * 1024)}, path)
            self.assertEqual(path.read_bytes(), b"previous complete evidence")
            self.assertEqual(
                [p.name for p in Path(directory).iterdir()], ["report.json"]
            )


if __name__ == "__main__":
    unittest.main()
