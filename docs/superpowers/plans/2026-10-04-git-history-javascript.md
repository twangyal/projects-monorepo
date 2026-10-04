# Git History JavaScript/TypeScript implementation

Issue #34; contract: `../specs/2026-10-04-git-history-javascript-design.md`. Root owns Git/GitHub, docs/catalog/configuration and final evidence. Existing autonomous authorization applies.

- [x] Inspect current reader/parser/CLI/tests, deduplicate issue, complete pinned native dependency and grammar feasibility on Linux Python 3.11–3.13.
- [x] Independently review and finalize the written syntax/isolation contract before implementation.
- [x] **audio_engine:** `git_history/native_syntax.py`, `tests/test_native_syntax.py`. Implement iterative grammar-backed catalog and exact ranges/scopes/barriers with meaningful syntax fixtures. No supervisor/integration/config edits.
- [x] **recorder:** `git_history/native_parser.py`, `git_history/native_worker.py`, `tests/test_native_parser.py`. Implement isolated bounded stdin/stdout supervisor, strict protocol validation, dependency/resource errors and process reaping tests. Coordinate error interface with grammar owner. No existing runner changes.
- [x] **git_history_review:** `git_history/function_parser.py`, `reader.py`, `cli.py`, `tests/test_javascript_integration.py`. Lazy suffix dispatch, existing error conversion, neutral CLI/help, committed snapshot/manual-range equivalence/ambiguity/integration tests. Do not change existing Python semantics.
- [x] **git_runner:** independent `tests/test_javascript_evidence.py` and `tests/fixtures/javascript/` only. Real Git fixtures and independent qualified-name/range/evidence/revision/rename/dirty-worktree tests. Wait for implementation before running integration; no duplicate ownership.
- [x] **root:** shared protocol constants, optional-extra packaging/version/CI, README/catalog and real installed CLI/wheel evidence. Preserve dependency-free core checks. All Git and issues remain root-owned.
- [x] Run focused owner checks, then full suites on actual Python 3.11–3.13, lint, compile and wheel/core-only/native-extra verification. Independently review native scope and subprocess safety; fix actual findings.
- [x] Exercise real committed monorepo TypeScript/JavaScript function HTML/JSON evidence and immutable snapshot behavior; record measured bounds and platform limitations.
- [ ] Fetch Astra state, review scoped diff, commit and push without force; check CI, update draft PR12, close #34 only if complete.
- [ ] Immediately reassess and continue the next useful unblocked task.
