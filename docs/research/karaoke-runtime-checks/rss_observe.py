import unittest,json,sys,time
from pathlib import Path
sys.path.insert(0,'.')
from karaoke import pipeline
observations=[]; original=pipeline._rss_kib
class Result(unittest.TextTestResult):
 def startTest(self,test):
  if test.id().endswith('.test_subprocess_rss_limit_is_enforced'):
   def observe(pid):
    value=original(pid); row={'pid':pid,'rss':value,'clock':time.monotonic()}
    if len(observations)<110:
     try: row['status']=[line for line in Path(f'/proc/{pid}/status').read_text().splitlines() if line.split(':')[0] in ['Name','State','VmRSS','NSpid']]
     except OSError as e: row['error']=type(e).__name__
     observations.append(row)
    return value
   pipeline._rss_kib=observe
  super().startTest(test)
 def stopTest(self,test):
  pipeline._rss_kib=original
  super().stopTest(test)
suite=unittest.defaultTestLoader.discover('tests');result=unittest.TextTestRunner(verbosity=2,resultclass=Result).run(suite)
Path('/tmp/karaoke309-rss-observations.json').write_text(json.dumps({'ok':result.wasSuccessful(),'observations':observations},indent=2))
sys.exit(not result.wasSuccessful())
