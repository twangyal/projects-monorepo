"""Require a gravity-only native pair before comparing its endpoint diagnostics."""
import argparse,hashlib,io,json,zipfile
from pathlib import Path
from garment_admission import require
from garment_archive_storage import read_archive
from garment_fixed_material_audit import audit

def pair_inputs(reference,zero):
 """Compare retained physical arrays, exact sidecars and recorded executable digest."""
 prefix='native-cache/sessions/cpu-garment-soft/session/'
 def read(path):
  with zipfile.ZipFile(io.BytesIO(read_archive(path))) as z:
   return ({n[len(prefix+'bin/'):]:z.read(n) for n in z.namelist() if n.startswith(prefix+'bin/')},z.read(prefix+'info.toml'),z.read(prefix+'param.toml'),z.read('native-binary-sha256.txt'))
 a,b=read(reference),read(zero)
 require(a[0] and a[0]==b[0],'Gravity pair changed native input arrays.')
 require(a[1]==b[1],'Gravity pair changed native scene metadata.')
 require(a[2].count(b'-9.8')==1 and a[2].replace(b'-9.8',b'0.0')==b[2],'Gravity pair differs beyond declared gravity.')
 require(a[3]==b[3],'Gravity pair has different recorded native executable digests; comparison is confounded.')
 return {'identical_native_input_arrays':len(a[0]),'session_metadata_only_gravity_differs':True,'recorded_native_executable_sha256':a[3].decode().split()[0],'native_input_sha256':{k:hashlib.sha256(v).hexdigest() for k,v in a[0].items()}}

def host_evidence(path):
 with zipfile.ZipFile(io.BytesIO(read_archive(path))) as z:
  cpu=z.read('cpu.txt')
  return {'cpu_model_names':[line.split(':',1)[1].strip() for line in cpu.decode().splitlines() if line.strip().startswith('Model name:')],'cpu_inventory_sha256':hashlib.sha256(cpu).hexdigest(),'environment_sha256':hashlib.sha256(z.read('environment.txt')).hexdigest(),'python_dependencies_sha256':hashlib.sha256(z.read('pip-freeze.txt')).hexdigest()}

def compare(reference,zero):
 a=audit(reference,profile='reference',protocol='gravity');b=audit(zero,profile='zero',protocol='gravity')
 inputs=pair_inputs(reference,zero)
 return {'schema':1,'experiment':'fixed-soft-gravity-only-pair-v1','input_comparison':inputs,'host_evidence':{'reference':host_evidence(reference),'zero':host_evidence(zero)},'reference':a,'zero':b,'limits':['One native pair on one prepared tee. Zero-gravity persistence does not distinguish construction, bending, contact or initialization.','Recorded executable digests match; replay does not independently rebuild or execute the native binary.','Jobs ran on separate CI hosts; matching executable records do not establish hardware equivalence or causal effect sizes.','No sustained settling, calibrated fabric, physical fit, representative coverage or backend adoption acceptance.']}

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('reference',type=Path);p.add_argument('zero',type=Path);a=p.parse_args();print(json.dumps(compare(a.reference,a.zero),indent=2,allow_nan=False))
