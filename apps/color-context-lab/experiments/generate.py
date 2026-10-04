"""Frozen original procedural fixtures; no learner or inference imports."""

import hashlib
import json
import math
from pathlib import Path

import numpy as np

PROTOCOL_SHA256 = "da016f6fce82d9c9f5716345fbbd97fd98825a6873d89f0a1e5cebc622205ee6"
SOURCE_FILES = ("experiments/generate.py", "experiments/report.py", "experiments/requirements.txt", "experiments/run.py")
SPLITS = ("train", "development", "test")
FAMILY_KEYS = {"id", "split", "label", "cx", "cy", "halfLength", "halfThickness", "radius", "rotation", "correlatedPalette", "independentPalette", "variants"}


def canonical_bytes(value):
    """Specified compact sorted Unicode JSON followed by exactly one LF."""
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def read_json(path, limit=2 * 1024 * 1024):
    with Path(path).open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Experiment JSON exceeds its byte bound.")
    text = data.decode("utf-8", errors="strict")
    depth, quoted, escaped = 0, False, False
    for c in text:
        if quoted:
            if escaped:
                escaped = False
            elif c == "\\":
                escaped = True
            elif c == '"':
                quoted = False
        elif c == '"':
            quoted = True
        elif c in "[{":
            depth += 1
            if depth > 16:
                raise ValueError("Experiment JSON nesting exceeds its bound.")
        elif c in "]}":
            depth -= 1
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate experiment JSON key.")
            result[key] = value
        return result
    def invalid(_):
        raise ValueError("Nonfinite experiment JSON number.")
    return json.loads(text, object_pairs_hook=pairs, parse_constant=invalid)


def _protocol(protocol):
    if hashlib.sha256(canonical_bytes(protocol)).hexdigest() != PROTOCOL_SHA256:
        raise ValueError("Protocol settings differ from the frozen contract.")
    return protocol


def load_protocol(path=None):
    path = Path(path) if path is not None else Path(__file__).with_name("protocol.json")
    protocol = _protocol(read_json(path, 64 * 1024))
    if path.read_bytes() != canonical_bytes(protocol):
        raise ValueError("Protocol bytes are not canonical.")
    return protocol


def source_hash(root=None):
    root = Path(root) if root is not None else Path(__file__).resolve().parent.parent
    digest = hashlib.sha256()
    for name in SOURCE_FILES:
        data = (root / name).read_bytes()
        digest.update(name.encode("utf-8") + b"\0" + str(len(data)).encode("ascii") + b"\0" + data)
    return digest.hexdigest()


def render_center(family, variant, protocol=None):
    """Literal 4x4 subpixel coverage of a separately specified geometry."""
    protocol = load_protocol() if protocol is None else protocol
    if type(variant) is not int or variant not in (0, 1) or type(family.get("label")) is not int or family["label"] not in range(4):
        raise ValueError("Invalid procedural shape label or variant.")
    for key in ("cx", "cy", "halfLength", "halfThickness", "radius", "rotation"):
        if type(family.get(key)) not in (int, float) or not math.isfinite(family[key]):
            raise ValueError("Invalid procedural geometry.")
    offset = protocol["geometry"]["variants"][variant]
    positions = np.arange(24, dtype=np.float64)[:, None] + (np.arange(4, dtype=np.float64)[None, :] + 0.5) / 4
    dx = positions[None, :, None, :] - (family["cx"] + offset[0])
    dy = positions[:, None, :, None] - (family["cy"] + offset[1])
    cosine, sine = math.cos(family["rotation"]), math.sin(family["rotation"])
    x, y = cosine * dx + sine * dy, -sine * dx + cosine * dy
    horizontal = (np.abs(x) <= family["halfLength"]) & (np.abs(y) <= family["halfThickness"])
    vertical = (np.abs(y) <= family["halfLength"]) & (np.abs(x) <= family["halfThickness"])
    label = family["label"]
    covered = horizontal if label == 0 else vertical if label == 1 else horizontal | vertical if label == 2 else x * x + y * y <= family["radius"] ** 2
    values = (192 - 8 * covered.sum(axis=(2, 3))).astype(np.uint8)
    return np.repeat(values[:, :, None], 3, axis=2)


def _palettes(protocol, split, label):
    settings = protocol["splits"][split]
    count = settings["familiesPerClass"]
    if split == "test":
        seed = protocol["assignments"]["testIndependentSeed"] + label
    else:
        seed = protocol["assignments"]["seed"] + SPLITS.index(split) * 100 + label
    def assigned(colors, counts):
        permutation = np.random.Generator(np.random.PCG64(seed)).permutation(count)
        result = [None] * count
        start = 0
        for color, size in zip(colors, counts, strict=True):
            for i in permutation[start:start + size]:
                result[int(i)] = color
            start += size
        return result
    independent = assigned(range(4), settings["independentCounts"])
    correlated = [None] * count if split == "test" else assigned([label, *[i for i in range(4) if i != label]], settings["correlatedCounts"])
    return correlated, independent


