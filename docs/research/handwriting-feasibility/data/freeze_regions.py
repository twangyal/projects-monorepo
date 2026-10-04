"""Deterministic source-annotation crops and literal references, without OCR."""
import hashlib
import json
from pathlib import Path
from xml.etree import ElementTree

from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parent
NS={'a':'http://www.loc.gov/standards/alto/ns-v4#'}
selection=json.loads((ROOT/'selection-before-ocr.json').read_text())
retrieval=json.loads((ROOT/'retrieval-manifest.json').read_text())
rows=[]
for split,page_ids in selection['splits'].items():
    for page_id in page_ids:
        image_path=ROOT/f'{page_id}.jpg'
        image=Image.open(image_path)
        image.load()
        xml=ElementTree.fromstring((ROOT/f'{page_id}.xml').read_bytes())
        page=xml.find('.//a:Page',NS)
        assert image.size==(int(page.attrib['WIDTH']),int(page.attrib['HEIGHT']))
        tags={node.attrib['ID']:node.attrib['LABEL'] for node in xml.findall('.//a:Tags/*',NS)}
        lines=[line for block in xml.findall('.//a:TextBlock',NS) if tags.get(block.attrib.get('TAGREFS'))=='MainZone' for line in block.findall('./a:TextLine',NS)]
        assert len(lines)>=6
        for index,line in enumerate(lines[:6]):
            strings=line.findall('./a:String',NS)
            assert len(strings)==1, 'Corpus line must have one literal CONTENT string; no guessed spacing'
            text=strings[0].attrib['CONTENT']
            x,y,width,height=[int(line.attrib[key]) for key in ['HPOS','VPOS','WIDTH','HEIGHT']]
            assert 0<=x<x+width<=image.width and 0<=y<y+height<=image.height
            bbox=[x,y,x+width,y+height]
            name=f'{page_id}-line-{index+1:02d}.png'
            crop=image.crop(bbox).convert('RGB')
            path=ROOT/name
            if path.exists(): raise ValueError('Refusing to overwrite previously frozen crop')
            crop.save(path,format='PNG',compress_level=6)
            rows.append({'id':f'{page_id}:line-{index+1:02d}','writerId':selection['writerId'],'pageId':page_id,'split':split,'lineId':line.attrib['ID'],'sourceImage':image_path.name,'sourceImageSha256':hashlib.sha256(image_path.read_bytes()).hexdigest(),'sourceAlto':f'{page_id}.xml','sourceAltoSha256':hashlib.sha256((ROOT/f'{page_id}.xml').read_bytes()).hexdigest(),'bbox':bbox,'crop':name,'cropWidth':width,'cropHeight':height,'cropSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'transcript':text,'referenceSha256':hashlib.sha256(text.encode('utf8')).hexdigest(),'referenceSource':'Literal existing ALTO CONTENT; no OCR-generated or model-corrected reference.','editorialMarkersPresent':any(char in text for char in '<>^_[]')})
        image.close()
manifest={'schemaVersion':1,'status':'frozen-before-OCR','dataset':'CREMMA-MSS-19','repository':retrieval['repository'],'commit':retrieval['commit'],'license':'CC-BY-4.0','licenseEvidence':['LICENSE','htr-united.yml'],'attribution':'HTR-United CREMMA: Thibault Clérice, Alix Chagué, Baudouin Davoury, Soline Doat, Margaux Faure, Maxime Humeau. Original archives and corpus contributions as identified in the retained source files.','modifications':'Selected first five page IDs of a fixed folder; first six MainZone lines per page; rectangular annotation crops saved as PNG, no resize/deskew/enhancement and no recognizer. Original JPEG and ALTO retained unchanged.','selection':selection,'preprocessing':'Pillow12.3.0 native JPEG decode; no EXIF orientation transform; full dimensions checked against ALTO; exact annotated rectangle crop; RGB PNG output. Later recognizer resizing must be separately frozen.','limitations':['Historical French cursive scans; not modern English notes or smartphone photographs.','Dataset metadata asserts one hand per folder; historical author identity is not independently authenticated.','These scans are pages from one letter/document, so page-level separation is intended for within-document writer correction, not independent-document or novel-language generalization.','Known ALTO line segmentation is supplied; this cannot establish automatic full-page segmentation accuracy.','Ground truth is a human-attributed dataset transcription, not certified error-free; original spelling, abbreviations, punctuation and editorial markup are retained literally.','Two source lines contain explicit editorial transcription markers; fair scoring requires a frozen declared diplomatic/plain-reading policy or separate marked-line diagnostics before recognition.','No model weights, predictions, OCR outputs or learned corrections were used in sample choice or references.','No knowledge of base-model pretraining overlap beyond its eventual published model card; dataset identity must remain disclosed.'],'rows':rows}
with (ROOT/'frozen-manifest.json').open('x') as stream: stream.write(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
# Model-free human audit contact sheet: all fixed crops with literal references.
canvas=Image.new('RGB',(1100,len(rows)*125),(255,255,255))
draw=ImageDraw.Draw(canvas)
for i,row in enumerate(rows):
    draw.text((8,i*125+4),f"{row['split']} {row['id']} | {row['transcript']}",fill=(0,0,0))
    crop=Image.open(ROOT/row['crop']); crop.thumbnail((1040,90)); canvas.paste(crop,(25,i*125+27)); crop.close()
canvas.save(ROOT/'model-free-reference-contact-sheet.png')
print(json.dumps({'rows':len(rows),'splits':{key:sum(r['split']==key for r in rows) for key in selection['splits']},'editorialRows':[r['id'] for r in rows if r['editorialMarkersPresent']],'manifestSha256':hashlib.sha256((ROOT/'frozen-manifest.json').read_bytes()).hexdigest(),'retrievedSourceBytes':sum(r['bytes'] for r in retrieval['files']),'cropBytes':sum((ROOT/r['crop']).stat().st_size for r in rows)}))
