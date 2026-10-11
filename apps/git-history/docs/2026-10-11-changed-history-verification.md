# Changed-file history handoff — fresh verification

Issue: [#180](https://github.com/twangyal/projects-monorepo/issues/180).
Base: main `8b9f595c40ec28ba4024e2017c58c85d08f78716`.
All checks below were run on 2026-10-11; earlier receipts in this directory are historical.

## Resulting behavior

Changed-file rows offer explicit left/right history investigation. The action opens the selected regular endpoint at its captured full commit ID, including the left side of a deletion, then uses the existing manual-range/function → attribution/patch/quoted-message → HTML/JSON workflow. It does not resolve the original ref again or generate a report automatically. Each side is admitted independently, so a regular replacement for a symlink is inspectable while the symlink endpoint stays metadata-only.

Replacement confirmation protects existing history controls. Acceptance keeps discussion records/raw fields, uploaded context, the commit limit and comparison selections; old downloads and catalog authority retire. The existing service queue cancels and drains previous work before starting the pinned source read. Source bounds, context validation, capability handling and evidence limitations remain authoritative.

## Reproduction and fresh checks

Commands ran from `apps/git-history` unless indicated. `GIT_HISTORY_PYTHON` selected an owned Python 3.12.14 virtual environment. Node was 24.19.0, npm 11.9.0 and native Chromium 151.0.7922.173. The documented `CHROMIUM_PATH` override was used. Internet and loopback commands used the runtime's supported command-scoped `with_additional_permissions` network grant; inherited proxy, CA, TLS and sandbox settings were preserved.

Setup used the existing lock/requirements files, without dependency changes:

```sh
python3 -m venv /tmp/projects-cycle-2026-10-11-venv
npm ci --ignore-scripts --cache /tmp/projects-cycle-2026-10-11-npm-cache
/tmp/projects-cycle-2026-10-11-venv/bin/python -m pip install -r requirements-dev.txt
```

Before implementation this actual browser command failed because the Inspect right history action did not exist:

```sh
GIT_HISTORY_PYTHON=/tmp/projects-cycle-2026-10-11-venv/bin/python CHROMIUM_PATH=/usr/bin/chromium npm run test:browser -- tests/browser/changed-history.spec.js --grep 'captured source' --timeout=10000
```

Fresh outcomes:

| Command | Outcome |
| --- | --- |
| `/tmp/projects-cycle-2026-10-11-venv/bin/python -m unittest discover -v` before parser installation | 357 cases; success, 26 expected optional-parser skips |
| `npm test` | 18 passed, zero skipped |
| `npm run lint` | passed |
| `/tmp/projects-cycle-2026-10-11-venv/bin/ruff check .` | passed |
| `/tmp/projects-cycle-2026-10-11-venv/bin/python -m compileall -q git_history tests` | passed |
| `GIT_HISTORY_PYTHON=/tmp/projects-cycle-2026-10-11-venv/bin/python CHROMIUM_PATH=/usr/bin/chromium npm run test:browser -- tests/browser/changed-history.spec.js` | all six new application cases passed |
| `GIT_HISTORY_PYTHON=/tmp/projects-cycle-2026-10-11-venv/bin/python CHROMIUM_PATH=/usr/bin/chromium npm run test:browser` before parser installation | 51 passed; one expected native-parser skip |
| `GIT_HISTORY_REQUIRE_JAVASCRIPT=1 /tmp/projects-cycle-2026-10-11-venv/bin/python -m unittest discover -v` after parser installation | 357 cases; success, two parser-absence cases skipped (already passed in the parser-free run) |

The six new native cases use real owned temporary Git repositories and the actual application service. They verify moved refs, staged/dirty file immutability, exact pinned source requests, deleted source, absent/symlink/gitlink refusal, literal tab/newline/Unicode paths, replacement refusal/acceptance, retained raw discussion/comparison drafts, stale-action disabling, binary refusal, a bounded selection from 201 lines at 390px, named Python functions without source execution, and cancellation of a held real source job. Actual downloaded evidence is compared byte for byte with independent CLI executions; source/revision/path/line expectations come from the original fixtures.

## Installed application and meaningful failure

```sh
/tmp/projects-cycle-2026-10-11-venv/bin/python -m pip wheel --no-deps . --wheel-dir /tmp/projects-cycle-2026-10-11-wheel --cache-dir /tmp/projects-cycle-2026-10-11-pip-cache
/tmp/projects-cycle-2026-10-11-venv/bin/python -m pip install '/tmp/projects-cycle-2026-10-11-wheel/local_git_history-0.8.0-py3-none-any.whl[javascript]' --cache-dir /tmp/projects-cycle-2026-10-11-pip-cache
```

The native-enabled installed-wheel browser run (`GIT_HISTORY_BROWSER_INSTALLED=1` with the same Python/Chromium selectors and `npm run test:browser`) passed 50 cases, including all six new flows, and failed two existing simulated-parser-absence cases. Their `-S` wrapper does not remove parsers located beside the installed app: the isolated worker intentionally adds its trusted package parent to imports. They found parsers and therefore did not produce the expected missing-dependency error. No assertion or gate was weakened. A separate core-only wheel installation exercises actual package absence:

```sh
python3 -m venv /tmp/projects-cycle-2026-10-11-core-wheel-venv
/tmp/projects-cycle-2026-10-11-core-wheel-venv/bin/python -m pip install --no-deps /tmp/projects-cycle-2026-10-11-wheel/local_git_history-0.8.0-py3-none-any.whl --cache-dir /tmp/projects-cycle-2026-10-11-pip-cache
GIT_HISTORY_PYTHON=/tmp/projects-cycle-2026-10-11-core-wheel-venv/bin/python GIT_HISTORY_BROWSER_INSTALLED=1 CHROMIUM_PATH=/usr/bin/chromium npm run test:browser -- --output=/tmp/projects-cycle-2026-10-11-browser-core-wheel-final
GIT_HISTORY_PYTHON=/tmp/projects-cycle-2026-10-11-venv/bin/python CHROMIUM_PATH=/usr/bin/chromium npm run test:browser -- --output=/tmp/projects-cycle-2026-10-11-browser-native-source-final
```

Final sequential runs: **native-enabled source 52 passed, no skips; parser-free installed wheel 51 passed, one expected native-parser skip**. Both previously failing dependency-absence cases passed unchanged in the genuinely parser-free installed environment. Two preliminary parallel reruns were interrupted when shared artifact output was noticed. Despite separate requested output directories, the next parallel runs still shared an internal Playwright trace directory: source reported 51 passed/one teardown failure, and core wheel 50 passed/one teardown failure/one expected native-parser skip. Both failures were ENOENT while closing the last browser context and saving trace artifacts, rather than application assertions. The final commands above run sequentially; tracing, timeouts and assertions are unchanged.

Outside the source tree, the installed `git-history --help` and an isolated `python -I` TypeScript function parse passed. All five packaged web assets were checked byte-identical against source in both wheel environments; optional distributions were independently confirmed absent in the core-only environment.

## Limits

Local Python 3.11/3.13, the earlier 10,000-entry catalog receipt and physical devices were not rerun for this bounded UI change. Python-version and bundled-browser CI results belong to their exact published head and are linked in the PR. Source-only native-enabled tests and parser-free installed tests retain the existing dependency-absence assertions; the fully native installed test environment cannot simulate absence with its current wrapper.

The host's complete chat activity inventory is unavailable. Fresh all-state issue/PR and branch pagination, remote heads, repository instructions and the parent's visible activity check supplied overlap evidence. All temporary repositories/services belong to this cycle's tests; no real user repository data was modified by the application.

Final cleanup verification found no live cycle-owned application/browser processes and no remaining `git-history-browser-*` fixture directories. The three earlier checkouts stayed clean; this cycle uses its separate owned worktree. Raw logs and disposable dependency environments remain outside Git.
