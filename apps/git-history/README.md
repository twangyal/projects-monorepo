# Git History

A local evidence explorer for unfamiliar code, with a command line and browser workbench. Select a committed file range or named Python, JavaScript or TypeScript function; get a portable HTML report or structured JSON containing an evidence synopsis, source, blame, range-changing patches, commit messages, available rename evidence, and optional supplied discussion excerpts.

You can also explicitly compare two committed source selections, including different paths or functions, with exact line changes and portable comparison exports.

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

### Browse in the local workbench

From this app directory, start the service for one local repository:

```sh
python3 -m git_history serve --repo /absolute/path/to/repository
```

Open the exact URL printed in the terminal. It uses an OS-assigned port on `127.0.0.1` and a fresh access capability in its fragment. The page removes that fragment immediately and keeps access only in memory. Reopening or reloading a page requires the original terminal URL; restarting the service creates a new capability. Keep that URL private. There are no accounts, cookies, browser storage, remote requests or repository writes. Stop the service with Ctrl-C. `--port N` can request a fixed local port; the service cannot bind a public interface.

1. Enter a committed ref such as `HEAD`, optionally narrow the directory/language, and discover source files. The resulting full commit ID fixes this investigation even if the branch later moves. Explicitly rediscover to choose another snapshot.
2. Open a candidate or enter an exact repository-relative path. Read the numbered committed source in pages; uncommitted edits are excluded. Choose a function or enter a 1–200-line range. Function discovery needs the optional parser for JavaScript/TypeScript; manual ranges work for other UTF-8 text too. Ambiguous/oversized functions require a manual range.
3. Optionally upload a supplied-context JSON file in either documented format below, or generate an initial report and choose **Author supplied discussion** to create literal records from its displayed evidence. Authors, links and claims remain unverified, and commit associations must match the actual report evidence. The browser sends bounded text, never a server-side file path.
4. Generate the report, follow its local evidence links, and download portable HTML or structured JSON. Both downloads come from the same report and use the existing CLI renderers. Reports contain the selected repository's source and author metadata; share them only where that content belongs. External evidence links connect only when explicitly opened.

The workbench keeps source, catalogs and reports in memory for the current session. It shows pending work and offers Stop; replacing a request waits for cancelled subprocess cleanup and cannot publish stale results over a newer selection. Recoverable errors preserve draft fields. Source is paginated at 100 physical Git lines and file/function catalogs at 50 entries, so large valid inputs do not create an unbounded page.

Only one job runs at a time. Existing source/Git/parser limits still apply, with an additional 45-second aggregate subprocess deadline and 32 MiB combined subprocess-output budget per job. Python parsing runs in a standard-library worker with the same 5-second/512 MiB limits as optional native parsing. Bounded in-process validation/rendering observes cancellation between stages; Stop is cooperative during those stages. HTTP input is limited to 2 MiB with an absolute 5-second header/body deadline; supplied context is still at most 256 KiB. Each report is at most 8 MiB and each serialized response at most 32 MiB. Exceeding a limit fails that operation without changing the repository.

The service accepts only its exact loopback Host, same-origin authenticated API requests and its packaged static assets. It serves one repository selected at startup; the browser cannot switch repository roots, read arbitrary local context files or write reports into server paths. It is a local developer tool, not a multi-user deployment or protection against other software running as your OS user.

### Author supplied discussion context

Generate a history report first, then choose **Author supplied discussion**. Select a full commit ID from the report's displayed blame, range changes or rename evidence. The selected revision is offered only when it also appears in that evidence. Enter the discussion title, attributed author, source URL and exact excerpt, then add it to the context draft. Edit, cancel an edit or remove individual records without rebuilding a JSON file by hand.

Adding a row only updates the local draft. Generate the report with context to validate every record against the actual selected Git evidence. On success, **Download validated context JSON**, HTML and report JSON belong to the same completed request. The reusable context file uses the existing revision-bound `records` format and works with CLI `--context`; no private UI row identifiers are serialized. Titles, authors and excerpts retain accepted whitespace, spelling and Unicode. They render as text, and links are never fetched automatically. Matching a commit does not verify a claim, author, link or relevance.

