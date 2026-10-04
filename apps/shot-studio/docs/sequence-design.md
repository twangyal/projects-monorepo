# Detached scene sequences (#90)

The sequence is an editable cut of whole authored shots, freshly rendered from
independent scene snapshots. It never splices retained video bytes. Scene films
and take archives keep their existing formats, storage and history.

## Document and clocks

`sequence.js` owns strict schema 1 (`kind: shot-studio-sequence`), four complete
canonical schema-3 sources, twenty clips and sixty sequence seconds. Sources have
unique bounded IDs and labels; clips reference an existing source and shot index.
Empty cuts are allowed during authoring but cannot play or export. Imports are
bounded to 300 KiB; each source stays within the existing 64 KiB film bound.
Validation and editing return detached values and reject quotas before publication.
Referenced sources cannot be removed until their clips are removed.

Each clip uses its shot's original duration, camera-local time and source-global
time. At a hard cut the next clip starts; a repeated shot restarts at its original
source start. The final frame uses the authored final endpoint. Blocking cues,
visibility and looping/wave phase evaluate on source time, never sequence time.

## Ownership and presentation

`sequence-ui.js` owns a separate preview canvas/renderer, source/shot selectors,
clip ordering/repetition/removal, sequence title, independent rehearsal/scrubbing,
Undo/Redo, JSON backup/import and bounded real-time WebM export. A separate canvas
keeps scene authoring and actual-take playback independent and avoids competing
animation loops or accidental presentation ownership of the main stage.

Sources can be copied from the committed scene (after resolving its unsent edits),
the selected saved take's editable film, or a validated scene JSON. Copies retain
no links to later scene edits or take deletion. Selecting sources does not edit
them. All structural edits are reversible with thirty session history entries.

`sequence-draft.js` owns only `shot-studio-sequence-v1`. Startup reads never write;
corrupt/denied reads block autosaves, with exact raw recovery when available and
explicit replacement. Another tab's changed record blocks a stale save. Failed
writes retain in-memory work and direct complete backups.

Native inputs invalidate pending sequence imports immediately, before blur.
Import completion must still own its epoch and revision. Rehearsal and encoder
draws use a committed snapshot. Raw title input is preserved until valid blur or
explicit discard; backups disclose that they contain committed work. Tab hide,
page departure, context loss and cancellation stop owned recording/animation;
late completion cannot publish a download or replace newer work.

## Implementation and verification plan

- [x] Write failing domain/draft tests; implement detached bounded operations,
  original clocks, history and protected saves; run all unit/syntax checks; commit.
- [x] Author native browser acceptance before UI: independent source capture,
  cut preview, actual encoded/decoded WebM, backups, raw imports/recovery and mobile.
- [ ] Observe native tests fail against missing controls, then implement the
  isolated UI and minimal scene/take capture adapters; keep existing tests intact.
- [ ] Run all unit/syntax/browser checks on the exact committed head. Add maximum
  topology/full-minute, complete browser-process restart and decoded pixel oracles
  before closing #90. Document any unavailable acceptance honestly.

No audio, transitions, arbitrary video import, model/service or headset acceptance
is added. Physical XR remains #21. Run autonomously under AGENTS.md; this plan
requires no interactive handoff or new authorization.
