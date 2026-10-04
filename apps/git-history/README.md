# Git History

A local evidence explorer for unfamiliar code. Select a committed file range or named Python, JavaScript or TypeScript function; get a portable HTML report or structured JSON containing an evidence synopsis, source, blame, range-changing patches, commit messages, available rename evidence, and optional supplied discussion excerpts.

The tool organizes Git evidence. It does **not** invent author intent, generate semantic AI explanations, fetch PR discussions, or send source to a service. Commit messages are quoted author statements; a patch alone does not explain why a change was made.

## Run

Requirements: Python **3.11+**, Git **2.30+**, and Linux or macOS. Python function selection and manual ranges have no runtime Python dependencies. JavaScript/TypeScript function selection uses an optional pinned parser extra. Windows is not currently supported because bounded subprocess pipe handling uses POSIX selectors.

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

### Select a named function

Start with committed file discovery when you do not know the exact path:

```sh
python3 -m git_history files --repo /path/to/repository
python3 -m git_history files --repo /path/to/repository \
  --directory src --language typescript --format json
```

`files` lists regular committed Python (`.py`, `.pyi`), JavaScript and TypeScript
file candidates no larger than 512 KiB, with their exact paths, language and blob
sizes. It reads only Git tree metadata: it does not open, parse or execute source,
and does not require the optional parser. A matching suffix does not guarantee
valid syntax, UTF-8 source, or any functions; use `functions` to inspect a candidate.
Symlinks, submodules and larger blobs are omitted. Non-UTF-8 regular-file paths
are omitted with a count because they cannot be used by the UTF-8 selection API.

`--directory` is a literal repository-relative directory prefix; `src` includes
`src/nested` but not `src-extra`. Missing directories produce an empty catalog.
`--language` accepts `all` (default), `python`, `javascript`, or `typescript`
(including TSX). The JSON catalog preserves exact paths and the resolved commit
ID. Pass that ID to subsequent `functions` and `explain --ref` commands to keep
the same snapshot. Text paths in `files` and `functions` are JSON-quoted so newlines/control characters
cannot alter terminal output; decode them or use the JSON format for automation.
Discovery is bounded at 10,000 candidates and 2 MiB of combined Git output.
Exceeding a limit fails without publishing a partial list; narrow the directory
or language selection (directory filtering also reduces Git tree output).

List qualified names and complete source ranges from the committed file, then select one:

```sh
python3 -m git_history functions --repo /path/to/repository \
  --ref HEAD --file src/example.py
python3 -m git_history explain --repo /path/to/repository \
  --ref HEAD --file src/example.py --function Example.process --output function.html
```

The listing supports `--format json` for automation and includes the resolved commit ID. Use that ID with `explain --ref` to keep the same snapshot if a branch moves between commands. An individual explanation resolves its revision only once, so function selection and Git evidence always describe the same commit.

Python `.py` and `.pyi` files support ordinary and async functions, methods, and nested functions. Names include enclosing classes/functions (`Example.process`, `outer.inner`). Decorators are included in the selected range. Source is parsed with the running Python version's standard-library AST; nothing is imported or executed. Syntax errors and unsupported language versions produce guidance to use `--lines`. Repeated definitions with the same qualified name require a manual range. Functions over 200 lines are listed, but must be investigated with a smaller `--lines` selection. Exactly one of `--lines` or `--function` is required.

### Optional JavaScript and TypeScript selection

Install the extra explicitly in a virtual environment, from this app directory:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install '.[javascript]'
.venv/bin/git-history functions --repo /path/to/repository --file src/example.ts
.venv/bin/git-history explain --repo /path/to/repository \
  --file src/example.ts --function Example.process --output function.html
