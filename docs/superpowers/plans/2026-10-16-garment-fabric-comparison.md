# Matched garment fabric comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Compare two actual fabric drapes on the same top/body, then deliberately apply a choice.
**Architecture:** Pure variant/receipt helpers plus an owned comparison view reusing the garment worker and disposable snapshot API; minimal product-view hooks.
**Tech Stack:** Existing TypeScript, Vite, Three.js, node:test and Playwright.
**Spec:** docs/superpowers/specs/2026-10-16-garment-fabric-comparison-design.md

## Global Constraints

No saved schema/dependency/paid-service/PR change. Default solver:240frames/10substeps. Two distinct library fabrics; replace non-rib parts only. Preserve drafts/asset owners, existing project behavior and explicit uncalibrated-fit limits. User authorizes autonomous inline execution/integration; interactive approval handoffs are superseded by that instruction.

## Review Focus

- A pending import/artwork decode must survive comparison controls; actual Apply must retire it.
- Changed body or equal-looking project replacement must retire old worker/render results.
- Rendering failure after first candidate must clear all result URLs and permit retry.
- Raw fields must remain unapplied and must block comparison Apply.
- Completed receipts must contain actual positions for both candidates, with unchanged source data.

### Task1: Candidate data and captured receipt

Files: create src/garment-comparison.ts and tests/garment-comparison.test.ts under apps/clothing-studio.
Interfaces: fabricVariants(product:Product,materials:[string,string]):[Product,Product]; comparisonReceipt(source:Product,body:{chest:number;waist:number;hip:number},materials:[string,string],results:[GarmentDrapeResult,GarmentDrapeResult]) returns plain JSON-safe captured data.
- [x] Write domain tests: source equality after candidate edits; rib retention; preserved colors/prints/artwork/colorways; reject duplicate/unknown/bottoms; actual solves finite/different and receipt positions match both results.
- [x] Run node --experimental-strip-types --test tests/garment-comparison.test.ts; expect missing-module RED.
- [x] Implement strict variants and receipt; run focused tests then npm run check, expect all passing; commit.

### Task2: Owned comparison and deliberate choice

Files: create src/garment-comparison-view.ts, tests/garment-comparison.spec.ts; modify src/product-view.ts, src/style.css, README.md, PROJECT_IDEAS.md and milestone notes.
Interfaces: mountGarmentComparison(host,{capture:()=>{product,body},apply:(materialId:string)=>void}) returns {sync:(product:Product|null,body:...|null)=>void,reset:()=>void}. Consume Task1 helpers. Existing worker handles each immutable candidate; lazy snapshot API produces front/back PNGs.
- [x] Write desktop1440/phone390 native test with two actual worker replies, receipt geometry, decoded images, backup parity and one-step material Undo/Redo. Run focused native; expect missing controls RED.
- [x] Implement panel, ownership/invalidation/URL lifecycle, explicit Apply hooks and responsive cards. Native tests must pass.
- [x] Add held native worker/render boundaries, cancel/input/body/project/pagehide, failure retry and pending draft/artwork/import tests; watch missing behavior RED before repairs where found.
- [x] Run npm run check and all focused native cases; commit implementation/docs.
- [ ] Freeze source, run full native suite and source CI; independent whole-branch review once; fix Important/Critical with RED→GREEN and green suite. Integrate with head lease, inspect main CI and commit root evidence/direction only. Close270 when actual gates complete.
