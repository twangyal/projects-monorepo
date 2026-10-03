# Git History

A local evidence explorer for unfamiliar code. Select a committed file range or Python function; get a portable HTML report or structured JSON containing an evidence synopsis, source, blame, range-changing patches, commit messages, and available rename evidence.

The tool organizes Git evidence. It does **not** invent author intent, generate semantic AI explanations, fetch PR discussions, or send source to a service. Commit messages are quoted author statements; a patch alone does not explain why a change was made.

## Run

Requirements: Python **3.11+**, Git **2.30+**, and Linux or macOS. There are no runtime Python dependencies. Windows is not currently supported because bounded subprocess pipe handling uses POSIX selectors.

From this app directory:

```sh
python3 -m git_history explain \
  --repo /path/to/repository \
  --ref HEAD \
  --file src/example.py \
  --lines 20:45 \
  --output report.html
```

Open `report.html` in a browser. Everything is embedded: no web server, JavaScript, external assets, or internet access is needed. The report links source lines to attribution, commit evidence, and expandable patches. Recognized credential-free GitHub/GitLab origins add optional commit links; clicking those links uses your browser's network access.

For automation:

```sh
python3 -m git_history explain --repo /path/to/repository \
  --file src/example.py --lines 20:45 --format json > report.json
```

### Select a Python function

List qualified names and complete source ranges from the committed file, then select one:

```sh
python3 -m git_history functions --repo /path/to/repository \
  --ref HEAD --file src/example.py
python3 -m git_history explain --repo /path/to/repository \
  --ref HEAD --file src/example.py --function Example.process --output function.html
```

The listing supports `--format json` for automation and includes the resolved commit ID. Use that ID with `explain --ref` to keep the same snapshot if a branch moves between commands. An individual explanation resolves its revision only once, so function selection and Git evidence always describe the same commit.

Python `.py` and `.pyi` files support ordinary and async functions, methods, and nested functions. Names include enclosing classes/functions (`Example.process`, `outer.inner`). Decorators are included in the selected range. Source is parsed with the running Python version's standard-library AST; nothing is imported or executed. Syntax errors and unsupported language versions produce guidance to use `--lines`. Repeated definitions with the same qualified name require a manual range. Functions over 200 lines are listed, but must be investigated with a smaller `--lines` selection. Other languages retain manual range support. Exactly one of `--lines` or `--function` is required.

### Read the synopsis

The report starts with a factual synopsis: which commits account for the current selected lines, up to three available range changes with quoted message excerpts, whole-file rename evidence, and completeness notes. Each observation links to the underlying report evidence. The oldest displayed change is not necessarily a function's introduction. Messages record author statements; the tool does not treat them as verified rationale or infer intent from a patch.

`--repo` defaults to the current directory; subdirectories normalize to the repository root. `--file` is always an exact **repository-relative** path, including when `--repo` names a subdirectory. Quote paths containing spaces. For a path beginning with a dash, use `--file=-example.py`. Bare repositories are supported. The selected revision must contain the file as a regular UTF-8 text blob.

`--ref` defaults to `HEAD`; it resolves once to an immutable commit ID. Uncommitted changes are excluded. Git replacement objects and configured blame exclusion lists do not alter the evidence; author names come from raw commit metadata, without uncommitted mailmap remapping. A malformed configured ignore-revs file can prevent Git attribution and produces an explicit error. No repository configuration is changed.

You can optionally install the command in a virtual environment:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/git-history explain --repo /path/to/repository \
  --file src/example.py --lines 20:45 --output report.html
```

## Output and limits

- HTML is the default. Omit `--output` or use `--output -` for stdout. JSON uses report schema version 1 and the fields defined in `git_history/model.py`, plus a derived `synopsis` object. `selected_function` is null for manual ranges. These fields extend the original schema; consumers should allow additional fields.
- Existing output files are preserved unless `--force` is supplied. Git metadata is protected even with `--force`, including bare and separate Git directories. Output publication is atomic; missing parent directories are reported.
- Select at most **200 lines** from a source blob no larger than **512 KiB**. Binary/NUL-containing, non-UTF-8, symbolic-link and submodule inputs are rejected.
- Function catalogs are limited to **10,000 definitions**, **2 MiB** of total qualified-name text, and **8 MiB** of serialized output. Files exceeding these limits can still be investigated with manual ranges. CRLF and UTF-8 BOM are supported; bare CR newlines require manual ranges because Python and Git count them differently.
- `--max-commits` is **1–50**, default **20**. Older range changes and rename records can be omitted; truncation is disclosed.
- Each Git command has a **10-second** timeout and **2 MiB** combined stdout/stderr cap. Processes are killed and reaped on limits. Serialized reports are limited to **8 MiB**.
- Shallow history is usable but incomplete. Configured partial/promisor clones are rejected to avoid implicit object downloads; use a complete local clone.
- Optional line-history or rename failures retain valid blame and add warnings. Renames are Git similarity heuristics. Merges, moved/copied code and rewritten functions can defeat line tracing; this is not a complete semantic lineage graph.
- A zero exit status means a report was produced, possibly with explicit completeness warnings. Invalid requests, unsupported input or output errors exit with status 2. A closed stdout pipe exits with status 1.

Git commands use argument arrays, literal file paths and resolved object IDs. External diff, text conversion, configured signature verification, fsmonitor and pagers are disabled for evidence reads. The tool never checks out files, fetches objects, runs repository hooks, or modifies the inspected repository. Reports can contain private source and author metadata: share the generated file only where that repository's content belongs.

## Verify

```sh
python3 -m unittest discover -v
python3 -m compileall -q git_history tests
```

Lint with the development-only Ruff version used in CI:

```sh
python3 -m pip install -r requirements-dev.txt
ruff check .
```

Tests create temporary repositories and cover roots, line edits and insertions, rename-plus-edit, merges, shallow and bare repositories, special filenames, invalid input, Git configuration side effects, output protection, HTML escaping/anchors, function selection from immutable snapshots, synopsis evidence, CLI behavior, subprocess timeouts and byte caps. No existing repository is modified by the tests.

Future work includes optional user-supplied PR/discussion evidence and evidence-grounded semantic summaries. The current report remains useful offline without either.
