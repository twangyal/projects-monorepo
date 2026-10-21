# Clothing shoulder-drop implementation plan — #296

> **For agentic workers:** Use superpowers:executing-plans inline; steps below track the work.

**Goal:** Edit shoulder slope through the existing linked construction workflow.
**Architecture:** Add optional Fit.shoulderDrop to shared dimensions. Existing validation, geometry, draft/history and export paths consume it. Preserve historical research artifacts and independently reproduce both frozen source and current default geometry.
**Tech Stack:** TypeScript, Three.js, Node tests, Playwright, Python unittest, GitHub Actions.
**Spec:** [Issue296](https://github.com/twangyal/projects-monorepo/issues/296), constrained by docs/PRODUCT_DIRECTION.md Clothing vision.

## Global constraints

- 1–8cm vertical drop; absent means exactly4cm. U is the new tech-pack code, fixed across grades.
- Tops only; retain sparse Fit, strict parser, existing relative-geometry limits and atomic drafts.
- Right front shoulder vertical handle must remain separate from left shoulder-width horizontal handle.
- No dependency changes, physical-fit claim or mutation of frozen research packets.
- No PR; integrate verified source into main through connected GitHub tooling.

## Review focus

- Low drop with deep front neck or short body must reject impossible geometry atomically.
- Changing shoulder height must preserve independent shoulder width and armhole depth.
- Omitted legacy values must produce identical patterns and actual mesh/capture packets.
- Raw drafts must survive tools, invalid Apply and blocked handle edits, including phone viewport.
- Historical source provenance must remain verified alongside exact current default packet equivalence.

### Task1: linked dimension and native user flow

Files: product.ts, product-view.ts, techpack.ts; tests/shoulder-drop.test.ts and shoulder-drop.spec.ts.
Consumes existing Fit, teeDimensions, patternPieces, teeMesh and buildTechPack.
Produces optional shoulderDrop, numeric field and vertical handle; tech-pack U and diagram.
- [ ] Write unit cases for shared actual geometry, strict/relative admission, legacy equality and portable data; run and observe unsupported-key failure.
- [ ] Write browser cases for numeric/pattern/GLB/tech-pack/history/reload, pointer/keyboard/raw-draft protection, phone reset/invalid behavior and actual drape input. Observe missing field failure before UI implementation.
- [ ] Implement shared dimension and UI; run focused tests and complete app check/browser suite.

### Task2: immutable native research continuity

Files: .github/workflows/clothing-ppf-garment.yml, docs/research/ppf-cpu/garment_capture_equivalence.py and test_garment_capture_equivalence.py.
Consumes retained cold/warm envelopes; produces strict current-source provenance and identical fixture/packet comparison.
- [ ] Write rejection cases for changed geometry, fixture, missing/extra provenance, wrong current hash and malformed envelope. Observe missing helper failure.
- [ ] Implement comparison with full current source hashes and canonical serialized packet equality; never claim current hash equals historical hash.
- [ ] Pin separate sparse checkout to10db749c32d991d053a7d319cdf1f2d1c6764da2. Reproduce historical cold/warm envelopes exactly from it. Keep historical --app provenance/admission, all research replay gates; add both current captures and equivalence checks.
- [ ] Run cold/warm reproduction and relevant Python checks locally; document evidence/limits.

### Finish

- [ ] Independent read-only whole-branch review; fix material findings with regression tests.
- [ ] Commit durable progress; README/roadmap and integration evidence; integrate source and verify CI before closure.
