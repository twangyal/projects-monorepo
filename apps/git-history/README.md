# Git History

A local, read-only evidence explorer for how code evolved. Select a committed line range or a named Python, JavaScript or TypeScript function and get a portable HTML or JSON report with blame, the patches that changed the range, quoted commit messages, rename evidence and, on request, the GitHub pull-request discussion behind those commits. It runs as a command-line tool and as a browser workbench served on loopback.

**Status:** DEFERRED (2026-10-25) — paused while the portfolio focuses on Gaze Navigator, Clothing Studio and Karaoke Studio. Direction: [docs/PRODUCT_DIRECTION.md](../../docs/PRODUCT_DIRECTION.md)

## What works today

- **`explain`:** a self-contained HTML report (no scripts or external assets) or JSON for a 1–200-line range or a named function, with a factual synopsis linking each observation to its evidence.
- **Function selection:** Python functions and methods via the standard-library AST; JavaScript/TypeScript (including JSX/TSX) via an optional pinned Tree-sitter extra running in a resource-limited subprocess.
- **Discovery:** `files` lists committed source candidates; `functions` lists qualified names and line ranges.
- **Pull-request discussion (opt-in):** `--fetch-discussions` quotes PR descriptions, review comments on the selected file, conversation comments and closing issues for the report's commits, plus explicitly cited issues for commits without a PR. Retrieved text is labelled as unverified participant text.
- **Supplied context:** attach your own PR/issue/discussion excerpts (`--context FILE`), validated against commits that actually appear in the report.
- **`compare`:** exact line comparison of two committed selections (whole file, range, function or missing path), possibly at different paths and revisions.
- **`changes`:** list changed paths between two committed trees, with modes and object IDs.
- **Workbench (`serve`):** browse committed source, pick functions or ranges, generate and download reports, author supplied-context records, discover changed files and compare revisions in the browser.

## Known gaps

- No semantic explanation: the tool organizes Git evidence and quotes what people wrote; it does not infer intent or separate documented reasoning from inference beyond labelling sources.
- Line tracing relies on Git blame and similarity-based rename detection; moved/copied code, merges and rewritten functions can break the trail.
- Discussion retrieval covers GitHub only and is capped (12 commits, 8 PRs, 30 comments per report); GitLab links are accepted only as supplied context.
- No browser extension or editor integration; one repository per workbench session.
- Windows is unsupported; JavaScript/TypeScript parsing has not been runtime-verified on macOS.

## Run locally

Requirements: Python 3.11+ (CI tests 3.11–3.13), Git 2.30+, Linux or macOS. The core tool has no runtime dependencies. Run from this directory:

```sh
cd apps/git-history
python3 -m git_history explain --repo /path/to/repo --ref HEAD \
  --file src/example.py --lines 20:45 --output report.html
python3 -m git_history explain --repo /path/to/repo --file src/example.py \
  --function Example.process --format json > report.json
python3 -m git_history files --repo /path/to/repo --directory src --language python
python3 -m git_history functions --repo /path/to/repo --file src/example.py
python3 -m git_history compare --repo /path/to/repo \
  --left-ref HEAD~1 --left-file src/a.py --left-lines 20:45 \
  --right-ref HEAD --right-file src/a.py --right-function Example.process --output comparison.html
python3 -m git_history changes --repo /path/to/repo --left-ref HEAD~1 --right-ref HEAD
python3 -m git_history serve --repo /absolute/path/to/repo
```

To install the `git-history` command, optionally with JavaScript/TypeScript support:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install '.[javascript]'    # or '.' for the core only
```

**Workbench security.** `serve` binds only to `127.0.0.1` (OS-assigned port unless `--port` is given) and prints a URL containing a fresh access capability in its fragment. Keep that URL private; reloading needs the original URL and restarting the service issues a new one. It is a single-user local tool, not a multi-user deployment.

**GitHub access.** `--fetch-discussions` (or the workbench checkbox) is the only feature that uses the network, and requires a `github.com` origin remote. Public repositories work unauthenticated within GitHub's rate limit; set `GITHUB_TOKEN` in the environment of `explain` or `serve` to raise the limit or read a private repository. The token is sent only to `api.github.com` and never written into reports.

Existing output files are kept unless `--force` is given. Exit status 0 means a report was produced (possibly with completeness warnings); 2 means an invalid request or unsupported input.

## Verify

```sh
python3 -m pip install -r requirements-dev.txt     # Ruff
python3 -m unittest discover -v                     # native-parser cases skip without the extra
python3 -m compileall -q git_history tests
ruff check .
python3 -m pip install '.[javascript]'
GIT_HISTORY_REQUIRE_JAVASCRIPT=1 python3 -m unittest discover -v
npm ci                                              # workbench test toolchain (Node 22.18+)
npm test                                            # Node unit tests for workbench JS
npm run lint
npx playwright install chromium
npm run test:browser                                # real services against temporary Git repos
```

Set `CHROMIUM_PATH` to use an installed browser and `GIT_HISTORY_PYTHON` to choose the interpreter used by browser tests. CI: `.github/workflows/git-history.yml` (Python 3.11–3.13 matrix with and without the parser extra, wheel install check, and a browser job). `scripts/smoke_changed_files*.{py,mjs}` are optional maximum-size probes, not part of CI.

## Project layout

- `git_history/cli.py` — command-line entry point (`explain`, `functions`, `files`, `compare`, `changes`, `serve`).
- `git_history/reader.py`, `git_history/runner.py`, `git_history/work_budget.py` — bounded, read-only Git subprocesses.
- `git_history/model.py`, `git_history/synopsis.py`, `git_history/render.py` — report schema, synopsis and HTML/JSON rendering.
- `git_history/function_parser.py`, `git_history/native_*.py` — Python AST and isolated Tree-sitter function discovery.
- `git_history/discussions.py` — opt-in GitHub PR and issue retrieval.
- `git_history/context.py` — supplied-context formats and validation.
- `git_history/comparison*.py`, `git_history/changed_files.py` — selection comparison and changed-file discovery.
- `git_history/workbench.py`, `git_history/web/` — loopback HTTP service and packaged browser assets.
- `tests/` — Python unit tests, Node `*.test.js`, and Playwright specs in `tests/browser/`.

## Data & privacy

The tool never checks out, fetches, runs hooks in or modifies the inspected repository, and disables external diff, textconv, fsmonitor and pagers for evidence reads. Without `--fetch-discussions`, nothing leaves the machine. Reports embed source and author metadata from the repository, so share them only where that code belongs. The workbench keeps everything in memory and uses no cookies or browser storage.

## Third-party code

The optional `javascript` extra installs Tree-sitter 0.25.2, tree-sitter-javascript 0.25.0 and tree-sitter-typescript 0.23.2 from PyPI under their own licenses.
