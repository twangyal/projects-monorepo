"""Synthetic protocol envelopes test admission only, never native improvement."""
import io,json,unittest,zipfile
from unittest.mock import patch
from pathlib import Path
import garment_fixed_material_audit as m
from test_garment_fixed_material_audit import resign

class PreparationAudit(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with zipfile.ZipFile(Path(__file__).with_name('results')/'garment-gravity-reference.zip') as z:cls.files={n:z.read(n) for n in z.namelist()}
 def fixture(self):
  f=self.files.copy();r=json.loads(f['receipt.json']);r.pop('gravity_study');r['preparation_study']='reference';r['experiment']=r['experiment'].replace('-gravity-study','-preparation-study');r['source_sha256']=m.PREPARATION_SOURCE_SHA256
  return f,r
 def audit(self,f,r):
  with patch.dict(m.PREPARATION_PROFILES,{'reference':(None,4,'soft',0)},clear=True):return m.audit(resign(f,r),profile='reference',protocol='preparation',verify_archive_hash=False)
 def test_declared_reference_reconstructs_exactly(self):
  f,r=self.fixture();result=self.audit(f,r)
  self.assertEqual(result['preparation_study'],'reference');self.assertEqual(result['case']['raw_frames'],181)
  self.assertIn('principal_strain_checkpoints',result['case'])
 def test_resigned_protocol_source_gravity_and_geometry_drift_refuse(self):
  for key in ['mode','source','gravity','initial','extra']:
   f,r=self.fixture();r=json.loads(json.dumps(r))
   if key=='mode':r['preparation_study']='smoothed'
   if key=='source':r['source_sha256'].pop('garment_preparation.py')
   if key=='gravity':r['session_parameters']['gravity']=[0.,0.,0.]
   if key=='initial':f['native-cache/sessions/cpu-garment-soft/session/bin/vert.bin']=bytes(2353*3*8)
   if key=='extra':r['gravity_study']='reference'
   with self.subTest(key=key),self.assertRaises(ValueError):self.audit(f,r)
 def test_historical_gravity_refuses_extra_preparation_flag(self):
  f=self.files.copy();r=json.loads(f['receipt.json']);r['preparation_study']='reference'
  with self.assertRaisesRegex(ValueError,'Unexpected preparation'):
   m.audit(resign(f,r),profile='reference',protocol='gravity',verify_archive_hash=False)
