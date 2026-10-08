"""Independent preregistration and result oracle; never fits protocol models.

Expected mathematics, ordering and fixtures were authored from the frozen design
before reading generate.py/run.py/report.py or their tests. The optional tiny
learner check uses unrelated solid-color samples, never protocol rows.
"""
from __future__ import annotations

import argparse
import base64
from collections import Counter
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys
import time

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ["experiments/generate.py", "experiments/report.py", "experiments/requirements.txt", "experiments/run.py"]
SPLITS = [("train", 160, 1103), ("development", 40, 2207), ("test", 80, 3301)]
SEEDS = [1729, 2718, 3141]
ARMS = ["neutral", "correlated", "independent"]
SUITES = ["neutral", "matched", "shifted", "independent"]
PALETTE = [(152, 128, 128), (104, 128, 128), (128, 152, 128), (128, 104, 128)]
PARAMETERS = ["cx", "cy", "halfLength", "halfThickness", "radius", "rotation"]
RANGES = [(11, 13), (11, 13), (7, 9), (1.5, 2.5), (5, 7), (-math.pi / 36, math.pi / 36)]
LEARNER = {"loss": "log_loss", "penalty": "l2", "alpha": 0.0001, "fit_intercept": True, "max_iter": 200, "tol": None, "shuffle": True, "learning_rate": "constant", "eta0": 0.01, "early_stopping": False, "average": False, "n_jobs": 1}


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def digest(value):
    return hashlib.sha256(value).hexdigest()


def strict_json(path, maximum=None):
    raw = Path(path).read_bytes()
    if maximum is not None:
        assert len(raw) <= maximum

    def pairs(items):
        result = {}
        for key, value in items:
            assert key not in result, f"Duplicate key: {key}"
            result[key] = value
        return result

    def invalid(value):
        raise AssertionError(f"Nonfinite JSON: {value}")

    value = json.loads(raw.decode("utf-8", errors="strict"), object_pairs_hook=pairs, parse_constant=invalid)
    return value, raw


def expected_protocol():
    return {
        "schemaVersion": 1, "protocol": "context-shapes-v1",
        "classes": ["horizontal bar", "vertical bar", "cross", "disk"],
        "geometry": {"image": 32, "center": 24, "surround": 4,
                     "drawOrder": PARAMETERS, "ranges": dict(zip(PARAMETERS, map(list, RANGES))),
                     "coordinates": "inverse-rotated-about-center",
                     "shapeRules": ["abs(x)<=halfLength and abs(y)<=halfThickness", "abs(y)<=halfLength and abs(x)<=halfThickness", "horizontal-or-vertical", "x*x+y*y<=radius*radius"],
                     "variants": [[-0.35, 0.35], [0.35, -0.35]]},
        "coverage": {"background": 192, "foreground": 64, "samplesPerAxis": 4, "samplePosition": "subpixel-center", "value": "192-8*coveredCount"},
        "duplicateAttempts": 100, "neutral": [128, 128, 128], "palette": list(map(list, PALETTE)),
        "splits": {
            "train": {"familiesPerClass": 160, "seed": 1103, "correlatedCounts": [136, 8, 8, 8], "independentCounts": [40, 40, 40, 40]},
            "development": {"familiesPerClass": 40, "seed": 2207, "correlatedCounts": [34, 2, 2, 2], "independentCounts": [10, 10, 10, 10]},
            "test": {"familiesPerClass": 80, "seed": 3301, "independentCounts": [20, 20, 20, 20]}},
        "assignments": {"algorithm": "fresh-PCG64-per-arm-same-permutation", "seed": 4409, "splitStride": 100, "testIndependentSeed": 5519, "correlatedBlockOrder": "own-then-other-ascending", "independentBlockOrder": [0, 1, 2, 3]},
        "trainingArms": ARMS, "trainingPreprocessing": ["raw", "mask"], "suites": SUITES,
        "normalization": {"dtype": "float32", "formula": "(byte-128)/128", "order": "row-major-RGB"},
        "learner": LEARNER, "modelSeeds": SEEDS,
        "evaluation": {"raw": ["raw", "mask"], "mask": ["mask"], "counterfactualShift": 1, "argmaxTie": "library-class-order", "confusionOrder": "rows-actual-columns-predicted", "metricTolerance": 1e-12},
        "readiness": {"minimum": 0.8, "models": "all-three-neutral-raw-development"},
        "artifact": {"bytes": 524288, "outputBytes": 33554432, "timeoutSeconds": 600}, "threadLimit": 1,
        "runtime": {"python": "3.12", "numpy": "2.3.5", "pillow": "12.3.0", "sklearn": "1.8.0", "scipy": "1.17.0"},
    }


