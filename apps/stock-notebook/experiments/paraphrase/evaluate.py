"""Independent stdlib inference/evaluation. No trainer implementation imports.

Held-out files may be opened only after root confirms the committed freeze.
The command-line entrypoint is for that single authorized gate, not tuning.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import uuid

HERE = Path(__file__).resolve().parent
ARTIFACT_BYTES = 1024 * 1024
REPORT_BYTES = 8 * 1024 * 1024
CLASSES = ("profitable", "lossMaking", "growing", "declining", "lowDebt", "highMargin")
FILTERS = (
    ("netIncome", "gt", 0),
    ("netIncome", "lt", 0),
    ("growthPct", "gt", 0),
    ("growthPct", "lt", 0),
    ("debtEquity", "lte", 1),
    ("marginPct", "gte", 10),
)
QUERIES = (
    "companies with profitable",
    "companies with loss making",
    "companies with growing",
    "companies with declining revenue",
    "companies with low debt",
    "companies with high margin",
)
RAW = re.compile(
    r"[A-Za-z]+(?:['-][A-Za-z]+)*(?:[ \t]+[A-Za-z]+(?:['-][A-Za-z]+)*)*[.!?]?", re.ASCII
)
TOKEN = re.compile(r"[a-z]+(?:'[a-z]+)*", re.ASCII)
IDENTIFIER = re.compile(r"[a-z][a-z0-9-]{0,79}", re.ASCII)
HASH = re.compile(r"[a-f0-9]{64}", re.ASCII)
TOLERANCE = 1e-10


class EvaluationError(ValueError):
    """Bounded validation/inference failure; never produces a partial result."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvaluationError(message)


def same_data(actual, expected) -> bool:
    """JSON structural equality distinguishing booleans from numeric values."""
    if isinstance(expected, bool) or expected is None or isinstance(expected, str):
        return type(actual) is type(expected) and actual == expected
    if isinstance(expected, (int, float)):
        return (
            type(actual) in (int, float)
            and number(actual, -1e308, 1e308)
            and actual == expected
        )
    if type(expected) is list:
        return (
            type(actual) is list
            and len(actual) == len(expected)
            and all(same_data(a, b) for a, b in zip(actual, expected))
        )
    if type(expected) is dict:
        return (
            type(actual) is dict
            and actual.keys() == expected.keys()
            and all(same_data(actual[key], expected[key]) for key in expected)
        )
    return False


def strict_json(raw: bytes, limit: int):
    require(
        type(raw) is bytes
        and len(raw) <= limit
        and not raw.startswith(b"\xef\xbb\xbf"),
        "JSON is oversized or has an unsupported encoding.",
    )
    try:
        text = raw.decode("utf-8")
        depth = 0
        quoted = escaped = False
        for char in text:
            if quoted:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    quoted = False
            elif char == '"':
                quoted = True
            elif char in "[{":
                depth += 1
                require(depth <= 12, "JSON exceeds the depth limit.")
            elif char in "]}":
                depth -= 1
                require(depth >= 0, "JSON has invalid nesting.")

        def pairs(items):
            result = {}
            for key, value in items:
                require(key not in result, "JSON contains duplicate fields.")
                result[key] = value
            return result

        def constant(_value):
            raise EvaluationError("JSON contains a nonfinite number.")

        def floating(value):
            result = float(value)
            require(math.isfinite(result), "JSON contains a nonfinite number.")
            return result

        value = json.loads(
            text, object_pairs_hook=pairs, parse_constant=constant, parse_float=floating
        )
        pending = [value]
        while pending:
            item = pending.pop()
            if type(item) is str:
                require(
                    not any(
                        0xD800 <= ord(char) <= 0xDFFF or ord(char) == 0 for char in item
                    ),
                    "JSON contains invalid Unicode or NUL.",
                )
            elif type(item) is dict:
                pending.extend(item.keys())
                pending.extend(item.values())
            elif type(item) is list:
                pending.extend(item)
        return value
    except EvaluationError:
        raise
    except (ValueError, UnicodeError, RecursionError, OverflowError):
        raise EvaluationError(
            "Input must be complete, strict bounded UTF-8 JSON."
        ) from None


def read_bytes(path: Path, limit: int) -> bytes:
    try:
        with Path(path).open("rb") as source:
            raw = source.read(limit + 1)
    except OSError:
        raise EvaluationError("A required experiment file could not be read.") from None
    require(len(raw) <= limit, "An experiment file exceeds its byte limit.")
    return raw


def load_mapping(path: Path) -> dict:
    value = strict_json(read_bytes(path, ARTIFACT_BYTES), ARTIFACT_BYTES)
    expected = {"schemaVersion": 1, "intents": {}}
    for intent, (metric, operator, threshold), query in zip(CLASSES, FILTERS, QUERIES):
        expected["intents"][intent] = {
            "canonicalQuery": query,
            "screen": {
                "sector": None,
                "currency": None,
                "filters": [
                    {
                        "metric": metric,
                        "operator": operator,
                        "value": threshold,
                        "currency": None,
                    }
                ],
                "includeStale": False,
                "sortBy": "ticker",
                "direction": "asc",
            },
        }
    require(
        same_data(value, expected),
        "The whole-screen mapping differs from the six independently declared screens.",
    )
    return expected["intents"]


