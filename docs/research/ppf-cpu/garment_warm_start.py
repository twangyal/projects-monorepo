"""Frozen browser body-growth endpoint mapped without new native rest/material data."""
import copy,gzip,hashlib,json,math
from garment_admission import require
from garment_native_inputs import load_inputs

ARCHIVE_SHA256='4a099ec5510d177c16ec54cd3ed23ac4cdd0c9d85d56409840f307b6497f3504'
EXTRA_SOURCE={'src/native-garment-warm-start.ts': '2ded72f5b8482b31f3d264e2184e6d3b671922c78e11440beebf5f0cd13c79d8', 'scripts/export-native-warm-start.ts': 'a4b40fe7426efa79ce5a2585f812bf1395e09612316bd6d83daaefbc040f5a00'}

def load_warm_start(root):
 raw=(root/'garment-warm-start.json.gz').read_bytes()
 require(hashlib.sha256(raw).hexdigest()==ARCHIVE_SHA256,'Changed warm-start capture.')
 return json.loads(gzip.decompress(raw))

def prepare(original,warm,root):
 require(original==load_inputs(root),'Changed original native mapping.')
 cold=json.loads(gzip.decompress((root/'garment-first.json.gz').read_bytes()))
 packet=warm.get('packet',{})
 require(warm.get('fixture')=='blank-tee-94cm-body-growth45-v1','Unexpected warm-start fixture.')
 require(warm.get('source_sha256')=={**cold['source_sha256'],**EXTRA_SOURCE},'Changed preparation source provenance.')
 require(packet.get('schema')=='clothing-native-garment-warm-start-v1' and packet.get('source_packet')==cold['packet'],'Changed source rest/material/body/seam packet.')
 expected={'method':'existing-browser-body-growth-endpoint','frames':45,'gravity_frames':0,'substeps':10,'velocity_handoff':'reset-to-zero-for-native-experiment'}
 require(packet.get('preparation')==expected,'Changed growth preparation controls.')
 values=packet.get('positions_m');require(isinstance(values,list) and len(values)==len(cold['packet']['positions_m']) and all(type(v) in [int,float] and math.isfinite(v) for v in values),'Incomplete/nonfinite warm-start positions.')
 candidate=json.loads(gzip.decompress((root/'garment-rest-candidate.json.gz').read_bytes()))
 result=copy.deepcopy(original)
 for authored,solved in enumerate(original['authored_to_solved']):
  source=candidate['source_particles'][authored];result['initial'][solved]=values[source*3:source*3+3]
 strain=0.
 for constraint in cold['packet']['constraints']:
  if constraint['kind']!='structural':continue
  i,j=constraint['particles'];strain=max(strain,abs(math.dist(values[i*3:i*3+3],values[j*3:j*3+3])/constraint['rest_m']-1.))
 require(strain<.5,'Warm-start distortion admission exceeded50%.')
 return result,{'capture_sha256':ARCHIVE_SHA256,'source_sha256':warm['source_sha256'],'growth_frames':45,'gravity_frames':0,'prepared_source_particles':len(values)//3,'maximum_absolute_edge_strain':strain,'reported_browser_metrics':packet['metrics'],'velocity_handoff':'reset-to-zero-for-native-experiment','scope':'Browser geometric preconditioning, not settled/native-contact/physical-fit acceptance.'}
