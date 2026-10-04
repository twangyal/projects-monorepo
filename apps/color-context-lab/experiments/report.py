"""Bounded exact procedural experiment reports; no model fitting or inference."""

import base64
import json
import math
import re

SEEDS = (1729, 2718, 3141)
ARMS = ("neutral", "correlated", "independent")
TRAINING = ("raw", "mask")
SUITES = ("neutral", "matched", "shifted", "independent")
ROOT_KEYS = {"schemaVersion", "protocol", "status", "provenance", "protocolHash", "generatorHash", "manifestHash", "environment", "readiness", "testSamples", "examples", "models", "evaluations", "limitations", "error"}
LIMITATIONS = [
    "Original procedural shapes only; no artist images, human perception, style or generative-model transfer were tested.",
    "Equal encoded RGB distortion is not perceptual equality or artwork protection.",
    "640 held-out images are 320 paired latent families; three seeds do not justify population confidence or significance claims.",
    "The known-center mask is an explicit inference-only distribution shift or separately retrained bypass; these are distinct controls.",
    "Masked training arrays are identical across all three arms; all separate fits and outcomes remain reported.",
    "Fixed linear shape classification is not evidence of training resistance, art protection or an effect on other models.",
]


def _fail():
    raise ValueError("Invalid or inconsistent procedural experiment report.")


def _keys(value, fields):
    if type(value) is not dict or set(value) != set(fields):
        _fail()
    return value


def _list(value, maximum, exact=None):
    if type(value) is not list or len(value) > maximum or exact is not None and len(value) != exact:
        _fail()
    return value


def _string(value, maximum):
    if type(value) is not str or not 0 < len(value) <= maximum or any(ord(c) < 32 or 127 <= ord(c) <= 159 or 0xd800 <= ord(c) <= 0xdfff for c in value):
        _fail()
    return value


def _number(value, low=0, high=1):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        _fail()
    return value


def _same(actual, expected):
    # Python bool and int equality must not admit a malformed wire type.
    if type(actual) is not type(expected) or actual != expected:
        _fail()


def _close(actual, expected, low=0):
    if abs(_number(actual, low, 1) - expected) > 1e-12:
        _fail()


def _hash(value):
    if type(value) is not str or re.fullmatch(r"[a-f0-9]{64}", value) is None:
        _fail()


def _safe(value, depth=0, count=None):
    count = [0] if count is None else count
    count[0] += 1
    if depth > 16 or count[0] > 160000:
        _fail()
    if type(value) is dict:
        if len(value) > 32:
            _fail()
        for key, entry in value.items():
            _string(key, 64)
            _safe(entry, depth + 1, count)
    elif type(value) is list:
        _list(value, 640)
        for entry in value:
            _safe(entry, depth + 1, count)
    elif type(value) is str:
        _string(value, 4096)
    elif value is None or type(value) is bool:
        pass
    elif type(value) in (int, float):
        if not math.isfinite(value):
            _fail()
    else:
        _fail()


def metrics(predictions, labels):
    if type(predictions) is not list or not predictions or len(predictions) > 640 or type(labels) is not list or len(labels) != len(predictions):
        _fail()
    confusion = [[0] * 4 for _ in range(4)]
    for predicted, actual in zip(predictions, labels, strict=True):
        if type(predicted) is not int or predicted not in range(4) or type(actual) is not int or actual not in range(4):
            _fail()
        confusion[actual][predicted] += 1
    totals = [sum(row) for row in confusion]
    if any(total == 0 for total in totals):
        _fail()
    return {"confusion": confusion, "accuracy": sum(confusion[i][i] for i in range(4)) / len(labels),
            "balancedAccuracy": sum(confusion[i][i] / totals[i] for i in range(4)) / 4}


