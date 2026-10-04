"""Model-free, a-priori bounded corpus retrieval and literal ALTO admission."""
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen
from xml.etree import ElementTree

ROOT=Path(__file__).resolve().parent
COMMIT='d8f466de72561cd989f957d75a6743c5d8f0a262'
BASE=f'https://raw.githubusercontent.com/HTR-United/CREMMA-MSS-19/{COMMIT}/'
SELECTION={'schemaVersion':1,'selectedBeforeAnyOCR':True,'selectionRule':'Fixed primary corpus folder lettre-boudreau-tessier; first five lexicographic page IDs 001..005 before inspecting recognition outputs. Select the first six ALTO manuscript-body lines in source reading order once region tags have been confirmed; never filter by OCR results.','writerId':'cremma19:lettre-boudreau-tessier','writerAttribution':'Dataset declares exactly one hand per folder; personal author name is not independently authenticated.','language':'fra','scope':'Historical French cursive manuscript scans; not modern English notes, phone-camera robustness, or writer-independent generalization.','splits':{'correction':['01R_P1S3SS1P019_001','01R_P1S3SS1P019_002'],'development':['01R_P1S3SS1P019_003'],'evaluation':['01R_P1S3SS1P019_004','01R_P1S3SS1P019_005']},'overlapPolicy':'All rows/crops of each source scan remain in its page-grouped split. No duplicate/cross-page augmentation.','commit':COMMIT}
selection=ROOT/'selection-before-ocr.json'
if not selection.exists(): selection.write_text(json.dumps(SELECTION,ensure_ascii=False,indent=2)+'\n')

def download(relative, destination, cap):
    if destination.exists(): return destination.read_bytes()
    with urlopen(Request(BASE+relative,headers={'User-Agent':'handwriting-feasibility/1.0'}),timeout=20) as response:
        data=response.read(cap+1)
    if len(data)>cap: raise ValueError('Corpus member exceeds declared retrieval bound')
    with destination.open('xb') as out: out.write(data)
    return data

files=[]
for name in ['LICENSE','README.md','htr-united.yml']:
    data=download(name,ROOT/name,100000)
    files.append({'path':name,'url':BASE+name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'purpose':'Primary dataset license/metadata; not model code license.'})
for number in range(1,6):
    stem=f'01R_P1S3SS1P019_{number:03d}'
    for suffix,cap in [('xml',100000),('jpg',400000)]:
        relative=f'data/lettre-boudreau-tessier/{stem}.{suffix}'
        data=download(relative,ROOT/f'{stem}.{suffix}',cap)
        files.append({'path':f'{stem}.{suffix}','url':BASE+relative,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'pageId':stem})
    root=ElementTree.fromstring((ROOT/f'{stem}.xml').read_bytes())
    ns={'a':'http://www.loc.gov/standards/alto/ns-v4#'}
    print(stem,'tags',[(e.tag.split('}')[-1],e.attrib) for e in root.findall('.//a:Tags/*',ns)])
    print('blocks',[(e.attrib.get('ID'),e.attrib.get('TAGREFS'),len(e.findall('./a:TextLine',ns))) for e in root.findall('.//a:TextBlock',ns)])
    print('first lines',[(e.attrib.get('ID'),' '.join(x.attrib.get('CONTENT','') for x in e.findall('./a:String',ns))) for e in root.findall('.//a:TextLine',ns)[:3]])
(ROOT/'retrieval-manifest.json').write_text(json.dumps({'repository':'https://github.com/HTR-United/CREMMA-MSS-19','commit':COMMIT,'license':'CC-BY-4.0','licenseScope':'Corpus-level htr-united.yml names CC-BY4.0; repository LICENSE is CC-BY4.0; includes original JPEG+ALTO rather than relying on unrelated repository code license.','files':files},indent=2)+'\n')
