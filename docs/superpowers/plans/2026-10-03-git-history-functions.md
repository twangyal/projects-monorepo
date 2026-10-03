# Git History function selection implementation plan

Spec: `docs/superpowers/specs/2026-10-03-git-history-functions.md`, issue #13.

- [x] Refactor committed snapshot loading and implement AST function listing/selection with fixture tests.
- [x] Implement shared structured evidence synopsis and HTML/JSON presentation with tests.
- [x] Integrate CLI commands/options with end-to-end tests and run documentation.
- [x] Run full verification, independent review and fixes, and a real browser report.
- [x] Commit/push complete milestone; update issue, PR and catalog; reassess next work.

## Verification

- 93 tests pass, including the entire suite from an extracted source distribution. Ruff, compile checks and whitespace checks pass.
- Built 0.2.0 wheel/sdist and verified the installed functions entrypoint. Source distribution includes test helpers and lint requirements.
- Real fixture demonstration: list and select `Calculator.total`, trace an edit and whole-file rename, inspect its synopsis and patches. Chromium desktop/mobile checks pass with all anchors resolving, no page errors, and no 390px horizontal overflow.
- Independent review found catalog name/output amplification. Incremental 10,000-definition/2 MiB-name bounds and an 8 MiB serialized listing cap fix it with ASCII/Unicode regression fixtures.
- Additional verified fixes cover decorator matrix operators, portable parser failures, and added/removed source lines beginning with repeated plus/minus characters.
