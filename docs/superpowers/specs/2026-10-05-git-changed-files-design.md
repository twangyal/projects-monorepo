# Git History changed-file discovery — approved contract (#123)

Approved by root on 2026-10-05 after Motion #122 local acceptance and publication. Issue #123 tracks this complete milestone; implementations and independent verification use the disjoint ownership below. No runtime acceptance is implied by this design.

## Concrete gap and overlap check

The current CLI offers `explain`, `functions`, `files`, `serve`, and `compare` (`git_history/cli.py:92–117`). Workbench jobs are exactly files/source/functions/report/comparison (`workbench.py:94`). File discovery inspects one committed tree and only supported-language regular blobs <=512 KiB (`reader.py:220–270`). Comparison needs two already chosen exact paths and supports at most200 lines per side. A developer investigating a release/regression still needs another tool to discover which paths changed before using the comparison UI.

GitHub connector title/topic searches found existing #41 file discovery, #52 workbench, #64 comparisons and #85 supplied discussion authoring; no matching changed-file catalog issue. An explicit remote `Astra` fetch of `apps/git-history/git_history/workbench.py:90–107` confirmed the same five operations (Git blob SHA2bfd2287e571c3d8f0632a69c6cca3256f3a296e). Local Git History's latest path commit is c29ad09 (published #85 receipt). Generic repository commit search follows the default branch rather than proving Astra freshness, so do not use it as a branch-head claim. Root's concurrent Karaoke #121 and Stock #120 remain unrelated/excluded. No new issue was created.

## Complete first user flow

Inside the existing Compare revisions workspace, add a separate **Discover changed files** panel. Enter Left ref, Right ref and optional literal directory prefix; explicitly discover. Resolve both refs once, display both complete immutable IDs and count the catalog. Browse100 rows/page, optionally filter the returned literal paths/status locally. Rows show exact path, change kind, old/new Git mode and object IDs. Explain that this is a committed-tree comparison, not a merge-base/PR diff or working-tree scan.

A deliberate **Use these comparison paths** action on an eligible row seeds the existing Left/Right comparison controls with both pinned IDs and the same exact path. It does not immediately read source, generate a report, replace history-authoring context, or write anything. Existing Open source controls load each present side through the existing single pump. Missing sides choose the existing explicit Missing path mode; the final comparison still verifies absence independently. Default present selection is Whole file; if it exceeds200 lines the existing UI requires a manual range/function rather than clipping it. Empty files remain present. Resulting exact HTML/JSON comparison exports continue using existing renderers and contain full pinned IDs.

Before handoff, explicitly confirm replacing existing comparison-side selections/raw fields when they have been edited. Cancel keeps them exact. History workspace/context drafts remain untouched. Add a **Download changed-file JSON** button for the completed catalog; this is a bounded metadata artifact, not a new source report or backup/import format. No HTML catalog renderer is needed for this slice.

## Exact first-slice semantics

- Compare two entire committed tree snapshots, directly Left→Right. No implicit merge base, branch-tip refresh, working-tree contents, rename/copy detection, semantic similarity or generated explanation.
- Explicit `--no-renames`; an actual moved file appears as independent deletion and addition. Users can still pair different paths deliberately using the existing comparison workflow. No rename score or inferred identity in this catalog.
- Include all changed leaf entry types, regardless of language: regular100644/100755 blobs, symlinks120000 and gitlinks160000. Do not follow symlinks, open submodule repositories, inspect external paths or read their targets. Trees are traversal containers, not rows. Directory↔file replacement appears as the underlying changed leaf paths.
- Change categories: `added` (old absent), `deleted` (new absent), `type-changed` (entry kind differs), `mode-changed` (same blob ID, different regular mode), `modified` (other changed object identity). If content and executable mode both change, categorymodified plus explicit modes captures both facts. No unchanged rows. Same revision is a successful empty catalog.
- A regular blob is only a **candidate** for text comparison. Catalog never claims UTF-8, nonbinary, small enough or <=200 lines without reading it. Binary/invalid-UTF8/oversize source is diagnosed only by the existing explicit Open source action. Symlink/gitlink rows remain visible but have no comparison handoff; explain why. This avoids eagerly reading up to10,000×512 KiB blobs or silently classifying unavailable data as absence.
- Invalid/nonexistent revisions or unavailable local objects fail the operation. Do not convert errors into an empty catalog or missing path. Shallow repositories may compare two available tree snapshots; absence of older history is irrelevant to this exact tree operation. Partial/promisor clones remain refused under existing policy.

