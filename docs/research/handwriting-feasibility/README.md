# Personal handwriting feasibility — issue #82

**Data available; recognition runtime blocked.** This archive preserves source identities, literal annotations, reproducible preparation and the actual blocker for [issue #82](https://github.com/twangyal/projects-monorepo/issues/82). No recognizer ran, no personal model was fitted, and no application or recognition-quality result is claimed.

## Admitted handwriting

Five original JPEG/ALTO page pairs and thirty line crops come from [HTR-United/CREMMA-MSS-19](https://github.com/HTR-United/CREMMA-MSS-19/tree/d8f466de72561cd989f957d75a6743c5d8f0a262), folder `data/lettre-boudreau-tessier`. The publisher explicitly licenses the corpus [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); the original license, attribution metadata and byte-exact ALTO annotations are retained in `data/`. Source JPEGs, derived PNGs and the contact sheet were acquired and independently verified locally; they are not committed. Automatic upload approval rejected an image payload as unverified/potentially sensitive, so this text-only archive retains reproducible provenance without publishing image payloads. The verified local copies remain available in the current workspace.

Attribution: **Thibault Clérice, Alix Chagué, Baudouin Davoury, Soline Doat, Margaux Faure and Maxime Humeau**, HTR-United / CREMMA. Original archive/source identities remain in the supplied files. Modifications: choose the first five page IDs and first six annotated manuscript-body lines per page; decode JPEG, crop the exact annotated rectangles and save RGB PNGs without resizing, deskewing or enhancement. A separate contact sheet resizes previews for inspection. Original spelling, punctuation and editorial marks remain literal.

The selection was frozen before any OCR. Pages 001/002 supply twelve correction lines, page 003 six development lines, and pages 004/005 twelve evaluation lines. Manifest SHA256: `69b8553577f2e0446305efe1f03125f42c3ae5fe8e6b3ea79a8a033e22f5dbbe`.

Independent verification matched thirteen primary file hashes, all thirty references and crop hashes, and **6,379,023 RGB values** against independent source-array slices. All crops are unique and whole pages stay within one split. See [review](review/independent-review.md), [machine-readable result](review/data-verification.json) and [selection](data/selection-before-ocr.json).

These are historical French scans of **one 1824 letter**, with one publisher-declared hand and supplied line segmentation. They do not establish modern English, phone-photo, independent-document or writer-independent performance. Two lines contain editorial markup; a scoring policy and any word boxes must be frozen before predictions. Dataset transcriptions are human-attributed references, not certified error-free text. Baseline pretraining overlap is unknown.

## Actual runtime blocker

The official TrOCR model-card request was denied by the current environment proxy (`CONNECT` HTTP 403; curl exit 56). The environment reported enforced restricted package-manager egress, revision 42. The denial was not retried or routed around. Linked original Azure and SimpleHTR Dropbox checkpoints were not requested. Official UniLM releases contained no TrOCR checkpoint. One bounded primary-source French alternative search found generator weights, not the referenced recognizer.

No lawful, checksummed recognition checkpoint was admitted. Source-code licensing is retained separately and does not prove model-weight licensing. A private CPU dependency import succeeded in 6.838 seconds with 356,464 KiB peak RSS; **this is not inference time, inference memory, recognition accuracy or adaptation evidence**. No images were read by that check. See [runtime receipt](runtime/blocked-report.json), [exact commands](runtime/commands.md), and [bounded alternative search](runtime/french-primary-search.json). Environments, package caches and downloaded research catalogs are excluded from this archive.

## Acquire once, then verify offline

With Python 3.12 and the pinned NumPy/Pillow dependencies from `review/requirements.txt` installed in a private environment, make a separate working copy of `data/`. Its acquisition script downloads only the five pinned original public JPEGs (at most 400,000 bytes each), retaining existing annotations/license. To regenerate crops without overwriting the frozen manifest, preserve the original receipt before running the crop script:

```sh
cp -R docs/research/handwriting-feasibility/data /tmp/handwriting-data
python /tmp/handwriting-data/prepare_selection.py
mv /tmp/handwriting-data/frozen-manifest.json /tmp/handwriting-data/expected-frozen-manifest.json
python /tmp/handwriting-data/freeze_regions.py
cmp /tmp/handwriting-data/expected-frozen-manifest.json /tmp/handwriting-data/frozen-manifest.json
python docs/research/handwriting-feasibility/review/verify_data.py /tmp/handwriting-data
```

Acquisition requires authorized access to the pinned primary GitHub source; no model host or mirror is involved. Use a new absent temporary directory. In the current workspace, verified images are already present beside the archived annotations (ignored by Git), so verification also works with no argument:

```sh
python docs/research/handwriting-feasibility/review/verify_data.py
```

The verifier only reads prepared local inputs and prints JSON. It performs no network requests, OCR, fitting or writes. Its packaging changes from the independent original are resolving `data/` relative to the script and accepting an explicit prepared-data directory. `data/prepare_selection.py` and `data/freeze_regions.py` preserve the original acquisition/cropping procedure; they are provenance scripts, not needed for verification. Do not rerun them over the frozen archive.

## Resume criteria

Keep issue #82 open until a genuine baseline and a useful personal workflow can be demonstrated. First admit lawful recognizer weights through an authorized source, preserving the weight license, immutable hash, safe loading format and actual bounded CPU inference. Reserve separate pilot pages before touching this evaluation set. Then commit a separate personal protocol and independent pre-fit review: word regions and literal scoring, page groups, correction-only vocabulary, learned visual features, seeds, abstention and complete baseline/personal comparisons. Unknown words must remain evaluation cases. A dictionary, printed-font classifier or manual editor cannot establish handwriting adaptation.

If those gates pass, build the local region/transcript editor, saved corrections, searchable notes and portable recovery with an explicitly separate general baseline and correction-trained visual classifier. A failed or null evaluation must remain visible without tuning against held-out outcomes.