def number(value, minimum: float, maximum: float) -> bool:
    return (
        type(value) in (int, float)
        and minimum <= value <= maximum
        and math.isfinite(value)
    )


def vectorize(
    tokens: list[str],
    vocabulary: list[str] | tuple[str, ...],
    idf: list[float] | tuple[float, ...],
) -> list[float]:
    present = set(tokens)
    present.update(f"{before} {after}" for before, after in zip(tokens, tokens[1:]))
    weighted = [
        weight if feature in present else 0.0
        for feature, weight in zip(vocabulary, idf)
    ]
    norm = math.sqrt(sum(value * value for value in weighted))
    return [value / norm for value in weighted] if norm else weighted


def softmax(logits: list[float]) -> list[float]:
    largest = max(logits)
    exponents = [math.exp(value - largest) for value in logits]
    total = sum(exponents)
    return [value / total for value in exponents]


def accepts(score: float, margin: float, similarity: float, thresholds: dict) -> bool:
    # Numerical parity tolerance must never enter these acceptance comparisons.
    return (
        score >= thresholds["minScore"]
        and margin >= thresholds["minMargin"]
        and similarity >= thresholds["minSimilarity"]
    )


class Evaluator:
    @classmethod
    def from_bytes(
        cls,
        raw: bytes,
        *,
        contract_path: Path = HERE / "training-contract.json",
        mapping_path: Path = HERE / "screen-mapping.json",
    ):
        contract_raw = read_bytes(contract_path, ARTIFACT_BYTES)
        contract = strict_json(contract_raw, ARTIFACT_BYTES)
        require(
            type(contract) is dict
            and contract.get("contractVersion") == "stock-paraphrase-1",
            "Unsupported training contract.",
        )
        artifact = strict_json(raw, ARTIFACT_BYTES)
        require(
            type(artifact) is dict
            and set(artifact) == set(contract["artifactSchema"]["rootKeys"]),
            "Artifact fields do not match the declared schema.",
        )
        require(
            type(artifact["schemaVersion"]) is int and artifact["schemaVersion"] == 1,
            "Unsupported artifact version.",
        )
        for field in ("contractSha256", "trainingSha256", "developmentSha256"):
            require(
                type(artifact[field]) is str
                and HASH.fullmatch(artifact[field]) is not None,
                "Artifact hash is invalid.",
            )
        require(
            artifact["contractSha256"] == hashlib.sha256(contract_raw).hexdigest(),
            "Artifact contract hash does not match frozen metadata.",
        )
        for field in (
            "classOrder",
            "canonicalMappings",
            "screenDefaults",
            "normalizer",
            "rejectionPolicy",
            "limits",
        ):
            require(
                same_data(artifact[field], contract[field]),
                "Artifact metadata differs from the training contract.",
            )
        require(
            same_data(artifact["dependencies"], contract["training"]["dependencies"]),
            "Artifact dependency metadata differs from the contract.",
        )
        require(
            artifact["classOrder"] == list(CLASSES),
            "Artifact class order is unsupported.",
        )
        mappings = load_mapping(mapping_path)
        limits = artifact["limits"]
        known = artifact["knownContentTokens"]
        vocabulary = artifact["vocabulary"]
        stopwords = frozenset(artifact["rejectionPolicy"]["requestStopwords"])
        require(
            type(known) is list
            and len(known) <= 4096
            and all(
                type(token) is str
                and len(token) <= 40
                and TOKEN.fullmatch(token)
                and token not in stopwords
                for token in known
            ),
            "Artifact known-content tokens are invalid.",
        )
        require(
            known == sorted(set(known)),
            "Artifact known-content tokens are not sorted and unique.",
        )
        require(
            type(vocabulary) is list
            and 1 <= len(vocabulary) <= limits["vocabularyFeatures"],
            "Artifact vocabulary count is invalid.",
        )
        require(
            all(
                type(feature) is str
                and len(feature) <= limits["featureCharacters"]
                and 1 <= len(feature.split(" ")) <= 2
                and all(TOKEN.fullmatch(token) for token in feature.split(" "))
                for feature in vocabulary
            ),
            "Artifact feature tokens are invalid.",
        )
        require(
            vocabulary == sorted(set(vocabulary)),
            "Artifact vocabulary is not sorted and unique.",
        )
        require(
            all(
                token in stopwords or token in known
                for feature in vocabulary
                for token in feature.split(" ")
            ),
            "Vocabulary contains undeclared content tokens.",
        )
        columns = len(vocabulary)

        def row(values, minimum, maximum):
            return (
                type(values) is list
                and len(values) == columns
                and all(number(value, minimum, maximum) for value in values)
            )

        require(
            row(artifact["idf"], 1, limits["maximumIdf"]), "Artifact IDF is invalid."
        )
        for field in ("coefficients", "centroids"):
            require(
                type(artifact[field]) is list and len(artifact[field]) == 6,
                "Artifact class matrix shape is invalid.",
            )
        bound = limits["absoluteCoefficient"]
        require(
            all(row(values, -bound, bound) for values in artifact["coefficients"]),
            "Artifact coefficients are invalid.",
        )
        require(
            type(artifact["intercepts"]) is list
            and len(artifact["intercepts"]) == 6
            and all(number(value, -bound, bound) for value in artifact["intercepts"]),
            "Artifact intercepts are invalid.",
        )
        require(
            all(
                row(values, 0, 1)
                and abs(math.sqrt(sum(value * value for value in values)) - 1)
                <= TOLERANCE
                for values in artifact["centroids"]
            ),
            "Artifact centroids are not normalized finite class rows.",
        )
        thresholds = artifact["thresholds"]
        require(
            type(thresholds) is dict
            and set(thresholds) == {"minScore", "minMargin", "minSimilarity"},
            "Artifact thresholds are invalid.",
        )
        for field, value in thresholds.items():
            require(
                number(value, 0, 1)
                and value in contract["thresholdSelection"][field + "Grid"],
                "Artifact threshold is outside the predeclared grid.",
            )
        instance = cls()
        instance.contract = contract
        instance.artifact_bytes = len(raw)
        instance.artifact = copy.deepcopy(artifact)
        instance.mappings = mappings
        instance.artifact_sha256 = hashlib.sha256(raw).hexdigest()
        instance.mapping_sha256 = hashlib.sha256(
            read_bytes(mapping_path, ARTIFACT_BYTES)
        ).hexdigest()
        return instance

    def predict(self, text) -> dict:
        artifact = self.artifact
        result = {
            "vetoReason": None,
            "normalized": None,
            "tokens": None,
            "features": None,
            "scores": None,
            "topIntent": None,
            "topScore": None,
            "margin": None,
            "similarity": None,
            "accepted": False,
            "canonicalQuery": None,
            "screen": None,
        }

        def veto(reason):
            result["vetoReason"] = reason
            return result

        limits = artifact["limits"]
        if type(text) is not str or len(text) > limits["rawCodePoints"]:
            return veto("invalidInput")
        try:
            if len(text.encode("utf-8")) > limits["rawUtf8Bytes"]:
                return veto("invalidInput")
        except UnicodeError:
            return veto("invalidInput")
        trimmed = text.strip(" \t")
        if not RAW.fullmatch(trimmed):
            return veto("invalidInput")
        lowered = trimmed.lower()
        if lowered[-1] in ".!?":
            lowered = lowered[:-1]
        normalized = re.sub(r"[ \t]+", " ", lowered.replace("-", " "))
        tokens = normalized.split(" ")
        if len(tokens) > limits["tokens"]:
            return veto("invalidInput")
        result.update(normalized=normalized, tokens=tokens)
        policy = artifact["rejectionPolicy"]
        if any(
            token in policy["negationTokens"]
            or token.endswith(policy["negationTokenSuffix"])
            for token in tokens
        ):
            return veto("negation")
        if any(token in policy["compositionTokens"] for token in tokens):
            return veto("composition")
        if any(token in policy["unsupportedConstraintTokens"] for token in tokens):
            return veto("unsupportedConstraint")
        anchors = sum(
            any(
                tokens[index : index + len(anchor)] == anchor
                for index in range(len(tokens) - len(anchor) + 1)
            )
            for anchor in policy["canonicalAnchorTokenSequences"]
        )
        if anchors >= 2:
            return veto("multipleCanonicalAnchors")
        known = set(artifact["knownContentTokens"])
        stopwords = set(policy["requestStopwords"])
        if any(
            token not in known and token not in stopwords for token in tokens
        ) or not any(token not in stopwords for token in tokens):
            return veto("unknownContent")
        vector = vectorize(tokens, artifact["vocabulary"], artifact["idf"])
        if not any(vector):
            return veto("emptyFeatures")
        logits = [
            bias + sum(weight * value for weight, value in zip(weights, vector))
            for weights, bias in zip(artifact["coefficients"], artifact["intercepts"])
        ]
        scores = softmax(logits)
        winner = max(range(6), key=lambda index: scores[index])
        score = scores[winner]
        margin = score - max(
            value for index, value in enumerate(scores) if index != winner
        )
        similarity = min(
            1.0,
            max(
                -1.0,
                sum(
                    value * center
                    for value, center in zip(vector, artifact["centroids"][winner])
                ),
            ),
        )
        require(
            all(math.isfinite(value) for value in (*scores, margin, similarity)),
            "Inference produced a nonfinite result.",
        )
        intent = CLASSES[winner]
        result.update(
            features=[[index, value] for index, value in enumerate(vector) if value],
            scores=scores,
            topIntent=intent,
            topScore=score,
            margin=margin,
            similarity=similarity,
        )
        if not accepts(score, margin, similarity, artifact["thresholds"]):
            return veto("modelThresholds")
        result.update(
            accepted=True,
            canonicalQuery=self.mappings[intent]["canonicalQuery"],
            screen=copy.deepcopy(self.mappings[intent]["screen"]),
        )
        return result


