# Git History two-revision source comparison

Issue: https://github.com/twangyal/projects-monorepo/issues/64. Proposed frozen contract pending root review; no implementation before release.

## Useful flow and truth

Pin two committed refs from the service's one local repository. Independently select an exact path and whole file, manual range or uniquely named function on each side. Compare their exact committed text through a deterministic numbered alignment, inspect changes, and download one portable HTML/JSON snapshot. Explicit missing-side selection supports additions/removals only after verifying the exact path is absent at that commit.

This compares user-selected regions. It does not establish semantic function identity, rename correspondence, patch applicability, repository-wide changes, author intent or AI-generated reasoning. Different paths/functions are permitted and labeled explicitly; no automatic counterpart discovery. Existing single-revision evidence reports/context formats and CLI commands remain unchanged. No fetches, packages/models, repository writes, working-tree source or server-side report output paths. No supplied-discussion/context option for comparison in this milestone; existing explain remains available for separate evidence investigation.

## Bounds and source selection

Keep existing regular-blob512KiB/UTF-8/NUL/path/ref/local-object checks. Comparison selections contain at most200 physical LF-delimited lines per side, at most512KiB selected UTF-8 bytes per side. Whole-file selection over200 lines rejects with guidance to choose a smaller explicit range/function; it never silently truncates. Manual/function comparison selections retain the same200-line bound as explain. Empty whole files are valid0-line selections; manual ranges/functions cannot be empty. Both sides missing is rejected.

Refs are independently resolved ONCE to full40/64-character commit IDs before source/catalog reading. Every subsequent read uses those exact IDs; CLI/library requested ref labels remain distinct metadata. HTTP deliberately submits pinned full IDs as refs, so its exported requested_ref fields are those full IDs. The browser separately displays the original discovery label and actual immutable pin without rewriting report metadata. Pinning two refs is not a claim of an atomic branch snapshot: each side shows its actual resolved commit. Optional function parsing retains current isolated5second/resource bounds, exact qualified names, ambiguity rejection and manual fallback. Different language/function names never imply equivalent symbols.

Tokens are physical Git lines INCLUDING their LF terminator when present, obtained by splitting only on `\n`, not Python splitlines. Preserve CRLF, BOM, Unicode separators and missing final newline. Range slicing preserves the original final terminator exactly, as existing reader selection does. Newline-only changes count as changes and receive readable end-of-line indications; never normalize whitespace or text. No `.gitattributes`, external diff driver, textconv or source execution.

## Public immutable contracts — new comparison.py

Frozen dataclasses (nested sequences are tuples; source strings are immutable):

```python
@dataclass(frozen=True)
class CompareSelection:
    kind: str  # 'whole' | 'lines' | 'function' | 'missing'
    start: int | None = None
    end: int | None = None
    function: str | None = None

@dataclass(frozen=True)
class CompareTarget:
    ref: str
    path: str
    selection: CompareSelection

@dataclass(frozen=True)
class ComparisonSide:
    requested_ref: str
    revision: str
    path: str
    status: str  # 'present' | 'missing'
    selection: CompareSelection
    start_line: int | None
    end_line: int | None
    selected_function: str | None
    source: str
    source_sha256: str | None

@dataclass(frozen=True)
class ComparisonBlock:
    kind: str  # 'equal' | 'change'
    left_start: int; left_end: int
    right_start: int; right_end: int

@dataclass(frozen=True)
class ComparisonReport:
    schema_version: int  # exactly1
    kind: str  # exactly 'source-comparison'
    repo_name: str
    left: ComparisonSide; right: ComparisonSide
    blocks: tuple[ComparisonBlock, ...]
    unchanged_lines: int; removed_lines: int; added_lines: int

def compare_repository(repo: str | Path,
    left: CompareTarget, right: CompareTarget) -> ComparisonReport: ...

def validate_comparison(report: ComparisonReport) -> ComparisonReport: ...
```

Export constants `MAX_COMPARE_LINES=200`, `MAX_COMPARE_BYTES=512*1024`, `MAX_ALIGNMENT_CELLS=40_000`. Invalid inputs raise ReaderError/ValueError with bounded actionable fixed messages; aggregate work-budget exceptions propagate without becoming recoverable selection errors. Validate real integer fields (not bool), exact selection combinations: whole/missing have no start/end/function; lines require integer1<=start<=end with no function; function requires nonempty valid UTF-8 qualified name<=8192bytes and no range. Ref/path retain existing bounds at HTTP boundary (1024/4096UTF-8bytes); comparison API applies these bounds too. Dataclass subclasses or malformed field types are not accepted as canonical requests.

