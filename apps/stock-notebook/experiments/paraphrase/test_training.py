"""Synthetic stdlib regressions for trainer/reference correctness.

Never reads corpora, fitted artifacts or held-out files; never imports numerical
fit dependencies. The examples and model below are deliberately artificial.
"""

import copy
import hashlib
import json
import math
from pathlib import Path
import unittest

import reference
import train

HERE = Path(__file__).resolve().parent
CONTRACT_BYTES = (HERE / "training-contract.json").read_bytes()
CONTRACT = json.loads(CONTRACT_BYTES)


def synthetic_model():
    keys = [
        "dependencies", "classOrder", "canonicalMappings", "screenDefaults",
        "normalizer", "rejectionPolicy", "limits",
    ]
    artifact = {
        key: copy.deepcopy(
            CONTRACT["training"][key] if key == "dependencies" else CONTRACT[key]
        )
        for key in keys
    }
    artifact.update(
        schemaVersion=1,
        contractSha256=hashlib.sha256(CONTRACT_BYTES).hexdigest(),
        trainingSha256="a" * 64,
        developmentSha256="b" * 64,
        knownContentTokens=["profitable"],
        vocabulary=["companies", "profitable"],
        idf=[1.0, 2.0],
        coefficients=[[0.0, 5.0]] + [[0.0, 0.0] for _ in range(5)],
        intercepts=[0.0] * 6,
        centroids=[[0.0, 1.0] for _ in range(6)],
        thresholds={"minScore": 0.55, "minMargin": 0.1, "minSimilarity": 0.1},
    )
    return artifact