def load_model(path: Path) -> Evaluator:
    return Evaluator.from_bytes(read_bytes(path, ARTIFACT_BYTES))


def load_corpus(path: Path, split: str) -> list[dict]:
    return validate_corpus(
        strict_json(read_bytes(path, ARTIFACT_BYTES), ARTIFACT_BYTES), split
    )


def validate_corpus(document, split: str, *, diagnostic: bool = False) -> list[dict]:
    require(
        type(document) is dict
        and set(document) == {"schemaVersion", "split", "provenance", "examples"},
        "Corpus fields are invalid.",
    )
    require(
        type(document["schemaVersion"]) is int
        and document["schemaVersion"] == 1
        and document["split"] == split,
        "Corpus version or split is invalid.",
    )
    require(
        type(document["provenance"]) is str
        and 1 <= len(document["provenance"]) <= 2000,
        "Corpus provenance is missing or oversized.",
    )
    require(
        not diagnostic or split == "development",
        "Diagnostic admission is only available for development math, never a benchmark.",
    )
    examples = document["examples"]
    require(
        type(examples) is list and len(examples) <= 2000,
        "Corpus example count is invalid.",
    )
    supported = split == "heldout-supported"
    development = split == "development"
    require(
        split in ("heldout-supported", "heldout-unsupported", "development"),
        "Unsupported corpus split.",
    )
    seen_ids = set()
    seen_text = set()
    counts = dict.fromkeys(CLASSES, 0)
    for example in examples:
        is_supported = supported or (
            development and type(example) is dict and example.get("intent") is not None
        )
        keys = {"id", "family", "text", "intent"} | (
            set() if is_supported else {"reason"}
        )
        require(
            type(example) is dict and set(example) == keys,
            "Corpus example fields are invalid.",
        )
        require(
            all(
                type(example[field]) is str and IDENTIFIER.fullmatch(example[field])
                for field in ("id", "family")
            ),
            "Corpus identity/family is invalid.",
        )
        text = example["text"]
        # Financial punctuation/digits rejected by the model are still normal
        # human-language benchmark inputs. Never remove them from the counts.
        require(
            type(text) is str
            and 5 <= len(text) <= 240
            and len(text.encode("utf-8")) <= 2048
            and (diagnostic or all(32 <= ord(char) <= 126 for char in text)),
            "Corpus includes a separate malformed/overlength safety case.",
        )
        require(
            example["id"] not in seen_ids and text not in seen_text,
            "Corpus has duplicate identities or raw texts.",
        )
        seen_ids.add(example["id"])
        seen_text.add(text)
        if is_supported:
            require(
                type(example["intent"]) is str and example["intent"] in CLASSES,
                "Supported example intent is invalid.",
            )
            counts[example["intent"]] += 1
        else:
            require(
                example["intent"] is None
                and type(example["reason"]) is str
                and 1 <= len(example["reason"]) <= 240,
                "Unsupported example reason/intent is invalid.",
            )
    if development:
        require(
            all(count >= 10 for count in counts.values())
            and sum(row["intent"] is None for row in examples) >= 80,
            "Development requires ten supported examples per class and eighty unsupported examples.",
        )
    elif supported:
        require(
            len(examples) == 120 and all(count == 20 for count in counts.values()),
            "Supported gate requires exactly 120 examples, twenty per intent.",
        )
    else:
        require(
            len(examples) >= 160,
            "Unsupported gate requires at least 160 language examples.",
        )
    return examples


