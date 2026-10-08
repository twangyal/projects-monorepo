# Handwriting #82 — independent feasibility review

2026-10-04. Read-only review/coordination; no app scaffold, personal fitting or held-out inference. Final local evidence review: the French corpus is available and verified; recognition weights/runtime remain blocked. Earlier unavailable-data conclusions are superseded below.

## Current evidence

- Catalog intent is local note transcription, user corrections and demonstrable adaptation to one person's handwriting, compared with a genuine general handwriting recognizer.
- Model owner proposes official Microsoft TrOCR-small-handwritten first, subject to actual CPU/runtime and checkpoint admission. Official UniLM README records Small IAM 62M parameters and IAM cased CER 4.22 as an upstream benchmark, not an observation from this environment. It lists handwritten checkpoint URLs under Microsoft's Azure distribution.
- Official code license in `../runtime/unilm-code-license.txt` is Microsoft MIT. The README's project-license paragraph points to that source-tree license. This alone is not independent checkpoint-license or dataset-reuse evidence.
- Model owner reports the current enforced package-managers network policy excludes Hugging Face/Azure checkpoint hosts. Do not repeat excluded-host probes or route around that policy. No actual local HTR inference or verified weight license has been established at this checkpoint.
- Real French handwriting data is now cleared for this bounded feasibility archive: primary HTR-United/CREMMA-MSS-19 corpus metadata explicitly licenses the dataset CC-BY 4.0, and its retained repository LICENSE contains that license. This is corpus licensing, not an inference from a software license. Five original JPEG/ALTO pairs and thirty annotated line crops are locally available; independent checks are recorded below.

Official references described in the retained README: https://github.com/microsoft/unilm/tree/master/trocr ; https://arxiv.org/abs/2109.10282 . No independent website/weight download was performed for this review.

## Separate license receipts

Record separately: runtime/source code license and exact revision; model weight license stated by the authorized distributor, immutable revision/hash/format and model card; page-image reuse rights; transcription/annotation reuse rights; required attribution and any publication restrictions. A permissive tag on an unofficial mirror is not evidence that the mirror owns the underlying scans/transcriptions. Do not redistribute benchmark data merely because a checkpoint trained on it is downloadable. Safe weight loading and absence of remotely supplied executable code are separate from licensing.

If weights or genuine lawful data remain unavailable, the personalization evidence gate is blocked. Fonts, synthetic glyph renderings, copied crops or a lookup table of corrections cannot replace real handwriting evaluation.

## Viable bounded product, conditional on asset gates

1. Import local scanned/photographed pages and let the user draw, correct and order explicit word regions. Keep the original page/crop identity and exact manual reading order. This is assisted region transcription, not automatic page layout recognition.
2. Run one frozen genuine HTR baseline on admitted regions. Retain editable baseline text and the fact that it is machine generated. Determine actual word-crop suitability on pilot data; a line-oriented checkpoint's published benchmark is not proof of word-region quality here.
3. Train a separate small visual classifier from the user's corrected region images and labels. Its vocabulary is explicitly closed to the user's saved corrected words. Image features plus learned parameters must genuinely depend on the corrected examples; a dictionary-only replacement is not handwriting adaptation.
4. Offer the personal suggestion separately from the baseline, or only substitute when a frozen acceptance policy passes. Unknown words, insufficient examples and weak/ambiguous matches abstain to the baseline/manual edit. Neither a softmax score nor HTR token likelihood is calibrated word accuracy without evidence.
5. Preserve baseline, suggested text, user-applied correction and source region separately. A later correction changes the training-data revision; stale training/recognition completions must not overwrite newer labels or raw editor text. Imported/pretrained model is not said to be fine-tuned if only a small head is trained.

## Leakage-safe protocol before fitting

- Mark runtime/pipeline smoke material as pilot. Record all source and page IDs used; exclude entire pilot pages from final held-out evaluation.
- Establish original-page/scan groups before deriving line/word crops. All overlapping regions, transformed/augmented derivatives and duplicate scans remain in the same group. A crop hash alone cannot detect same-page leakage.
- Same writer across correction/development/test pages is intentional for personalization. Do not call this writer-independent evaluation.
- Freeze source identity/rights, original page hashes, writer/page grouping, boxes, exact labels, reading order, segmentation rules and Unicode/case/punctuation scoring before predictions. Manual regions and manual ground truth must not be selected because the baseline failed on them.
- Select vocabulary from correction pages only using a fixed rule. Require multiple distinct handwritten instances; repeated exact/augmented copies are not independent evidence. Keep development/test unknown-vocabulary words as negatives rather than dropping them.
- Freeze feature extraction, learner, seeds, regularization and acceptance/abstention policy before test. Development may choose only preregistered alternatives, then freeze. A failed test is retained; no threshold, vocabulary, crop or label tuning on held-out output.
- Report baseline exact-word accuracy and declared character/word edit-distance metrics on the complete manually segmented evaluation set. Report personal accepted-suggestion accuracy, coverage, false acceptance of unknown words, baseline-versus-combined outcomes and every abstention. Include per-page counts and outcomes; words from a shared page are clustered, not independent handwriting authors.
- Unknown pretraining overlap need not block a practical baseline, but state that it is unknown. Valid claim: held out from this personal correction classifier. Invalid unsupported claim: unseen by the pretrained HTR model or unseen writer.
- Keep a changed-label or shuffled-label training control on separate development/tiny fixtures to prove corrections influence a learned image-dependent model; do not use favorable test-set effects as an asset-selection loop.

