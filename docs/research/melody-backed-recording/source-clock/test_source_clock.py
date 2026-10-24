import unittest,json,hashlib,tempfile,shutil
from pathlib import Path
from verify_source_clock import validate_schedule,validate_startup,verify
ROOT=Path(__file__).resolve().parent
class ClockTests(unittest.TestCase):
 def test_fixed_order_rejects_missing_duplicate_or_reversed_modes(self):
  rows=[{'pair':i,'mode':m,'route':'normal'} for i in range(5)for m in (['cold','warm']if i%2==0 else ['warm','cold'])];validate_schedule(rows)
  for bad in [rows[:-1],rows[::-1],rows[:1]+rows[:1]+rows[2:]]:
   with self.assertRaises(AssertionError):validate_schedule(bad)
 def test_actual_complete_cohort_preserves_the_failing_original_quality_check(self):
  rows=verify(ROOT);self.assertEqual(len(rows),10);bad=[r for r in rows if not r['qualityPass']];self.assertEqual([(r['pair'],r['mode'])for r in bad],[(3,'cold')]);self.assertEqual(bad[0]['native']['zeroRuns'],[[4353,4794]])
 def test_resigned_source_clock_and_mode_tampering_refuse(self):
  for field in ['short-warm','requested','state','negative-wall','mode']:
   with self.subTest(field=field),tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp)
    for f in ROOT.iterdir():
     if f.is_file():shutil.copyfile(f,root/f.name)
    m=json.loads((root/'manifest.json').read_text());row=m['rows'][1];p=root/row['receipt'];r=json.loads(p.read_text());s=r['observed']['startup']
    if field=='short-warm':s['handoffTime']=s['startTime']+.1
    elif field=='requested':s['requested']=0
    elif field=='state':s['stateBefore']='suspended'
    elif field=='negative-wall':s['wallMs']=-1
    else:r['mode']='cold'
    p.write_text(json.dumps(r));row['receiptSha256']=hashlib.sha256(p.read_bytes()).hexdigest();(root/'manifest.json').write_text(json.dumps(m))
    with self.assertRaises(AssertionError):verify(root)
 def test_failed_pre_exposure_capture_remains_a_failure_not_a_completed_warmup(self):
  r={'mode':'warm','error':'permission refused','observed':{'startup':None}};self.assertIsNone(validate_startup(r));r['error']=None
  with self.assertRaises(AssertionError):validate_startup(r)
if __name__=='__main__':unittest.main()
