"""Verify declared research mesh patch provenance without executing archive code."""
import hashlib,json,re
from garment_admission import require
from garment_mesh_order_patch import BASE_SHA256,PATCHED_SHA256,PATCH_SHA256,SOURCE_PATH

def replay_diff(before,diff):
 lines=diff.decode().splitlines(keepends=True);base=before.decode().splitlines(keepends=True)
 require(len(lines)>=5 and lines[0]==f'diff --git a/{SOURCE_PATH} b/{SOURCE_PATH}\n' and lines[1].startswith('index ') and lines[2]=='--- a/'+SOURCE_PATH+'\n' and lines[3]=='+++ b/'+SOURCE_PATH+'\n','Unexpected research diff header/path.')
 output=[];cursor=0;i=4
 while i<len(lines):
  match=re.fullmatch(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\n]*\n',lines[i]);require(match is not None,'Unexpected research diff hunk.')
  old_start,old_count,new_start,new_count=match.groups();start=int(old_start)-1;old_count=int(old_count or 1);new_count=int(new_count or 1)
  require(cursor<=start<=len(base),'Overlapping/out-of-bounds source hunk.');output.extend(base[cursor:start]);cursor=start
  require(len(output)==int(new_start)-1,'Changed new-source hunk coordinates.');i+=1;removed=added=0
  while i<len(lines) and not lines[i].startswith('@@ '):
   line=lines[i];require(line and line[0] in ' +-','Unexpected diff instruction.')
   if line[0] in ' -':require(cursor<len(base) and base[cursor]==line[1:],'Diff does not match base source.');cursor+=1;removed+=1
   if line[0] in ' +':output.append(line[1:]);added+=1
   i+=1
  require((removed,added)==(old_count,new_count),'Changed diff hunk lengths.')
 output.extend(base[cursor:]);return ''.join(output).encode()

def verify_research_patch(z):
 require({'research-patch.json','base-mesh.rs','patched-mesh.rs','canonical_mesh_order.patch','upstream-research.diff','native-binary-sha256.txt'}<=set(z.namelist()),'Missing research patch provenance.')
 r=json.loads(z.read('research-patch.json'))
 expected={'schema':1,'experiment':'canonical-derived-mesh-order-v1','upstream_revision':'6b30976f86e6b94d68d459e5237d59704c7d1384','source_path':SOURCE_PATH,'base_mesh_sha256':BASE_SHA256,'patched_mesh_sha256':PATCHED_SHA256,'patch_sha256':PATCH_SHA256,'scope':'Research-only ordered edge/hinge maps. Changes derived element/accumulation order; no physical equivalence, broad determinism or backend adoption acceptance.'}
 require(r==expected,'Changed research patch receipt.')
 for name,digest in [('base-mesh.rs',BASE_SHA256),('patched-mesh.rs',PATCHED_SHA256),('canonical_mesh_order.patch',PATCH_SHA256)]:require(hashlib.sha256(z.read(name)).hexdigest()==digest,'Changed research source/patch bytes: '+name)
 require(replay_diff(z.read('base-mesh.rs'),z.read('upstream-research.diff'))==z.read('patched-mesh.rs'),'Upstream diff differs from exact declared patch.')
 binary=z.read('native-binary-sha256.txt').decode().strip()
 require(re.fullmatch(r'[0-9a-f]{64}  /home/runner/work/projects-monorepo/projects-monorepo/upstream/target/cpu/release/ppf-contact-solver',binary) is not None,'Missing/malformed built executable digest.')
 return {**r,'recorded_native_executable_sha256':binary.split()[0],'scope_of_executable_digest':'Recorded CI executable digest; executable bytes are not retained or independently rebuilt by replay.'}