def _derived(value, count):
    predicted = _list(value["predictions"], count, count)
    result = metrics(predicted, [i // (count // 4) for i in range(count)])
    _list(value["confusion"], 4, 4)
    for i, row in enumerate(value["confusion"]):
        _list(row, 4, 4)
        for actual, expected in zip(row, result["confusion"][i], strict=True):
            _same(actual, expected)
    _close(value["accuracy"], result["accuracy"])
    _close(value["balancedAccuracy"], result["balancedAccuracy"])
    return {**result, "predictions": predicted}


def empty_report(status="not-run"):
    return {"schemaVersion": 1, "protocol": "context-shapes-v1", "status": status,
            "provenance": "Frozen original procedural experiment; no uploaded artwork is scored.",
            "protocolHash": None, "generatorHash": None, "manifestHash": None, "environment": None,
            "readiness": {"status": "pending", "minimum": 0.8, "neutralDevelopment": [], "reason": None},
            "testSamples": [], "examples": [], "models": [], "evaluations": [],
            "limitations": list(LIMITATIONS), "error": None}


def validate_report(report):
    _safe(report)
    root = _keys(report, ROOT_KEYS)
    _same(root["schemaVersion"], 1)
    _same(root["protocol"], "context-shapes-v1")
    status = root["status"]
    if status not in ("not-run", "inconclusive", "complete", "error"):
        _fail()
    _string(root["provenance"], 1000)
    for item in _list(root["limitations"], 12):
        _string(item, 1000)
    if not root["limitations"]:
        _fail()
    readiness = _keys(root["readiness"], ("status", "minimum", "neutralDevelopment", "reason"))
    _same(readiness["minimum"], 0.8)
    if readiness["status"] not in ("pending", "pass", "fail"):
        _fail()
    for text in (readiness["reason"], root["error"]):
        if text is not None:
            _string(text, 1000)
    models = _list(root["models"], 18)
    evaluations = _list(root["evaluations"], 108)
    samples = _list(root["testSamples"], 640)
    examples = _list(root["examples"], 4)
    rows = _list(readiness["neutralDevelopment"], 3)
    if status == "not-run":
        if any(root[key] is not None for key in ("protocolHash", "generatorHash", "manifestHash", "environment", "error")) or any((models, evaluations, samples, examples, rows)) or readiness["status"] != "pending" or readiness["reason"] is not None:
            _fail()
        return json.loads(json.dumps(root, allow_nan=False))
    present = [root[key] for key in ("protocolHash", "generatorHash", "manifestHash") if root[key] is not None]
    for value in present:
        _hash(value)
    if status != "error" and len(present) != 3:
        _fail()
    if root["environment"] is not None:
        env = _keys(root["environment"], ("python", "numpy", "pillow", "sklearn", "scipy", "platform", "threadLimit", "numericLibraries"))
        for key in ("python", "numpy", "pillow", "sklearn", "scipy"):
            _string(env[key], 64)
        if re.fullmatch(r"3\.12\.\d+", env["python"]) is None:
            _fail()
        for key, value in (("numpy", "2.3.5"), ("pillow", "12.3.0"), ("sklearn", "1.8.0"), ("scipy", "1.17.0"), ("threadLimit", 1)):
            _same(env[key], value)
        _string(env["platform"], 256)
        _string(env["numericLibraries"], 4096)
    elif status != "error":
        _fail()
    if (models or examples or evaluations) and (len(present) != 3 or root["environment"] is None):
        _fail()
    if len(examples) not in (0, 4) or models and len(examples) != 4:
        _fail()
    for i, example in enumerate(examples):
        _keys(example, ("sampleId", "label", "centerRgb"))
        _same(example["label"], i)
        _same(example["sampleId"], f"development-c{i}-f000-v0")
        encoded = example["centerRgb"]
        if type(encoded) is not str or len(encoded) != 2304 or re.fullmatch(r"[A-Za-z0-9+/]{2304}", encoded) is None:
            _fail()
        data = base64.b64decode(encoded, validate=True)
        if len(data) != 1728 or base64.b64encode(data).decode("ascii") != encoded:
            _fail()
    tuples = [(seed, arm, training) for seed in SEEDS for arm in ARMS for training in TRAINING]
    neutral = {}
    for model, identity in zip(models, tuples):
        _keys(model, ("seed", "arm", "training", "coefficientHash", "iterations", "fitSeconds", "development"))
        for key, value in zip(("seed", "arm", "training"), identity, strict=True):
            _same(model[key], value)
        _hash(model["coefficientHash"])
        _same(model["iterations"], 200)
        _number(model["fitSeconds"], 0, 600)
        _keys(model["development"], ("predictions", "confusion", "accuracy", "balancedAccuracy"))
        result = _derived(model["development"], 320)
        if identity[1:] == ("neutral", "raw"):
            neutral[identity[0]] = result["balancedAccuracy"]
    if readiness["status"] == "pending":
        if rows or samples or evaluations or readiness["reason"] is not None:
            _fail()
    else:
        if len(models) != 18 or len(rows) != 3:
            _fail()
        for row, seed in zip(rows, SEEDS, strict=True):
            _keys(row, ("seed", "balancedAccuracy"))
            _same(row["seed"], seed)
            _close(row["balancedAccuracy"], neutral[seed])
        passes = all(value >= 0.8 for value in neutral.values())
        if readiness["status"] != ("pass" if passes else "fail") or passes and readiness["reason"] is not None:
            _fail()
        if not passes:
            _string(readiness["reason"], 1000)
    if samples and len(samples) != 640:
        _fail()
    for i, sample in enumerate(samples):
        _keys(sample, ("id", "label"))
        label = i // 160
        _same(sample["label"], label)
        _same(sample["id"], f"test-c{label}-f{(i % 160) // 2:03d}-v{i % 2}")
    expected = [(*model, suite, preprocessing) for model in tuples for suite in SUITES for preprocessing in (TRAINING if model[2] == "raw" else ("mask",))]
    evaluated = {}
    for evaluation, identity in zip(evaluations, expected):
        _keys(evaluation, ("seed", "arm", "training", "suite", "preprocessing", "predictions", "confusion", "accuracy", "balancedAccuracy", "flipFraction", "baselineDifference"))
        for key, value in zip(("seed", "arm", "training", "suite", "preprocessing"), identity, strict=True):
            _same(evaluation[key], value)
        result = _derived(evaluation, 640)
        seed, arm, training, suite, preprocessing = identity
        evaluated[identity] = result
        neutral_key = (seed, arm, training, "neutral", preprocessing)
        baseline_key = (seed, "neutral", training, suite, preprocessing)
        if neutral_key not in evaluated or baseline_key not in evaluated:
            _fail()
        _close(evaluation["flipFraction"], sum(a != b for a, b in zip(result["predictions"], evaluated[neutral_key]["predictions"], strict=True)) / 640)
        _close(evaluation["baselineDifference"], result["balancedAccuracy"] - evaluated[baseline_key]["balancedAccuracy"], -1)
    if evaluations:
        if readiness["status"] != "pass" or len(samples) != 640 or len(models) != 18:
            _fail()
        if len(evaluations) < 108 and expected[len(evaluations) - 1][:3] == expected[len(evaluations)][:3]:
            _fail()
    if samples and readiness["status"] != "pass":
        _fail()
    if status == "complete":
        if readiness["status"] != "pass" or root["error"] is not None or len(models) != 18 or len(evaluations) != 108 or len(samples) != 640 or len(examples) != 4:
            _fail()
    elif status == "inconclusive":
        if readiness["status"] != "fail" or root["error"] is not None or len(models) != 18 or samples or evaluations or len(examples) != 4:
            _fail()
    else:
        _string(root["error"], 1000)
    encoded = json.dumps(root, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(encoded) > 512 * 1024:
        _fail()
    return json.loads(encoded)


def report_bytes(report):
    admitted = validate_report(report)
    encoded = (json.dumps(admitted, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")
    if len(encoded) > 512 * 1024:
        _fail()
    return encoded
