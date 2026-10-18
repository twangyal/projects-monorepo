import copy,struct,unittest
from garment_native_inputs import OBJECT
from garment_native_export import verify_export
from test_garment_native_export import buffers
class StitchControl(unittest.TestCase):
 def test_export_admits_only_declared_unsewn_stiffness(self):
  data,files=buffers();files['bin/stitch_stiffness.bin']=struct.pack('<22f',*([0.]*22))
  with self.assertRaises(ValueError):verify_export(files.__getitem__,data,500.)
  controls={**OBJECT,'stitch-stiffness':0.}
  self.assertTrue(verify_export(files.__getitem__,data,500.,object_parameters=controls)['native_export_bytes_verified'])
  files['bin/stitch_stiffness.bin']=struct.pack('<22f',*([.1]*22))
  with self.assertRaises(ValueError):verify_export(files.__getitem__,data,500.,object_parameters=controls)
 def test_unsewn_controls_change_only_stitch_for_warm_experiment(self):
  from garment_native_probe import experiment_controls
  before=copy.deepcopy(OBJECT)
  normal=experiment_controls('warm-sewing');control=experiment_controls('warm-sewing',True)
  self.assertEqual([k for k in normal if normal[k]!=control[k]],['stitch-stiffness'])
  self.assertEqual(control['stitch-stiffness'],0.)
  self.assertEqual(experiment_controls('strict'),OBJECT)
  for mode in ['strict','separated','sewing']:
   with self.assertRaises(ValueError):experiment_controls(mode,True)
  self.assertEqual(OBJECT,before)
 def test_actual_unsewn_failure_repeats_same_contact_with_only_stitch_bytes_changed(self):
  from garment_warm_failure_audit import audit
  from pathlib import Path
  r=audit(Path(__file__).with_name('results')/'garment-unsewn-native-failure.zip',unsewn_control=True)
  self.assertEqual(r['only_changed_native_bin'],['stitch_stiffness.bin'])
  self.assertEqual(r['motion_frames'],0)
  self.assertTrue(r['failure_reproduced_without_stitch_forces'])
 def test_sewn_archive_cannot_be_relabelled_as_unsewn(self):
  from garment_warm_failure_audit import audit
  from pathlib import Path
  with self.assertRaises(ValueError):audit(Path(__file__).with_name('results')/'garment-warm-native-failure.zip',verify_archive_hash=False,unsewn_control=True)