def check_parity(evaluator: Evaluator, rows: list[dict]) -> dict:
    require(
        type(rows) is list and 1 <= len(rows) <= 2000,
        "Parity requires a nonempty declared reference fixture.",
    )
    row_keys = {
        "id",
        "text",
        "expectedIntent",
        "vetoReason",
        "normalized",
        "tokens",
        "features",
        "scores",
        "topIntent",
        "topScore",
        "margin",
        "similarity",
        "accepted",
        "canonicalQuery",
        "screen",
    }
    maximum_error = 0.0
    mismatches = []
    seen = set()
    for row in rows:
        require(
            type(row) is dict
            and set(row) == row_keys
            and type(row["id"]) is str
            and IDENTIFIER.fullmatch(row["id"])
            and row["id"] not in seen,
            "Parity reference fields/identity are invalid.",
        )
        require(
            row["expectedIntent"] is None or row["expectedIntent"] in CLASSES,
            "Parity expected intent is invalid.",
        )
        require(
            type(row["text"]) is str
            and len(row["text"]) <= 512
            and type(row["accepted"]) is bool,
            "Parity text or acceptance type is invalid.",
        )
        require(
            row["vetoReason"] is None
            or type(row["vetoReason"]) is str
            and row["vetoReason"] in evaluator.artifact["rejectionPolicy"]["order"],
            "Parity veto reason is invalid.",
        )
        require(
            row["topIntent"] is None
            or type(row["topIntent"]) is str
            and row["topIntent"] in CLASSES,
            "Parity top intent is invalid.",
        )
        require(
            row["normalized"] is None
            or type(row["normalized"]) is str
            and len(row["normalized"]) <= 512,
            "Parity normalized text is invalid.",
        )
        require(
            row["tokens"] is None
            or type(row["tokens"]) is list
            and len(row["tokens"]) <= 64
            and all(
                type(token) is str and TOKEN.fullmatch(token) for token in row["tokens"]
            ),
            "Parity tokens are invalid.",
        )
        require(
            row["canonicalQuery"] is None
            or type(row["canonicalQuery"]) is str
            and len(row["canonicalQuery"]) <= 240,
            "Parity canonical query is invalid.",
        )
        require(
            row["screen"] is None or type(row["screen"]) is dict,
            "Parity screen type is invalid.",
        )
        require(
            row["scores"] is None
            or type(row["scores"]) is list
            and len(row["scores"]) == 6
            and all(number(value, 0, 1 + TOLERANCE) for value in row["scores"]),
            "Parity scores must be six finite probabilities.",
        )
        features = row["features"]
        if features is not None:
            require(
                type(features) is list
                and len(features) <= len(evaluator.artifact["vocabulary"]),
                "Parity sparse feature count is invalid.",
            )
            previous = -1
            for feature in features:
                require(
                    type(feature) is list
                    and len(feature) == 2
                    and type(feature[0]) is int
                    and previous < feature[0] < len(evaluator.artifact["vocabulary"])
                    and number(feature[1], 0, 1 + TOLERANCE)
                    and feature[1] > 0,
                    "Parity sparse features are not sorted finite columns.",
                )
                previous = feature[0]
        seen.add(row["id"])
        actual = evaluator.predict(row["text"])
        differences = []
        for key in (
            "vetoReason",
            "normalized",
            "tokens",
            "topIntent",
            "accepted",
            "canonicalQuery",
            "screen",
        ):
            if not same_data(actual[key], row[key]):
                differences.append(key)

        def numeric(left, right, key):
            nonlocal maximum_error
            require(
                right is None or number(right, -1e6, 1e6),
                "Parity reference contains invalid numeric values.",
            )
            if left is None or right is None:
                if left is not None or right is not None:
                    differences.append(key)
            elif not number(right, -1e6, 1e6):
                raise EvaluationError(
                    "Parity reference contains invalid numeric values."
                )
            else:
                error = abs(left - right)
                maximum_error = max(maximum_error, error)
                if error > TOLERANCE:
                    differences.append(key)

        for key in ("topScore", "margin", "similarity"):
            numeric(actual[key], row[key], key)
        for key in ("scores", "features"):
            left, right = actual[key], row[key]
            if left is None or right is None:
                if left is not None or right is not None:
                    differences.append(key)
                continue
            require(type(right) is list, "Parity reference arrays are invalid.")
            if len(left) != len(right):
                differences.append(key)
                continue
            if key == "scores":
                for a, b in zip(left, right):
                    numeric(a, b, key)
            else:
                for a, b in zip(left, right):
                    require(
                        type(b) is list and len(b) == 2 and type(b[0]) is int,
                        "Parity sparse features are invalid.",
                    )
                    if a[0] != b[0]:
                        differences.append(key)
                    numeric(a[1], b[1], key)
        if differences:
            mismatches.append({"id": row["id"], "fields": sorted(set(differences))})
    return {
        "passed": not mismatches,
        "vectors": len(rows),
        "absoluteTolerance": TOLERANCE,
        "maximumAbsoluteError": maximum_error,
        "mismatches": mismatches,
    }


