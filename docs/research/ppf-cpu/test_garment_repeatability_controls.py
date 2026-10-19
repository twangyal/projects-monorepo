import copy,unittest
import garment_native_probe as probe
from garment_native_inputs import CASES
class RepeatabilityControls(unittest.TestCase):
 def test_two_fresh_cases_have_identical_material_without_mutating_original_pair(self):
  make=getattr(probe,'case_plan',None);self.assertTrue(callable(make),'Same-material case plan is missing.')
  before=copy.deepcopy(CASES);self.assertEqual(make(False),CASES)
  self.assertEqual(make(True),{'first':500.,'second':500.});self.assertEqual(CASES,before)
 def test_requested_thread_settings_are_explicit_consistent_and_bounded(self):
  make=getattr(probe,'repeatability_settings',None);self.assertTrue(callable(make),'Requested execution settings are missing.')
  names=['RAYON_NUM_THREADS','OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS']
  for count in [1,4]:
   env={k:str(count) for k in names};r=make('clear-warm-sewing',60,'browser-inertia',False,env)
   self.assertEqual(r['requested_threads'],count);self.assertEqual(r['variables'],env)
  for env in [{},{k:'2' for k in names},{**{k:'1' for k in names},'OMP_NUM_THREADS':'4'}]:
   with self.assertRaises(ValueError):make('clear-warm-sewing',60,'browser-inertia',False,env)
 def test_repeatability_mode_cannot_change_pose_mass_duration_or_stitch_control(self):
  make=getattr(probe,'repeatability_settings',None);self.assertTrue(callable(make),'Controlled repeatability guard is missing.')
  env={k:'1' for k in ['RAYON_NUM_THREADS','OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','NUMEXPR_NUM_THREADS']}
  for pose,frames,mass,unsewn in [('sewing',60,'browser-inertia',False),('clear-warm-sewing',18,'browser-inertia',False),('clear-warm-sewing',60,'captured-density',False),('clear-warm-sewing',60,'browser-inertia',True)]:
   with self.assertRaises(ValueError):make(pose,frames,mass,unsewn,env)
