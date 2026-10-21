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
- [x] Write unit cases for shared actual geometry, strict/relative admission, legacy equality and portable data; run and observe unsupported-key failure.
- [x] Write browser cases for numeric/pattern/GLB/tech-pack/history/reload, pointer/keyboard/raw-draft protection, phone reset/invalid behavior and actual drape input. Observe missing field failure before UI implementation.
- [x] Implement shared dimension and UI; run focused tests and complete app check/browser suite.

### Task2: immutable native research continuity

Files: .github/workflows/clothing-ppf-garment.yml, docs/research/ppf-cpu/garment_capture_equivalence.py and test_garment_capture_equivalence.py.
Consumes retained cold/warm envelopes; produces strict current-source provenance and identical fixture/packet comparison.
- [x] Write rejection cases for changed geometry, fixture, missing/extra provenance, wrong current hash and malformed envelope. Observe missing helper failure.
- [x] Implement comparison with full current source hashes and canonical serialized packet equality; never claim current hash equals historical hash.
- [x] Pin separate sparse checkout to10db749c32d991d053a7d319cdf1f2d1c6764da2. Reproduce historical cold/warm envelopes exactly from it. Keep historical --app provenance/admission, all research replay gates; add both current captures and equivalence checks.
- [x] Run cold/warm reproduction and relevant Python checks locally; document evidence/limits.

### Finish

- [x] Independent read-only whole-branch review; fix material findings with regression tests.
- [x] Commit durable progress; README/roadmap and integration evidence; integrate source and verify CI before closure.

Verification ledger:166 app units/check pass;4 focused native cases pass; source CI all213 native cases pass; local163-case garment preflight passes787.839s; frozen/current cold/warm checks pass; independent review has no findings. Source hosted preflight39660091324 passes163 cases in511.006s and every provenance/reproduction step. Source app39660091374 passes166 units/all213 browsers. Canonical main268e1da passes166 units/all213 browsers,163 garment checks and220 research cases. The extra local full replay is211 passes/2 timeouts; both named cases pass unchanged in isolated replay. See the integration record for exact evidence; no failure is erased or called a green full local suite.