def verify_development_parity(
    evaluator: Evaluator, path: Path, rows: list[dict], *, diagnostic: bool = False
) -> dict:
    raw = read_bytes(path, ARTIFACT_BYTES)
    digest = hashlib.sha256(raw).hexdigest()
    require(
        digest == evaluator.artifact["developmentSha256"],
        "Development corpus hash does not match the artifact.",
    )
    examples = validate_corpus(
        strict_json(raw, ARTIFACT_BYTES), "development", diagnostic=diagnostic
    )
    expected = sorted(examples, key=lambda row: row["id"])
    require(
        type(rows) is list and len(rows) == len(expected),
        "Parity must cover every development example exactly once.",
    )
    for row, example in zip(rows, expected):
        require(
            type(row) is dict
            and all(
                same_data(row.get(field), example[source])
                for field, source in (
                    ("id", "id"),
                    ("text", "text"),
                    ("expectedIntent", "intent"),
                )
            ),
            "Parity identities, texts, intents or sorted order differ from the complete development corpus.",
        )
    result = check_parity(evaluator, rows)
    invalid = [
        row["id"]
        for row in expected
        if not all(32 <= ord(char) <= 126 for char in row["text"])
    ]
    supported = sum(
        row["intent"] is not None and row["id"] not in invalid for row in expected
    )
    result.update(
        completeDevelopment=True,
        developmentSha256=digest,
        diagnosticOnly=diagnostic,
        benchmarkAdmissible=not invalid,
        invalidBenchmarkIDs=invalid,
        admissibleSupported=supported,
        admissibleUnsupported=sum(
            row["intent"] is None and row["id"] not in invalid for row in expected
        ),
    )
    return result


