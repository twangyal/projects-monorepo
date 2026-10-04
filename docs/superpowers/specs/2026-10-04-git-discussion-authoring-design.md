# Git History: supplied-discussion authoring design (#85)

Frozen implementation contract for issue #85 on Astra. Existing Python context admission remains the publication authority; the frontend provides literal local authoring.

## Outcome and boundary

Complete the missing workflow between reading Git evidence and supplying a discussion excerpt: generate a pinned history report, select a commit actually displayed in its evidence, author literal attributed text, review the context, and download both a reusable context JSON file and the corresponding portable HTML/JSON report.

The current implementation already admits and renders supplied discussion context (#17), and the workbench already reads uploaded JSON (#52). It does not provide a form to author that JSON or an evidence-backed commit picker. This milestone removes manual copying of commit IDs and hand-authoring envelope JSON. It adds no source fetching, credential setup, semantic synthesis, inferred rationale, persistent browser storage, repository writes or remote requests. Comparisons remain separate: their schema has no discussion evidence.

Existing relevant milestones are #11/#13, #17, #34, #41, #52 and #64. A scoped search found no open issue with Git History in its title and no additional discussion-title issue beyond #17. The catalog describes tracing available discussions and distinguishing documented reasoning from inference; locally supplied, explicitly unverified claims advance that goal without a model/network dependency.

## Reuse the authoritative protocol

Retain the current endpoints and single-job lifecycle. The existing submission is:

```json
{"operation":"report","args":{"revision":"<full pinned ID>","path":"<exact path>","selection":{"start":1,"end":20},"max_commits":20,"context":"<JSON text or null>"}}
```

Function selection uses `{"function":"<qualified name>"}` instead of start/end. The authenticated POST goes to `/api/jobs`; `/api/result` and `/api/cancel` retain their existing contract. One job, cancellation/join, the 45-second aggregate deadline, 32 MiB subprocess budget, 5-second HTTP deadline, capability/Host/Origin controls and exact renderer outputs are unchanged.

`workbench.py::_execute` already obtains a real immutable `Report`, then calls `context.parse_context(context, report)` and both existing renderers before returning `{html,json}`. **This is the publication authority.** Browser checks may make editing convenient, but cannot claim server validation or substitute a browser-provided evidence list for the real reader. No new report-object cache, arbitrary-report upload, context path or server-side output path is needed.

First generate a context-free report, or use an existing successful report. Retain its JSON and the exact submitted selection identity: revision, path, selection and max_commits. Derive picker options from its actual blame, changes and renames, deduplicating full commit IDs in a documented stable evidence order. Do not offer the selected revision merely because it is the report revision: revision-bound records currently require a commit in displayed blame/change/rename evidence. A matching ID does not verify a URL, author, relevance or intent.

New authoring uses only the existing revision-bound format:

```json
{"schema_version":1,"revision":"<report revision>","records":[{"commit":"<displayed full ID>","url":"https://github.com/owner/repo/pull/42#issuecomment-123","title":"Literal supplied title","author":"Literal attributed author","excerpt":"Literal supplied excerpt"}]}
```

Keep both existing uploaded formats (`entries` and revision-bound `records`) accepted unchanged by the Python parser, CLI and workbench. Uploaded context and newly authored context are distinct UI modes; do not silently convert source labels into titles, merge envelopes or discard imported records. Authoring an imported file is not required for this slice. It can remain an uploaded text source while a separate authored draft is retained in memory.

## Small UI state contract

Private state contract:

- `mode`: none, uploaded, or authored; switching modes preserves the other mode's in-memory work.
- `evidence`: last successful history report JSON plus its exact selection identity; picker provenance is displayed alongside it.
- `authored`: bound revision, dense ordered records, and private stable row keys (not serialized).
- `rawForm`: add/edit row key, commit/title/author/url/excerpt strings, dirty flag and an input-intent epoch. Input intent advances even when a value changes back.
- `receipt`: captured selection, context mode/text, authoring and input epochs, and the successful report's HTML/JSON/context bytes. Null or stale until the server accepts this exact submission.

Controls: **Author supplied discussion**, **Commit in displayed evidence**, **Discussion title**, **Attributed author**, **Source URL**, **Exact excerpt**, **Add to context draft**, **Save record changes**, **Cancel record edit**, per-row **Edit**/**Remove**, **Generate report with context**, and **Download validated context JSON**. Explain that saved draft rows are local unverified input until the complete report request succeeds. Rows render literal text, not Markdown or HTML; external links open only on explicit activation with the current safe-link policy.

Use stable native form nodes and stable keyed rows. Rerendering status/report/evidence must not replace focused form fields or alter raw spelling, whitespace, caret or selection. Invalid/oversized fields remain editable and do not modify the accepted records, current context receipt, or prior report. Valid row addition/edit/removal is an atomic local draft operation. Cancel edit explicitly restores the retained row; it does not clear unrelated rows or the uploaded file.

Selection/ref/path/range/function/max-commits changes invalidate publication and visibly mark the report/context association stale. Keep all records and raw drafts. Never silently repin the envelope, delete an out-of-scope commit or substitute a new commit. A changed evidence selection requires an explicit revalidation submission; a changed revision additionally requires explicit acknowledgement of updating the envelope's revision. The server must accept every record or reject the whole request. If a commit is absent, identify the record without echoing its excerpt or unsafe URL and let the user deliberately edit/remove it.

The raw active form must be saved into the draft or explicitly cancelled before submitting context. Capture the exact complete context string and request identity before the await. Any later raw input, row action, mode switch, source selection, import, cancellation or pagehide retires its publication receipt; queued/late results cannot install new picker metadata, replace fields, enable downloads, or relabel another report. Keep the existing cancelled-job cleanup admission behavior.

**Export authority:** enable authored-context download only after the existing report operation successfully validates the exact submitted authored envelope against actual Git evidence. Download those captured UTF-8 JSON bytes, not a later reconstruction from live fields. Report HTML/JSON remain the exact server response from the same receipt. Editing makes these downloads stale/disabled while leaving the prior preview visibly labelled stale. Empty records are deliberately different from mode none. Reload loses in-memory authoring, consistent with the existing capability/session design; show backup guidance and an unsaved-draft navigation guard rather than silently adding storage.

## Limits and literal text

Reuse the parser's exact 50-record and 256 KiB envelope limits, full lowercase 40/64-character commit IDs, title1–300/author1–200/excerpt1–4,000 Unicode code points, URL1–2,000 and conservative credential-free HTTPS GitHub/GitLab discussion routes. No trim/recase, excerpt paraphrase, hidden truncation, automatic link fetch or statement-authenticity badge. Native textarea newline normalization is not a promise of byte-identical original webpage content; the accepted browser string is retained literally, while unsupported carriage returns/control characters are rejected visibly under the existing records policy.

Count code points and encoded UTF-8 JSON bytes, not JavaScript UTF-16 units. Reject malformed surrogate strings before `TextEncoder` replacement could normalize them. Check cheap per-field/count bounds before serialization; bound the whole canonical envelope before admitting a row. Do not reflect arbitrarily large invalid raw input into report/status/list previews. Imported duplicate keys, malformed Unicode and mixed envelopes still reach the existing strict Python parser; do not approve them using permissive `JSON.parse` alone.

## Exclusive implementation partition

1. **Authoring domain:** new private browser module, for example `git_history/web/context-editor.js`, with pure bounded revision-bound draft admission/serialization, ordered row operations and receipt identity helpers; corresponding literal Node tests. It must not import Git or replace Python authority.
2. **Workbench UI:** `web/workbench.js`, `workbench.html`, `workbench.css`; integrate editor, stable fields, picker from completed report, mode retention, explicit revalidation, cancellation/stale publication and downloads. Avoid modifying the independent comparison state.
3. **Python compatibility/HTTP:** new targeted tests for both existing upload formats, strict displayed-commit association, same-selection revalidation, changed max-commits/revision rejection, and exact CLI/workbench export equivalence. Existing `context.py`, model and render schemas should need no behavior change. If a separate browser module is chosen, add only its exact packaged static path to `workbench.py`'s current asset whitelist and MIME map; no directory/file selector or dynamic asset path. Verify that authenticated APIs and all other rejected paths stay unchanged. No new JSON route or service result field is required.
4. **Independent native acceptance:** new browser file, real temporary Git histories and services, literal fixtures authored without production helpers. Full user form workflow, actual downloaded context reimported through CLI, exact report bytes/literal claims, hostile text/safe links, 50/51 and UTF-8 limits, ref movement, context errors, delayed real responses/file reads, raw focus/caret preservation, cancel/late completion, desktop/mobile and installed wheel.
5. **Root:** reviewed spec/plan/issue, package/lint/CI wiring for any new JS helper/tests, README/catalog/version, build/wheel/package assets, full Python3.11–3.13 core/native matrix, all old20 browser cases unchanged, final evidence and Git.

## Root-only commands and acceptance

The frontend is packaged static JavaScript, not a Vite app. Its current HTML loads `workbench.js` as a classic deferred script; a helper using ES-module imports requires the UI owner to switch that tag to `type="module"`, while the HTTP owner explicitly serves only the new trusted module path. Alternatively keep private helpers in the existing script to avoid that seam. Existing wheel package data includes `web/*.html`, `web/*.js` and `web/*.css`; nevertheless verify a clean installed wheel outside the checkout. There is no frontend build command to invent.

```sh
cd /workspace/projects-monorepo/apps/git-history
GIT_HISTORY_REQUIRE_JAVASCRIPT=1 /tmp/git-history-ts-env/bin/python -m unittest discover -v
/tmp/git-history-ts-env/bin/python -m compileall -q git_history tests
ruff check .
npm run lint
GIT_HISTORY_PYTHON=/tmp/git-history-ts-env/bin/python CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

Use the existing cached interpreter/Ruff paths available when root schedules the gate; run the dependency-free matrix too. Browser fixtures already launch isolated real repositories/services on ephemeral ports. Never reuse an unknown existing service or capability. For a root-owned manual preview, run `/tmp/git-history-ts-env/bin/python -m git_history serve --repo <owned-fixture>` and retain its printed private launch URL privately; do not put it into verification artifacts. Stop only that owned process.

Acceptance should prove unchanged evidence, not just successful form clicks: downloaded records feed the existing CLI at their full immutable revision and produce the exact authored literals/evidence associations; malformed/stale records reject without partial output; moving refs and dirty worktrees cannot change pinned evidence; user text containing words such as token or password is not censored, while session capability and absolute repository paths are absent from artifacts. No external request occurs during authoring, validation, rendering or downloads. Explicit external-link activation is outside that no-fetch assertion. No model or physical-device claim is involved.

## Integration decisions

Use a private ES module at `git_history/web/context-editor.js`; serve it through one exact trusted static-asset route with JavaScript MIME, and load the workbench as a module. Keep all capability, Host/Origin and packaged-asset protections. Browser receipt epochs belong to the UI; the pure module provides bounded literal draft operations and evidence-commit extraction. Coordinate the exported API before parallel UI implementation.

Mode none can generate fresh context-free evidence while retaining uploaded and authored drafts. A changed revision requires an explicit reviewed rebind of the authored envelope; every retained record still passes the real server parser before any context download. This permits recovery from stale associations without automatic removal or rebinding. Comparison navigation also retires active history publication while retaining local authoring.
