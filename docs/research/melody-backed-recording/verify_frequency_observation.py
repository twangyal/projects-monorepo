#!/usr/bin/env python3
"""Independently verify retained synthetic PCM; never changes the product oracle."""
import base64
import hashlib
import json
import math
import sys
import zlib
from array import array
from pathlib import Path

path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name('2026-10-22-frequency-observation.json')
assert path.stat().st_size <= 100_000
receipt = json.loads(path.read_text())
assert receipt['originalOracle'] == {'expectedHz': 440, 'maximumAbsoluteHzError': 2, 'windowStart': 2205, 'windowEndExclusive': 24255}
assert receipt['testOutcome']['passed'] == 9 and receipt['testOutcome']['failed'] == 1
results = []
for capture in receipt['retainedCaptures']:
    compressed = base64.b64decode(capture['pcmGzipBase64'], validate=True)
    decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
    pcm = decoder.decompress(compressed, 882_001)
    assert decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail
    measured = capture['measurement']
    assert len(pcm) == measured['frames'] * 2 <= 882_000
    assert hashlib.sha256(pcm).hexdigest() == measured['pcmSha256'] == capture['assetMetadata']['sha256']
    assert capture['sampleRate'] == 22050 and capture['pcmEncoding'] == 'signed16le-mono'
    samples = array('h'); samples.frombytes(pcm)
    if sys.byteorder != 'little':
        samples.byteswap()
    start, end = 2205, 24255
    assert end < len(samples)
    crossings = sum(samples[i - 1] <= 0 < samples[i] for i in range(start + 1, end))
    hz = crossings * 22050 / (end - start)
    rms = math.sqrt(math.fsum((samples[i] / 32768) ** 2 for i in range(start, end)) / (end - start))
    assert hz == measured['crossingHz'] and abs(rms - measured['rms']) < 1e-12
    runs = []; i = 0
    while i < len(samples):
        if samples[i] != 0:
            i += 1
            continue
        j = i + 1
        while j < len(samples) and samples[j] == 0:
            j += 1
        if j - i >= 8:
            runs.append({'start': i, 'endExclusive': j, 'frames': j - i})
        i = j
    assert runs == measured['exactZeroRunsAtLeast8Frames']
    failed = abs(hz - 440) > 2
    assert failed == (capture['role'] == 'failed-frequency-gate')
    assert len(runs) == 1 and runs[0]['frames'] == 220
    intersects = runs[0]['start'] < end and runs[0]['endExclusive'] > start
    assert intersects == failed
    results.append({'role': capture['role'], 'sha256': measured['pcmSha256'], 'hz': hz, 'rms': rms, 'zeroRuns': runs, 'originalFrequencyGatePasses': not failed})
assert {row['role'] for row in results} == {'failed-frequency-gate', 'passing-gate-with-gap-outside-window'}
print(json.dumps({'verifiedRetainedCaptures': len(results), 'results': results, 'causeOfGapEstablished': False, 'physicalMicrophoneEvaluated': False}, indent=2))
