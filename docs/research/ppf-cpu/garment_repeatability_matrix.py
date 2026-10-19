"""Re-audit both frozen canonical pairs and compare all four saved trajectories."""
import json,sys,zipfile,struct
from pathlib import Path
from garment_repeatability_audit import audit,trajectory_comparison
root=Path(__file__).with_name('results');reports={};frames={}
for name in ['one','four']:
 r=audit(root/f'garment-canonical-{name}.zip',profile='canonical-'+name)
 reports[name]=r
 with zipfile.ZipFile(root/f'garment-canonical-{name}.zip') as z:
  frames[name]=[]
  for i in range(61):
   values=struct.unpack('<7059f',z.read(f'native-cache/sessions/cpu-garment-first/session/output/vert_{i}.bin'))
   frames[name].append([list(values[j:j+3]) for j in range(0,len(values),3)])
all_hashes=[hashes for r in reports.values() for hashes in r['raw_frame_sha256'].values()]
comparison={'source_commit':'d56b1d61faa95b557fd61274db51c5d619ca367b','run_url':'https://github.com/twangyal/projects-monorepo/actions/runs/39205289113','archive_sha256':{n:r['archive_sha256'] for n,r in reports.items()},'sessions':4,'saved_frames_per_session':61,'total_saved_frames':244,'all_four_raw_trajectories_identical':all(h==all_hashes[0] for h in all_hashes),'identical_frames_across_all_four_sessions':sum(len({h[i] for h in all_hashes})==1 for i in range(61)),'all_input_reference_checks_passed':all(r['identical_native_input_bytes'] and r['original_soft_reference_inputs_identical'] for r in reports.values()),'within_profile_identical_raw_frames':{n:r['identical_raw_frames'] for n,r in reports.items()},'cross_profile_first_session_trajectory':trajectory_comparison(frames['one'],frames['four']),'recorded_native_executable_sha256':{n:r['research_patch']['recorded_native_executable_sha256'] for n,r in reports.items()},'limits':['Four sessions of one prepared garment/material over one second under two requested environments only.','Separate hosts and one pair/profile do not establish causal thread effects or population tolerances.','Raw saved-frame equality does not establish continuous contact, sustained settling, physical fit or calibrated material response.','Executable hashes are recorded CI digests; replay does not independently rebuild executables.']}
print(json.dumps(comparison,indent=2,allow_nan=False))
