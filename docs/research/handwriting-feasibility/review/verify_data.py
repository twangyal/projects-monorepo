"""Independent local integrity/alignment review; no network, OCR or data writes."""
from pathlib import Path
import hashlib
import json
import sys
from collections import Counter
import xml.etree.ElementTree as ET
import numpy as np
from PIL import Image

ROOT = Path(sys.argv[1]) if len(sys.argv) == 2 else Path(__file__).resolve().parent.parent / 'data'
if len(sys.argv) > 2:
    raise SystemExit('Usage: verify_data.py [prepared-data-directory]')
sha = lambda b: hashlib.sha256(b).hexdigest()
manifest_bytes = (ROOT / 'frozen-manifest.json').read_bytes()
assert sha(manifest_bytes) == '69b8553577f2e0446305efe1f03125f42c3ae5fe8e6b3ea79a8a033e22f5dbbe'
m = json.loads(manifest_bytes)
r = json.loads((ROOT / 'retrieval-manifest.json').read_text())
assert r['commit'] == m['commit'] == 'd8f466de72561cd989f957d75a6743c5d8f0a262'
for f in r['files']:
    b = (ROOT / f['path']).read_bytes()
    assert len(b) == f['bytes'] and sha(b) == f['sha256'], f['path']
    assert f"/{m['commit']}/" in f['url']
    assert f['url'].startswith('https://raw.githubusercontent.com/HTR-United/CREMMA-MSS-19/')
ns = {'a': 'http://www.loc.gov/standards/alto/ns-v4#'}
expected_pages = [f'01R_P1S3SS1P019_{i:03}' for i in range(1, 6)]
expected_splits = dict(zip(expected_pages, ['correction', 'correction', 'development', 'evaluation', 'evaluation']))
assert len(m['rows']) == 30
assert len({x['id'] for x in m['rows']}) == 30
assert len({x['cropSha256'] for x in m['rows']}) == 30
assert sorted({x['pageId'] for x in m['rows']}) == expected_pages
pixel_values = 0
pages = []
for page in expected_pages:
    tree = ET.parse(ROOT / (page + '.xml'))
    assert tree.find('.//a:MeasurementUnit', ns).text == 'pixel'
    assert tree.find('.//a:fileName', ns).text == page + '.jpg'
    tags = {e.attrib['ID'] for e in tree.findall('.//a:OtherTag', ns) if e.attrib['LABEL'] == 'MainZone'}
    lines = [line for block in tree.findall('.//a:TextBlock', ns) if tags.intersection(block.attrib.get('TAGREFS', '').split()) for line in block.findall('a:TextLine', ns)][:6]
    selected = [row for row in m['rows'] if row['pageId'] == page]
    assert [x['lineId'] for x in selected] == [x.attrib['ID'] for x in lines]
    with Image.open(ROOT / (page + '.jpg')) as img:
        assert img.getexif().get(274, 1) == 1
        full = np.asarray(img.convert('RGB'))
    dim = tree.find('.//a:Page', ns).attrib
    assert full.shape == (int(dim['HEIGHT']), int(dim['WIDTH']), 3)
    for index, (row, line) in enumerate(zip(selected, lines), 1):
        assert row['id'] == f'{page}:line-{index:02}'
        assert row['split'] == expected_splits[page]
        assert row['writerId'] == 'cremma19:lettre-boudreau-tessier'
        strings = line.findall('a:String', ns)
        assert len(strings) == 1
        transcript = strings[0].attrib['CONTENT']
        assert row['transcript'] == transcript
        assert row['referenceSha256'] == sha(transcript.encode('utf-8'))
        x, y, w, h = [int(line.attrib[k]) for k in ('HPOS', 'VPOS', 'WIDTH', 'HEIGHT')]
        assert row['bbox'] == [x, y, x+w, y+h]
        assert 0 <= x < x+w <= full.shape[1] and 0 <= y < y+h <= full.shape[0]
        assert (row['cropWidth'], row['cropHeight']) == (w, h)
        for name, key in [('sourceImage', 'sourceImageSha256'), ('sourceAlto', 'sourceAltoSha256'), ('crop', 'cropSha256')]:
            assert sha((ROOT / row[name]).read_bytes()) == row[key]
        with Image.open(ROOT / row['crop']) as crop:
            assert crop.mode == 'RGB'
            pixels = np.asarray(crop)
        assert np.array_equal(pixels, full[y:y+h, x:x+w, :]), row['id']
        pixel_values += pixels.size
    pages.append({'pageId': page, 'split': expected_splits[page], 'sourceShape': list(full.shape), 'lines': len(lines)})
marked = [x['id'] for x in m['rows'] if x['editorialMarkersPresent']]
assert marked == ['01R_P1S3SS1P019_002:line-02', '01R_P1S3SS1P019_003:line-02']
result = {'status': 'data-available-runtime-blocked-no-OCR', 'manifestSha256': sha(manifest_bytes), 'primaryFilesHashAndLengthVerified': len(r['files']), 'rows': len(m['rows']), 'splits': dict(Counter(x['split'] for x in m['rows'])), 'allLiteralALTOReferencesExact': True, 'allFirstSixMainZoneLinesExact': True, 'allCropPixelsEqualIndependentArraySlices': True, 'rgbChannelValuesCompared': pixel_values, 'uniqueCropHashes': 30, 'editorialRows': marked, 'pages': pages, 'inferencePerformed': False, 'sourceNetworkRefetchPerformed': False}
print(json.dumps(result, indent=2))