The report contains selected text ONCE per side; blocks reference zero-based half-open offsets within its physical token list, not duplicate text. Present empty source has null line bounds and SHA256 of empty bytes; missing source has null bounds/function/hash and empty source, clearly distinct. Nonempty bounds are original1-based file lines. Hash is selected exact UTF-8 text integrity, not authenticity. The public validate_comparison(report) returns the admitted immutable report unchanged or raises ValueError; it performs bounded exact dataclass/type/source/hash/provenance/selection admission, then recomputes the canonical alignment from the two admitted sources and requires exact block/count equality. Both direct renderers call it. Thus forged nonminimal or arbitrary change blocks reject even when partition/counts are internally consistent. Validation checks cooperative budgets and makes no repository reads; hashes prove text integrity only, not that supplied provenance is authentic. Dataclass subclasses and mutable/wrongly typed nested fields reject. No comparison import or private authentication receipt system.

## Small reusable reader seam

Add `resolve_revision(repo,ref='HEAD') -> RevisionSnapshot` in reader.py, with frozen `RevisionSnapshot(repo_name,revision,requested_ref)` in model.py, delegating to existing guarded repository resolution. Add `read_source_or_missing(repo,file,ref='HEAD') -> SourceSnapshot|None`. Only an exact absent tree entry returnsNone; directories, symlinks, submodules, oversized/binary/non-UTF8 files, missing objects, invalid refs/paths, timeouts and cancellation remain errors. Existing read_source keeps its exact error behavior. Factor a shared internal path/tree loader rather than catching ReaderError by message or broad exception.

Comparison resolves both revisions first, then passes full IDs to this source helper and list_functions. `missing` succeeds ONLY for an actually absent path; an existing empty file is not missing. Present modes reject absence with explicit guidance to choose Missing or another path. Paths are literal and independently chosen; no inferred rename. No public repository root switch in HTTP. Preserve existing CLI exception/render/context contracts.

## Deterministic bounded alignment

Use exact-token longest-common-subsequence dynamic programming, not unbounded difflib heuristics. For n,m<=200, build an(n+1)*(m+1) table of unsigned16-bit lengths (array('H') or equivalent explicit two-byte storage): at most40,401 entries/~80KiB. Values cannot exceed200. Comparisons are at most n*m<=40,000; no recursive algorithm or unconstrained Python-object matrix. Call check_work_budget before allocation, at least every32 constructed rows, while walking/grouping output, and between source/parser/render stages.

Precompute integer identities for exact complete tokens before filling the table, checking budgets during this bounded pass. An identity is shared only after exact token confirmation (including terminator); hashes alone never establish equality, and collisions cannot merge unequal strings. Assign identities in first appearance order across left then right so output is deterministic. Table cells compare these integer identities, not repeatedly scan arbitrarily long source strings.

Fill suffix lengths: equal tokens use1+diagonal; otherwise max(down,right). Walk forward: consume exact equality immediately; otherwise delete left if down>=right (ties always delete first), else insert right. Group consecutive equal steps into equal blocks and consecutive non-equal steps into change blocks. Counts are unchanged LCS matches, unmatched left removals and unmatched right additions. Changed display rows pair unmatched left/right in their original order for readability, with remaining rows one-sided. This positional pairing is explicitly presentation, NOT semantic correspondence or a moved-line detector. Repeated lines have stable tie handling. No word/character diff, fuzzy match, ignored whitespace or patch generation in this milestone.

All blocks completely partition both token sequences without overlap/gaps; equal blocks have same length and exact matching tokens, and change blocks are nonempty on at least one side. Empty/identical sources and one missing side produce correct zero/single blocks. Budget/cancel errors publish no partial report.

## Renderers, CLI and workbench service

New comparison_render.py exports `render_comparison_json(report)->str` and `render_comparison_html(report)->str`. Each output remains<=existing8MiB report limit, checked before publication. JSON uses exact dataclass fields above with tuples serialized as arrays; HTML embeds all source/style, no script/external asset, literal escaping and source/revision/selection labels, stats, numbered aligned changes and line-ending notes. Show full immutable IDs and both requested refs/path/function/range/status. Use anchors scoped left/right, never source names as raw HTML IDs. Report is reproducible text evidence, not a semantic explanation.

