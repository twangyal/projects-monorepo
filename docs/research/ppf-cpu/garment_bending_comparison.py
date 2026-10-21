"""Strict fixed-garment bending pair; an isolation control, not calibrated fit."""
import argparse,hashlib,io,json,zipfile
from pathlib import Path
from garment_admission import require
from garment_archive_storage import read_archive
from garment_fixed_material_audit import audit
from garment_gravity_comparison import host_evidence
from garment_preparation_comparison import pair_trajectory

def pair_inputs(reference,zero):
 prefix='native-cache/sessions/cpu-garment-soft/session/'
 def read(path):
  with zipfile.ZipFile(io.BytesIO(read_archive(path))) as z:
   return ({n[len(prefix+'bin/'):]:z.read(n) for n in z.namelist() if n.startswith(prefix+'bin/')},z.read(prefix+'info.toml'),z.read(prefix+'param.toml'),z.read('native-binary-sha256.txt'))
 a,b=read(reference),read(zero)
 require(a[0] and set(a[0])==set(b[0]),'Bending pair changed native input namespace.')
 changed=sorted(k for k in a[0] if a[0][k]!=b[0][k])
 require(changed==['param/tri-bend.bin'],'Bending pair differs beyond the declared bending coefficient.')
 require(a[1:3]==b[1:3],'Bending pair changed scene/session metadata.')
 require(a[3]==b[3],'Bending pair has different recorded executable digests.')
 return {'native_input_arrays':len(a[0]),'changed_native_arrays':changed,'identical_scene_and_session_metadata':True,'recorded_native_executable_sha256':a[3].decode().split()[0],'native_input_sha256':{mode:{k:hashlib.sha256(v).hexdigest() for k,v in bins.items()} for mode,bins in [('reference',a[0]),('zero',b[0])]}}

def compare(reference,zero):
 a=audit(reference,profile='reference',protocol='bending');b=audit(zero,profile='zero',protocol='bending')
 return {'schema':1,'experiment':'fixed-soft-bending-only-pair-v1','input_comparison':pair_inputs(reference,zero),'saved_trajectory_difference':pair_trajectory(reference,zero),'host_evidence':{'reference':host_evidence(reference),'zero':host_evidence(zero)},'reference':a,'zero':b,'limits':['One fixed prepared garment pair; separate hosts and matching recorded executables do not establish precise causal effects or hardware equivalence.','Zero bending isolates a constitutive component; it is not calibrated fabric, a construction correction or a proposed production preset.','Bending sensitivity or persistence does not isolate a unique source-construction, contact, initial-pose or physical-fit cause.','Saved endpoints and motion windows are not sustained settling, continuous-time contact or broad garment/body acceptance.','Replay does not independently rebuild or execute the native binary.']}
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('reference',type=Path);p.add_argument('zero',type=Path);a=p.parse_args();print(json.dumps(compare(a.reference,a.zero),indent=2,allow_nan=False))
