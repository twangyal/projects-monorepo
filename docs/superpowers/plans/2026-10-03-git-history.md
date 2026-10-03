# Git history implementation plan

Issue #11. Spec: `docs/superpowers/specs/2026-10-03-git-history-design.md`.

## Work units

- [ ] Implement `git_history/runner.py` bounded shell-free Git execution and runner tests. API and limits are fixed by the spec. Preserve read-only command behavior and consume no unbounded output.
- [ ] Implement `git_history/reader.py` plus parser helpers as needed and fixture-repository tests. Consume shared dataclasses and GitRunner; produce a complete Report or actionable GitError. Missing optional range/rename evidence becomes explicit warnings. Do not fetch or execute repo tooling.
- [ ] Implement HTML/JSON rendering, CLI and tests against the same contract. Escape all values; link embedded evidence. Protect existing output and Git metadata. Add setup/run documentation and independent CI.
- [ ] Run all fixture/CLI tests, lint, Python compile checks, inspect an HTML report in Chromium, and request independent review. Fix findings, commit/push, update issue and catalog.

Review focus: option/path injection, malicious Git configuration and raw source/messages; rename and shallow-history completeness; time/output limits; evidence links and any unsupported claims of intent; output files must not damage repository metadata or existing work.
