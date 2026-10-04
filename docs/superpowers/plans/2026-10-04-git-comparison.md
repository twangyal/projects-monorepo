# Git History comparison implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Reproducible two-revision explicit-source comparison in CLI/library/browser, with exact text and portable exports rather than inferred semantic identity.

**Architecture:** Frozen comparison contracts, shared pinned revision/typed absence reader, bounded cooperative LCS table, separate direct renderers/CLI, one existing HTTP job pump, independent dual-side UI and oracle/native acceptance.

**Tech Stack:** Existing Python3.11stdlib/Git/POSIX budgets and static JavaScript workbench. Optional installed parser unchanged; no new runtime dependency or external service.

**Spec:** [Design](../specs/2026-10-04-git-comparison-design.md), [Issue64](https://github.com/twangyal/projects-monorepo/issues/64).

## Constraints

- Root review/release before source edits. Exclusive files; root owns Git/docs/config/issues and shared service/browser verification. Never print private launch tokens or reuse root's private service.
- Existing explain/files/functions/context/render/output/security contracts remain compatible. Comparison is its own schema/kind, not a forged old history report.
- Explicit independent pins/paths/selections; missing succeeds only after exact absence verification. No network/source execution/rename inference.
- <=200lines/512KiB selected bytes per side, <=40,000 LCS comparisons/~80KiB typed table,45second aggregate/32MiB output and existing HTTP/report limits. Cooperative cancellation at bounded stages.
- Observe meaningful producer RED→GREEN. Independent expectations authored before implementation reads; actual first-run evidence is reported honestly.

## Task1 — Comparison contracts, source seams and alignment

Owner: comparison.py, minimal model.py/reader.py, tests/test_comparison.py.

- [x] Publish exact frozen dataclasses/constants/compare/validate_comparison APIs and reusable revision/absence helper signatures.
- [x] Write RED pinning/selection/path/empty/verified-missing fixtures, preserving old read_source error contracts and legacy reader tests.
- [x] Implement independent once-only ref resolution and subsequent full-ID reads; parse exact functions through existing bounded parser and reject ambiguity/oversized selections.
- [x] Write RED token/newline/repeated-line alignment and200/201bounds; implement explicit unsigned16bit suffix LCS and delete-first tie traversal with budget checks every32rows.
- [x] Build immutable complete partition/count/hash/provenance report without duplicate source bodies; implement shared bounded canonical alignment recomputation for direct report validation; no partial result on cancellation/errors.
- [x] Run focused unit/Ruff checks and send callable API readiness.

## Task2 — Portable rendering and additive CLI

Owner: comparison_render.py, cli.py, tests/test_comparison_render.py, tests/test_comparison_cli.py.

- [x] Write RED direct malformed/noncanonical alignment report validation through validate_comparison, literal escaping, empty/missing distinction, line-ending labels, exact provenance and8MiB output bounds.
- [x] Implement script-free standalone HTML and canonical JSON from one validated report with scoped line anchors and positional-pairing disclosure.
- [x] Add compare arguments and reuse existing200-line parser without changing explain behavior; use existing output protection/publication.
- [x] Write/run real fixture CLI comparisons, atomic --force/no-clobber/metadata refusal and aggregate budget/cancel tests; preserve existing CLI suites.

## Task3 — Existing service operation

Owner: workbench.py, tests/test_comparison_workbench.py.

- [x] Write RED exact comparison wire admission/type/key/full-ID/selection tests.
- [x] Execute real comparison and both renderers inside existing one-job aggregate budget, retaining startup repo binding/security and joined cancellation.
- [x] Pin actual HTTP overflow/timeout/cancel/result publication/no-replay behavior and helper error treatment. No browser assets or repository output writes.
- [x] Run scoped service regressions and communicate operation readiness.

## Task4 — Independent browser comparison workspace

Owner: web/workbench.html,workbench.js,workbench.css.

- [x] Use the exact frozen Workspace, left-/right-, comparison result/pager/download selectors in the spec; preserve all history IDs.
- [x] Add dual independent discovery/pinning/source/function/selection controls, explicit Missing and comparison selection limits.
- [x] Reuse ONE pump/session/request lifetime; side/workspace edits invalidate pending results on input intent and retain exact unrelated drafts.
- [x] Render bounded source/catalog pages and100-row safe DOM alignment pages from completed JSON, keeping original history iframe unchanged; show exact provenance/counts/line endings and stale-result disclosure; portable downloads derive from one completed report.
- [x] Preserve all existing history/context workflows, fragment/token privacy, cleanup/no-replay and late-result guards. Run scoped lint; coordinate shared service/browser slot with root.

## Task5 — Independent semantic and native acceptance

Owner: tests/test_comparison_oracle.py, tests/browser/comparison.spec.js and disjoint fixture helpers (root may split owners).

- [x] Author hand source/LCS/provenance/count expectations for literal independent repo commits before producer reads, including rename choice/absence/empty/newline/ties and disjoint histories.
- [x] Verify source/object/type/budget boundaries and immutable pins despite branch advancement; no semantic identity assumptions.
- [x] Native flow chooses both sides independently, discovers functions/manual ranges, produces real HTML/JSON artifacts and compares with trusted direct CLI results for identical exact inputs.
- [x] Gate actual response delivery to test draft/side/workspace intent and stop/cleanup/supersession; preserve session capability privacy and script-free portable output.
- [x] Run existing browser suite plus new cases on fresh root-coordinated service; report exact observed results/artifacts, not invented RED.

## Task6 — Root release

- [x] Final independent read-only cross-module review of absence, pinning, LCS bounds/cancellation, direct render validity and async UI ownership.
- [x] Root runs core/native Python tests, Ruff, JS lint and full fresh production browser checks; routes demonstrated defects to exclusive owners.
- [x] Root updates user docs/evidence/catalog truth, reviews/commits/pushes and checks path-scoped CI before closing64.


## Completion evidence — 2026-10-04

Core committed `fc2093d`; full library/CLI/service/browser implementation `37831a3299134a4145ed518c8c3d728aeadbaa8b` is pushed. Final304-case native/core runs pass with2/26 expected skips, plus Ruff/compile/ESLint,20 unchanged/new native browser cases and installed-wheel18+2 cases across real optional/core-only environments. CI passes the full Python3.11–3.13 matrix and20 browser cases; all12projectworkflows pass that implementation commit. Independent review reproduced normalized path aliases falsely reported missing; fixed with observed producerRED and preserved oldreader behavior. Independent oracle19 first ran againstcallablestubs and then passed actualengineunchanged; addedaliasoracle first ranGREENafterownerfix. Full-discovery helperimport was corrected before both final304 runs.

A real installed-package maximum probe compared two exact512KiB/200-line sources in327.8ms, retained100rowpages and actual native HTML/JSON downloads byteidenticaltoCLI. Original expected190/10/10 counts/sourcehashes, dirtyworktree exclusion, cap/privacy, keyboard/mobile checks andownedcleanup pass. All21 wheelpackagefiles matchedsourceexactly. See permanent [verification](../../../apps/git-history/docs/2026-10-04-comparison-verification.json). Software issue64 is ready for closure after final evidence push; next coherent milestone is Duet offline library recovery #65.
