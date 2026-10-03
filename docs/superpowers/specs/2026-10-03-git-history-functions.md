# Git History function selection and synopsis

Issue #13 continues idea #4 on `Astra`. User authorization permits independent product decisions. No external services or repository code execution are required.

## Product behavior

`functions --repo PATH --ref HEAD --file module.py [--format text|json]` lists committed Python functions, async functions, methods and nested functions as qualified names with complete ranges. `explain` accepts exactly one of `--lines START:END` or `--function QUALIFIED_NAME`. Qualified names include enclosing classes and functions; control-flow blocks do not create scopes. Repeated definitions remain separate candidates and require manual line selection. Decorators belong to the function's range. Over-200-line functions are listed but cannot be selected without choosing a smaller manual range.

Parse only a bounded regular committed UTF-8 `.py` or `.pyi` blob using Python AST. Never import or execute inspected code. Parser syntax/depth failures become actionable errors; syntax support follows the running Python version. Resolve the requested revision once and share that snapshot between selection and attribution. Existing manual ranges continue working for all supported UTF-8 source files.

## Shared contracts

- `model.FunctionDefinition(qualified_name: str, start_line: int, end_line: int, kind: str)`; kind is `function` or `async function`.
- `model.FunctionCatalog(repo_name: str, revision: str, requested_ref: str, path: str, functions: list[FunctionDefinition])`.
- `Report` gains an optional trailing `selected_function: str | None = None`. Schema version 1 gains additive fields; existing evidence fields retain their meanings.
- `reader.list_functions(repo, file, ref='HEAD') -> FunctionCatalog`.
- `reader.inspect_repository(repo, file, start=None, end=None, ref='HEAD', max_commits=20, *, function=None) -> Report`. Exactly one complete range or function name is required. Existing positional range calls remain compatible. A single shared internal snapshot load provides the Git runner, SHA and entire bounded source to both routes.
- `synopsis.build_synopsis(report) -> dict` returns machine-readable factual summaries. `render_json` adds this derived `synopsis` object to the serialized report. HTML renders the same facts and links to embedded evidence.

## Synopsis

Show selected range/function and immutable revision, current-line attribution grouped by commit with counts, up to three available newest range-change records with clearly quoted bounded message excerpts, whole-file rename evidence and explicit completeness notes. Every commit observation links to its existing embedded evidence. Do not label the oldest returned commit as the function's introduction, treat message text as verified reasoning, infer causation from a patch, or describe chronology using blame counts. Excerpts are visibly labeled when truncated. Empty and partial reports remain useful and explicit. Preserve HTML escaping, offline CSP and maximum serialized size.

## Verification and ownership

Reader implementer owns model/reader/function parser and their tests. Report implementer owns synopsis/render and report tests. Integrator owns CLI, CLI tests, docs/catalog, integration and review. Shared interfaces above prevent overlapping edits.

- Real fixture repositories: decorators, async/method/nested definitions, conditional duplicate names, unsupported files, syntax/depth errors, oversized functions, changed working-tree source and identical manual-range evidence.
- CLI: listing formats, exclusive selection, clean unknown/ambiguous failure without output, full offline function-to-report flow.
- Synopsis: correct counts, bounded excerpts, evidence anchors, unknown intent and incomplete history.
- Run complete unit suite, Ruff, compile checks, package build/install and Chromium desktop/mobile report checks. Independent review followed by concrete regression fixes. Commit/push, update issue #13 and PR #12, then reassess.
