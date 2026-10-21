"""Synthetic transformed archives test admission, never native outcomes."""
import io,json,unittest
from unittest.mock import patch
import garment_fixed_material_audit as m
import test_garment_half_step_audit as half
from test_garment_fixed_material_audit import resign

class GravityAdmission(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  half.HalfStepAdmission.setUpClass();cls.fixed=half.HalfStepAdmission.fixed
 def files(self,mode):
  files=self.fixed.copy();r=json.loads(files['receipt.json'])
  r['experiment']+='-gravity-study';r['gravity_study']=mode;r['source_sha256']=m.GRAVITY_SOURCE_SHA256
  if mode=='zero':
   r['session_parameters']['gravity']=[0.,0.,0.]
   p='native-cache/sessions/cpu-garment-soft/session/param.toml';files[p]=files[p].replace(b'-9.8',b'0.0')
  return files,r
 def audit(self,files,r,mode):
  with patch.dict(m.GRAVITY_PROFILES,{mode:(None,4,'soft',0)},clear=True):
   return m.audit(resign(files,r),profile=mode,protocol='gravity',verify_archive_hash=False)
 def test_declared_modes_replay_without_changing_historical_controls(self):
  for mode in ['reference','zero']:
   files,r=self.files(mode);result=self.audit(files,r,mode)
   self.assertEqual(result['gravity_study'],mode)
   self.assertEqual(result['case']['raw_frames'],181)
   self.assertIn('principal_strain',result['case'])
 def test_resigned_mutations_refuse(self):
  for mutation in ['flag','gravity','dt','contact','source','export']:
   f,r=self.files('zero');r=json.loads(json.dumps(r))
   if mutation=='flag':r['gravity_study']='reference'
   if mutation=='gravity':r['session_parameters']['gravity']=[0.,-9.8,0.]
   if mutation=='dt':r['session_parameters']['dt']=1/240
   if mutation=='contact':r['session_parameters']['disable-contact']=True
   if mutation=='source':r['source_sha256']['garment_native_probe.py']='forged'
   if mutation=='export':f['native-cache/sessions/cpu-garment-soft/session/param.toml']=self.fixed['native-cache/sessions/cpu-garment-soft/session/param.toml']
   with self.subTest(mutation=mutation),self.assertRaises(ValueError):self.audit(f,r,'zero')
 def test_historical_receipt_refuses_unexpected_gravity_flag(self):
  f=self.fixed.copy();r=json.loads(f['receipt.json']);r['gravity_study']='reference'
  with self.assertRaisesRegex(ValueError,'Unexpected gravity'):
   m.audit(resign(f,r),profile='four-soft',verify_archive_hash=False)
