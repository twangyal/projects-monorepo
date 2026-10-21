"""Strict paired startup-control replay; geometric differences are not physical fit."""
import argparse,hashlib,io,json,zipfile
from pathlib import Path
from garment_admission import require
from garment_archive_storage import read_archive
from garment_fixed_material_audit import audit
from garment_gravity_comparison import host_evidence

def pair_inputs(reference,smoothed):
 prefix='native-cache/sessions/cpu-garment-soft/session/'
 def read(path):
  with zipfile.ZipFile(io.BytesIO(read_archive(path))) as z:
   return ({n[len(prefix+'bin/'):]:z.read(n) for n in z.namelist() if n.startswith(prefix+'bin/')},z.read(prefix+'info.toml'),z.read(prefix+'param.toml'),z.read('native-binary-sha256.txt'))
 a,b=read(reference),read(smoothed)
 require(a[0] and set(a[0])==set(b[0]),'Preparation pair changed native input namespace.')
 changed=sorted(k for k in a[0] if a[0][k]!=b[0][k])
 require(changed==['param/tri-density.bin','vert.bin'],'Preparation pair differs beyond declared initial geometry/captured-inertia coefficients.')
 require(a[1:3]==b[1:3],'Preparation pair changed scene/session metadata.')
 require(a[3]==b[3],'Different recorded executable digests confound preparation pair.')
 return {'native_input_arrays':len(a[0]),'changed_native_arrays':changed,'identical_scene_and_session_metadata':True,'recorded_native_executable_sha256':a[3].decode().split()[0],'native_input_sha256':{mode:{k:hashlib.sha256(v).hexdigest() for k,v in bins.items()} for mode,bins in [('reference',a[0]),('smoothed',b[0])]}}

def compare(reference,smoothed):
 first=audit(reference,profile='reference',protocol='preparation');second=audit(smoothed,profile='smoothed',protocol='preparation')
 return {'schema':1,'experiment':'fixed-soft-startup-preparation-pair-v1','input_comparison':pair_inputs(reference,smoothed),'host_evidence':{'reference':host_evidence(reference),'smoothed':host_evidence(smoothed)},'reference':first,'smoothed':second,'limits':['One fixed garment/control pair; separate hosts and matching executable records do not establish precise causal effects or hardware equivalence.','Lower initial geometric strain does not establish improved final construction, settling, calibrated fabric or physical fit.','Effective density changes recover the same captured source-quotient inertia under changed initial areas; native2353DOFs are not dynamically identical to browser2331classes.','Replay does not independently rebuild or execute the native binary.']}

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('reference',type=Path);p.add_argument('smoothed',type=Path);a=p.parse_args();print(json.dumps(compare(a.reference,a.smoothed),indent=2,allow_nan=False))
