"""One-thread bounded fit runner; protocol fits require the root freeze receipt.

Default invocation has no training side effects. --generate emits fixtures only;
--fit is the separately authorized post-freeze operation, never a unit-test step.
"""

import argparse
import base64
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import tempfile
import time

# The runner must not write bytecode caches outside its owned output.
sys.dont_write_bytecode = True

for _thread_variable in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS", "BLIS_NUM_THREADS"):
    os.environ[_thread_variable] = "1"

import numpy as np  # noqa: E402
import generate  # noqa: E402
import report  # noqa: E402


def _features(images, mask=False):
    if type(images) is not np.ndarray or images.dtype != np.uint8 or images.ndim != 4 or images.shape[1:] != (32, 32, 3) or not 1 <= len(images) <= 1280:
        raise ValueError("Invalid bounded learner input images.")
    pixels = images.copy() if mask else images
    if mask:
        pixels[:, :4] = 128
        pixels[:, 28:] = 128
        pixels[:, :, :4] = 128
        pixels[:, :, 28:] = 128
    return ((pixels.astype(np.float32) - 128) / 128).reshape(len(pixels), -1)


def fit_model(images, labels, seed):
    """The exact frozen learner; tiny unrelated unit datasets may use this seam."""
    if type(seed) is not int or seed not in report.SEEDS:
        raise ValueError("Invalid frozen learner seed.")
    features = _features(images)
    if type(labels) is not np.ndarray or labels.shape != (len(images),) or not np.issubdtype(labels.dtype, np.integer) or set(labels.tolist()) != {0, 1, 2, 3}:
        raise ValueError("Invalid bounded learner class labels.")
    from sklearn.linear_model import SGDClassifier
    from threadpoolctl import threadpool_limits
    with threadpool_limits(limits=1):
        model = SGDClassifier(**generate.load_protocol()["learner"], random_state=seed).fit(features, labels)
    if model.n_iter_ != 200 or model.coef_.shape != (4, 3072) or model.intercept_.shape != (4,) or not np.array_equal(model.classes_, np.arange(4)) or not np.isfinite(model.coef_).all() or not np.isfinite(model.intercept_).all():
        raise ValueError("Learner did not produce a finite frozen model.")
    return model


def _environment():
    if sys.version_info[:2] != (3, 12):
        raise ValueError("Experiment requires pinned Python 3.12.")
    versions = {key: importlib.metadata.version(package) for key, package in (("numpy", "numpy"), ("pillow", "Pillow"), ("sklearn", "scikit-learn"), ("scipy", "scipy"))}
    for key, value in versions.items():
        if value != generate.load_protocol()["runtime"][key]:
            raise ValueError("Experiment requires the pinned numeric dependencies.")
    from threadpoolctl import threadpool_info
    libraries = [{key: entry.get(key) for key in ("internal_api", "version", "num_threads", "architecture")} for entry in threadpool_info()]
    if any(entry["num_threads"] != 1 for entry in libraries):
        raise ValueError("Numeric library thread limit is not one.")
    return {"python": platform.python_version(), **versions, "platform": platform.platform()[:256], "threadLimit": 1,
            "numericLibraries": json.dumps(libraries, sort_keys=True, separators=(",", ":"))}