def check_development(
    evaluator: Evaluator,
    development: Path,
    reference: Path,
    *,
    diagnostic: bool = False,
) -> dict:
    raw = read_bytes(reference, REPORT_BYTES)
    report = strict_json(raw, REPORT_BYTES)
    keys = {
        "schemaVersion",
        "contractSha256",
        "trainingSha256",
        "developmentSha256",
        "artifactSha256",
        "dependencies",
        "seed",
        "corpusCounts",
        "audit",
        "fit",
        "artifactBytes",
        "status",
        "selected",
        "grid",
        "perIntent",
        "unsupportedByReason",
        "vetoCounts",
        "acceptedConfusion",
        "parityVectors",
        "limitations",
    }
    require(
        type(report) is dict
        and set(report) == keys
        and type(report["schemaVersion"]) is int
        and report["schemaVersion"] == 1,
        "Development report schema is invalid.",
    )
    for key in ("contractSha256", "trainingSha256", "developmentSha256"):
        require(
            report[key] == evaluator.artifact[key],
            "Development report hashes differ from the artifact.",
        )
    require(
        report["artifactSha256"] == evaluator.artifact_sha256
        and type(report["artifactBytes"]) is int
        and report["artifactBytes"] == evaluator.artifact_bytes,
        "Development report does not describe this exact artifact.",
    )
    require(
        same_data(report["dependencies"], evaluator.artifact["dependencies"])
        and type(report["seed"]) is int
        and report["seed"] == evaluator.contract["seed"],
        "Development report dependency versions or seed differ from the contract.",
    )
    require(
        report["status"] in ("ready", "notReady", "noEligibleThresholds"),
        "Development report readiness status is invalid.",
    )
    parity = verify_development_parity(
        evaluator, development, report["parityVectors"], diagnostic=diagnostic
    )
    examples = report["parityVectors"]
    counts = {
        "total": len(examples),
        "supported": sum(row["expectedIntent"] is not None for row in examples),
        "unsupported": sum(row["expectedIntent"] is None for row in examples),
        "intents": {
            intent: sum(row["expectedIntent"] == intent for row in examples)
            for intent in CLASSES
        },
    }
    corpus = validate_corpus(
        strict_json(read_bytes(development, ARTIFACT_BYTES), ARTIFACT_BYTES),
        "development",
        diagnostic=diagnostic,
    )
    counts["families"] = len({row["family"] for row in corpus})
    require(
        type(report["corpusCounts"]) is dict
        and set(report["corpusCounts"]) == {"training", "development"}
        and same_data(report["corpusCounts"]["development"], counts),
        "Development report counts differ from the complete corpus.",
    )
    training = report["corpusCounts"]["training"]
    require(
        type(training) is dict
        and set(training) == set(counts)
        and type(training["intents"]) is dict
        and set(training["intents"]) == set(CLASSES),
        "Training count metadata is invalid.",
    )
    require(
        all(
            type(value) is int and 30 <= value <= 2000
            for value in training["intents"].values()
        )
        and len(set(training["intents"].values())) == 1
        and type(training["total"]) is int
        and training["total"] == sum(training["intents"].values()) <= 2000
        and type(training["supported"]) is int
        and training["supported"] == training["total"]
        and type(training["unsupported"]) is int
        and training["unsupported"] == 0
        and type(training["families"]) is int
        and 1 <= training["families"] <= training["total"],
        "Training count metadata violates class balance or bounds.",
    )
    fit = report["fit"]
    require(
        type(fit) is dict
        and set(fit)
        == {
            "iterations",
            "converged",
            "vocabularyFeatures",
            "trainingRows",
            "exportedFitScoreMaxAbsoluteError",
        }
        and fit["converged"] is True
        and type(fit["iterations"]) is list
        and len(fit["iterations"]) == 1
        and type(fit["iterations"][0]) is int
        and 1
        <= fit["iterations"][0]
        <= evaluator.contract["training"]["classifier"]["maxIter"]
        and type(fit["vocabularyFeatures"]) is int
        and fit["vocabularyFeatures"] == len(evaluator.artifact["vocabulary"])
        and type(fit["trainingRows"]) is int
        and fit["trainingRows"] == training["total"]
        and number(fit["exportedFitScoreMaxAbsoluteError"], 0, TOLERANCE),
        "Development fit evidence is invalid or unconverged.",
    )
    accepted = dict.fromkeys(CLASSES, 0)
    per_intent = {
        intent: {
            "total": counts["intents"][intent],
            "accepted": 0,
            "correct": 0,
            "incorrect": 0,
            "abstained": 0,
        }
        for intent in CLASSES
    }
    confusion = {intent: dict.fromkeys(CLASSES, 0) for intent in CLASSES}
    by_reason = {}
    veto_counts = {}
    corpus_by_id = {row["id"]: row for row in corpus}
    wrong = unsupported = 0
    for row in examples:
        actual = evaluator.predict(row["text"])
        veto = actual["vetoReason"] or "accepted"
        veto_counts[veto] = veto_counts.get(veto, 0) + 1
        intent = row["expectedIntent"]
        if intent is None:
            reason = corpus_by_id[row["id"]]["reason"]
            totals = by_reason.setdefault(
                reason, {"total": 0, "accepted": 0, "abstained": 0}
            )
            totals["total"] += 1
            totals["accepted"] += int(actual["accepted"])
            totals["abstained"] += int(not actual["accepted"])
            unsupported += int(actual["accepted"])
        elif not actual["accepted"]:
            per_intent[intent]["abstained"] += 1
        else:
            accepted[intent] += 1
            per_intent[intent]["accepted"] += 1
            confusion[intent][actual["topIntent"]] += 1
            mapping = evaluator.mappings[intent]
            incorrect = (
                not same_data(actual["screen"], mapping["screen"])
                or actual["canonicalQuery"] != mapping["canonicalQuery"]
            )
            wrong += int(incorrect)
            per_intent[intent]["incorrect" if incorrect else "correct"] += 1
    for key, expected in [
        ("perIntent", per_intent),
        ("acceptedConfusion", confusion),
        ("unsupportedByReason", by_reason),
        ("vetoCounts", veto_counts),
    ]:
        require(
            same_data(report[key], expected),
            "Development report summary differs from independent complete inference.",
        )
    selected = report["selected"]
    if selected is not None:
        require(
            type(selected) is dict
            and set(selected)
            == {
                "thresholds",
                "acceptedPerClass",
                "wrongAccepted",
                "unsupportedAccepted",
            },
            "Selected development result fields are invalid.",
        )
        expected = {
            "thresholds": evaluator.artifact["thresholds"],
            "acceptedPerClass": list(accepted.values()),
            "wrongAccepted": wrong,
            "unsupportedAccepted": unsupported,
        }
        require(
            same_data(selected, expected),
            "Selected development result differs from independent inference.",
        )
    ready = (
        parity["passed"]
        and parity["benchmarkAdmissible"]
        and selected is not None
        and wrong == 0
        and unsupported == 0
        and all(
            4 * accepted[intent] >= 3 * counts["intents"][intent] for intent in CLASSES
        )
    )
    require(
        report["status"] != "ready" or ready,
        "Development report claims readiness without independent coverage and safety proof.",
    )
    parity.update(
        developmentReady=not diagnostic and report["status"] == "ready" and ready,
        developmentStatus=report["status"],
        parityReferenceSha256=hashlib.sha256(raw).hexdigest(),
        artifactSha256=evaluator.artifact_sha256,
        contractSha256=evaluator.artifact["contractSha256"],
        trainingSha256=evaluator.artifact["trainingSha256"],
        screenMappingSha256=evaluator.mapping_sha256,
        thresholds=copy.deepcopy(evaluator.artifact["thresholds"]),
        acceptedPerClass=dict(accepted),
        supportedAccepted=sum(accepted.values()),
        unsupportedAccepted=unsupported,
        wrongSupportedAccepted=wrong,
    )
    return parity