def generate_manifest(protocol=None):
    protocol = load_protocol() if protocol is None else _protocol(protocol)
    families, emitted = [], set()
    ranges = protocol["geometry"]["ranges"]
    for split in SPLITS:
        config = protocol["splits"][split]
        rng = np.random.Generator(np.random.PCG64(config["seed"]))
        for label in range(4):
            correlated, independent = _palettes(protocol, split, label)
            for index in range(config["familiesPerClass"]):
                for _ in range(protocol["duplicateAttempts"]):
                    family = {"id": f"{split}-c{label}-f{index:03d}", "split": split, "label": label}
                    for name in protocol["geometry"]["drawOrder"]:
                        family[name] = float(rng.uniform(*ranges[name]))
                    hashes = [hashlib.sha256(render_center(family, v, protocol).tobytes()).hexdigest() for v in (0, 1)]
                    if hashes[0] != hashes[1] and not any(h in emitted for h in hashes):
                        break
                else:
                    raise ValueError("Procedural family duplicate redraw budget exhausted.")
                emitted.update(hashes)
                family.update(correlatedPalette=correlated[index], independentPalette=independent[index], variants=[{"id": family["id"] + f"-v{v}", "centerSha256": h} for v, h in enumerate(hashes)])
                families.append(family)
    return {"schemaVersion": 1, "protocolHash": PROTOCOL_SHA256, "generatorHash": source_hash(), "families": families}


def validate_manifest(manifest, protocol=None):
    protocol = load_protocol() if protocol is None else _protocol(protocol)
    if type(manifest) is not dict or set(manifest) != {"schemaVersion", "protocolHash", "generatorHash", "families"}:
        raise ValueError("Invalid experiment manifest fields.")
    if type(manifest["families"]) is not list or len(manifest["families"]) != 1120:
        raise ValueError("Invalid experiment family count.")
    for family in manifest["families"]:
        if type(family) is not dict or set(family) != FAMILY_KEYS:
            raise ValueError("Invalid experiment family fields.")
        if type(family["variants"]) is not list or len(family["variants"]) != 2:
            raise ValueError("Invalid experiment variant count.")
        for variant in family["variants"]:
            if type(variant) is not dict or set(variant) != {"id", "centerSha256"}:
                raise ValueError("Invalid experiment variant fields.")
        for name in protocol["geometry"]["drawOrder"]:
            number = family[name]
            low, high = protocol["geometry"]["ranges"][name]
            if type(number) not in (float, int) or not math.isfinite(number) or not low <= number < high:
                raise ValueError("Invalid experiment family geometry range.")
        if type(family["label"]) is not int or family["label"] not in range(4):
            raise ValueError("Invalid experiment class label.")
    try:
        supplied = canonical_bytes(manifest)
    except (ValueError, TypeError, UnicodeError):
        raise ValueError("Invalid experiment manifest values.") from None
    if len(supplied) > 2 * 1024 * 1024 or supplied != canonical_bytes(generate_manifest(protocol)):
        raise ValueError("Manifest does not match the frozen deterministic generator.")
    return json.loads(supplied)


def dataset(manifest, split, suite, mask=False):
    if split not in SPLITS or suite not in ("neutral", "correlated", "matched", "shifted", "independent") or type(mask) is not bool:
        raise ValueError("Invalid experiment dataset selection.")
    if split == "test" and suite == "correlated" or split != "test" and suite not in ("neutral", "correlated", "independent"):
        raise ValueError("Suite is unavailable for this split.")
    manifest = validate_manifest(manifest)
    protocol = load_protocol()
    families = [family for family in manifest["families"] if family["split"] == split]
    images = np.full((len(families) * 2, 32, 32, 3), 128, dtype=np.uint8)
    labels, ids = [], []
    for i, family in enumerate(families):
        label = family["label"]
        palette = None if suite == "neutral" or mask else family["correlatedPalette"] if suite == "correlated" else family["independentPalette"] if suite == "independent" else label if suite == "matched" else (label + 1) % 4
        if palette is not None:
            images[i * 2:i * 2 + 2] = protocol["palette"][palette]
        for variant in (0, 1):
            images[i * 2 + variant, 4:28, 4:28] = render_center(family, variant, protocol)
            labels.append(label)
            ids.append(family["variants"][variant]["id"])
    return images, np.array(labels, dtype=np.int64), ids