def fit_experiment(manifest, receipt, check=None):
    """Fit/evaluate only when the exact committed three-hash receipt is supplied.

    The caller must obtain root's explicit fitting release separately. Merely
    generating a manifest, importing this module, or running tests never calls it.
    """
    if type(receipt) is not dict or set(receipt) != {"protocolHash", "generatorHash", "manifestHash"} or any(type(v) is not str or len(v) != 64 for v in receipt.values()):
        raise ValueError("A complete root freeze receipt is required before fitting.")
    admitted = generate.validate_manifest(manifest)
    actual = {"protocolHash": admitted["protocolHash"], "generatorHash": admitted["generatorHash"], "manifestHash": hashlib.sha256(generate.canonical_bytes(admitted)).hexdigest()}
    if receipt != actual:
        raise ValueError("Root freeze receipt does not match the exact protocol, source and manifest.")
    # Dependency admission precedes every fit. No sklearn import in generation.
    from sklearn.linear_model import SGDClassifier  # noqa: F401
    from threadpoolctl import threadpool_limits
    started = time.monotonic()
    result = report.empty_report("error")
    result.update(actual)
    result["environment"] = _environment()
    result["provenance"] = "Actual fixed linear learner on original procedural fixtures identified by the committed preregistration receipt."
    def checkpoint():
        if time.monotonic() - started >= 600:
            raise TimeoutError("Frozen experiment deadline exceeded.")
        if check is not None:
            check(result)
    try:
        checkpoint()
        for label in range(4):
            family = next(f for f in admitted["families"] if f["split"] == "development" and f["label"] == label)
            result["examples"].append({"sampleId": family["variants"][0]["id"], "label": label,
                                       "centerRgb": base64.b64encode(generate.render_center(family, 0).tobytes()).decode("ascii")})
        arrays = {}
        for split in ("train", "development"):
            for arm in report.ARMS:
                checkpoint()
                arrays[(split, arm)] = generate.dataset(admitted, split, arm)
            # This is a pre-fit invariant, not a observed-result criterion.
            baseline = _features(arrays[(split, "neutral")][0])
            for arm in report.ARMS:
                if not np.array_equal(_features(arrays[(split, arm)][0], True), baseline):
                    raise ValueError("Center-mask training/development arrays disagree across arms.")
        fitted = {}
        for seed in report.SEEDS:
            for arm in report.ARMS:
                for training in report.TRAINING:
                    checkpoint()
                    images, labels, _ = arrays[("train", "neutral" if training == "mask" else arm)]
                    before = time.monotonic()
                    with threadpool_limits(limits=1):
                        model = fit_model(images, labels, seed)
                    fit_seconds = time.monotonic() - before
                    dev_images, dev_labels, _ = arrays[("development", arm)]
                    with threadpool_limits(limits=1):
                        predictions = model.predict(_features(dev_images, training == "mask")).tolist()
                    coefficients = np.concatenate((model.coef_.astype("<f8", copy=False).ravel(order="C"), model.intercept_.astype("<f8", copy=False))).astype("<f8", copy=False)
                    result["models"].append({"seed": seed, "arm": arm, "training": training,
                                             "coefficientHash": hashlib.sha256(coefficients.tobytes(order="C")).hexdigest(), "iterations": int(model.n_iter_), "fitSeconds": fit_seconds,
                                             "development": {"predictions": predictions, **report.metrics(predictions, dev_labels.tolist())}})
                    fitted[(seed, arm, training)] = model
                    checkpoint()
        neutral = [{"seed": seed, "balancedAccuracy": next(m["development"]["balancedAccuracy"] for m in result["models"] if (m["seed"], m["arm"], m["training"]) == (seed, "neutral", "raw"))} for seed in report.SEEDS]
        ready = all(row["balancedAccuracy"] >= 0.8 for row in neutral)
        result["readiness"] = {"status": "pass" if ready else "fail", "minimum": 0.8, "neutralDevelopment": neutral,
                               "reason": None if ready else "At least one fixed neutral raw model failed the development balanced accuracy >= 0.80 prerequisite. No test inference ran."}
        if not ready:
            result["status"], result["error"] = "inconclusive", None
            return report.validate_report(result)
        # No held-out model.predict occurs anywhere before the readiness branch.
        test = {}
        for suite in report.SUITES:
            checkpoint()
            images, labels, ids = generate.dataset(admitted, "test", suite)
            test[suite] = (_features(images), _features(images, True), labels.tolist())
            if suite == "neutral":
                result["testSamples"] = [{"id": name, "label": label} for name, label in zip(ids, labels.tolist(), strict=True)]
        done = {}
        for seed in report.SEEDS:
            for arm in report.ARMS:
                for training in report.TRAINING:
                    model = fitted[(seed, arm, training)]
                    block = []
                    for suite in report.SUITES:
                        for preprocessing in (report.TRAINING if training == "raw" else ("mask",)):
                            checkpoint()
                            features = test[suite][preprocessing == "mask"]
                            with threadpool_limits(limits=1):
                                predictions = model.predict(features).tolist()
                            row = {"seed": seed, "arm": arm, "training": training, "suite": suite, "preprocessing": preprocessing,
                                   "predictions": predictions, **report.metrics(predictions, test[suite][2])}
                            identity = (seed, arm, training, suite, preprocessing)
                            done[identity] = row
                            reference = done[(seed, arm, training, "neutral", preprocessing)]
                            baseline = done[(seed, "neutral", training, suite, preprocessing)]
                            row["flipFraction"] = sum(a != b for a, b in zip(predictions, reference["predictions"], strict=True)) / 640
                            row["baselineDifference"] = row["balancedAccuracy"] - baseline["balancedAccuracy"]
                            block.append(row)
                    result["evaluations"].extend(block)
                    checkpoint()
        result["status"], result["error"] = "complete", None
    except Exception:
        result["status"] = "error"
        result["error"] = "The fixed experiment stopped before completion; only completed referentially valid records are retained. No parameters or fixtures were changed."
    return report.validate_report(result)


