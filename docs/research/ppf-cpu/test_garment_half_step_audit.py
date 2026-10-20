"""Synthetic protocol-admission tests; transformed bytes are not native evidence."""
import hashlib,io,json,unittest,zipfile
from unittest.mock import patch
import garment_fixed_material_audit as m
from test_garment_fixed_material_audit import ROOT,resign
class HalfStepAdmission(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with zipfile.ZipFile(ROOT/'garment-fixed-four-soft.zip') as z:cls.fixed={n:z.read(n) for n in z.namelist()}
  cls.files=cls.fixed.copy();r=json.loads(cls.files['receipt.json'])
  r['experiment']+='-half-step-study';r['half_step_study']=True
  r['session_parameters']['dt']=1/240;r['source_sha256']=getattr(m,'HALF_STEP_SOURCE_SHA256',{})
  p='native-cache/sessions/cpu-garment-soft/session/param.toml'
  cls.files[p]=cls.files[p].replace(b'dt = 0.008333333333333333',b'dt = 0.004166666666666667')
  cls.receipt=r;cls.raw=resign(cls.files,r).read()
 def audit(self,stream):
  with patch.dict(m.HALF_STEP_PROFILES,{'synthetic-half-soft':(None,4,'soft',0)},clear=True):
   return m.audit(stream,profile='synthetic-half-soft',protocol='half-step',verify_archive_hash=False)
 def test_declared_protocol_and_reference_are_explicit(self):
  r=self.audit(io.BytesIO(self.raw))
  self.assertEqual(r['configured_dt_seconds'],1/240)
  self.assertEqual(r['configured_dt_reference_seconds'],1/120)
  self.assertEqual(r['reference_archive']['profile'],'duration-four')
  self.assertEqual(r['reference_trajectory']['maximum_vertex_difference_m'],0)
  self.assertEqual(r['case']['principal_strain'],r['reference_principal_strain'])
  self.assertFalse(r['original_timed_out_serial_pair_completed'])
 def test_resigned_wrong_protocol_source_material_and_export_refuse(self):
  for mode in ['flag','receipt-dt','export-dt','source','material']:
   f=self.files.copy();r=json.loads(json.dumps(self.receipt))
   if mode=='flag':r['half_step_study']=False
   if mode=='receipt-dt':r['session_parameters']['dt']=1/120
   if mode=='export-dt':f['native-cache/sessions/cpu-garment-soft/session/param.toml']=self.fixed['native-cache/sessions/cpu-garment-soft/session/param.toml']
   if mode=='source':r['source_sha256']['garment_native_probe.py']='forged'
   if mode=='material':r['case_normalized_young']['soft']=2000.
   with self.subTest(mode=mode),self.assertRaises(ValueError):self.audit(resign(f,r))
 def test_ordinary_protocol_rejects_extra_half_step_flag(self):
  f=self.fixed.copy();r=json.loads(f['receipt.json']);r['half_step_study']=True
  with self.assertRaisesRegex(ValueError,'Unexpected half-step'):
   m.audit(resign(f,r),profile='four-soft',verify_archive_hash=False)