```

The extra pins Tree-sitter 0.25.2, the JavaScript grammar 0.25.0 and the TypeScript grammar 0.23.2. `.js`, `.jsx`, `.mjs` and `.cjs` use the JavaScript grammar; `.ts`, `.mts` and `.cts` use TypeScript; `.tsx` uses TSX. Parsing never consults repository `package.json` or `tsconfig`, imports the inspected source, installs packages automatically or fetches dependencies. Missing or incompatible parser packages produce setup guidance; `--lines` continues to work without the extra.

Supported names come from syntax:

- Named function and generator declarations, including async functions and named default exports.
- Direct identifier-bound arrows and function expressions, such as `const run = () => {}`. The binding `run` overrides a function expression's internal alias.
- Identifier class methods, constructors, getters/setters and callable fields. A class expression bound to `Store` uses that name, including nested named functions such as `Store.load.validate`.
- Identifier-bound object literal methods and callable properties, including nested identifier namespaces such as `api.users.fetch`.
- Parenthesized expressions and TypeScript `as`, `satisfies`, type assertion and non-null wrappers around those bound values.

Anonymous default exports, unbound callbacks, assignment inference, computed/private/string-literal members, namespace/module bodies, class static-initializer blocks, functions inside parameter expressions and type-only signatures are omitted. Their anonymous or unsupported scopes are barriers: nested declarations are not mislabelled as top-level functions. A `.d.ts` file with declarations but no implementation bodies produces an empty catalog. Exact identifier spelling is preserved; names do not resolve runtime aliases or normalize Unicode escapes. Getter/setter pairs and static/instance name collisions remain separate entries and can make a name ambiguous; use the listed `--lines` ranges.

Ranges count **physical LF-delimited Git lines** in the original committed bytes, preserving BOM, CRLF and Unicode line separators. Declarations include a direct export prefix; methods include their attached decorators/modifiers. Bound arrows/expressions cover their own declarator/property/field, so a separately lined `const` keyword can fall outside that range. Whole-line selection can include neighboring syntax written on the same line. Malformed or recovered syntax trees fail as a whole; no partial catalog is published. The pinned JavaScript grammar rejects a valid default export when both `export` and `default` occupy separate lines; use manual ranges for that formatting. TypeScript/TSX handles the corresponding named declaration with its complete export prefix.

Native parsing runs in a fresh isolated POSIX subprocess with a **5-second wall deadline**, **512 MiB address-space limit**, **3/4-second CPU limits**, and **8 MiB combined output cap**. The worker applies limits before loading native packages. Timeouts, crashes, caller interruption and oversized output trigger process-group cleanup; errors do not echo inspected source or native diagnostics. Unsupported resource controls fail with manual-range guidance. Linux Python 3.11–3.13 dependency/API checks passed; compatible macOS wheels exist, but macOS native parsing has not been runtime-verified.

### Attach supplied PR, issue, or discussion excerpts

`explain --context FILE` adds a separate **Unverified supplied context** section. It reads only your local file. It never fetches the linked discussion, verifies who wrote it, or treats the excerpt as established intent. The source label, author, URL and text are exactly what you supplied; matching a commit ID does not verify a claim or its relevance.

This complete example creates `context.json` with the exact selected commit ID. Replace the repository/file paths and the example source, URL, author and excerpt with your own supplied material:

```sh
REPO=/path/to/repository
COMMIT=$(git -C "$REPO" rev-parse --verify 'HEAD^{commit}')
COMMIT="$COMMIT" python3 - <<'PYTHON'
import json
import os
from pathlib import Path

context = {
    "schema_version": 1,
    "entries": [
        {
            "commit": os.environ["COMMIT"],
            "source": "Pull request #42 — supplied discussion excerpt",
            "url": "https://github.com/owner/repository/pull/42#issuecomment-123",
            "author": "Example author",
            "excerpt": "Replace this text with an excerpt you want to inspect alongside the commit."
        }
    ]
}
Path("context.json").write_text(json.dumps(context, indent=2), encoding="utf-8")
PYTHON
python3 -m git_history explain --repo "$REPO" --ref "$COMMIT" \
  --file src/example.py --lines 20:45 --context context.json --output report.html
```

The same flag works with `--function Example.process` and `--format json`. JSON adds `supplied_context`, containing `schema_version`, an explicit `provenance` warning, and `entries`. Each output entry retains the five supplied fields and adds `evidence_anchor`, linking to the corresponding embedded commit evidence. Omit `--context` to keep the existing report shape; there is no supplied-context section or JSON field. An empty `entries` array produces an explicitly empty section.

Every entry requires all five fields shown above. `commit` must be an exact lowercase **40- or 64-character full ID** already represented by the selected revision, selected-line blame, returned range changes, or returned renames. Abbreviations, branch names and unrelated IDs are rejected. To choose another commit, inspect the IDs in an existing JSON report. A context file remains usable after a ref changes only if its IDs are still represented; use an immutable `--ref` to reproduce a report. One invalid/stale entry rejects the entire file without publishing any report, even with `--force`.

Supported source links are credential-free HTTPS URLs on these public hosts:

- GitHub: `https://github.com/OWNER/REPO/pull/N`, `/issues/N`, or `/discussions/N`. Pull requests may include `#issuecomment-N`, `#discussion_rN`, or `#pullrequestreview-N`; issues may include `#issuecomment-N`; discussions may include `#discussioncomment-N`.
- GitLab: `https://gitlab.com/GROUP/PROJECT/-/merge_requests/N` or `/-/issues/N`, including nested groups and optional `#note_N`.

Here `N` is a numeric ID. Ports, user information, query strings, escaped paths, other hosts/routes and unrecognized fragments are rejected; remove tracking parameters before supplying a URL. Link existence and repository ownership are not checked. Clicking a report's source link uses your browser's network access.