def _write(path, data):
    if len(data) > 32 * 1024 * 1024:
        raise ValueError("Experiment output exceeds the directory byte budget.")
    with Path(path).open("xb") as stream:
        stream.write(data)


def _checkpoint(output, result):
    # Never serialize a partially constructed example/readiness/model block.
    if len(result["examples"]) not in (0, 4):
        return
    current = {**result, "status": "error", "error": "Experiment is incomplete; this checkpoint is not a successful outcome."}
    data = report.report_bytes(current)
    fd, temporary = tempfile.mkstemp(prefix=".report-", dir=output)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        os.replace(temporary, Path(output) / "experiment-report.json")
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def _generate(output):
    manifest = generate.generate_manifest()
    generate.validate_manifest(manifest)
    data = generate.canonical_bytes(manifest)
    _write(output / "manifest.json", data)
    checks = {"schemaVersion": 1, "protocolHash": manifest["protocolHash"], "generatorHash": manifest["generatorHash"],
              "manifestHash": hashlib.sha256(data).hexdigest(), "families": 1120, "uniqueCenters": 2240,
              "status": "generated-not-fitted", "fittingAuthorized": False}
    _write(output / "prefit-generation.json", generate.canonical_bytes(checks))
    return checks


def _worker(args):
    manifest = generate.read_json(args.manifest)
    receipt = generate.read_json(args.receipt, 4096)
    output = Path(args.output)
    result = fit_experiment(manifest, receipt, lambda state: _checkpoint(output, state))
    _checkpoint(output, result)
    # _checkpoint marks interim error; install the final admitted actual status.
    path = output / "experiment-report.json"
    data = report.report_bytes(result)
    fd, temporary = tempfile.mkstemp(prefix=".final-", dir=output)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return 0 if result["status"] in ("complete", "inconclusive") else 2


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--generate", action="store_true", help="Generate frozen manifest only; never fit")
    mode.add_argument("--fit", action="store_true", help="Separately authorized protocol fitting with exact root receipt")
    mode.add_argument("--fit-worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--output", required=True, help="New owned output directory; existing directories refused")
    parser.add_argument("--manifest")
    parser.add_argument("--receipt")
    args = parser.parse_args(argv)
    if args.fit_worker:
        return _worker(args)
    output = Path(args.output).absolute()
    child = None
    owned_output = False
    try:
        if args.fit and (not args.manifest or not args.receipt):
            raise ValueError("Fitting requires the frozen manifest and root receipt.")
        output.mkdir(mode=0o700, parents=False, exist_ok=False)
        owned_output = True
        if args.generate:
            print(json.dumps(_generate(output), sort_keys=True))
            return 0
        started = time.monotonic()
        child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--fit-worker", "--manifest", str(Path(args.manifest).absolute()), "--receipt", str(Path(args.receipt).absolute()), "--output", str(output)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        while child.poll() is None:
            size = sum(path.stat().st_size for path in output.iterdir() if path.is_file())
            if size > 32 * 1024 * 1024 or time.monotonic() - started >= 600:
                raise TimeoutError("Experiment exceeded its frozen resource budget.")
            time.sleep(0.05)
        if child.returncode != 0:
            path = output / "experiment-report.json"
            if not path.exists():
                result = report.empty_report("error")
                result["error"] = "Experiment failed before an admitted checkpoint; no successful outcome is claimed."
                _write(path, report.report_bytes(result))
        return 0 if child.returncode == 0 else 2
    except (Exception, KeyboardInterrupt):
        if child is not None and child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
        if owned_output and output.is_dir():
            path = output / "experiment-report.json"
            if path.exists():
                result = generate.read_json(path, 512 * 1024)
                result["status"] = "error"
            else:
                result = report.empty_report("error")
            result["error"] = "Experiment stopped or failed under its fixed resource limits. No fit or result is claimed successful."
            fd, temporary = tempfile.mkstemp(prefix=".failure-", dir=output)
            with os.fdopen(fd, "wb") as stream:
                stream.write(report.report_bytes(result))
            os.replace(temporary, path)
        print("Experiment did not complete; preserved bounded output identifies the failure.", file=sys.stderr)
        return 2
    finally:
        if child is not None and child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()


if __name__ == "__main__":
    raise SystemExit(main())