def evaluate_examples(
    evaluator: Evaluator,
    supported: list[dict],
    unsupported: list[dict],
    parity: dict | None = None,
) -> dict:
    require(
        len({row["id"] for row in supported + unsupported})
        == len(supported) + len(unsupported),
        "Corpus identities overlap between supported and unsupported files.",
    )
    classes = {
        intent: {
            "total": 0,
            "accepted": 0,
            "correct": 0,
            "incorrect": 0,
            "abstained": 0,
            "confusion": dict.fromkeys((*CLASSES, "abstain"), 0),
        }
        for intent in CLASSES
    }
    predictions = []
    accepted = correct = 0
    unsupported_accepted = 0
    unsupported_by_family = {}
    reasons = {}
    for example in supported + unsupported:
        result = evaluator.predict(example["text"])
        predictions.append({**example, **result})
        reason = result["vetoReason"] or "accepted"
        reasons[reason] = reasons.get(reason, 0) + 1
        if example["intent"] is None:
            unsupported_accepted += int(result["accepted"])
            family = unsupported_by_family.setdefault(
                example["family"], {"total": 0, "accepted": 0, "abstained": 0}
            )
            family["total"] += 1
            family["accepted"] += int(result["accepted"])
            family["abstained"] += int(not result["accepted"])
        else:
            class_result = classes[example["intent"]]
            class_result["total"] += 1
            class_result["confusion"][
                result["topIntent"] if result["accepted"] else "abstain"
            ] += 1
            if result["accepted"]:
                accepted += 1
                class_result["accepted"] += 1
                mapping = evaluator.mappings[example["intent"]]
                exact = (
                    same_data(result["screen"], mapping["screen"])
                    and result["canonicalQuery"] == mapping["canonicalQuery"]
                )
                correct += int(exact)
                class_result["correct" if exact else "incorrect"] += 1
            else:
                class_result["abstained"] += 1
    criteria = {
        "counts": len(supported) == 120
        and len(unsupported) >= 160
        and all(row["total"] == 20 for row in classes.values()),
        "perClassCoverage": all(row["accepted"] >= 15 for row in classes.values()),
        "overallCoverage": accepted >= 90,
        "exactScreenAccuracy": accepted > 0 and correct * 100 >= accepted * 98,
        "unsupportedAbstention": unsupported_accepted == 0,
        "numericalAndDecisionParity": parity is not None
        and parity.get("passed") is True
        and parity.get("completeDevelopment") is True
        and parity.get("developmentReady") is True,
    }
    return {
        "schemaVersion": 1,
        "passed": all(criteria.values()),
        "criteria": criteria,
        "supported": {
            "total": len(supported),
            "accepted": accepted,
            "correct": correct,
            "incorrect": accepted - correct,
            "abstained": len(supported) - accepted,
            "exactScreenAccuracy": correct / accepted if accepted else None,
            "classes": classes,
        },
        "unsupported": {
            "total": len(unsupported),
            "accepted": unsupported_accepted,
            "abstained": len(unsupported) - unsupported_accepted,
            "families": unsupported_by_family,
        },
        "reasonCounts": reasons,
        "parity": parity or {"passed": False, "status": "notVerified"},
        "predictions": predictions,
        "limitations": "Scores are not calibrated correctness probabilities. Authored examples do not establish population-wide accuracy, zero false acceptance, financial quality or forecasts.",
    }


