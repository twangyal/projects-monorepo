"""Synthetic transformed controls test rejection, never actual native outcomes."""
import json,struct,unittest
from unittest.mock import patch
import garment_fixed_material_audit as m
import test_garment_half_step_audit as half
from test_garment_fixed_material_audit import resign
class BendingAdmission(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  half.HalfStepAdmission.setUpClass();cls.fixed=half.HalfStepAdmission.fixed
 def files(self,mode):
  f=self.fixed.copy();r=json.loads(f['receipt.json']);r['experiment']+='-bending-study';r['bending_study']=mode;r['source_sha256']=dict(getattr(m,'BENDING_SOURCE_SHA256',r['source_sha256']))
  if mode=='zero':
   r['object_parameters']['bend']=0.
   f['native-cache/sessions/cpu-garment-soft/session/bin/param/tri-bend.bin']=struct.pack('<4480f',*([0.]*4480))
  return f,r
 def audit(self,f,r,mode):
  with patch.dict(m.BENDING_PROFILES,{mode:(None,4,'soft',0)},clear=True):return m.audit(resign(f,r),profile=mode,protocol='bending',verify_archive_hash=False)
 def test_declared_reference_and_zero_replay(self):
  self.assertTrue(hasattr(m,'BENDING_PROFILES'),'Missing distinct bending protocol registry')
  for mode in ['reference','zero']:
   f,r=self.files(mode);x=self.audit(f,r,mode);self.assertEqual(x['bending_study'],mode);self.assertEqual(x['case']['raw_frames'],181)
   self.assertEqual([v['frame'] for v in x['case']['principal_strain_checkpoints']],[0,1,6,18,60,120,180])
 def test_resigned_control_mutations_refuse(self):
  self.assertTrue(hasattr(m,'BENDING_PROFILES'),'Missing distinct bending protocol registry')
  p='native-cache/sessions/cpu-garment-soft/session/bin/'
  for change in ['flag','receipt','bend','rest','density','stitch','friction','gravity','preparation','half','source']:
   f,r=self.files('zero')
   if change=='flag':r['bending_study']='reference'
   if change=='receipt':r['object_parameters']['bend']=20.
   if change=='bend':f[p+'param/tri-bend.bin']=self.fixed[p+'param/tri-bend.bin']
   if change=='rest':f[p+'rest_vert.bin']=b'forged'
   if change=='density':f[p+'param/tri-density.bin']=b'forged'
   if change=='stitch':f[p+'stitch_stiffness.bin']=struct.pack('<22f',*([0.]*22))
   if change=='friction':f[p+'param/tri-friction.bin']=struct.pack('<4480f',*([.1]*4480))
   if change=='gravity':r['gravity_study']='reference'
   if change=='preparation':r['preparation_study']='reference'
   if change=='half':r['half_step_study']=True
   if change=='source':r['source_sha256']['garment_native_probe.py']='forged'
   with self.subTest(change=change),self.assertRaises(ValueError):self.audit(f,r,'zero')
 def test_historical_receipt_refuses_unexpected_bending_flag(self):
  f=self.fixed.copy();r=json.loads(f['receipt.json']);r['bending_study']='reference'
  with self.assertRaisesRegex(ValueError,'Unexpected bending'):m.audit(resign(f,r),profile='four-soft',verify_archive_hash=False)