The context modes retain separate in-memory state. **None** generates fresh evidence without attaching context, **Uploaded** uses the selected JSON file, and **Authored** uses the local records. Both existing upload formats remain supported without conversion. Changing source selection, history limits or revision makes prior downloads stale while keeping the records and raw fields. Use None to inspect fresh evidence if needed. A changed revision additionally requires explicit rebinding of the authored envelope; each retained commit must still be accepted by the server. An out-of-scope record rejects the entire report until you deliberately edit or remove it.

The same bounds apply: at most **50 records**, **256 KiB** of UTF-8 JSON, title 1–300, author 1–200, excerpt 1–4,000 and URL 1–2,000 characters, with the existing conservative HTTPS GitHub/GitLab discussion-link policy. Text limits count Unicode code points. Invalid or excessive input stays editable and cannot partially replace the accepted rows. Save or cancel an active row edit before generating authored context. Later input, mode changes, cancellation or page departure retire pending publication and downloads; previous reports remain visibly stale.

Drafts are session-only. Download validated context to retain it; unaccepted form text is not included. The page warns before leaving with unsaved authoring. Reloading does not restore local records and requires the original private launch URL, as with the rest of the workbench. There is no browser storage or automatic discussion retrieval.

### Discover files changed between two commits

Choose **Compare revisions**, then use **Discover changed files** to compare two committed tree snapshots. Enter Left ref, Right ref and an optional literal directory prefix, then discover explicitly. Both refs resolve once; the catalog displays their complete immutable IDs and continues to refer to those snapshots even if a branch moves. It does not inspect your working tree or choose a merge base.

Rows show literal paths, change categories, old/new modes and object IDs. Additions, deletions, content changes, executable-mode changes and entry-type changes are distinct. Rename inference is disabled: moving a file appears as a deletion and an addition. Symlinks and gitlinks remain visible metadata; the tool never follows their targets or opens submodules. A regular blob is an **uninspected text candidate**, not a promise that it is UTF-8, nonbinary or within the source limits. The existing explicit Open source action checks those properties.

Browse 100 rows per page or filter the captured catalog locally. **Use these comparison paths** deliberately fills both comparison sides with the same exact path and the captured IDs. A missing endpoint selects Missing path; a present regular endpoint selects Whole file. This does not fetch source or generate a comparison. If either side already has entered selections, confirm replacement or cancel to retain its fields and report exactly. After handoff, explicitly open the available source and use the existing comparison controls; large files still require a bounded manual range or function.

**Download changed-file JSON** saves complete metadata for the captured catalog using the same canonical UTF-8 serialization as the CLI. Typing or changing discovery input, Stop, workspace changes and page departure retire stale publication/download authority. Literal paths are displayed with visible escaping; control characters are not interpreted as markup. Git paths that the existing source API cannot address stay visible with handoff disabled. Non-UTF-8 path bytes are omitted with an explicit count, never replacement characters or invented names.

```sh
python3 -m git_history changes --repo /path/to/repository \
  --left-ref HEAD~1 --right-ref HEAD --directory src --format text
python3 -m git_history changes --repo /path/to/repository \
  --left-ref LEFT_FULL_ID --right-ref RIGHT_FULL_ID --format json > changed-files.json
```

The optional directory is an exact subtree prefix: `src` includes `src/file.py`, not `src-extra/file.py`. Paths retain their exact UTF-8 bytes and sort by those bytes, rather than locale order. A valid same-revision comparison is empty; missing revisions/objects and command failures remain errors. The complete catalog is refused if it exceeds **10,000 raw changed entries**, **2 MiB** per-command output, or **8 MiB** serialized JSON. Paths/directories are at most 4,096 UTF-8 bytes and refs 1,024. The existing **45-second / 32 MiB** aggregate job budget also applies; narrow the directory when a tighter bound dominates. No partial authoritative list is published.

