from pathlib import Path
import json,gzip,lzma,hashlib,shutil,subprocess
import argparse
a=argparse.ArgumentParser();a.add_argument('output',type=Path);a.add_argument('--chromium',required=True);args=a.parse_args()
r=Path(__file__).resolve().parents[4];out=Path(__file__).resolve().parent;src=args.output
h=lambda x:hashlib.sha256(x).hexdigest()
found={}
for p in src.rglob('receipt.json'):
 d=json.loads(p.read_text());k=(d['pair'],d['mode']);assert k not in found;found[k]=(p,d)
assert len(found)==12
m={'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=r,text=True).strip(),'melodyTree':subprocess.check_output(['git','rev-parse','HEAD:apps/melody-studio'],cwd=r,text=True).strip(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'chromium':subprocess.check_output([args.chromium,'--version'],text=True).strip(),'playwright':json.loads((r/'apps/melody-studio/node_modules/@playwright/test/package.json').read_text())['version'],'workers':1,'probeSha256':h((out/'probe.spec.ts').read_bytes()),'patchSha256':h((out/'observer.patch').read_bytes()),'rows':[]}
for pair in range(6):
 for mode in (['on','off'] if pair%2==0 else ['off','on']):
  p,d=found[pair,mode];name=f'{pair:02}-{mode}';raw=p.read_bytes();(out/(name+'.json')).write_bytes(raw)
  row={'pair':pair,'mode':mode,'route':'normal','receipt':name+'.json','receiptSha256':h(raw),'native':None,'normalized':None}
  for key,file,kind in [('native','native.f32le.gz','f32le.xz'),('normalized','normalized.s16le.gz','s16le.gz')]:
   source=p.parent/file
   if source.exists():
    b=gzip.decompress(source.read_bytes());dest=out/(name+'-'+kind);dest.write_bytes(lzma.compress(b,preset=6) if key=='native' else source.read_bytes());row[key]={'file':dest.name,'bytes':len(b),'sha256':h(b)}
  m['rows'].append(row)
m['cohort']='B: separate recollection after lost first observer-control artifacts'
m['primitivesSha256']=h((out.parent/'output-route'/'verify_output_route.py').read_bytes())
(out/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
print(json.dumps([{'pair':d['pair'],'mode':d['mode'],'error':d['error'],'qualityError':d['qualityError'],'startup':d['observed']['startup']} for _,d in found.values()],indent=2))