## Release prerequisites

Actual lawful weights/runtime and real annotated handwriting must be available first. Root separately commits the personal protocol, full ordered page/region split manifest, source/config fingerprints and independent pre-fit checks before any personal-protocol fitting or held-out prediction. A deployable editor can remain useful with manual corrections, but it must not be presented as demonstrated personalized recognition if that scientific gate is unavailable or fails.

## Dataset-owner checkpoint

Recorder reports the modern-English CSAFE corpus (Iowa State DOI `10.25380/iastate.10062203.v2`; Crawford, Ray, Carriquiry, Kruse, Peterson) has explicit writer/session/page identity and repeated human-written prompts. Secondary metadata describes CC-BY4. The primary Figshare endpoint returned403 to its authorized probe; primary licensing/source access is therefore unverified and no data was admitted. Archive metadata indicates about1.57 GB, so a future acquisition must have an explicitly bounded plan rather than silently fetching the entire corpus.

If primary rights/access are cleared, prefer correction/development/test **session-disjoint** within-writer groups. Repeated prompts are distinct genuine pen-written instances, but conclusions are limited to copied-passage/closed-vocabulary adaptation, not arbitrary novel notes. Preserve prompt/session identity. Learned input must not include box location, page/order/filename or other shortcuts to the known copied text. Keep words outside the correction vocabulary as open-set rejection cases.

Other candidates reported by the data owner remain unadmitted: Stanford memorial letters have permissive catalog metadata but no confirmed upstream license; Hooker ground-truth licensing does not override separate Kew image copyright/permission. Those earlier candidates remain unadmitted. This reviewer did not retry blocked endpoints or run OCR; subsequently inspected the admitted French corpus contact sheet as described below.

## Final independent French data verification

The admitted corpus is [HTR-United/CREMMA-MSS-19](https://github.com/HTR-United/CREMMA-MSS-19), pinned at `d8f466de72561cd989f957d75a6743c5d8f0a262`. Its primary `htr-united.yml` explicitly says French, manuscript-only, one hand per folder (exact), preserved abbreviations, and CC-BY 4.0; it names human transcriber/aligner and quality-control contributors. Its full repository LICENSE is Attribution 4.0 International. The archive must retain the supplied attribution, license/link, original source identities and crop-modification notice. This supports corpus reuse on the publisher's stated terms; it does not independently authenticate the historical author or prove every historical-rights question.

An independently written verifier, `verify_data.py`, passed against manifest SHA256 `69b8553577f2e0446305efe1f03125f42c3ae5fe8e6b3ea79a8a033e22f5dbbe`. `data-verification.json` records the results:

- All 13 retrieved original files (three primary metadata/license files, five JPEGs and five ALTO files) match their retained byte lengths and SHA256 receipts. All source URLs identify the same pinned primary repository commit. No network refetch was performed in this independent review.
- Each source JPEG is 975 × 1500; its ALTO page dimensions and source filename match, with no orientation transform required.
- Each page contributes exactly its first six MainZone lines in XML source order. The thirty exact line IDs, bounding rectangles, crop dimensions and literal ALTO `CONTENT` references match the manifest. All source, crop and UTF-8 transcript hashes match.
- Independently decoded RGB arrays sliced as `[top:bottom, left:right, :]` equal all thirty saved PNG crops exactly: 6,379,023 channel values compared. No producer preparation script was imported or executed.
- All thirty crop hashes are unique. Whole pages 001/002 are correction (12 lines), 003 is development (6), and 004/005 evaluation (12); no source page crosses splits. This verifies the frozen local selection, not the ordering of an independently refetched upstream repository tree.
- Visual inspection of the complete contact sheet confirms genuine cursive manuscript scans with folds/bleed-through and plausible line/reference pairing. It is not an independent scholarly certification of every transcription. Original annotation spellings and punctuation were preserved without correction.

Two editorial-marked lines remain exactly as supplied: page002 line02 `ment elle partait >le<`, and page003 line02 `15^ne  de jours,` (two spaces after `ne`). No normalization or scoring interpretation was applied. A future diplomatic/plain-reading policy must be frozen before predictions; these rows must not later be dropped because of model errors.

## Independent readiness conclusion

**Data available; actual HTR runtime and personalization evidence still blocked.** The earlier statement that no eligible corpus was available is superseded by the verified French corpus above. This is five pages of one 1824 letter, one publisher-declared hand, with supplied line segmentation. It establishes neither standalone word boxes nor modern-English, phone-camera, independent-document or writer-independent generalization. Pretrained-model exposure to this corpus remains unknown.

Model owner records one normal official Hugging Face model-card GET denied by proxy CONNECT HTTP403, without retry/bypass. Official UniLM releases expose no TrOCR weights; linked Azure and SimpleHTR Dropbox assets were not admitted. The separately authorized French search found the referenced FoNDUE recognizer absent from its official release; available generator checkpoints are not recognizers. No licensed/checksummed safe HTR checkpoint or actual local HTR output has been verified. A CPU dependency-import check is not inference.

No OCR, personal training, held-out predictions or scoring was performed. No personal protocol or word-region annotation/scoring policy has been frozen. Archive the available data and truthful blocker evidence without an app scaffold or recognition-quality claim. Reopen the model gate only with lawful accessible recognizer weights through an authorized route, then freeze the separate personal protocol before fits or held-out predictions. A manual editor, printed-font classifier or correction dictionary cannot substitute for the genuine baseline and image-dependent learned personal classifier.