def source_fingerprint():
    stream = bytearray()
    entries = []
    for name in SOURCES:
        raw = (ROOT / name).read_bytes()
        stream.extend(name.encode("utf-8") + b"\0" + str(len(raw)).encode("ascii") + b"\0" + raw)
        entries.append({"path": name, "bytes": len(raw), "sha256": digest(raw)})
    return digest(stream), entries


def center(family, variant=None):
    """Independent 96x96 supersampling mesh then block reduction."""
    dx, dy = (0, 0) if variant is None else [(-0.35, 0.35), (0.35, -0.35)][variant]
    axis = (np.arange(96, dtype=np.float64) + 0.5) / 4
    xx, yy = np.meshgrid(axis - family["cx"] - dx, axis - family["cy"] - dy)
    cosine, sine = math.cos(family["rotation"]), math.sin(family["rotation"])
    x, y = cosine * xx + sine * yy, -sine * xx + cosine * yy
    horizontal = (abs(x) <= family["halfLength"]) & (abs(y) <= family["halfThickness"])
    vertical = (abs(y) <= family["halfLength"]) & (abs(x) <= family["halfThickness"])
    selected = [horizontal, vertical, horizontal | vertical, x * x + y * y <= family["radius"] ** 2][family["label"]]
    covered = selected.reshape(24, 4, 24, 4).sum(axis=(1, 3))
    return np.repeat((192 - 8 * covered).astype(np.uint8)[:, :, None], 3, axis=2)