### Compare two committed selections

Choose **Compare revisions** in **Workspace**. The Left and Right sides are
independent: discover each ref, then open its exact path and choose **Whole file**,
**Manual range**, **Named function**, or **Missing path**. Each discovery displays
its full immutable commit ID. Editing a ref unpins that side; explicitly rediscover
to use a changed branch. Opening or editing the other side does not repin it.

Use different paths to inspect a moved function or renamed file. This is your
explicit pairing, not an inferred rename or claim that the symbols mean the same
thing. Named functions use the existing optional parser rules; manual ranges and
whole text files do not need that extra. Each comparison side supports at most
**200 physical Git lines** from a **512 KiB** UTF-8 source blob. Select a smaller
range when a whole file or function exceeds 200 lines; nothing is silently clipped.

For an addition or deletion, choose **Missing path** on the absent side and give
the exact path at its pinned commit. The comparison verifies actual absence.
Canonical paths exclude `./`, repeated slashes and trailing slashes, so Git path
normalization cannot turn an existing entry into a false absence.
An empty committed file is present and compares as zero lines. Directories,
symlinks, binary/non-UTF-8 source, bad revisions, unavailable objects and failed
reads are errors; they cannot become a missing side. Both sides cannot be missing.

Choose **Compare selected source** to review the immutable result. It preserves
exact source and original line numbers, including BOM, CRLF, Unicode separators,
whitespace and the absence of a final newline. The alignment uses exact full-line
matches and a deterministic deletion-first tie rule. Consecutive unmatched lines
are paired in order for display; that pairing does not establish semantic
correspondence, moved-line detection or a patch that can be applied elsewhere.

Comparison rows paginate at 100 rows. **Download comparison HTML** and **Download
comparison JSON** save the exact completed report, including both commit IDs,
paths, selection modes, source hashes and change counts. Hashes establish text
integrity, not authenticity. HTML is standalone and script-free. Browser exports
use their submitted full IDs as `requested_ref`; the original typed discovery
labels remain separate in the workbench. Any newer source-selection input makes
the previous result visibly stale and disables its downloads. Errors, Stop and
late responses preserve your current fields; workspaces retain their own drafts.
No comparison data is autosaved or sent to a remote service.

The CLI uses the same comparison and renderers:

```sh
python3 -m git_history compare --repo /path/to/repository \
  --left-ref HEAD~1 --left-file src/example.py --left-lines 20:45 \
  --right-ref HEAD --right-file src/example.py --right-function Example.process \
  --output comparison.html
```

Each side requires exactly one of `--left-whole`, `--left-lines START:END`,
`--left-function NAME`, `--left-missing` (and corresponding `--right-*` choices).
Both file paths are required, including a missing path. Each ref defaults to
`HEAD` and is resolved once independently; use full IDs to reproduce pinned
workbench exports. Use `--format json` for structured output, `--output -` or no
output flag for stdout, and explicit `--force` to replace an existing report.
The existing Git-metadata protections and atomic no-clobber publication apply.

Comparison JSON has its own `kind: "source-comparison"`, schema version 1; it does
not change the existing history-report schema. Selected text occurs once per side,
with alignment blocks expressed as zero-based half-open offsets into physical
LF-delimited source tokens. Original file line bounds remain 1-based. Source
SHA-256 is null for missing paths and the hash of empty bytes for an empty file.
Direct library renderers validate source/provenance field shapes, hashes and the
canonical alignment; this consistency check does not authenticate supplied Git
provenance. See the [comparison contract](../../docs/superpowers/specs/2026-10-04-git-comparison-design.md).

The exact-line algorithm performs at most 40,000 cell comparisons using an
approximately 80 KiB typed table. Tokenization, alignment, reading, parsing and
rendering cooperate with the existing job budget. CLI comparisons also use the
45-second aggregate deadline and 32 MiB subprocess-output budget. Each output is
bounded at 8 MiB. No history/blame/context, remote discussion fetching, generated
explanation or repository-wide change summary is implied by a comparison.

### Select a named function