def write_report(report: dict, path: Path) -> None:
    try:
        raw = (
            json.dumps(
                report,
                sort_keys=True,
                ensure_ascii=True,
                allow_nan=False,
                separators=(",", ":"),
            )
            + "\n"
        ).encode("utf-8")
    except (ValueError, TypeError):
        raise EvaluationError(
            "The evaluation report is not finite serializable JSON."
        ) from None
    require(
        len(raw) <= REPORT_BYTES,
        "The evaluation report exceeds its 8 MiB bound; no output was replaced.",
    )
    path = Path(path)
    temporary = path.with_name(path.name + ".tmp-" + uuid.uuid4().hex)
    try:
        with temporary.open("xb") as output:
            output.write(raw)
        temporary.replace(path)
    except OSError:
        raise EvaluationError(
            "The complete evaluation report could not be written; prior output was retained."
        ) from None
    finally:
        temporary.unlink(missing_ok=True)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument(
        "--check-development",
        action="store_true",
        help="Validate artifact and full development parity without opening held-out files.",
    )
    modes.add_argument(
        "--diagnostic-development",
        action="store_true",
        help="Compare bounded complete development math only; never qualify a benchmark or open held-out files.",
    )
    for name in ("artifact", "development", "parity"):
        parser.add_argument("--" + name, type=Path, required=True)
    for name in ("supported", "unsupported", "output"):
        parser.add_argument("--" + name, type=Path)
    args = parser.parse_args(argv)
    development_only = args.check_development or args.diagnostic_development
    try:
        if development_only:
            require(
                args.supported is None and args.unsupported is None,
                "Development-only checking forbids held-out file arguments.",
            )
        else:
            require(
                all((args.supported, args.unsupported, args.output)),
                "The release gate requires both held-out corpora and an output path.",
            )
        inputs = [
            args.artifact,
            args.development,
            args.parity,
            HERE / "training-contract.json",
            HERE / "screen-mapping.json",
        ]
        if not development_only:
            inputs.extend((args.supported, args.unsupported))
        require(
            args.output is None
            or all(args.output.resolve() != path.resolve() for path in inputs),
            "Output must not replace any experiment input.",
        )
        evaluator = load_model(args.artifact)
        parity = check_development(
            evaluator,
            args.development,
            args.parity,
            diagnostic=args.diagnostic_development,
        )
        if development_only:
            if args.output:
                write_report(parity, args.output)
            print(json.dumps(parity, sort_keys=True, allow_nan=False))
            return 0 if parity["passed"] else 1
        require(
            parity["passed"] and parity["developmentReady"],
            "Development is not ready with complete parity; held-out files were not opened.",
        )
        supported_raw = read_bytes(args.supported, ARTIFACT_BYTES)
        unsupported_raw = read_bytes(args.unsupported, ARTIFACT_BYTES)
        supported = validate_corpus(
            strict_json(supported_raw, ARTIFACT_BYTES), "heldout-supported"
        )
        unsupported = validate_corpus(
            strict_json(unsupported_raw, ARTIFACT_BYTES), "heldout-unsupported"
        )
        report = evaluate_examples(evaluator, supported, unsupported, parity)
        report["hashes"] = {
            "artifact": evaluator.artifact_sha256,
            "screenMapping": evaluator.mapping_sha256,
            "trainingContract": evaluator.artifact["contractSha256"],
            "training": evaluator.artifact["trainingSha256"],
            "development": evaluator.artifact["developmentSha256"],
            "supported": hashlib.sha256(supported_raw).hexdigest(),
            "unsupported": hashlib.sha256(unsupported_raw).hexdigest(),
            "parityReference": parity["parityReferenceSha256"],
        }
        report["dependencies"] = evaluator.artifact["dependencies"]
        report["thresholds"] = evaluator.artifact["thresholds"]
        write_report(report, args.output)
        print(
            json.dumps(
                {
                    "passed": report["passed"],
                    "criteria": report["criteria"],
                    "supportedAccepted": report["supported"]["accepted"],
                    "supportedCorrect": report["supported"]["correct"],
                    "unsupportedAccepted": report["unsupported"]["accepted"],
                }
            )
        )
        return 0 if report["passed"] else 1
    except EvaluationError as error:
        print(f"Evaluation failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
