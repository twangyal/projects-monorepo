# Direct-commit referenced issue context — #314

Git History's intended code-history exploration needs task context for commits pushed without PRs. Existing optional discussion retrieval used only PR associations. The same opt-in now reads descriptions of up to eight unique same-repository issues explicitly cited in checked range-change messages by Ref/Refs/References, Fix/Fixes/Fixed, Close/Closes/Closed, Resolve/Resolves/Resolved, or standalone (#N). Blame-only summaries and commits with PR associations are excluded from this additional lookup. Bare hashes, foreign repository references and URLs do not trigger it.

Every issue is linked to its report commit(s), strictly admitted by number/type/repository URL, text-capped, escaped and labeled quoted/unverified. Missing issues, truncation, cap omissions and partial refusal are disclosed. Issue comments are not read. A reference does not establish intent, closure or causation. Existing GitHub transport boundaries, credentials handling, cancellation, per-request and aggregate budgets remain. JSON adds referenced_issues; the synopsis and HTML provide source anchors. The workbench previews and both downloads retain these records. Default no-network output stays unchanged.

## Verification checkpoint

- Test-first actual CLI failed with missing referenced_issues before implementation.
- All 13 focused discussion tests pass, covering literal escaped text, no-network default, truncation, malformed/foreign/PR/boolean/query URLs, strict syntax, eight-issue cap, 404, shared issue/multiple commits, PR-associated exclusion and partial rate-limit evidence.
- Existing PR and new direct-issue native workbench/download cases both pass. First new native fixture expected a plain fragment href; the existing opaque iframe deliberately rewrites those to about:srcdoc. Only the fixture expectation was corrected. Exported HTML still uses original local anchors.
- Initial two domain fixtures had only two physical lines while requesting 1:3; corrected the fixtures to three lines. Ruff then caught six multiple-statement formatting errors in new tests; split them without changing assertions.
- Fresh independent review found no blocking defects, independently passed all 13 discussion tests, and requested the shared-reference/404/PR-scope cases now included. A follow-up confirmed source and wording changes.
- All 18 Node tests and ESLint pass; Python compilation and diff checks pass. Complete Python/native-parser/browser and hosted acceptance results are recorded separately once finished; no unrun gate is claimed here.

No real GitHub API request was needed for these software tests: actual local Git, CLI/service and loopback documented response shapes are used. No real repository-specific issue relevance or AI summary quality is established. Git History remains ACTIVE, and project #8 remains skipped.

Local complete Python checks: 370 cases with the optional parser absent (26 explicit skips) and 370 with native parsing required (two deliberate absent-parser checks skipped); no failures. The original full native browser run passed 53 with one optional grammar case skipped; that grammar case is checked separately with the native-parser environment. The new and existing retrieval browser cases also passed as a two-case cohort. This records actual runs, not a combined full-suite claim. Final hosted acceptance remains pending at this checkpoint.
