"""Run the original pinned upstream CPU contact fixture; retain evidence, including failure."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import runpy
import subprocess
import sys
import time
import traceback

REVISION = '6b30976f86e6b94d68d459e5237d59704c7d1384'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--upstream', required=True, type=Path)
parser.add_argument('--out', required=True, type=Path)
parser.add_argument('--cache', required=True, type=Path)
args = parser.parse_args()
upstream = args.upstream.resolve()
out = args.out.resolve()
out.mkdir(parents=True, exist_ok=True)
cache=args.cache.resolve()
if cache.exists() and any(cache.iterdir()):raise SystemExit('Use an empty dedicated native cache for this synthetic probe.')
cache.mkdir(parents=True,exist_ok=True)
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
(out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
started = time.perf_counter()
try:
    # The existing fixture's geometry, parameters, frame admission and all assertions run unchanged.
    sys.path.insert(0, str(upstream))
    os.chdir(upstream)
    from frontend import App
    original_create=App.create
    original_data_dir=App.get_data_dirpath
    App.get_data_dirpath=staticmethod(lambda: str(cache / 'sessions'))
    def create_in_probe_cache(name, cache_dir=''):
        if name not in ['cpu-contact-held','cpu-contact-through'] or cache_dir:
            raise ValueError('Unexpected fixture app/cache request')
        app=original_create(name, cache_dir=str(cache / 'meshes'))
        # Session outputs/logs use the application data root, not its mesh cache.
        if not Path(app._root).resolve().is_relative_to(cache):
            raise ValueError('Native session escaped the dedicated synthetic data root')
        return app
    # Only storage is redirected through the documented API; fixture source,
    # physical parameters, solver calls and every numerical assertion stay intact.
    App.create=staticmethod(create_in_probe_cache)
    try:
        namespace = runpy.run_path(str(fixture), run_name='__main__')
    finally:
        App.create=staticmethod(original_create)
        App.get_data_dirpath=staticmethod(original_data_dir)
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
    (out / 'receipt.json').write_text(json.dumps(receipt, indent=2, allow_nan=False) + '\n')
