# Selected-passage lyric timing — #294

## Intended outcome and bounded design

Correct a delayed verse or chorus in one deliberate edit without moving sections that are already synchronized. This extends the existing complete-clip offset and correction workflow; it does not replace the automatic song-to-karaoke destination or establish better recognition/alignment quality.

All lines stays the default. Selected passage exposes first/last existing-line choices and an inclusive numbered summary. A single line is allowed. The existing finite signed decimal offset moves only those boundaries; literal words, cue lengths/internal gaps and outside cues stay intact. The pure helper validates the complete original/proposed graph, dense cue presence, ordered integer endpoints, both untouched neighboring intervals, clip bounds and representability of every moved boundary. It never crops or mutates input.

The UI validates before history or operation retirement. Invalid requests preserve editor/raw timing text, title, pasted drafts, Redo and pending listening/import/timing work. A valid request captures the exact pre-edit state, cancels obsolete operations and applies one unsaved history change. Rendering reuses raw spellings for unchanged outside boundaries. Save and exports remain deliberate.

Passage endpoints bind to the current cue object identities. Replacements (including same-length SRT), split/merge/remove and Undo/Redo clear both endpoints; repeated successful offsets keep the intended passage. Text/time edits to the same lines preserve selection and refresh labels. A different clip resets scope and offset. These controls are session utilities, not project schema additions.

## Verification history and current limits

- Baseline: all 134 TypeScript tests passed before changes. Three passage tests then failed on the original whole-clip implementation (outside cues shifted, range admission absent, sparse graph accepted). The final pure helper passes all 16 cue-edit tests; project check passes all 137 TypeScript tests, ESLint and TypeScript/production build.
- A first UI RED established that the passage controls were absent. The local workspace later restored an older checkpoint; uncommitted implementation and pending logs were lost. #294 records the interruption. Reconstructed code was saved in task-branch checkpoint d636a20b034752da21410d18aca1b28323c7e0e9 (tree c33a6bc7e7fb8b894207bac394cb0e7fd89e01dc); canonical main was not changed by that checkpoint.
- First reconstructed focused native gate: 7 original cases passed and 4 new cases failed before applying the feature because exact label-text lookup included wrapped-select option text. Accessibility snapshots exposed correctly named comboboxes. Tests now locate those exact combobox roles/names; behavior assertions were retained. A fifth new case covers same-length SRT replacement.
- Corrected focused gate passes all 12 cases in 34.4s, including actual saved/reloaded SRT, literal words/outside raw spelling, one-step history, invalid offset/range/overlap preservation, playback/import retirement, structural replacement and phone keyboard/containment. The subsequent final suite strengthens Redo invalidation by selecting endpoints before Redo.
- Full local Python suite: 206 run, 205 pass. Unchanged `test_subprocess_rss_limit_is_enforced` fails: the expected memory-limit exception becomes a subprocess timeout because this environment does not expose the child RSS reliably. Prior checks recorded the same local limitation. No resource guard/assertion is relaxed; hosted Linux verification is required.
- Independent code review found no critical/important issues; incremental test review found no blockers. Full final browser and hosted source/canonical outcomes are recorded below when available and in #294.

Native tests use an injected deterministic separator/transcript fixture and real audio/service/SRT/export paths. They are software workflow evidence, not real-model inference, real-song alignment or physical-device/intended-user usability acceptance. Models, dataset timing/correction-effort evidence under #241 and the full Karaoke vision remain separate. No paid service, schema change or PR is introduced. Project #8 remains skipped.

## Final local receipt

Reviewed source `efaa04f4223b01a9e3d559de5301a18b93b2682e` has tree `51eca4f4e27d1ef62723c08a7dd8b3423a2709fa`, identical locally and remotely. The final complete local browser run passes **122/122 in 5.7m**, including the stronger Redo check (freshly select a passage before Redo), same-length replacement, actual saved/reloaded SRT and existing real MP4 cases. All 137 TypeScript tests, ESLint and typecheck pass again on the final tests; the production implementation/build is unchanged from the preceding passing check. The final 390px passage screenshot was inspected. Local Python remains 205/206 with the precise RSS/procfs failure above.

Checkpoint run [39428125826](https://github.com/twangyal/projects-monorepo/actions/runs/39428125826) was cancelled by the normal branch update and is not an acceptance pass. The source branch is pinned to the reviewed follow-up while [39428728861](https://github.com/twangyal/projects-monorepo/actions/runs/39428728861) runs the complete hosted gate. Its actual outcome, followed by canonical main verification, is recorded in the issue and the integration receipt below.

## Hosted source acceptance and integration

[Source run 39428728861](https://github.com/twangyal/projects-monorepo/actions/runs/39428728861), job118647982040 at `efaa04f4223b01a9e3d559de5301a18b93b2682e`, succeeds: **206 Python tests (73.641s), 137 TypeScript tests and all 122 browser cases (5.4m)**, plus compileall, Ruff, ESLint, typecheck and production build. The unchanged RSS-enforcement test passes on hosted Linux; the local failure remains recorded above. No guard or assertion was relaxed.

The canonical integration follow-up changes only this verification document. Product code, tests and other documentation retain the exact verified source bytes. Issue #294's bounded passage-correction milestone is complete; the issue records canonical-main follow-up when available. Karaoke remains ACTIVE, with real-song multilingual timing and correction-effort evaluation still open in #241. Project #8 remains skipped.
