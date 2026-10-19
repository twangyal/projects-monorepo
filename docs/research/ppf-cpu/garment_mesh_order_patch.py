"""Apply one exact research-only native mesh-order patch; refuse other source."""
import argparse,hashlib,json,difflib
from pathlib import Path
from garment_admission import require
BASE_SHA256='17361cfee9af9f686b9c929fc59db4ec014412fccd3409a51b0298c1daef490f'
PATCHED_SHA256='29ba8fa8ef9e45a4ba8c323d644aed557939afab1f0d74bbb4bc8aa93f89be50'
PATCH_SHA256='b816533c4ff05fda40f32ae9c223aa1212b184a691c0ea0244526f8bb1caaafa'
SOURCE_PATH='crates/ppf-cts-solver/src/mesh.rs'
def apply(upstream,out):
 source=upstream/SOURCE_PATH;before=source.read_bytes()
 require(hashlib.sha256(before).hexdigest()==BASE_SHA256,'Unexpected pinned mesh source; no patch applied.')
 require(before.count(b'HashMap')==3,'Unexpected map declarations.')
 after=before.replace(b'HashMap',b'BTreeMap')
 require(hashlib.sha256(after).hexdigest()==PATCHED_SHA256,'Unexpected patched source.')
 patch=Path(__file__).with_name('patches').joinpath('canonical_mesh_order.patch').read_bytes()
 require(hashlib.sha256(patch).hexdigest()==PATCH_SHA256,'Changed research patch.')
 generated=''.join(difflib.unified_diff(before.decode().splitlines(keepends=True),after.decode().splitlines(keepends=True),fromfile='a/'+SOURCE_PATH,tofile='b/'+SOURCE_PATH,n=0)).encode()
 require(generated==patch,'Patch does not describe exact transformation.')
 receipt={'schema':1,'experiment':'canonical-derived-mesh-order-v1','upstream_revision':'6b30976f86e6b94d68d459e5237d59704c7d1384','source_path':SOURCE_PATH,'base_mesh_sha256':BASE_SHA256,'patched_mesh_sha256':PATCHED_SHA256,'patch_sha256':PATCH_SHA256,'scope':'Research-only ordered edge/hinge maps. Changes derived element/accumulation order; no physical equivalence, broad determinism or backend adoption acceptance.'}
 out.mkdir(parents=True,exist_ok=True);(out/'canonical_mesh_order.patch').write_bytes(patch);(out/'base-mesh.rs').write_bytes(before);(out/'patched-mesh.rs').write_bytes(after);(out/'research-patch.json').write_text(json.dumps(receipt,indent=2)+'\n');source.write_bytes(after)
 return receipt
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--upstream',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();apply(a.upstream,a.out)