Context input is a regular UTF-8 JSON file of at most **256 KiB**, with at most **50 entries**. Source labels and author names are **1–200 characters** each, excerpts **1–4,000**, and URLs **1–2,048**. Duplicate/unknown fields, unsupported schema versions, invalid Unicode, NUL and unsupported control characters are rejected. Errors do not repeat excerpt contents or rejected credential-bearing URLs. HTML escapes supplied text; JSON preserves it as string data. The existing total report size limit still applies.

For context tied to an exact report snapshot, the alternative **revision-bound records** format is also supported by the same `--context` flag:

```json
{
  "schema_version": 1,
  "revision": "<exact full revision from your JSON report>",
  "records": [
    {
      "commit": "<full commit ID from blame, changes or renames>",
      "url": "https://github.com/owner/repository/pull/42#issuecomment-123",
      "title": "Review of the selected helper",
      "author": "Example author",
      "excerpt": "Paste the relevant source excerpt here, preserving its wording."
    }
  ]
}
```

Replace the placeholders with exact IDs from an existing report, then run the command above with `--ref` set to that report's full revision. This envelope requires `revision` to equal the resolved report revision and every record's commit to appear in returned blame/change/rename evidence. The selected revision alone is insufficient if it has no displayed evidence. Changing revisions requires deliberately updating the envelope; changing selections or history limits may remove an accepted commit.

Records render as **Supplied discussion context** in HTML. JSON preserves this format as a `supplied_context` array with a separate `supplied_context_note` provenance warning. Titles are **1–300 characters**, authors **1–200**, excerpts **1–4,000**, and URLs **1–2,000**. Text permits newlines/tabs; carriage returns and other unsupported controls are rejected. The same 256 KiB, 50-record, safe-link and atomic-publication rules apply, including for direct renderer callers. Empty `records` produces an explicitly empty array/section. Use exactly one envelope format per file; mixing `entries` and `records` is rejected. With neither supplied, both context fields and the HTML section are omitted.

The Python API retains both `render_json(report, entries)` / `render_html(report, entries)` for `ContextEntry` values and `report.supplied_context` for `SuppliedContext` records. `load_context` returns a list of entries or a `ContextRecords` list for the revision-bound format, preserving the format even when empty. Its return value can also be passed directly as the renderer's second argument. Supplying both rendering arguments rejects the request rather than silently discarding context.

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
- Function catalogs are limited to **10,000 definitions**, **2 MiB** of total qualified-name text, and **8 MiB** of serialized output. Files exceeding these limits can still be investigated with manual ranges. CRLF and UTF-8 BOM are supported; Python bare CR newlines require manual ranges because Python and Git count them differently. JavaScript/TypeScript ranges always count LF only.
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

Tests create temporary repositories and cover roots, line edits and insertions, rename-plus-edit, merges, shallow and bare repositories, special filenames, invalid input, Git configuration side effects, output protection, HTML escaping/anchors, function selection from immutable snapshots, synopsis evidence, CLI behavior, subprocess timeouts and byte caps, and bounded supplied-context imports with exact commit matching, safe discussion links and escaped provenance. No existing repository is modified by the tests.

The default suite explicitly skips native syntax cases when the extra is absent. To require and verify the entire optional feature:

```sh
python3 -m pip install '.[javascript]'
GIT_HISTORY_REQUIRE_JAVASCRIPT=1 python3 -m unittest discover -v
python3 -m pip wheel --no-deps . --wheel-dir dist
```

CI checks dependency-free behavior before installing the extra, then requires the complete native suite and checks the installed command outside the source tree on Python 3.11, 3.12 and 3.13.

Future work includes evidence-grounded semantic summaries. Supplied excerpts remain unverified context; this tool does not infer intent or automatically retrieve discussions.

### Measured optional-parser verification

[Recorded evidence](docs/2026-10-04-javascript-verification.json) covers the 177-test suite on actual Linux Python 3.11.16, 3.12.14 and 3.13.5: 176 pass with the extra and one core-only case skips. Without the extra, 151 pass and 26 native cases explicitly skip. Ruff, compilation, wheel build and installed commands outside the source tree passed.

An independently parsed TypeScript 5.9.3 reference matched all 20 top-level function declaration ranges across committed Stock, Lens and Melody sources. Real installed CLI HTML/JSON reports matched the selected source and 25/46/13 blame lines respectively. The installed worker accepted exactly 512 KiB of source and 10,000 definitions, rejected one-byte/one-definition excess and qualified-name amplification, and rejected a 512 KiB malformed-depth fixture. The 10,000-definition catalog took 0.17 seconds; maximum observed child RSS across this acceptance run was 138 MiB. These are bounded fixture measurements, not a semantic-correctness or throughput guarantee for arbitrary source.