CLI adds `git-history compare --repo REPO --left-ref REF --left-file PATH --right-ref REF --right-file PATH` with REQUIRED mutually exclusive choices per side: `--left-whole` / `--left-lines START:END` / `--left-function NAME` / `--left-missing`, and corresponding right flags. Ref defaults HEAD independently; files required even for missing. Add --format html|json(defaulthtml), --output(defaultstdout), --force with existing metadata protection/atomic no-clobber writer. Reuse the existing200-line parser where appropriate without changing explain. Compare CLI uses aggregate work_budget45seconds/32MiB output, like HTTP. No max-commits/context flags since this report performs no blame/history fetch.

Add HTTP operation `comparison`, args EXACT `{left,right}`. Each side EXACT `{revision,path,selection}`; revisions must be full lowercase40/64IDs from explicit discovery. Selection wire shape is ONLY `{kind:'whole'}` / `{kind:'missing'}` / `{kind:'lines',start,end}` / `{kind:'function',function}`. Decode into CompareTarget using revision as ref. Return `{html,json}` generated from ONE ComparisonReport through new renderers. Existing2MiB input/5second absolute HTTP deadline,45second aggregate job,32MiB subprocess/serialized reply, one owned joined job, token/Host/Origin/security and cancellation machinery remain unchanged. Exceeding output/response bounds atomically fails. No filesystem write/export endpoint.

## Browser workflow and lifetime

Keep existing history investigation intact; add explicit **Compare revisions** workspace with independent Left/Right controls and pinned commit/source/function/catalog state. Reuse the existing SINGLE pump/job ownership and cancellation cleanup; do not create concurrent pumps or competing session clients. Each side can Discover ref, choose file/read source, select whole/manual/function/verified-missing. Show both immutable IDs prominently. Catalogs remain50/page; committed source100physical lines/page; comparison alignment100rows/page so a valid400row result does not inflate DOM. Missing selection still needs explicit resolved ref and exact path; discovery absence does not automatically mark it missing.

Input/change/side selection intents invalidate any pending comparison before commit/blur; late results cannot overwrite newer drafts, pins or modes. Ref edits unpin ONLY that side and invalidate comparison; path edits clear ONLY its source/functions; keep the other side's draft/pin. Changing workspaces retains draft fields and invalidates/cancels pending publication safely. Preserve previous report as visibly stale; revoke/disable downloads until a matching new comparison succeeds. Errors/cancel do not silently replace any side with Missing, apply old selections or reset active form values/focus. No autosave/storage. Comparison has no iframe: parse the completed result.json once into a detached immutable view and render its alignment with safe DOM textContent,100 display rows per page. Download the exact completed result.html/result.json strings from that SAME snapshot; never reconstruct exports from paginated DOM or relabel their requested refs. Standalone HTML may contain all<=400 alignment rows. The original history iframe remains unchanged. Revoke URLs on invalidation/pagehide/session expiry. Show current job/pending/cancelling and keep Stop usable.

No automatic ref repinning when a branch advances; rediscover is explicit. No assumed function counterpart or same-line correspondence. Optional language parser absence affects function selection only; whole/manual/missing comparison still works. Request-start response uncertainty retains existing no-replay/cleanup safety rather than introducing takeover/retry behavior. Original capability stays memory-only and fragments are scrubbed; comparison exports never contain it or absolute local filesystem paths.

## Frozen browser selectors and routing

Preserve every existing history control ID and label inside `#history-workspace`. Add native select `#workspace-mode`, accessible label **Workspace**, values `history` (**History investigation**) and `comparison` (**Compare revisions**), and `#comparison-workspace`. Switching mode preserves both workspaces' actual DOM drafts/pins, invalidates global publication generation, and cancels/joins an owned active job through the existing queue/pump before another begins; no second pump/client and no automatic request on mode change. Shared current job/status/error/Stop/session controls retain their existing IDs.

