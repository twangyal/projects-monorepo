"""Run the original pinned upstream CPU contact fixture; retain evidence, including failure."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import runpy
import shutil
import subprocess
import sys
import time
import traceback

REVISION = '6b30976f86e6b94d68d459e5237d59704c7d1384'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--upstream', required=True, type=Path)
parser.add_argument('--out', required=True, type=Path)
args = parser.parse_args()
upstream = args.upstream.resolve()
out = args.out.resolve()
out.mkdir(parents=True, exist_ok=True)
actual = subprocess.check_output(['git', '-C', str(upstream), 'rev-parse', 'HEAD'], text=True).strip()
if actual != REVISION:
    raise SystemExit(f'Refusing unpinned source: {actual}')
fixture = upstream / 'tools/cpu_contact_fixture.py'
receipt = {
    'schema': 1, 'upstream_revision': actual,
    'fixture_sha256': hashlib.sha256(fixture.read_bytes()).hexdigest(),
    'scope': 'Reproduction of upstream synthetic cloth/cloth contact fixture; no garment or physical validation.',
    'python': platform.python_version(), 'machine': platform.machine(),
    'logical_cpus': os.cpu_count(), 'status': 'started',
    'backend': 'cpu', 'build_resource_file': 'build-resources.txt',
}
started = time.perf_counter()
try:
    # The existing fixture's geometry, parameters, frame admission and all assertions run unchanged.
    sys.path.insert(0, str(upstream))
    os.chdir(upstream)
    namespace = runpy.run_path(str(fixture), run_name='__main__')
    receipt.update(status='passed_upstream_fixture', held=namespace['held'], contact_disabled=namespace['through'],
                   frames_per_case=namespace['FRAMES'] + 1, vertices_per_case=namespace['LOWER_COUNT'] + namespace['UPPER_COUNT'],
                   simulated_seconds=namespace['ELAPSED'], gap_metres=namespace['DROP'],
                   theoretical_free_fall_metres=namespace['FREE_FALL'])
except BaseException as exc:
    receipt.update(status='failed', error_type=type(exc).__name__, error=str(exc))
    traceback.print_exc()
    raise
finally:
    receipt['fixture_wall_seconds'] = time.perf_counter() - started
    # A fresh CI home contains only these synthetic test scenes. Retain every original vertex frame.
    cache = Path.home() / '.cache/ppf-cts'
    frames = []
    if cache.is_dir():
        for path in sorted(cache.rglob('vert_*.bin')):
            relative = path.relative_to(cache)
            target = out / 'frames' / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
            frames.append({'path': str(Path('frames') / relative), 'bytes': path.stat().st_size,
                           'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    receipt['retained_vertex_frames'] = frames
    (out / 'receipt.json').write_text(json.dumps(receipt, indent=2, allow_nan=False) + '\n')
