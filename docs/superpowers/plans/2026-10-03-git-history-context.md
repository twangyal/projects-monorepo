# Git History supplied context implementation plan

> **For agentic workers:** Use the executing-plans workflow in the assigned existing checkout; the integrator handles independent review, commits and publication.

**Goal:** Add optional offline discussion excerpts linked exclusively to commits already represented in a Git History report.
**Architecture:** A bounded JSON loader produces validated `ContextEntry` values. Existing renderers accept optional supplied context; the CLI reads it after Git evidence extraction and before rendering or output publication.
**Tech stack:** Python 3.11+ standard library, existing Git plumbing and portable HTML.
**Spec:** `docs/superpowers/specs/2026-10-03-git-history-context.md`.

## Global constraints

256 KiB regular UTF-8 sidecars; schema version 1; at most 50 entries; source/author 200 characters, excerpt 4,000, URL 2,048. Exact lowercase 40/64-character commit IDs already represented in selected revision/blame/change/rename evidence. Public credential-free HTTPS GitHub/GitLab discussion routes only. No network reads, dependencies, comments, commits or pushes. Existing no-context reports remain unchanged; complete reports retain the 8 MiB limit.

## Review focus

- Stale or unrelated commits must fail atomically, even if earlier entries match.
- Parser diagnostics and rejected URLs must not disclose supplied secrets.
- Selected-revision-only and rename-only anchors must resolve exactly once.
- Empty context, oversized UTF-8 data, duplicate JSON keys and nonregular inputs must be explicit and bounded.
- Direct renderer callers must receive the same URL and commit-membership protection as CLI imports.

## Tasks

- [x] Add failing fixture tests in `tests/test_context.py`: import success, membership across all evidence sources, exact IDs, strict schema/limits/file types/URLs and safe diagnostics. Add `model.ContextEntry` and `context.load_context(path, report)` plus reusable validation; verify targeted tests.
- [x] Add failing renderer tests for provenance, escaping, JSON fields, empty context and exact internal anchors. Extend `render_json(report, context=None)` and `render_html(report, context=None)` without changing omitted-context output. Verify existing report/synopsis tests.
- [x] Add failing CLI tests for real repository HTML/JSON/function imports, stale refs, atomic failure and omission compatibility. Wire `explain --context FILE`; verify targeted and full CLI flow.
- [x] Add complete README sidecar and command examples, provenance semantics, supported URLs and limits. Run full unittest, Ruff, compile and package checks; inspect generated HTML. Review the scoped diff and hand the verified files to the integrator without committing.

## Verification recorded

- 108 unittest cases pass on Python 3.11 and 3.12; Ruff, compileall and scoped whitespace checks pass.
- Wheel and sdist build; an installed-wheel CLI imports function context from a real fixture repository outside the source tree.
- Omitted-context HTML and JSON match the committed baseline byte for byte.
- Chromium desktop and mobile checks confirm literal escaped excerpts, valid unique internal anchors, no external requests and no horizontal overflow, including SHA-256 IDs and long source/author labels.
- Temporary preview server stopped; no comments, commits or pushes were made.
