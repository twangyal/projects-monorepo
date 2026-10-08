# Git history implementation plan

Issue #11. Spec: `docs/superpowers/specs/2026-10-03-git-history-design.md`.

## Work units

- [x] Implement `git_history/runner.py` bounded shell-free Git execution and runner tests. API and limits are fixed by the spec. Preserve read-only command behavior and consume no unbounded output.
- [x] Implement `git_history/reader.py` plus parser helpers as needed and fixture-repository tests. Consume shared dataclasses and GitRunner; produce a complete Report or actionable GitError. Missing optional range/rename evidence becomes explicit warnings. Do not fetch or execute repo tooling.
- [x] Implement HTML/JSON rendering, CLI and tests against the same contract. Escape all values; link embedded evidence. Protect existing output and Git metadata. Add setup/run documentation and independent CI.
- [x] Run all fixture/CLI tests, lint, Python compile checks, inspect an HTML report in Chromium, and request independent review. Fix findings, commit/push, update issue and catalog.

Review focus: option/path injection, malicious Git configuration and raw source/messages; rename and shallow-history completeness; time/output limits; evidence links and any unsupported claims of intent; output files must not damage repository metadata or existing work.

## Verification

- 54 real-fixture, CLI, rendering and bounded-runner tests pass on Python 3.12.
- Ruff, compile checks and whitespace checks pass.
- Built wheel/sdist, installed the wheel in a clean temporary virtual environment, and verified the console entrypoint.
- Chromium report inspection: evidence links resolve, patches expand, no page errors, and no horizontal overflow at 390px.
- Independent review found and fixed subdirectory source/blame mismatch, replacement objects, configured blame exclusions, mailmap attribution, log encoding, and output protection for unrelated Git metadata. Public attribution failures do not echo arbitrary configured file contents.