## Proposed exact library/wire shape

New frozen dataclasses in `git_history/changed_files.py` (snake_case as current catalog API):

```python
@dataclass(frozen=True)
class ChangedEndpoint:
    kind: str       # regular | symlink | gitlink
    mode: str       # exact six-octal Git mode from admitted set
    object_id: str  # full repository object ID,40 or64 lowercase hex

@dataclass(frozen=True)
class ChangedPath:
    path: str
    change: str     # added | deleted | modified | mode-changed | type-changed
    left: ChangedEndpoint | None
    right: ChangedEndpoint | None
    addressable: bool  # exact path is admitted by current source/comparison API

@dataclass(frozen=True)
class ChangedFileCatalog:
    schema_version: int  # 1
    kind: str            # changed-file-catalog
    repo_name: str
    left_requested_ref: str
    left_revision: str
    right_requested_ref: str
    right_revision: str
    directory: str
    entries: tuple[ChangedPath, ...]
    omitted_non_utf8_paths: int
```

`list_changed_files(repo, left_ref='HEAD~1', right_ref='HEAD', *, directory='') -> ChangedFileCatalog`; `validate_changed_files(catalog) -> ChangedFileCatalog`; `render_changed_files_json(catalog) -> str` with exact field admission, safe finite integer counts, sorted unique entries, consistent change/mode/object identities and UTF-8/byte bounds. Do not authenticate externally supplied catalog provenance through structural validation. No browser catalog-import endpoint in this milestone.

Represent absent endpoints with null, never all-zero IDs in public wire. Same object-format width on both endpoints/revisions. Retain requested labels separately from full resolved IDs. `addressable` is deterministically derived from the existing exact path policy; it is not an arbitrary server permission bit. Valid Git paths that the existing reader cannot address (for example leading backslash or a drive-like prefix) remain visible metadata with disabled handoff, not rewritten. Names exceeding4096 UTF-8 bytes should fail the bounded catalog with narrowing guidance rather than emitting unusable unbounded strings. Non-UTF8 path bytes are omitted with an explicit count; do not decode them with replacement or invent a path.

Sort returned entries by their exact UTF-8 path bytes (document this, not locale sorting). Preserve tabs/newlines, whitespace, glob-looking text and Unicode in the JSON value. CLI text and UI display quote/escape control characters using the established visible-path convention; never split raw paths on whitespace/newlines.

HTTP exact job: `{operation:'changed-files',args:{left_ref,right_ref,directory}}`. Do not accept repository paths, output filenames, arbitrary Git flags, partial side objects or extra fields. Both refs1024 UTF-8 bytes maximum; directory4096, emptyallowed. Discovery accepts refs; subsequent source/comparison jobs still require full IDs. Return the one catalog object as the normal completed job result.

CLI: `git-history changes --repo PATH --left-ref REF --right-ref REF [--directory DIR] [--format text|json]`. Text lists safely quoted paths/status/modes and full pins; JSON shares the browser serializer. Stdout only initially, permitting ordinary shell redirection. Existing `compare --output` remains the portable HTML/JSON publication path; no new arbitrary server output path.

## Bounds and Git invocation

