"""Native telemetry must be opted out before a runtime can initialize."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock

from karaoke.pipeline import _run


ROOT = Path(__file__).resolve().parents[1]


class NativeTelemetryTests(unittest.TestCase):
    def test_standalone_separation_benchmark_opts_out_before_numeric_dependencies(self):
        code = '''
import importlib.abc, importlib.util, json, os, runpy, sys
class Probe(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, fullname, path=None, target=None):
        return importlib.util.spec_from_loader(fullname, self) if fullname == 'numpy' else None
    def create_module(self, spec):
        return None
    def exec_module(self, module):
        os.environ['KARAOKE_NUMERIC_IMPORT_FLAG'] = os.environ.get('ORT_DISABLE_TELEMETRY', 'unset')
sys.meta_path.insert(0, Probe())
runpy.run_path(sys.argv[1], run_name='telemetry_probe')
print(json.dumps([os.environ.get('ORT_DISABLE_TELEMETRY'), os.environ.get('KARAOKE_NUMERIC_IMPORT_FLAG')]))
'''
        result = subprocess.run([sys.executable, '-S', '-c', code, str(ROOT / 'scripts/evaluate_separation.py')],
                                cwd=ROOT, env={**os.environ, 'ORT_DISABLE_TELEMETRY': '0'},
                                capture_output=True, text=True, timeout=10, check=True)
        self.assertEqual(json.loads(result.stdout), ['1', '1'])

    def test_container_custom_command_opts_out_before_starting_python(self):
        result = subprocess.run([
            'sh', str(ROOT / 'docker-entrypoint.sh'), sys.executable, '-S', '-c',
            'import os; print(os.environ.get("ORT_DISABLE_TELEMETRY", "unset"))',
        ], cwd=ROOT, env={**os.environ, 'ORT_DISABLE_TELEMETRY': '0'},
            capture_output=True, text=True, timeout=10, check=True)
        self.assertEqual(result.stdout.strip(), '1')

    def test_direct_package_and_worker_bootstrap_opt_out_without_importing_ml(self):
        for target in ('package', 'worker.py', 'transcribe_worker.py', 'align_worker.py'):
            with self.subTest(target=target):
                code = (
                    'import json, os, runpy, sys\n'
                    + ('import karaoke\n' if target == 'package' else
                       f'runpy.run_path({str(ROOT / "karaoke" / target)!r}, run_name="telemetry_probe")\n')
                    + 'print(json.dumps([os.environ.get("ORT_DISABLE_TELEMETRY"), '
                      'any(name in sys.modules for name in ("onnxruntime", "sherpa_onnx"))]))\n'
                )
                result = subprocess.run([sys.executable, '-S', '-c', code], cwd=ROOT,
                                        env={**os.environ, 'ORT_DISABLE_TELEMETRY': '0'},
                                        capture_output=True, text=True, timeout=10, check=True)
                self.assertEqual(json.loads(result.stdout), ['1', False])

    def test_child_opt_out_precedes_python_startup_and_preserves_other_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            # Models can initialize from native code or startup hooks before the worker body.
            Path(directory, 'sitecustomize.py').write_text(
                'import os\nos.environ["KARAOKE_STARTUP_FLAG"] = os.environ.get("ORT_DISABLE_TELEMETRY", "unset")\n'
            )
            for inherited in (None, '0'):
                with self.subTest(inherited=inherited), mock.patch.dict(os.environ, {
                    'PYTHONPATH': directory, 'KARAOKE_ENV_PROBE': 'preserved',
                }):
                    if inherited is None:
                        os.environ.pop('ORT_DISABLE_TELEMETRY', None)
                    else:
                        os.environ['ORT_DISABLE_TELEMETRY'] = inherited
                    output, _ = _run([
                        sys.executable, '-c',
                        'import json,os; print(json.dumps([os.environ.get(name) for name in '
                        '("KARAOKE_STARTUP_FLAG","ORT_DISABLE_TELEMETRY","KARAOKE_ENV_PROBE")]))',
                    ], threading.Event())
                    self.assertEqual(json.loads(output), ['1', '1', 'preserved'])
                    self.assertEqual(os.environ.get('ORT_DISABLE_TELEMETRY'), inherited)


if __name__ == '__main__':
    unittest.main()
