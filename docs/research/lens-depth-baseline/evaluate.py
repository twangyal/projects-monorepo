"""Offline, checksum-pinned one-photo depth smoke check for issue172.

No network requests, automatic model downloads, product integration or metric
calibration. See README.md and frozen-smoke.json for provenance and limits.
"""
import argparse
import hashlib
import json
import platform
import resource
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps, __version__ as pillow_version


def verified(path, expected):
    data = Path(path).read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError(f"Checksum mismatch: {Path(path).name}")
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("model", "preprocessor", "photo", "output"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    manifest_path = Path(__file__).with_name("frozen-smoke.json")
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    model = manifest["model"]
    verified(args.model, model["sha256"])
    cfg = json.loads(verified(args.preprocessor, model["preprocessorSha256"]))
    verified(args.photo, manifest["photo"]["sha256"])
    with Image.open(args.photo) as original:
        if list(original.size) != manifest["photo"]["dimensions"]:
            raise ValueError("Original photo dimensions changed")
        image = ImageOps.exif_transpose(original).convert("RGB")
    image.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
    # DPT's keep-aspect rule picks the target scale closest to1, then rounds
    # each dimension to the nearest14. Source formula: Transformers v4.57.1.
    width, height = image.size
    sh, sw = cfg["size"]["height"] / height, cfg["size"]["width"] / width
    scale = sw if abs(1 - sw) < abs(1 - sh) else sh
    multiple = cfg["ensure_multiple_of"]
    out_h, out_w = (round(v * scale / multiple) * multiple for v in (height, width))
    pixels = np.asarray(image.resize((out_w, out_h), Image.Resampling.BICUBIC), dtype=np.float32)
    pixels *= np.float32(cfg["rescale_factor"])
    pixels = (pixels - np.asarray(cfg["image_mean"], dtype=np.float32)) / np.asarray(cfg["image_std"], dtype=np.float32)
    tensor = np.ascontiguousarray(pixels.transpose(2, 0, 1)[None])
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    started = time.perf_counter()
    session = ort.InferenceSession(args.model, sess_options=options, providers=["CPUExecutionProvider"])
    load_ms = (time.perf_counter() - started) * 1000
    if [i.name for i in session.get_inputs()] != ["pixel_values"] or [o.name for o in session.get_outputs()] != ["predicted_depth"]:
        raise ValueError("Unexpected model interface")
    durations, hashes = [], []
    for _ in range(3):
        started = time.perf_counter()
        raw = session.run(["predicted_depth"], {"pixel_values": tensor})[0]
        durations.append((time.perf_counter() - started) * 1000)
        if raw.shape != (1, out_h, out_w) or raw.dtype != np.float32 or not np.isfinite(raw).all() or not float(np.ptp(raw)) > 0:
            raise ValueError("Invalid raw depth output")
        hashes.append(hashlib.sha256(raw.tobytes()).hexdigest())
    depth = raw[0]

    def sample(point):
        x, y = int(point[0] * out_w), int(point[1] * out_h)
        return float(np.median(depth[max(0, y - 1):min(out_h, y + 2), max(0, x - 1):min(out_w, x + 2)]))

    pairs = []
    for pair in manifest["pairs"]:
        near, far = sample(pair["near"]), sample(pair["far"])
        pairs.append({**pair, "nearRaw": near, "farRaw": far, "correct": near > far})
    preview = np.round((depth - depth.min()) / np.ptp(depth) * 255).astype(np.uint8)
    preview_path = Path(args.output).with_suffix(".png")
    Image.fromarray(preview).save(preview_path)
    receipt = {
        "scope": manifest["scope"], "frozenManifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "modelSha256": model["sha256"], "photoSha256": manifest["photo"]["sha256"],
        "runtime": {"python": platform.python_version(), "onnxruntime": ort.__version__, "numpy": np.__version__, "pillow": pillow_version, "architecture": platform.machine(), "providers": session.get_providers(), "intraOpThreads": 4, "interOpThreads": 1},
        "normalizedPhoto": [width, height], "inputShape": list(tensor.shape), "outputShape": list(raw.shape),
        "sessionLoadMs": load_ms, "inferenceMs": durations, "rawOutputSha256": hashes,
        "sameProcessRepeatExactlyEqual": len(set(hashes)) == 1,
        "rawRange": [float(depth.min()), float(depth.max())], "pairs": pairs,
        "strictCorrect": sum(p["correct"] for p in pairs), "pairsTotal": len(pairs), "unpaintedBaselineStrictCorrect": 0,
        "processPeakRssKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        "previewPngSha256": hashlib.sha256(preview_path.read_bytes()).hexdigest(),
        "limitations": ["One previously published real photo may have training overlap; no generalization or calibrated distance claim", "Visual ordinal labels from one implementer, not independently measured ground truth", "No subject-boundary/correction-effort or browser/WebGPU evaluation", "Pillow normalization differs from product browser normalization", "Measured latency and Linux process peak RSS are observations, not resource guarantees"]
    }
    Path(args.output).write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