Each side uses prefix `left-` or `right-` and the following exact suffixes: `discovery-form`, `ref`, `directory`, `language`, `discover-button`, `catalog-summary`, `revision`, `file-filter`, `file-list`, `file-prev`, `file-page`, `file-next`, `source-form`, `path`, `open-source`, `selected-path`, `source-caption`, `source-lines`, `source-prev`, `source-page`, `source-next`, `functions-button`, `function-status`, `function-filter`, `function-list`, `function-prev`, `function-page`, `function-next`, `selection-mode`, `start-line`, `end-line`, `selected-function`, `missing-status`. Fields have accessible labels **Left ref/directory/language/path/selection/start line/end line/file filter/function filter**, and matching **Right** labels. Actions are **Discover left ref**, **Open left source**, **Discover left functions**, and matching right labels. Side file/source/function pagers are labeled **Previous/Next left files/source/functions** and corresponding right labels. Literal path/function choice buttons retain exact visible source names and use safe DOM text, never HTML interpolation.

Selection values are `whole`, `lines`, `function`, `missing`, displayed **Whole file**, **Manual range**, **Named function**, **Missing path**, default `whole`. Present modes require source loaded for the exact side pin/path; function also requires an explicitly selected unique catalog entry. Missing requires pin and exact path, not a failed source request; `#left-missing-status`/`#right-missing-status` say **Verification pending** until successful comparison verifies absence, after which they say **Verified absent at pinned revision**. An input/change invalidates that verification. Whole over200 lines remains visible but Compare is disabled with explicit smaller-selection guidance.

Result controls are `#comparison-form`, `#compare-button` (**Compare selected source**), `#comparison-description`, `#comparison-stale`, `#comparison-summary`, `#comparison-lines` (alignment table), `#comparison-prev` (**Previous comparison rows**), `#comparison-page`, `#comparison-next` (**Next comparison rows**), `#comparison-download-html` (**Download comparison HTML**), `#comparison-download-json` (**Download comparison JSON**). Catalog/functions use50-item pages; source/alignment use100-row pages. Page selection/filtering does not change source/ref selection or immutable report, but choosing a path/function does. Both side requests and comparison requests go through existing queueJob/pump; their receive closures capture global intent generation and exact side pin/path before publication. Completed alignment rows come solely from admitted completed JSON; original history report preview and IDs remain unchanged.

## Exclusive implementation ownership and verification

1. Comparison/reader owner: new comparison.py; model.py/reader.py minimal reusable seams; new tests/test_comparison.py. Frozen dataclasses/absence/pinning/selection/alignment and budget checks. Publish APIs early.
2. Renderer/CLI owner: new comparison_render.py; cli.py additive compare command; new tests/test_comparison_render.py and test_comparison_cli.py. Preserve all original commands/output-write guards.
3. Service owner: workbench.py operation admission/execution only; new tests/test_comparison_workbench.py. No browser assets/helper source overlap.
4. UI owner: web/workbench.html,workbench.js,workbench.css; the frozen selectors above, agreed with browser owner. Preserve old workspace/native workflows and one pump.
5. Independent oracle/browser owner: new tests/test_comparison_oracle.py and tests/browser/comparison.spec.js plus separate fixtures; root may split semantic and browser tests across agents without file overlap.
6. Root docs/config/Git/issues/shared verification; spec author final independent read-only integration review.

Independent fixture repos must include different paths and named functions, rename chosen manually, unchanged/different selections, add/remove verified absence, empty present file, final LF/CRLF/BOM/Unicode separators, repeated-line ties, hostile paths/literal source, branches advancing after pin and disjoint ancestry. Hand expectations establish tokens/LCS/counts/source/hash/line provenance; do not invoke producer alignment to calculate expected output. Pin missing/object/symlink/binary/UTF8 and wrong-key/type/request bounds,200/201lines, aggregate timeout/cancel and exact before-publication guards. Independent renderer checks escaping, block integrity and8MiB caps; CLI real output refusal/no-clobber/metadata protection remain.

Native browser tests drive discoverLeft/right→independent path/function/range→comparison→actual HTML/JSON downloads and decode them against direct trusted CLI comparison of the fixture's exact commits/selections. Verify unchanged pins after branch movement, independent-side edits, raw draft preservation and genuinely delayed HTTP completion, cancellation/cleanup/new request ownership, portable script-free report links, parser-free manual mode and session privacy. Run existing suites unchanged plus new tests; Python optional/native parser configurations remain separate. No live model/network/device acceptance is needed.

## Release status

The200-line/max-40,000-comparison bound, canonical direct validation, explicit absence, API names, safe DOM comparison and selectors above are the reviewed proposal. Source implementation still waits for root release. No unresolved algorithm/migration/security choice is delegated to separate owners.
