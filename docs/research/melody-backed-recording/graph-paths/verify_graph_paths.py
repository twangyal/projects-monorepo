"""Replay the bounded graph-path diagnostic; this is not a release audio-quality gate."""
import hashlib
import json
import math
import struct
import zlib
from collections import Counter
from pathlib import Path


def integer(value):
    assert type(value) is int and 0 <= value < 2**53
    return value


def input_runs(blocks, start, end):
    integer(start); integer(end)
    assert end > start
    runs = []
    previous = -128
    for block in blocks:
        frame = integer(block['currentFrame'])
        assert frame >= previous + 128
        previous = frame
        assert block['type'] == 'zero-input-graph300'
        assert block['sampleRate'] == 44100 and block['channels'] == 2 and block['frames'] == 128
        last = -1
        for left, right in block['zeroRuns']:
            integer(left); integer(right)
            assert last <= left < right <= 128
            last = right
            left, right = max(start, frame + left) - start, min(end, frame + right) - start
            if left < right:
                if runs and runs[-1][1] == left:
                    runs[-1][1] = right
                else:
                    runs.append([left, right])
    return [run for run in runs if run[1] - run[0] >= 8]


def decode_signal(path, meta):
    size = integer(meta['bytes'])
    assert 0 < size <= 352800 and size % 4 == 0
    decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
    raw = decoder.decompress(path.read_bytes(), size + 1)
    assert len(raw) == size and decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail
    assert hashlib.sha256(raw).hexdigest() == meta['sha256']
    values = struct.unpack('<' + str(size // 4) + 'f', raw)
    assert all(math.isfinite(value) for value in values)
    return values


def metrics(samples):
    runs = []
    left = None
    for index in range(len(samples) + 1):
        if index < len(samples) and samples[index] == 0:
            if left is None:
                left = index
        elif left is not None:
            if index - left >= 8:
                runs.append([left, index])
            left = None
    window = samples[4410:48510]
    return dict(zeroRuns=runs,
                hz=sum(samples[i - 1] <= 0 < samples[i] for i in range(4411, min(len(samples), 48510))),
                rms=math.sqrt(sum(value * value for value in window) / len(window)) if window else 0)


def verify(root):
    manifest = json.loads((root / 'manifest.json').read_text())
    for file, key in [('graph-paths.patch', 'patchSha256'), ('graph-probe.spec.ts', 'probeSha256')]:
        assert hashlib.sha256((root / file).read_bytes()).hexdigest() == manifest[key]
    rows = manifest['rows']
    assert len(rows) == 16 and sum(row['silent'] for row in rows) == 1
    assert Counter(row['mode'] for row in rows if not row['silent']) == {
        'direct': 5, 'same-context-stream': 5, 'separate-context-stream': 5}
    results = []
    for row in rows:
        assert Path(row['file']).name == row['file']
        samples = decode_signal(root / row['file'], row)
        complete = row['complete']
        assert len(samples) == complete['samples']['frames'] == 88200
        assert complete['sampleRate'] == 44100 and complete['channels'] == 2
        assert complete['endFrame'] - complete['startFrame'] == 88200
        assert all(rate == 44100 for rate in row['contextRates'])
        assert row['error'] is None
        assert all(row[key] is True for key in ('contextsClosed', 'tracksEnded', 'oscillatorStopped'))
        measured = metrics(samples)
        observed = input_runs(row['inputBlocks'], complete['startFrame'], complete['endFrame'])
        assert observed == measured['zeroRuns'], row['case']
        if row['silent']:
            assert measured == dict(zeroRuns=[[0, 88200]], hz=0, rms=0)
        results.append(dict(case=row['case'], mode=row['mode'], silent=row['silent'], **measured))
    return results


if __name__ == '__main__':
    print(json.dumps(verify(Path(__file__).resolve().parent), indent=2))
