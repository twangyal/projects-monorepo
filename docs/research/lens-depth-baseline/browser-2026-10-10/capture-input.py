"""Capture the existing harness's actual tensor and raw CPU oracle for a browser probe.
Research instrumentation only; no change to model inputs or outputs.
"""
import hashlib
import json
from pathlib import Path
import runpy
import sys
import onnxruntime as ort

# Pass the ordinary evaluate.py arguments after the local capture directory.
destination = Path(sys.argv[1])
destination.mkdir(parents=True, exist_ok=True)
arguments = sys.argv[2:]
harness = Path(__file__).resolve().parent.parent / 'evaluate.py'
original = ort.InferenceSession
captured = {}


def session_with_capture(*args, **kwargs):
    session = original(*args, **kwargs)
    original_run = session.run

    def run(outputs, feeds, *rest, **options):
        result = original_run(outputs, feeds, *rest, **options)
        tensor = feeds['pixel_values']
        raw = result[0]
        if not captured:
            for name, array in (('input', tensor), ('cpu', raw)):
                data = array.astype('<f4', copy=False).tobytes()
                (destination / (name + '.bin')).write_bytes(data)
                captured[name] = {'shape': list(array.shape), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'dtype': 'little-endian float32'}
        return result

    session.run = run
    return session


ort.InferenceSession = session_with_capture
sys.argv = [str(harness), *arguments]
try:
    runpy.run_path(str(harness), run_name='__main__')
finally:
    ort.InferenceSession = original
(destination / 'tensor-provenance.json').write_text(json.dumps({'harnessSha256': hashlib.sha256(harness.read_bytes()).hexdigest(), 'capture': captured}, indent=2) + '\n')
