"""Offline anchored-subject diagnostic on a pinned, already-observed 8bit depth preview.
Coarse reference agreement and binary label flips only; not human correction effort.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from PIL import Image


def checked(path, expected):
    data = Path(path).read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('Checksum mismatch: ' + Path(path).name)
    return data


def polygon_mask(width, height, polygon):
    if not 3 <= len(polygon) <= 2048 or not all(
        isinstance(p, list) and len(p) == 2 and all(type(v) in (int, float) and math.isfinite(v) and 0 <= v <= 1 for v in p)
        for p in polygon
    ):
        raise ValueError('Expected bounded normalized polygon')
    xs = (np.arange(width) + 0.5) / width
    result = np.zeros((height, width), dtype=bool)
    for y in range(height):
        py = (y + 0.5) / height
        for (x1, y1), (x2, y2) in zip(polygon, polygon[1:] + polygon[:1]):
            if (y1 > py) != (y2 > py):
                crossing = x1 + (py - y1) * (x2 - x1) / (y2 - y1)
                result[y] ^= xs < crossing
    return result


def reference_mask(width, height, outers, holes):
    if not 1 <= width <= 1280 or not 1 <= height <= 1280 or not 1 <= len(outers) <= 16 or len(holes) > 16:
        raise ValueError('Expected bounded raster and polygon count')
    result = np.zeros((height, width), dtype=bool)
    for polygon in outers:
        result |= polygon_mask(width, height, polygon)
    for polygon in holes:
        result &= ~polygon_mask(width, height, polygon)
    return result


def component(band, x, y):
    height, width = band.shape
    result = np.zeros_like(band, dtype=bool)
    if not band[y, x]:
        return result
    stack = [(x, y)]
    result[y, x] = True
    while stack:
        px, py = stack.pop()
        for nx, ny in ((px - 1, py), (px + 1, py), (px, py - 1), (px, py + 1)):
            if 0 <= nx < width and 0 <= ny < height and band[ny, nx] and not result[ny, nx]:
                result[ny, nx] = True
                stack.append((nx, ny))
    return result


def measure(candidate, reference):
    tp = int(np.count_nonzero(candidate & reference))
    fp = int(np.count_nonzero(candidate & ~reference))
    fn = int(np.count_nonzero(~candidate & reference))
    tn = int(np.count_nonzero(~candidate & ~reference))
    return {'truePositive': tp, 'falsePositive': fp, 'falseNegative': fn, 'trueNegative': tn,
            'differentPixels': fp + fn, 'differentFraction': (fp + fn) / reference.size,
            'iou': tp / (tp + fp + fn) if tp + fp + fn else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('protocol', 'protocol-sha256', 'annotation', 'depth', 'output'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    protocol_bytes = checked(args.protocol, args.protocol_sha256)
    protocol = json.loads(protocol_bytes)
    annotation_bytes = checked(args.annotation, protocol['sourceAnnotationSha256'])
    annotation = json.loads(annotation_bytes)
    checked(args.depth, protocol['depthPreviewSha256'])
    with Image.open(args.depth) as image:
        if image.mode != 'L' or list(image.size) != protocol['depthSize']:
            raise ValueError('Expected frozen grayscale depth size')
        depth = np.asarray(image).copy()
    width, height = protocol['depthSize']
    reference = reference_mask(width, height, [p['outer'] for p in annotation['polygons']], annotation['background_holes'])
    ax, ay = protocol['anchor']
    if not all(type(v) in (int, float) and math.isfinite(v) and 0 <= v < 1 for v in (ax, ay)):
        raise ValueError('Expected normalized anchor')
    half = protocol['bandHalfWidth']
    if type(half) is not int or not 0 <= half <= 255 or protocol['connectivity'] != 4:
        raise ValueError('Expected frozen four-connected band')
    x, y = int(ax * width), int(ay * height)
    anchor_value = int(depth[y, x])
    lower, upper = max(0, anchor_value - half), min(255, anchor_value + half)
    band = (depth >= lower) & (depth <= upper)
    candidates = {'all-subject': np.ones_like(reference), 'empty': np.zeros_like(reference),
                  'whole-band': band, 'anchor-component': component(band, x, y)}
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=False)
    hashes = {}
    for name, mask in {'reference': reference, **candidates}.items():
        target = output / (name + '.png')
        Image.fromarray(mask.astype(np.uint8) * 255).save(target)
        hashes[name] = hashlib.sha256(target.read_bytes()).hexdigest()
    receipt = {'scope': protocol['scope'], 'protocolSha256': hashlib.sha256(protocol_bytes).hexdigest(),
               'annotationSha256': hashlib.sha256(annotation_bytes).hexdigest(), 'depthPreviewSha256': protocol['depthPreviewSha256'],
               'size': [width, height], 'anchorPixel': [x, y], 'anchorGray': anchor_value, 'inclusiveBand': [lower, upper],
               'referencePixels': int(reference.sum()), 'comparisons': {name: measure(mask, reference) for name, mask in candidates.items()},
               'maskPngSha256': hashes, 'interpretation': protocol['interpretation'],
               'limitations': ['Previously evaluated public portrait; training overlap unknown, not held-out quality',
                               'One independently drawn coarse silhouette, not measured ground truth',
                               'Uses minmax-normalized8bit display depth, not raw or physical distance',
                               'No human correction time, strokes, actual perspective output or product acceptance',
                               'No model rerun, new model selection, browser inference or resource evaluation']}
    (output / 'result.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
