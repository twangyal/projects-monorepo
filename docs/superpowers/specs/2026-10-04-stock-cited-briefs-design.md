# Stock Notebook cited company briefs

Issue: [#67](https://github.com/twangyal/projects-monorepo/issues/67). Reviewed contract frozen by root after independent numerical/provenance and UI/persistence reviews. Implementation follows the exclusive plan ownership.

## Product outcome

A shortlisted company can become a readable, user-authored brief with Business, Risks and Open questions statements. The author explicitly attaches supplied text excerpts or snapshots of selected annual figures. Readers can inspect exactly what was cited, where it came from and whether the current financial dataset differs. Uncited statements remain usable and conspicuously uncited. Attaching evidence never verifies a statement, issuer, source or investment thesis.

This adds evidence authoring and review to the existing deterministic workspace. No model, generated analysis, forecasts, recommendations, scoring, source fetching, document upload, quotation extraction or automatic semantic support/contradiction judgment. The failed #36 experiment remains frozen. The current free-text research note is retained independently; no note is silently converted into a statement.

Actual integration seams are `types.ts` Notebook/EditState, `model.ts` exact schemas and editState extraction, `history.ts` serialized edit keys, `refresh.ts` annotated-ticker union and retention, both text report builders, and `main.ts` draft/intent maps. Baseline:149 unit and34 production browser cases, with #56 complete refresh/restart evidence. Preserve their behavior except explicit schema/size/report additions here.

## Types, schema and quotas

Add the following exported types and `BRIEF_LIMITS` to `src/types.ts`; change canonical `NOTEBOOK_SCHEMA_VERSION` to3. Notebook and EditState gain `briefs:CompanyBrief[]`.

```ts
type BriefSection = 'business' | 'risks' | 'questions';
type AnnualField = 'revenue' | 'priorRevenue' | 'netIncome' | 'debt' | 'equity';
interface BriefStatement {
  id:string; section:BriefSection; text:string; citationIds:string[];
}
interface ExcerptCitation {
  id:string; kind:'excerpt'; title:string; author:string|null;
  publishedDate:string|null; url:string|null; excerpt:string;
}
interface AnnualSnapshot {
  datasetId:string; fileName:string; importedDate:string;
  basis:'annual-12-month'; units:'currency-millions'; synthetic:boolean;
  company:Company;
}
interface AnnualCitation {
  id:string; kind:'annual'; fields:AnnualField[]; snapshot:AnnualSnapshot;
}
type BriefCitation = ExcerptCitation | AnnualCitation;
interface CompanyBrief {
  ticker:string; statements:BriefStatement[]; citations:BriefCitation[];
}
const BRIEF_LIMITS = {
  briefs:50, statementsPerBrief:12, citationsPerBrief:12,
  totalCitations:100, citationsPerStatement:6,
  statementCharacters:1200, excerptCharacters:4000,
  titleCharacters:160, authorCharacters:120,
  bytes:1024*1024,
} as const;
```

Keep existing annual CSV bounds,100 notes, their text semantics,500 annual rows,100 watchlist and4 comparison tickers. New canonical notebook/input cap is6 MiB (`LIMITS.notebookBytes`); add `LIMITS.legacyNotebookBytes = 4*1024*1024`. Brief arrays have a separate1 MiB compact UTF-8 JSON cap, including snapshots, metadata, IDs and escaping. Existing full/proposed text reports retain8 MiB. Count new text in Unicode code points, bytes with TextEncoder after canonical serialization; reject before publication when either independent quota fails. Item-count maxima are not a promise that every field can simultaneously be maximal Unicode text. No automatic shortening, source deletion or statement eviction makes an oversized edit fit. Migration sizing is explicit: an accepted canonical legacy object is at most4 MiB; appending the briefs key and a separately bounded1 MiB graph adds less than1 MiB plus32 bytes (version2→3 is equal width), so6 MiB safely admits every such value without relying on small ASCII examples. Existing legacy input/canonical ceilings still apply before migration.

All objects have exact keys and ordinary data descriptors; arrays are dense; reuse existing safe validators. IDs use existing canonical lowercase UUID validation and are globally unique across all statements and citations in the notebook. Briefs require distinct normalized current-dataset tickers and sort by ticker code-unit order. Arrays of statements and citations preserve author insertion order. Each statement cites0–6 distinct IDs in its own brief only; no dangling/cross-ticker references. Fields select1–5 unique annual money fields and canonicalize to the type order above. A persisted brief must contain at least one statement or citation; source-only draft research is permitted. Empty editor state is transient; use explicit Delete brief to remove the last complete graph.

New literal text must be nonblank but is otherwise retained exactly: preserve leading/trailing whitespace, tabs, LF and CRLF; reject lone CR, NUL, other C0/C1 controls and unpaired surrogates. Source title/author are single-line (no tab/newline), also preserved without trimming; null means no author. Excerpt/statement text allows the multiline forms above. Do not reuse `validateText` for these literals because it trims and normalizes CRLF. Bound UTF-16 length at twice the code-point quota before walking it. Existing old notes keep their current trimming/line-ending normalization; this milestone does not rewrite them. Browser textarea line endings may normalize on an explicit later edit/save; loading/rendering/exporting must not rewrite stored text.

Optional source date is an actual YYYY-MM-DD in the existing2000–2099 range, <=explicit operation UTC today; null is unknown, not today. Excerpt URL is nullable and uses the existing filing-link policy, preserving its supplied spelling: credential-free absolute HTTPS, no fragment/backslash/whitespace/local address/nondefault port. Export `validateSourceUrl(value:unknown):string|null` from validation.ts and use it for both existing filingUrl validation and new excerpts, with no policy broadening. Links open only after explicit user activation using noopener/noreferrer. URLs and source metadata are never fetched or authenticated.

## Capture and immutable evidence

An annual citation is created by choosing an exact current ticker/fiscal-date row and one or more of the five raw fields. Capture the entire detached Company plus the listed dataset provenance so names, currencies, independently supplied priorRevenue, nulls, original filename/physical line and filing URL cannot be lost. Its `fields` says which financial values were explicitly cited; unselected captured fields are contextual data, not silently attached supporting claims. No metric substitutes for missing values, no latest-row fallback, no currency conversion and no calculated ratio is stored as a raw annual field.

Annual snapshot admission reuses dataset/company validation via a single-row synthetic Dataset wrapper with the captured original metadata and row. Fiscal date must be <=captured import date<=today; sourceLine keeps its real2–501 bound, not renumbered to2. Snapshot ticker equals its containing brief ticker; captured issuer name/sector/currency/synthetic need not match current data because historical retained evidence may differ. Backups are supplied data: a valid shape does not prove that a snapshot genuinely came from a particular file or import.

Excerpt sources contain exact supplied text and metadata; the user chooses the containing company. There is no automatic issuer matching. Once saved, a citation's UUID and all fields are immutable in the active notebook. To correct it, add a replacement citation, explicitly edit the affected statements' attachments, then delete the old unreferenced citation. Deleting a still-cited source is refused and identifies the affected statement count; it never silently removes attachments. Delete statement leaves its citations in the source library. If deleting a final item would produce an empty persisted brief, direct the user to the explicit Delete brief action instead of silently deleting the graph. Delete brief explicitly confirms removal of its statements and sources as one undoable edit. Existing statements can change section/text/attachments while retaining their UUID. Import may replace the whole validated notebook through existing consent; it is not an in-place citation edit.

## Current-source comparison

`compareAnnualCitation` returns detached current row and independent difference categories. Lookup is **only** captured ticker plus fiscalDate. Never retarget to latest or rewrite a snapshot when data is refreshed.

```ts
type BriefIdentityField = 'name'|'sector'|'currency'|'synthetic';
type BriefSourceField = 'datasetId'|'fileName'|'importedDate'|'sourceLine'|'filingUrl';
interface CitationDrift {
  state:'same'|'changed'|'missing';
  factFields:AnnualField[];
  identityFields:BriefIdentityField[];
  sourceFields:BriefSourceField[];
  current:Company|null;
}
```

When the row exists, `factFields` compares only selected fields, exactly including null versus0. `identityFields` compares captured/current name, sector, currency and dataset synthetic flag. `sourceFields` compares import ID, filename/import date, row number and filing link. Fixed order follows the unions above. `state:'same'` means all categories empty; the UI says **Selected values and source metadata match the current row**, not “verified”. Any category makes `changed`; show each changed field with captured/current values. The same values in a renamed file, moved row or changed link are source changes, not financial changes. A new dataset ID alone is a different import, not changed facts or verified issuer continuity. Changes to unselected financial fields are not classified as changes to the selected evidence; disclose that comparison scope.

Missing exact period produces `missing`, current:null and empty field lists; retain and display the complete captured snapshot. Current rows of another year cannot rescue it. Excerpt citations always say **Supplied excerpt — not fetched or verified**; they do not pretend to have automatic drift comparison. Citation attachment, nonmissing rows and matching values make no statement about whether the excerpt/numbers logically support the author's statement. Uncited means zero attachments; do not label all attached statements “supported”.

## Pure domain APIs and dependency direction

New `brief.ts` imports only types, validation and periods helpers, never model/history/refresh/UI. All APIs validate, detach and use an explicit date; no implicit clock/storage/network and no mutation of caller data.

- `validateBriefs(value:unknown,dataset:Dataset,today:string):CompanyBrief[]` validates current ticker membership, complete snapshot/source/ID/reference graph and aggregate quota.
- `createExcerptCitation(input:{title:string;author:string|null;publishedDate:string|null;url:string|null;excerpt:string},today:string):ExcerptCitation` validates before assigning crypto.randomUUID().
- `captureAnnualCitation(dataset:Dataset,ticker:string,fiscalDate:string,fields:AnnualField[],today:string):AnnualCitation` requires exact row, snapshots it and assigns crypto.randomUUID() only after input validation.
- `updateBrief(briefs:CompanyBrief[],next:CompanyBrief,dataset:Dataset,today:string):CompanyBrief[]` validates old and candidate full arrays. Existing citation IDs may not change any fields. Removing an existing citation still referenced by any old statement is refused even if the submitted edit simultaneously removes that attachment; detach explicitly first. This guards accidental multi-object deletion. New statements/citations require IDs distinct across the final notebook; no silent GC.
- `removeBrief(briefs:CompanyBrief[],ticker:string,dataset:Dataset,today:string):CompanyBrief[]` validates then removes exactly an existing brief, or throws if absent; UI owns confirmation.
- `compareAnnualCitation(citation:AnnualCitation,dataset:Dataset,today:string):CitationDrift` validates snapshot/dataset intrinsically, then returns comparison above; it accepts missing current ticker for proposed removal review.

Creation of statement UUIDs is a UI action after its bounded draft validates through updateBrief; failed creation can consume an unused UUID but commits nothing. Callers may create a transient empty `{ticker,statements:[],citations:[]}` to assemble the first edit; validateBriefs rejects it if persisted unchanged. Native date validation uses one captured today throughout each synchronous operation.

## Notebook compatibility, history and refresh

`validateNotebook` chooses exact root keys by input version: v1/v2 old keys; v3 adds briefs. Preserve v1 unique-ticker requirement before migration, preserve all accepted old notes, IDs/data/criteria/selections, and output canonical3 with briefs:[] for valid older input. Keep old v1/v2 raw JSON and canonical old-shape ceiling4 MiB; new v3 input/canonical cap6 MiB. Do not first add fields and reject an accepted near4 MiB legacy notebook for wrapper overhead. Initial migration stays in memory; loading must not rewrite the existing raw IndexedDB record until a later real save. Existing database location and transaction/recovery machinery remain unchanged.

Briefs belong in EditState, model extraction, history entry serialization and reconstructed snapshots. The immutable financial Dataset still lives once per history. A brief-only edit must be a real undoable change; restore exact cited snapshots and literals. Keep existing up-to30 states/8 MiB history policy, including its normal oldest-history trimming and redo truncation; never evict citations or statements from any retained state. Document these history limits visibly. Current brief content is never silently reduced to fit a history budget. No-op commits retain redo.

Refresh annotation union includes any ticker with a brief, even if absent from note/watchlist/comparison. Extend `RefreshAnnotation` with `brief:CompanyBrief|null`, a detached complete prior brief. Existing policies are unchanged: absent incoming ticker removes its whole research group; changed latest name/sector/currency/synthetic requires explicit Keep/Drop; unchanged identity retains automatically. Keeping preserves every brief byte/value/ID and captured source, never replaces snapshots with incoming rows. Dropping/removal removes the whole brief alongside its existing note/watch/comparison. Choice-array maximum includes the additional50 brief-only groups. Existing loss acknowledgement includes these groups; changed decisions reset consent.

Review UI lists brief statement/citation counts and offers an expandable complete text rendering of that group's old brief with both captured sources and comparisons against incoming data. Annual-period removal while ticker remains does **not** drop citation snapshots or create an issuer Keep/Drop choice; show their missing-current-period warning. Export the full prior brief plus projected source differences/outcome in the refresh report, including groups proposed for removal. Existing Download previous notebook is the complete recovery artifact; accepted refresh still starts fresh history, with explicit confirmation, since this milestone does not change #56's history contract.

## Authoring, drafts and accessible interface

Add stable `#company-brief` after existing Research note in the company detail. It stays available through Shortlist, Watchlist, Comparison and Excluded company evidence. Heading **Company brief** names the selected ticker. Display **Your statements and supplied citations. Citations do not verify claims.** A readable sectioned view shows saved statements in Business/Risks/Open questions, attachments and **Uncited statement** when none. Do not auto-create a “strength” from a positive number. A source library shows literal titles/captured period, with expandable full excerpts/snapshots and safe links. All financial evidence shows units, currency, null as Not supplied, file:row and supplied/synthetic provenance.

Frozen selectors/accessibility:
- `#brief-section` **Statement section** (business/risks/questions), `#brief-text` **Statement text**, `#brief-citation-options` checkboxes labeled by bounded source title or annual period/field names, `#brief-save-statement` **Save statement**, `#brief-cancel-statement` **Cancel statement edit**.
- Saved rows `[data-brief-statement=id]` have **Edit statement**, **Delete statement**, and internal citation links to `#brief-citation-ID`; expose section through `data-section`.
- `#brief-source-title` **Source title**, `#brief-source-author` **Source author (optional)**, `#brief-source-date` **Source date (optional)**, `#brief-source-url` **Source HTTPS link (optional)**, `#brief-source-excerpt` **Supplied excerpt**, `#brief-add-excerpt` **Add excerpt citation**.
- `#brief-period` **Annual period to cite** lists exact stored dates oldest first; `#brief-fields` labeled five field checkboxes, none selected automatically; `#brief-add-annual` **Capture annual fields**. Capture adds to library only; attachments always explicit.
- `#brief-citations` saved `[data-brief-citation=id]` entries have bounded heading, **Inspect citation**, **Delete citation**; annual entry `[data-citation-state=same|changed|missing]` and separate factual/identity/source difference lists. Details do not default-expand long URLs/text.
- `#brief-delete` **Delete brief**, `#brief-discard-drafts` **Discard brief drafts**, `#brief-download` **Download company brief**, polite `#brief-status` with aria-live rather than introducing mandatory changes to existing status selectors.

Forms and display are separate. Keep per-ticker raw statement/excerpt/period/field/attachment drafts, including invalid text, across normal redraws, async save/restore statuses and company switches; cap draft keys to existing dataset tickers and clear only through successful targeted save, explicit discard or confirmed notebook replacement. Draft arrays/objects must be detached from committed notebook graphs: neither form editing nor delayed autosave may mutate a captured committed snapshot. Do not replace active form nodes on routine render; preserve caret/focus and unrelated old note drafts. Native maxlength measures UTF-16, not code points; omit it or use twice the code-point bound and domain validation so valid astral input is not silently prevented. Large invalid programmatic input remains in its field but cannot be copied into labels/preview; validate length before formatting. Successful saving of one form clears only that submitted unchanged draft. Source additions do not auto-attach to an unsent statement; the user chooses the new checkbox.

Every new input/change and add/edit/remove intent calls existing draftIntent before any asynchronous publication can become current. Extend editorDrafts, beforeunload, refresh readiness and explicit Discard editor drafts for refresh to all brief/source/attachment drafts; its confirmation names briefs/citations. Clearing a dirty flag never revives an already stale refresh. Saving a brief invalidates staged refresh through ordinary generation. Delete statement/source/brief and Undo/Redo must not silently discard conflicting raw brief drafts: block with Apply/Cancel/Discard guidance, while unrelated old title/note drafts stay intact. Explicit Cancel statement edit clears only its statement draft; Discard brief drafts confirms clearing all unsent brief forms for selected ticker. These never alter committed evidence.

Existing JSON/CSV replace, startup retry and refresh flows retain operation ID, notebook generation, raw intent and UTC rechecks, including after native confirmation. Their approved discard/reset paths must include brief draft maps. New excerpt/annual authoring has no async network/file operation. Any rejected shape/count/byte/date edit leaves current notebook, entire history/redo, saved record and other drafts unchanged. No autoplay, HTML injection or automatic link opening. All controls usable by keyboard, visible focus, no page overflow at390px; readable excerpt blocks wrap, bounded labels never contain full4000-character text.12 citations/statements per company need no pager.

## Reports and persistence

`brief-report.ts` provides `briefReportLines(brief:CompanyBrief,dataset:Dataset,today:string):string[]`: a complete standalone company block with authoring/provenance warning, all three sections, exact statement text/IDs and explicit citation IDs or Uncited; then each citation exactly once with complete text/metadata/captured selected fields plus full captured raw row and current-source comparison. Validate using the same domain rules; for a removed ticker in a proposed refresh, validate the brief against the previous dataset, and accept a separate comparison dataset via optional fourth `comparisonDataset?:Dataset` (default dataset). The source labels distinguish captured and current; IDs make plaintext references unambiguous. No inferred support or current-source substitution.

`buildCompanyBriefReport(notebook:Notebook,ticker:string,today:string):string` validates the notebook, requires an existing brief and returns UTF-8-ready text ending LF. It includes notebook title/ID and explicit UTC as-of date; source publication/fiscal/import dates remain distinct. Ordinary `buildReport` appends all committed briefs once, including tickers absent from the shortlist, preserving the old note and annual-history sections. `buildRefreshReport` appends every old affected brief and its retention outcome, comparing against incoming data. Both share the brief formatter but must include full content rather than counts-only summaries.

Each builder incrementally counts complete emitted UTF-8 bytes, including separators/newlines and repeated full captured/current provenance, against the existing8 MiB report cap. Do not count UTF-16 .length as bytes, truncate excerpts or return partial reports. Standalone brief report uses the same cap. An oversized report fails before creating a Blob/download and leaves state/drafts/review untouched; complete6 MiB JSON remains available. Literal CRLF inside supplied content remains, while the report's own separators are LF. User text is never interpreted as markup or commands.

Native IndexedDB save uses the existing complete canonical record and transaction-success semantics. A v3 brief-only change autosaves, survives process restart and is restored on Undo/Redo. Save failure leaves it usable/exportable in memory and prior durable record intact; existing Retry saving/protected raw backup/reset behavior remains. JSON must roundtrip every source field, literal, selected field, statement order/attachment and immutable snapshot. Restore validation rejects malformed/unknown fields, duplicate IDs/orphans, unsupported versions and oversize data atomically; it must not discard references to removed historical periods because they are intentionally standalone snapshots.

## Acceptance gates

- Original independent source fixtures distinguish null/0, negative income/equity, tiny nonzero amounts, independent priorRevenue, same selected values with changed other fields, same values/different filename/row/link/import ID/date, identity/synthetic changes, missing exact period despite newer row, and copied issuer labels. No endpoint silently becomes latest.
- Literal Unicode/whitespace/LF/CRLF roundtrips; reject lone CR/surrogate/controls, unsafe URLs, duplicates/orphans/cross-company IDs/unknown fields; quota boundaries and exact UTF-8 report accounting. Direct edit of a saved citation refuses atomically, cited deletion refuses, explicit statement detach then source deletion succeeds, deletion/clear preserves unrelated research.
- v1 unique-ticker rules retained, v2→v3 empty briefs, exact accepted near4 MiB old notebook migration, raw old saved record not rewritten at load; complete v3 graph and brief-only history/redo. No-op preserves redo; failed limits leave all state unchanged.
- Refresh-only-brief ticker enters Keep/Drop; removed ticker loses complete group only after reviewed consent; retained company with removed fiscal period keeps citation snapshot and shows missing. Repeated refreshes never rewrite old evidence. Proposed report includes dropped/retained full briefs, and legacy refresh behavior remains.
- Actual production shortlist→source/annual capture→statement citations→inspect→standalone/full/JSON downloads→reopen; independently decode exact files and restart a real persistent browser process. Source-only and uncited briefs are visible/exportable. Native save failure/retry, protected invalid record and legacy migration continue to work.
- Native raw drafts/focus across source additions, company switch, saving, UTC turnover, pending File read, changed-back input, stale import/refresh, Undo/Redo and declined discard. Excluded-company authoring and390px keyboard flow. All existing149 unit/34 browser gates plus new scoped tests/lint/typecheck/build must pass; root coordinates shared build/ports and final evidence.