class ReferenceTests(unittest.TestCase):
    def test_normalization_preserves_complete_internal_words(self):
        result = reference.normalize(
            "  I'm\tlooking for loss-making firms?  ", CONTRACT
        )
        self.assertEqual(
            result,
            (
                "i'm looking for loss making firms",
                ["i'm", "looking", "for", "loss", "making", "firms"],
                None,
            ),
        )

    def test_invalid_raw_input_never_becomes_prefix(self):
        for value in (
            "profitable; buy now", "profitable\ncompanies", "profitable 10%",
            "x" * 513, "\ud800", None,
        ):
            with self.subTest(value=repr(value)):
                self.assertEqual(
                    reference.normalize(value, CONTRACT),
                    (None, None, "invalidInput"),
                )

    def test_vetoes_never_return_partial_screens(self):
        for text, reason in (
            ("not profitable companies", "negation"),
            ("profitable and companies", "composition"),
            ("sort profitable companies", "unsupportedConstraint"),
            ("profitable growing companies", "multipleCanonicalAnchors"),
            ("profitable unicorns", "unknownContent"),
        ):
            with self.subTest(reason=reason):
                result = reference.infer(text, synthetic_model(), CONTRACT)
                self.assertEqual(result["vetoReason"], reason)
                self.assertIsNone(result["screen"])
                self.assertIsNone(result["canonicalQuery"])
                self.assertFalse(result["accepted"])

    def test_binary_tfidf_and_exact_screen(self):
        artifact = synthetic_model()
        first = reference.infer("profitable companies", artifact, CONTRACT)
        repeated = reference.infer(
            "profitable profitable companies", artifact, CONTRACT
        )
        self.assertEqual(first["features"], repeated["features"])
        self.assertAlmostEqual(first["features"][0][1], 1 / math.sqrt(5), places=14)
        self.assertAlmostEqual(first["features"][1][1], 2 / math.sqrt(5), places=14)
        self.assertTrue(first["accepted"])
        self.assertEqual(first["canonicalQuery"], "companies with profitable")
        self.assertEqual(
            first["screen"],
            {
                "sector": None,
                "currency": None,
                "filters": [
                    {"metric": "netIncome", "operator": "gt", "value": 0,
                     "currency": None}
                ],
                "includeStale": False,
                "sortBy": "ticker",
                "direction": "asc",
            },
        )

    def test_score_gate_abstains_without_discarding_math(self):
        artifact = synthetic_model()
        artifact["centroids"][0] = [1.0, 0.0]
        artifact["thresholds"]["minSimilarity"] = 0.7
        reference.validate_model(artifact, CONTRACT, artifact["contractSha256"])
        result = reference.infer("profitable companies", artifact, CONTRACT)
        self.assertEqual(result["vetoReason"], "modelThresholds")
        self.assertIsNotNone(result["scores"])
        self.assertIsNotNone(result["features"])
        self.assertIsNone(result["canonicalQuery"])
        self.assertIsNone(result["screen"])

    def test_artifact_rejects_nonfinite_dimensions_and_metadata_mutation(self):
        cases = ("nonfinite", "dimension", "normalizer", "centroid")
        for case in cases:
            with self.subTest(case=case):
                artifact = synthetic_model()
                if case == "nonfinite":
                    artifact["idf"][0] = float("nan")
                elif case == "dimension":
                    artifact["coefficients"][0].append(0)
                elif case == "normalizer":
                    artifact["normalizer"]["version"] = "evil"
                else:
                    artifact["centroids"][0][0] = 1
                with self.assertRaises(ValueError):
                    reference.validate_model(
                        artifact, CONTRACT, artifact["contractSha256"]
                    )

    def test_metadata_rejects_boolean_number_substitution(self):
        for field in ("includeStale", "mappedValue"):
            with self.subTest(field=field):
                artifact = synthetic_model()
                if field == "includeStale":
                    artifact["screenDefaults"]["includeStale"] = 0
                else:
                    artifact["canonicalMappings"][4]["value"] = True
                with self.assertRaises(ValueError):
                    reference.validate_model(
                        artifact, CONTRACT, artifact["contractSha256"]
                    )

    def test_huge_json_integers_fail_as_bounded_artifact_errors(self):
        for key in ("coefficients", "idf", "intercepts"):
            with self.subTest(key=key):
                artifact = synthetic_model()
                if key == "coefficients":
                    artifact[key][0][0] = 10**1000
                else:
                    artifact[key][0] = 10**1000
                with self.assertRaises(ValueError):
                    reference.validate_model(
                        artifact, CONTRACT, artifact["contractSha256"]
                    )

    def test_valid_model_is_detached_after_validation(self):
        artifact = synthetic_model()
        detached = reference.validate_model(
            artifact, CONTRACT, artifact["contractSha256"]
        )
        self.assertEqual(detached, artifact)
        detached["coefficients"][0][0] = 100
        self.assertEqual(artifact["coefficients"][0][0], 0)

    def test_logits_add_intercept_after_ascending_product_sum(self):
        artifact = synthetic_model()
        words = ["a" + chr(97 + index // 26) + chr(97 + index % 26)
                 for index in range(64)]
        artifact.update(
            knownContentTokens=words,
            vocabulary=words,
            idf=[1.0] * 64,
            coefficients=[
                [1e6 if index % 2 == 0 else -999999.999999
                 for index in range(64)]
            ] + [[0.0] * 64 for _ in range(5)],
            intercepts=[1e6] * 6,
            centroids=[[0.125] * 64 for _ in range(6)],
        )
        reference.validate_model(artifact, CONTRACT, artifact["contractSha256"])
        result = reference.infer(" ".join(words), artifact, CONTRACT)
        products = 0.0
        for value in artifact["coefficients"][0]:
            products += value * 0.125
        difference = (products + 1e6) - 1e6
        expected_score = 1 / (1 + 5 * math.exp(-difference))
        self.assertLessEqual(abs(result["scores"][0] - expected_score), 1e-10)


class TrainerTests(unittest.TestCase):
    def test_audit_rejects_cross_split_ids_before_fitting(self):
        training = {
            "examples": [
                {"id": "same-id", "family": "train-family",
                 "text": "Profitable companies", "intent": "profitable"}
            ]
        }
        development = {
            "examples": [
                {"id": "same-id", "family": "dev-family",
                 "text": "Firms losing money", "intent": "lossMaking"}
            ]
        }
        with self.assertRaises(ValueError):
            train.audit_corpora(training, development, CONTRACT)

    def test_training_policy_conflicts_are_found_before_numeric_fitting(self):
        corpus = {
            "examples": [
                {"id": "blocked", "text": "Positive bottom line companies"},
                {"id": "okay", "text": "Profitable companies"},
            ]
        }
        self.assertEqual(
            train.training_policy_conflicts(corpus, CONTRACT),
            [{"id": "blocked", "vetoReason": "unsupportedConstraint"}],
        )

    def test_ready_candidate_wins_before_larger_unready_total(self):
        def candidate(counts, score):
            return {
                "thresholds": {
                    "minScore": score, "minMargin": 0.1, "minSimilarity": 0.1
                },
                "acceptedPerClass": counts,
                "wrongAccepted": 0,
                "unsupportedAccepted": 0,
            }

        higher_total = candidate([10, 10, 10, 10, 10, 7], 0.6)
        ready = candidate([9, 9, 9, 9, 9, 8], 0.65)
        picked, status = train.select_thresholds([higher_total, ready], [10] * 6)
        self.assertEqual(status, "ready")
        self.assertEqual(picked, ready)

    def test_no_ready_candidate_keeps_diagnostic_without_false_success(self):
        candidate = {
            "thresholds": {
                "minScore": 0.7, "minMargin": 0.2, "minSimilarity": 0.3
            },
            "acceptedPerClass": [10, 10, 10, 10, 10, 7],
            "wrongAccepted": 0,
            "unsupportedAccepted": 0,
        }
        picked, status = train.select_thresholds([candidate], [10] * 6)
        self.assertEqual(status, "notReady")
        self.assertEqual(picked, candidate)


if __name__ == "__main__":
    unittest.main()
