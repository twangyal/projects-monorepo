import unittest,json,hashlib,tempfile,shutil
from pathlib import Path
from verify_source_clock import validate_schedule,validate_startup,validate_observer,verify
class ObserverControls(unittest.TestCase):
 def test_fixed_schedule_refuses_missing_duplicate_and_reversed_rows(self):
  rows=[{'pair':i,'mode':m,'route':'normal'}for i in range(6)for m in (['on','off']if i%2==0 else ['off','on'])];validate_schedule(rows)
  for bad in [rows[:-1],rows[::-1],rows[:1]+rows[:1]+rows[2:]]:
   with self.assertRaises(AssertionError):validate_schedule(bad)
 def test_worklet_acknowledgement_is_exact_and_disabled_observer_stays_empty(self):
  validate_observer({'mode':'on','observerModes':[True],'inputs':[{'zeroRuns':[[0,8]]}]});validate_observer({'mode':'off','observerModes':[False],'inputs':[]})
  for bad in [{'mode':'on','observerModes':[False],'inputs':[]},{'mode':'off','observerModes':[False],'inputs':[{}]},{'mode':'on','observerModes':[True,True],'inputs':[]},{'mode':'on','observerModes':[1],'inputs':[]}]:
   with self.assertRaises(AssertionError):validate_observer(bad)
 def test_cold_source_requested_wait_and_running_state_are_required(self):
  r={'mode':'off','error':None,'observed':{'startup':{'requested':0,'startTime':0,'handoffTime':0,'wallMs':0,'stateBefore':'running','stateAfter':'running'}}};validate_startup(r)
  for key,value in [('requested',.2),('stateAfter','suspended'),('wallMs',-1)]:
   old=r['observed']['startup'][key];r['observed']['startup'][key]=value
   with self.assertRaises(AssertionError):validate_startup(r)
   r['observed']['startup'][key]=old
 def test_complete_cohort_keeps_the_observed_on_gap(self):
  rows=verify(Path(__file__).resolve().parent);self.assertEqual(len(rows),12);self.assertTrue(all(r['qualityPass']for r in rows))
  self.assertEqual([(r['pair'],r['mode'],r['native']['zeroRuns'],r['normalized']['zeroRuns'])for r in rows if r['native']['zeroRuns']],[(0,'on',[[82665,83106]],[[41333,41553]])])
 def test_resigned_wrong_worklet_acknowledgement_refuses(self):
  root=Path(__file__).resolve().parent
  with tempfile.TemporaryDirectory() as t:
   out=Path(t)
   for p in root.iterdir():
    if p.is_file():shutil.copyfile(p,out/p.name)
   m=json.loads((out/'manifest.json').read_text());row=m['rows'][1];p=out/row['receipt'];r=json.loads(p.read_text());r['observerModes']=[True]
   p.write_text(json.dumps(r));row['receiptSha256']=hashlib.sha256(p.read_bytes()).hexdigest();(out/'manifest.json').write_text(json.dumps(m))
   with self.assertRaises(AssertionError):verify(out)
if __name__=='__main__':unittest.main()
