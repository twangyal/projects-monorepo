import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

SCRIPT=Path(__file__).with_name('supervise.py')
class NativeLifetime(unittest.TestCase):
    def test_timeout_stops_and_reaps_a_real_detached_native_writer(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);marker=root/'writes';pid=root/'native.pid'
            writer="import os,time;from pathlib import Path;p=Path("+repr(str(marker))+");Path("+repr(str(pid))+").write_text(str(os.getpid()));\nwhile True:\n p.write_text(str(time.monotonic()));time.sleep(.02)"
            parent="import subprocess,sys,time;subprocess.Popen([sys.executable,'-c',"+repr(writer)+"],start_new_session=True);time.sleep(60)"
            result=subprocess.run([sys.executable,str(SCRIPT),'--seconds','.4','--out',str(root),'--',sys.executable,'-c',parent],capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,124,result.stderr)
            data=json.loads((root/'supervisor.json').read_text());self.assertEqual(data['status'],'timed_out');self.assertEqual(data['remaining_children'],0)
            with self.assertRaises(ProcessLookupError):os.kill(int(pid.read_text()),0)
            before=marker.read_text();time.sleep(.1);self.assertEqual(marker.read_text(),before)
    def test_normal_completion_and_failure_keep_the_actual_exit_code(self):
        for code in [0,7]:
            with self.subTest(code=code),tempfile.TemporaryDirectory() as temp:
                result=subprocess.run([sys.executable,str(SCRIPT),'--seconds','2','--out',temp,'--',sys.executable,'-c',f'raise SystemExit({code})'],capture_output=True,text=True,timeout=10)
                self.assertEqual(result.returncode,code,result.stderr)
                data=json.loads((Path(temp)/'supervisor.json').read_text());self.assertEqual(data['status'],'completed' if code==0 else 'failed');self.assertEqual(data['remaining_children'],0)
if __name__=='__main__':unittest.main()