- At most10,000 raw changed-path records, counting eventual non-UTF8 omissions too. Fail as a whole at10,001; no truncated authoritative list.
- Existing GitRunner per-command10-second and2MiB combined stdout/stderr caps; aggregate work_budget45seconds/32MiB for both CLI and workbench operation. Check budget between parsing/sorting/rendering stages.
- Catalog JSON UTF-8 <=8MiB inclusive; fail before publication if escaped control characters/metadata exceed it. Existing HTTP response32MiB remains a separate enclosing bound, not a larger catalog permission.100 DOM rows/page; no expanded source bodies.
- At most4096 UTF-8 bytes per path/directory; refs1024. Exact schema and canonical primitive admission before Git commands.10,000 rows with long paths need not all fit2MiB: byte and count bounds independently apply and the failure asks for a narrower directory.
- Reuse `_resolve_repository` security and same resolved root. Both refs are resolved before diff; all later reads use only their IDs. A small narrow internal helper refactor is acceptable if required to avoid duplicating/promisor-bypassing admission; do not introduce another subprocess runner.
- Proposed Git invocation via existing shell-free runner: `git --literal-pathspecs diff-tree --no-commit-id -r --raw -z --no-abbrev --no-renames --no-ext-diff --no-textconv --ignore-submodules=none LEFT RIGHT -- [DIRECTORY/]`. Freeze/verify actual raw framing against original fixtures before relying on this precise command. Both commits are explicit so no implicit root/parent inference. No configurable filters or user argv.
- Parse exact colon metadata plus NUL-delimited path records; reject unsupported statuses, extra columns, unexpected rename records, mode/type/OID inconsistencies, duplicate paths or trailing garbage rather than guessing. Derive public kind/category from admitted endpoints, using raw status as a consistency check.
- Directory filtering is an exact literal subtree prefix; `src` includes `src/a`, not `src-extra/a`. Canonical directory syntax only: no absolute paths, parent traversal, `./`, repeated/trailing separators or drive-like/backslash-root ambiguity; normalize empty only. Apply Git prefix filtering before output collection so large repositories can narrow within limits; independently check returned prefix.
- Existing runner disables shell, external diff environment, textconv, replace objects, fsmonitor, lazy fetch, prompts and optional locks. Preserve all of that. Verify raw-diff config sensitivity explicitly (renames/submodule ignore/external drivers/attributes); do not assume metadata-only commands make repository config harmless.

## Browser ownership and useful UI

Keep one shared request pump, authentication/session capability and cancellation drain; no independent fetch queue or concurrent subprocess job. Static inputs retain exact raw values/caret. New input, changed-back input, workspace change, Stop or pagehide retires catalog publication/downloads; old rows may remain visibly stale with all handoff/download controls disabled. Discovery errors keep both existing comparison drafts and previous visible stale catalog.

Completed catalog is immutable. Local path/status filtering and paging operate on it and must not silently repin refs. Editing catalog inputs marks it stale. Existing side edits do not mutate its captured pins; handoff always names the captured Left/Right IDs in confirmation. A new handoff must invalidate prior comparison report/downloads and pending work through the existing pump even if no source fetch is yet requested. No autoload on workspace switching, ref typing or row rendering. A pending handoff/late job cannot overwrite newer comparison input.

Proposed selectors: `#changes-form`, `#changes-left-ref`, `#changes-right-ref`, `#changes-directory`, `#changes-discover`, `#changes-summary`, `#changes-stale`, `#changes-filter`, `#changes-status-filter`, `#changes-table tbody` rows[data-change-index], per-row `[data-use-change]`, `#changes-prev`, `#changes-next`, `#changes-page`, `#changes-download-json`. Existing workspace-mode/history/comparison IDs unchanged. Add no second role=status that breaks current accessibility/test contracts; use named region/aria-live as appropriate.

## Disjoint implementation and independent gates

1. Reader/catalog owner: new changed_files.py and new original Git fixture/unit tests; narrow reader helper only if needed, coordinated with root.
2. CLI/service integration owner: cli.py/workbench.py and new HTTP/CLI tests. Preserve exact old operations/errors/auth/job budgets.
3. UI owner: existing three web files only; safe literal rows, handoff and stale ownership. Existing comparison code remains authoritative for source/report selection.
4. Independent oracle owner: original temporary Git history with literal expected statuses/modes/object hashes/order, plus CLI metadata and final comparison parity; no producer-derived expected output.
5. Independent browser owner: actual service/temp repo, original fixture and downloads, raw focus/late job/drain/handoff/permission, desktop390px. Root owns package/config/docs/Git/build/install-wheel/full gates.