Start with committed file discovery when you do not know the exact path:

```sh
python3 -m git_history files --repo /path/to/repository
python3 -m git_history files --repo /path/to/repository \
  --directory src --language typescript --format json
```

`files` lists regular committed Python (`.py`, `.pyi`), JavaScript and TypeScript
file candidates no larger than 512 KiB, with their exact paths, language and blob
sizes. It reads committed tree entries and blob-size metadata, without reading,
parsing or executing source contents,
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

The browser workbench has a separate development-only verification toolchain; Node is not needed to run the installed app:

```sh
npm ci
npm test
npm run lint
npx playwright install chromium
npm run test:browser
```

Set `CHROMIUM_PATH=/path/to/chromium` to use an installed browser and `GIT_HISTORY_PYTHON=/path/to/python` to choose the service/test interpreter. Browser cases create isolated temporary Git repositories and real services on ephemeral ports. CI runs them with the optional parser installed, alongside the existing Python 3.11–3.13 matrix. The Python wheel includes all static workbench assets.

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

### Measured workbench verification

Issue [#52](https://github.com/twangyal/projects-monorepo/issues/52) expands the suite to **239 discovered Python cases**: native-enabled runs on Python 3.11–3.13 pass with two expected skips, and the dependency-free run passes with 26 optional skips. Eight real Chromium flows cover immutable discovery/source/function/manual selection, rename evidence, supplied context, actual report anchors, byte-identical CLI downloads, cancellation, parser fallback, large-source pagination and same-tab session recovery. Seven enabled cases also pass using the installed wheel outside the source tree; the source suite separately verifies missing parser dependencies.

Independent installed-package checks handled 10,000 candidate files, 10,000 Python functions, and an exact 512 KiB/8,192-line source with only 50 catalog/function rows and 100 source rows rendered. Actual HTML/JSON downloads matched independently invoked CLI bytes; a real report click reached the source target and scroll position inside the opaque sandbox. The 390-pixel layout had no page overflow, page errors or external requests. The browser suite also covers a 524,288-line source. These are fixture/runtime measurements, not latency guarantees or other-device compatibility. The complete final Python 3.11–3.13 matrix and browser job passed [CI at `c2bac6c`](https://github.com/twangyal/projects-monorepo/actions/runs/37175391363). See [the workbench verification record](docs/2026-10-04-workbench-verification.json).


### Measured comparison verification

Issue [#64](https://github.com/twangyal/projects-monorepo/issues/64) passes **304
Python cases discovered**: 302 pass with the optional parser and two expected
skips; 278 pass without it and 26 optional skips. Ruff, compilation and JavaScript
lint pass. All **20 native browser cases** pass, including the eight original
workflows unchanged. The installed wheel covers the same 20 cases outside the
source tree: 18 with the extra and two against an actually parser-free environment.
[CI at `37831a3`](https://github.com/twangyal/projects-monorepo/actions/runs/37192168127)
passes the core/native Python 3.11–3.13 matrix and all 20 Chromium153 browser cases.
All twelve project workflows passed that implementation commit.

A separate original maximum-size fixture compares two exact 524,288-byte,
200-line committed sources, with ten changes specified before output was observed.
Native controls retain 100 rows per page and produce the expected 190 unchanged,
10 removed and 10 added lines; a dirty worktree is ignored. Actual downloaded
JSON (1,102,745 bytes) and HTML (2,119,823 bytes) are byte-identical to independent
installed CLI outputs. The measured native comparison took 328 ms; the complete
probe took 4.07 seconds. Private capabilities and absolute repository paths are
absent from artifacts; no app storage, external requests or page errors occurred.
Desktop and390px viewport screenshots were inspected and owned service/browser
processes closed. These are fixture measurements, not general latency promises.

The [comparison verification record](docs/2026-10-04-comparison-verification.json)
retains hashes, exact inputs/counts, package-source parity, observed test history
and limits. Review reproduced and fixed normalized path aliases falsely reported
as missing; existing reader behavior stayed unchanged. The one full-suite test
import failure was corrected before final304-case runs, without production changes.


### Measured discussion-authoring verification

Issue [#85](https://github.com/twangyal/projects-monorepo/issues/85) adds literal,
revision-bound context editing and exact validated context downloads. All **311
Python cases** are discovered on Python 3.11–3.13: 309 pass with the optional
parsers and two expected skips; the dependency-free run passes 285 with 26 skips.
Nine Node cases, full Ruff/JavaScript lint and compilation pass. All **35 source
browser cases** pass (20 existing and 15 new). The same 35 cases pass against
the installed wheel outside the checkout: 33 with optional parsers and two in an
actually parser-free environment (4.3 seconds for that two-case gate). Running
those two fixtures with installed parsers first failed; no product or test change
was required once the documented split environment was used.

Real native authoring covers 50 accepted records, refusal of the 51st, a
261,196-byte multibyte envelope, literal hostile-looking text, both legacy upload
formats, explicit revision rebinding, authoritative out-of-scope rejection, raw
field/caret retention, genuine delayed report/file delivery, cancellation and
390-pixel keyboard use. Exact 262,144-byte acceptance and one-byte excess are
separate Node/Python checks. The installed 0.7.0 wheel contains byte-identical
assets; all twelve actual context/HTML/JSON downloads match source-run bytes.
Three flows match independent CLI HTML and JSON; the near-capacity flow checks
CLI JSON only. These are measured fixtures, not arbitrary-input latency promises.

The [verification record](docs/2026-10-04-context-authoring-verification.json)
retains exact artifact/source hashes, actual failed attempts and corrections,
independent domain checks, package details and verification limits.

The [exact-head push CI](https://github.com/twangyal/projects-monorepo/actions/runs/37209120068)
at `a04bc50862b1a4a89c9af2b8a9990b5020aa685d` passes the full core/native Python
3.11–3.13 matrix, nine Node tests, lint, compilation, installed command/worker
checks and all 35 browser cases (52.2 seconds). The PR run independently passes
the same checks against its merge checkout. All thirteen project PR workflows
passed. The [CI receipt](docs/2026-10-04-context-authoring-ci.json) distinguishes
those checkouts and retains actual job counts/timings.


### Measured changed-file discovery verification

The 0.8.0 milestone (#123) discovers changed committed-tree paths before either
source selection is opened. All 357 Python cases are discovered locally: the
core environment passes 331 with 26 intentional optional-parser skips, and the
native-parser environment passes 355 with two intentional core-only skips.
All 17 Node cases, Ruff, JavaScript lint, compilation, wheel build and all 46
source browser cases pass. All 46 cases also pass against fresh installed wheels,
using 44 native-parser cases and two dependency-failure cases in the parser-free
environment. An initial native-wheel invocation mistakenly included one of the
core-only cases; its expected dependency error required the documented parser-free
environment, with no product or assertion changes. The eleven new browser cases cover exact catalog
exports, addition/deletion handoff, unsupported kinds, literal paths, paging,
raw draft ownership, cancellation, confirmation and immutable revision pins.

An independent original fixture has exactly 10,000 changed paths. Its complete
3,890,122-byte metadata catalog matches source CLI, freshly installed parser-free
wheel CLI and native browser download byte for byte. The 10,001st change is
refused without partial JSON. Actual page-two handoff and explicit source loads
produce exact CLI/browser comparison HTML and JSON; dirty tracked files, staged
content, untracked files and the Git index remain byte-identical. This is a count
maximum with small paths, not simultaneous saturation of every byte limit.
Separate controlled fixtures cover the exact raw 2 MiB and JSON 8 MiB limits and
one-byte overflow. The 0.8.0 wheel packages byte-identical browser assets.

The [verification record](docs/2026-10-05-changed-files-verification.json),
[independent oracle](docs/2026-10-05-changed-files-oracle.json) and
[maximum fixture receipt](docs/2026-10-05-changed-files-maximum.json) retain
original expectations, actual attempts, source/artifact hashes and limitations.
