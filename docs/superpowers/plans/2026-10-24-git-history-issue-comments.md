# Direct-issue progress comments Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Autonomous main integration authorized; no PR.

**Goal:** Explain direct commits with recent referenced issue progress (#324).

**Architecture:** Extend ReferencedIssue with nested comments/omission/note; existing Fetch discussions opt-in and bounded GitHub client. Validated issue count selects last10-comment page, one extra request per issue under existing8issue cap. Exact issue/comment URL and ID validation,4000character quoted text, author/time and escaped portable HTML/JSON. Keep descriptions on partial failures; zero/invalid count skips extra requests with honest status. No completeness/verified-intent/closure claim.

**Tech Stack:** Existing Python dataclasses/urllib/HTML and actual CLI/Git/loopback tests, existing Playwright. No project dependency/runtime/workflow/deadline change.

**Spec:** AGENTS.md/PROJECT_IDEAS.md Git History vision/#324. Autonomous choice: recent snapshot page over unbounded crawling. No-network reports unchanged; ACTIVE/#8skip.

## Review Focus

- Snapshot count may drift: page/omission notes must stay honest.
- Foreign/wrong issue/wrong ID/empty/malformed data must not become evidence.
- Rate limit/cancel/deadline during comments retains description and earlier results.
- Existing8issue/one10commentpage/4000text caps and credential/budget boundaries stay intact.
- All portable output escapes untrusted bodies/authors and links exact accepted sources; opt-out never fetches.

### Task1: complete recent issue context

- [x] Baseline370tests pass (26optional-parser skips before installing isolated verification tools).
- [x] Four real CLI/HTTP tests RED on absent comments; native literal-comment check RED;17focused tests GREEN.
- [x] Typed nested records, bounded recent-page retrieval, safe rendering; review drift regression observedRED then repaired.
- [ ] Focused/full Python/Node/browser/static checks, fresh review, necessary RED→GREEN fixes.
- [ ] Commit through connected GitHub tools; observe canonical gates, issue/roadmap update.

## Ledger

Base f72ce18 after accepting Melody#323. Existing linked detached worktree, no unrelated edits. #314 quotes descriptions only; no suitable open issue. Official GitHub comments API checked. Verification-only environment installs exact optional-parser/ruff versions; project dependencies stay unchanged. Recent-page counts are snapshot metadata, not a completeness guarantee.

Review: no security/critical finding. Ruling: count drift is Important to the explicit honest-omission contract; expose comment_count_at_lookup and omitted_comments_estimate and label the estimate, pinned by a fifth RED→GREEN test. README completion and trailing-whitespace cleanup finish the original documentation/check steps. Minor deferred: iframe-specific script assertion could be stronger; native literal-body and portable escaped-output checks already cover quotation. No outside-scope behaviors declined. Full final gates pending.

Source67102a committed. Final375Python tests pass88.799s with2expected dependency-absence skips;18focused/18Node/lint/Ruff/compile pass. Pre-final54native pass2.6m; final54native and canonical40134455981 matrix pending. Root verification handoff retains earlier PID-marker fixture failure; no unrun gate claimed.