def assignment(split_index, label, count, correlated):
    seed = 5519 + label if split_index == 2 else 4409 + split_index * 100 + label
    shuffled = np.random.Generator(np.random.PCG64(seed)).permutation(count)
    order = [label] + [color for color in range(4) if color != label] if correlated else list(range(4))
    sizes = [count * 85 // 100] + [count * 5 // 100] * 3 if correlated else [count // 4] * 4
    result = [None] * count
    offset = 0
    for color, size in zip(order, sizes):
        for index in shuffled[offset:offset + size]:
            result[int(index)] = color
        offset += size
    assert offset == count and None not in result
    return result


def expected_families():
    result, seen, redraws = [], set(), 0
    for split_index, (split, count, seed) in enumerate(SPLITS):
        rng = np.random.Generator(np.random.PCG64(seed))
        for label in range(4):
            correlated = assignment(split_index, label, count, True) if split != "test" else [None] * count
            independent = assignment(split_index, label, count, False)
            for index in range(count):
                for attempt in range(100):
                    family = dict(zip(PARAMETERS, [float(rng.uniform(low, high)) for low, high in RANGES]))
                    family.update(id=f"{split}-c{label}-f{index:03}", split=split, label=label,
                                  correlatedPalette=correlated[index], independentPalette=independent[index])
                    hashes = [digest(center(family, variant).tobytes()) for variant in range(2)]
                    if len(set(hashes)) == 2 and not seen.intersection(hashes):
                        break
                    redraws += 1
                else:
                    raise AssertionError("Independent generator exceeded 100 duplicate attempts")
                family["variants"] = [{"id": f"{family['id']}-v{variant}", "centerSha256": value} for variant, value in enumerate(hashes)]
                seen.update(hashes)
                result.append(family)
    assert len(result) == 1120 and len(seen) == 2240
    return result, redraws


def surround(rgb, palette=None, mask=False):
    image = np.full((32, 32, 3), 128, dtype=np.uint8)
    if palette is not None and not mask:
        image[:] = PALETTE[palette]
    image[4:28, 4:28] = rgb
    return image


def self_checks():
    family = dict(cx=12, cy=12, halfLength=8, halfThickness=2, radius=6, rotation=0, label=0)
    expected_histograms = [{64: 64, 192: 512}, {64: 64, 192: 512}, {64: 112, 192: 464}, {64: 96, 88: 16, 136: 8, 184: 4, 192: 452}]
    for label, expected in enumerate(expected_histograms):
        family["label"] = label
        assert dict(Counter(map(int, center(family)[:, :, 0].flat))) == expected
    assert sum((192 - value) // 8 * count for value, count in expected_histograms[3].items()) == 1804
    neutral = surround(center(family))
    for color in range(4):
        colored = surround(center(family), color)
        diff = colored.astype(np.int32) - neutral.astype(np.int32)
        assert int((diff * diff).sum()) == 258048
        assert float(np.sqrt((diff * diff).mean())) == math.sqrt(84)
        assert np.array_equal(colored[4:28, 4:28], neutral[4:28, 4:28])
        assert np.array_equal(surround(center(family), color, True), neutral)
    return {"axisAlignedHistograms": expected_histograms, "diskCoveredSubsamples": 1804, "borderPixels": 448, "paletteSquaredDistance": 576, "fullImageSquaredDifference": 258048, "fullImageRgbRmse": math.sqrt(84)}


def producer_module(name):
    sys.path.insert(0, str(ROOT / "experiments"))
    spec = importlib.util.spec_from_file_location(f"color_oracle_{name}", ROOT / "experiments" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def prefit(manifest_path, check_api=False):
    protocol, raw_protocol = strict_json(ROOT / "experiments/protocol.json")
    assert protocol == expected_protocol(), "Canonical protocol differs from independently pinned contract"
    assert raw_protocol == canonical(protocol), "Protocol encoding is not canonical one-LF UTF-8"
    source_hash, sources = source_fingerprint()
    families, redraws = expected_families()
    expected = {"schemaVersion": 1, "protocolHash": digest(raw_protocol), "generatorHash": source_hash, "families": families}
    manifest, raw_manifest = strict_json(manifest_path)
    assert manifest == expected, "Manifest differs from independently drawn, assigned and rendered families"
    assert raw_manifest == canonical(expected), "Manifest ordering/encoding differs from canonical bytes"
    counts = {}
    for split, count, _ in SPLITS:
        rows = [family for family in families if family["split"] == split]
        assert Counter(row["label"] for row in rows) == {label: count for label in range(4)}
        for label in range(4):
            selected = [row for row in rows if row["label"] == label]
            assert Counter(row["independentPalette"] for row in selected) == {color: count // 4 for color in range(4)}
            if split != "test":
                assert Counter(row["correlatedPalette"] for row in selected) == {color: count * (85 if color == label else 5) // 100 for color in range(4)}
        if split != "test":
            assert Counter(row["correlatedPalette"] for row in rows) == Counter(row["independentPalette"] for row in rows)
        counts[split] = {"families": len(rows), "images": len(rows) * 2}
    if check_api:
        generate = producer_module("generate")
        assert generate.canonical_bytes(protocol) == raw_protocol
        assert generate.source_hash() == source_hash
        assert generate.validate_manifest(clone_json(manifest)) == manifest
        for split, _, _ in SPLITS:
            selected = [family for family in families if family["split"] == split]
            for suite in ARMS if split != "test" else SUITES:
                for masked in [False, True]:
                    images, labels, ids = generate.dataset(manifest, split, suite, mask=masked)
                    assert images.dtype == np.uint8 and images.shape == (len(selected) * 2, 32, 32, 3)
                    for index, family in enumerate(selected):
                        palette = None if suite == "neutral" else family["correlatedPalette"] if suite == "correlated" else family["independentPalette"] if suite == "independent" else family["label"] if suite == "matched" else (family["label"] + 1) % 4
                        for variant in range(2):
                            location = index * 2 + variant
                            assert ids[location] == family["variants"][variant]["id"] and int(labels[location]) == family["label"]
                            assert np.array_equal(images[location], surround(center(family, variant), palette, masked))
        for variant in [0, 1]:
            for label in range(4):
                family = next(f for f in families if f["label"] == label)
                assert np.array_equal(generate.render_center(family, variant), center(family, variant))
        for mutation in ["hash", "parameter", "id", "extra", "order"]:
            bad = clone_json(manifest)
            if mutation == "hash":
                bad["families"][0]["variants"][0]["centerSha256"] = "0" * 64
            elif mutation == "parameter":
                bad["families"][0]["cx"] = 11
            elif mutation == "id":
                bad["families"][0]["id"] = bad["families"][1]["id"]
            elif mutation == "extra":
                bad["families"][0]["unexpected"] = True
            else:
                bad["families"][0], bad["families"][1] = bad["families"][1], bad["families"][0]
            try:
                generate.validate_manifest(bad)
            except (ValueError, AssertionError, RuntimeError):
                pass
            else:
                raise AssertionError(f"Producer admitted tampered manifest: {mutation}")
    return {"protocolHash": digest(raw_protocol), "generatorHash": source_hash, "manifestHash": digest(raw_manifest), "sourceFiles": sources, "counts": counts, "independentDuplicateRedraws": redraws, "all2240CenterHashesVerified": True, "allAssignmentsAndParametersVerified": True, "producerDatasetsByteCompared": check_api, "protocolFitsExecuted": 0, "protocolTestPredictionsExecuted": 0}


def clone_json(value):
    return json.loads(json.dumps(value))


def result_metrics(predictions, per_class):
    assert len(predictions) == 4 * per_class and all(type(p) is int and 0 <= p <= 3 for p in predictions)
    confusion = [[sum(predictions[index] == prediction for index in range(actual * per_class, (actual + 1) * per_class)) for prediction in range(4)] for actual in range(4)]
    correct = sum(confusion[label][label] for label in range(4))
    return confusion, correct / len(predictions), sum(confusion[label][label] / per_class for label in range(4)) / 4


def near(left, right):
    assert type(left) in [int, float] and math.isfinite(left) and abs(left - right) <= 1e-12, (left, right)


def results(path, receipt_path):
    report, raw = strict_json(path, 512 * 1024)
    receipt, _ = strict_json(receipt_path)
    assert report["schemaVersion"] == 1 and report["protocol"] == "context-shapes-v1"
    for name in ["protocolHash", "generatorHash", "manifestHash"]:
        assert report[name] == receipt[name]
    assert report["environment"]["threadLimit"] == 1
    for name, expected in [("numpy", "2.3.5"), ("pillow", "12.3.0"), ("sklearn", "1.8.0"), ("scipy", "1.17.0")]:
        assert report["environment"][name] == expected
    assert report["environment"]["python"].startswith("3.12.")
    expected_models = [(seed, arm, training) for seed in SEEDS for arm in ARMS for training in ["raw", "mask"]]
    actual_models = [(row["seed"], row["arm"], row["training"]) for row in report["models"]]
    assert actual_models == expected_models[:len(actual_models)]
    for row in report["models"]:
        assert row["iterations"] == 200 and 0 <= row["fitSeconds"] <= 600
        confusion, accuracy, balanced = result_metrics(row["development"]["predictions"], 80)
        assert row["development"]["confusion"] == confusion
        near(row["development"]["accuracy"], accuracy)
        near(row["development"]["balancedAccuracy"], balanced)
    baselines = {row["seed"]: row["development"]["balancedAccuracy"] for row in report["models"] if row["arm"] == "neutral" and row["training"] == "raw"}
    ready = len(actual_models) == 18 and len(baselines) == 3 and all(value >= 0.8 for value in baselines.values())
    if report["status"] == "inconclusive":
        assert len(actual_models) == 18 and not ready and report["readiness"]["status"] == "fail"
        assert report["testSamples"] == [] and report["evaluations"] == []
    elif report["status"] == "complete":
        assert ready and report["readiness"]["status"] == "pass" and report["error"] is None
        assert len(report["evaluations"]) == 108
    else:
        assert report["status"] == "error" and report["error"]
    assert report["readiness"]["minimum"] == 0.8
    for row in report["readiness"]["neutralDevelopment"]:
        near(row["balancedAccuracy"], baselines[row["seed"]])
    if report["testSamples"]:
        assert ready and report["readiness"]["status"] == "pass"
        assert report["testSamples"] == [{"id": f"test-c{label}-f{family:03}-v{variant}", "label": label} for label in range(4) for family in range(80) for variant in range(2)]
    expected_evaluations = [(seed, arm, training, suite, preprocessing) for seed, arm, training in expected_models for suite in SUITES for preprocessing in (["raw", "mask"] if training == "raw" else ["mask"])]
    by_key = {}
    for index, row in enumerate(report["evaluations"]):
        key = tuple(row[name] for name in ["seed", "arm", "training", "suite", "preprocessing"])
        assert key == expected_evaluations[index] and key not in by_key
        by_key[key] = row
        confusion, accuracy, balanced = result_metrics(row["predictions"], 160)
        assert row["confusion"] == confusion
        near(row["accuracy"], accuracy)
        near(row["balancedAccuracy"], balanced)
    for key, row in by_key.items():
        seed, arm, training, _, preprocessing = key
        neutral = by_key[(seed, arm, training, "neutral", preprocessing)]
        baseline = by_key[(seed, "neutral", training, row["suite"], preprocessing)]
        near(row["flipFraction"], sum(a != b for a, b in zip(row["predictions"], neutral["predictions"])) / 640)
        near(row["baselineDifference"], row["balancedAccuracy"] - baseline["balancedAccuracy"])
    assert len(report["examples"]) == 4
    frozen_families, _ = expected_families()
    for label, example in enumerate(report["examples"]):
        assert example["label"] == label and example["sampleId"] == f"development-c{label}-f000-v0"
        pixels = base64.b64decode(example["centerRgb"], validate=True)
        assert len(pixels) == 1728 and base64.b64encode(pixels).decode() == example["centerRgb"]
        family = next(item for item in frozen_families if item["id"] == f"development-c{label}-f000")
        assert pixels == center(family, 0).tobytes()
    aggregates = []
    if report["status"] == "complete":
        # Same seed and byte-identical neutral/masked training must fit the same
        # model; inference masking removes all suite-specific pixels as well.
        for seed in SEEDS:
            controls = [row for row in report["models"] if row["seed"] == seed and (row["training"] == "mask" or row["arm"] == "neutral")]
            assert len({row["coefficientHash"] for row in controls}) == 1
            assert all(row["development"]["predictions"] == controls[0]["development"]["predictions"] for row in controls)
            for arm in ARMS:
                for training in ["raw", "mask"]:
                    control = by_key[(seed, arm, training, "neutral", "mask")]["predictions"]
                    assert all(by_key[(seed, arm, training, suite, "mask")]["predictions"] == control for suite in SUITES)
        for arm in ARMS:
            for training in ["raw", "mask"]:
                for suite in SUITES:
                    for preprocessing in ["raw", "mask"] if training == "raw" else ["mask"]:
                        selected = [by_key[(seed, arm, training, suite, preprocessing)] for seed in SEEDS]
                        summary = {"arm": arm, "training": training, "suite": suite, "preprocessing": preprocessing}
                        for metric in ["accuracy", "balancedAccuracy", "flipFraction", "baselineDifference"]:
                            values = [row[metric] for row in selected]
                            summary[metric] = {"mean": sum(values) / 3, "min": min(values), "max": max(values)}
                        aggregates.append(summary)
    discrete = {"development": [row["development"]["predictions"] for row in report["models"]],
                "test": [row["predictions"] for row in report["evaluations"]], "testSamples": report["testSamples"]}
    return {"reportSha256": digest(raw), "discretePredictionsSha256": digest(canonical(discrete)),
            "status": report["status"], "modelsChecked": len(actual_models), "evaluationsChecked": len(by_key),
            "allDerivedMetricsIndependentlyRecomputed": True, "neutralDevelopment": baselines, "aggregates": aggregates}


def tiny_learner():
    run = producer_module("run")
    colors = [(32, 32, 32), (224, 32, 32), (32, 224, 32), (32, 32, 224)]
    images = np.array([np.full((32, 32, 3), np.array(color) + offset, dtype=np.uint8) for color in colors for offset in [0, 1, 2, 3]])
    labels = np.repeat(np.arange(4), 4)
    learned = run.fit_model(images, labels, 1729)
    for key, value in LEARNER.items():
        assert learned.get_params()[key] == value
    assert learned.n_iter_ == 200 and learned.coef_.shape == (4, 3072)
    assert np.any(learned.coef_ != 0)
    heldout = np.array([np.full((32, 32, 3), np.array(color) + 8, dtype=np.uint8) for color in colors])
    features = (heldout.reshape(4, -1).astype(np.float32) - 128) / 128
    assert learned.predict(features).tolist() == [0, 1, 2, 3]
    return {"unrelatedTinyTrainingRows": 16, "unrelatedTinyHeldoutRows": 4, "actualIterations": int(learned.n_iter_), "allFourHeldoutLabelsCorrect": True, "protocolFitsExecuted": 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--producer-api", action="store_true")
    parser.add_argument("--tiny-learner", action="store_true")
    parser.add_argument("--results", type=Path)
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--allow-authorized-results", action="store_true")
    parser.add_argument("--output", type=Path)
    options = parser.parse_args()
    began = time.monotonic()
    verification = {"independentMathematics": self_checks()}
    if options.manifest:
        verification["prefit"] = prefit(options.manifest, options.producer_api)
    if options.tiny_learner:
        verification["tinyLearner"] = tiny_learner()
    if options.results:
        assert options.allow_authorized_results and options.receipt, "Root must release actual results inspection; specify receipt and explicit authorization flag"
        verification["results"] = results(options.results, options.receipt)
    verification.update(passed=True, elapsedSeconds=time.monotonic() - began, oracleNumpy=np.__version__)
    encoded = canonical(verification)
    if options.output:
        with options.output.open("xb") as output:
            output.write(encoded)
    print(encoded.decode(), end="")


if __name__ == "__main__":
    main()