Original fixture should cover A/M/D; empty present file; executable-mode-only and combined content/mode changes; symlink↔regular and gitlink updates; directory↔file; identical-content rename shown D+A; binary and non-UTF8 contents; non-UTF8 *path* count; literal space/tab/newline/Unicode/glob/option-looking paths; exact directory boundaries; dirty worktree/index and moving branches after pin. Gitlinks use original literal commit IDs without opening any nested repository. Freeze expected graph facts before invoking the new producer. Compute object IDs independently from original blob bytes when testing hashes; do not call the SUT to build expected entries.

Boundary/refusal fixtures:10,000/+1 small entries,2MiB/+1 raw-output framing independently constructed for parser tests,8MiB canonical cap where reachable independently of tighter input cap, empty/same-ref, malformed raw framing, absent objects, partial/promisor clone and hostile diff configuration. Do not claim an unreachable simultaneous maximum; disclose which limits dominate.

Native workflow: discover original pinned changes→choose added/deleted/modified→explicit open available sources→compare→download metadata JSON and exact comparison HTML/JSON, verify CLI parity. More than100 rows proves paging. Held real202/completion, input changed-back, Stop/replacement, workspace switch and branch movement prove no stale handoff. Type/binary rows must never become false missing selections. Check filesystem/index/untracked files remain unchanged and native optional-parser-free installation still supports catalog/manual selection.

No new model, remote source fetch, dependency, corpus or hardware is needed. This milestone completes a discovery-to-existing-comparison flow rather than expanding into automatic PR retrieval, semantic change summaries or merge-conflict editing.


## Frozen integration choices and execution ownership

The dataclass fields, function signatures, job operation/argument keys, CLI flags, bounds, sorting and DOM selectors above are approved as the first implementation contract. JSON uses the documented snake_case keys. All new public catalog validation/serialization lives in changed_files.py, avoiding CLI/HTTP divergence. Structural validation may accept the dataclass and its exact decoded JSON object as needed; any expanded API must be agreed with root before callers depend on it. Reject unknown fields and invalid primitive types without coercion. A regular candidate can be handed off only when every present endpoint is regular and addressable. No comparison attempt is triggered by handoff.

Handoff confirmation is required if either side has any entered ref/path/range/function beyond untouched initial defaults, or any loaded selection. The confirmation names the exact selected path and both full captured IDs; cancellation leaves all raw values and current report untouched. Accepted handoff uses existing pump retirement and invalidates old reports, then sets pinned refs/paths and Whole file or Missing mode. Direct source fetch stays a separate explicit user action. Discovery inputs remain independent from existing side inputs; no implicit initial network job.

The kernel owner may make a narrow internal reader helper extraction/reuse when needed, with old tests unchanged. Do not weaken repository admission, external-process defenses, aggregate work budget, path policy or source absence checks. Verify the proposed raw Git command against an original temporary repository; deviations for actual Git framing must be reported and frozen before other owners implement assumptions. No external diff, textconv, submodule traversal or lazy fetch.

Root owns Git/GitHub, documentation/catalog/package versions, broad test/build/install-wheel gates and all live browser/service leases. Unit tests may create and mutate their own disposable Git repositories and test-owned ephemeral HTTP servers; they may not mutate the monorepo Git index/branches or operate preexisting services. Independent test authors freeze expected original path/status/object facts before reading new producer implementation. Preserve actual first failures, distinguish feature absence from behavioral regression, and do not manufacture RED after source has already landed.

Ownership: git_reader kernel/reader helper + own tests; git_runner CLI/workbench + own tests; recorder web UI + own JS tests; audio_engine independent literal Git/domain/HTTP oracle; git_history_review independent native browser oracle; next_project_assessment original maximum/installed-wheel acceptance runner and independent source review. Root coordinates exact file lists to avoid conflicts. No dependency/model/service expansion.

Canonical metadata JSON is frozen as Python `json.dumps(asdict(validated_catalog), ensure_ascii=False, sort_keys=True, indent=2) + "\n"`. The browser recursively sorts the ASCII schema keys, retains array order, and uses `JSON.stringify(value, null, 2) + "\n"`. This makes CLI/browser metadata downloads byte-identical without changing the job's single-object result. An optional packaged `changed-files.js` is served through one exact allowlisted static route using the current asset mechanism, never general filesystem serving.
