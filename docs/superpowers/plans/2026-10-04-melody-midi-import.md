# Melody MIDI phrase import implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a deliberately reviewed MIDI phrase into the existing editable composition, preserving precise source timing and making unsupported/excluded content visible, with one undoable replacement.

**Architecture:** Bounded byte parser → transient channel/window/mapping review → detached candidate → exact-base checked application through existing history/storage. A stable import host and captured editor intent isolate asynchronous native File reads from the current editor and continuation proposal.

**Tech Stack:** Existing TypeScript/Vite/Web Audio, Node 24 tests, Playwright production Chromium. No runtime package, backend, account, downloaded model or Composition schema change.

**Spec:** [Reviewed MIDI import design](../specs/2026-10-04-melody-midi-import-design.md). **Tracker:** [issue #60](https://github.com/twangyal/projects-monorepo/issues/60).

## Global constraints

- Only root releases implementation, assigns owners, changes configuration/docs/CI and performs Git/tracker operations. User autonomy supplies product decisions; no additional approval question is needed.
- Exact exports/types/limits and semantics in the spec are authoritative. Parser types publish first; no owner duplicates them. Keep existing APIs/labels/tests and source schema/localStorage key.
- Fail unsupported global events and ambiguous lane state honestly; do not silently quantize, clip, drop, flatten tempo or relabel unsupported MIDI as faithfully imported.
- Import staging never commits, saves, plays, stops existing playback, clears continuation/redo/drafts or redraws the composition editor. Apply alone has deliberate scratch/replacement consent and one history edit.
- Each owner writes meaningful failing tests first, observes the failure, then implements and runs focused checks. Do not run competing shared production builds/servers; root coordinates port 4174 and full gates.
- No excluded project paths/catalog entries are read or changed. No new runtime dependencies, model/network probes or generalized workstation rewrite.

## Review focus

1. **Channel state is global:** a format-1 channel has program/CC7 on one raw track and notes on another. Parser marks it unsupported; independent oracle and browser show the exclusion, never inventing two independent parts.
2. **Precise window inclusion:** PPQN 997, off-grid onset/offset and a note crossing a whole-beat window. Builder preserves tick differences and rejects crossing notes; decoded actual MIDI uses only the disclosed 480-tick rounding.
3. **Unsent input races:** hold native File.arrayBuffer, type a blank note start or global tempo/title without blur, then release/cancel/new file. UI and browser assert exact DOM drafts/focus/history/proposal remain and stale review cannot apply.
4. **Text and unsupported global effects:** malformed UTF-8/long names plus port/SysEx/unknown sequencer meta. Parser fails effects globally; usable subset/name fallback review is explicit and literal, never truncated or rendered as HTML.
5. **One deliberate replacement:** nonselected-note raw drafts and an unapplied suggestion exist. Consent refusal changes nothing; successful replace clears only after validation, gives one Undo/Redo edit and a real reloaded/exported composition, with save failures visibly recoverable.

## Task 1 — Parser contract and strict SMF engine

**Owner:** parser implementer. **Files:** create `apps/melody-studio/src/midi-import.ts`, `apps/melody-studio/tests/midi-import.test.ts` only.

- [ ] Publish exact `MIDI_IMPORT_LIMITS`, `MidiImportError`, parser types and `parseMidi(bytes)` callable placeholder so peers typecheck immediately. A placeholder is not completion.
- [ ] Write independently assembled byte fixtures/test helpers and observe RED for format0/1/PPQN/default tempo/simple paired notes; record focused command and failure.
- [ ] Implement bounded chunk/event/VLQ/running-status/EOF handling. Add hostile/truncated/budget/tick-overflow/unused-track tests before each corresponding safety branch.
- [ ] Implement global metadata whitelist and constant exact tempo/default policy using all tempo values and globally minimum absolute tempo tick, not raw-track parse order; globally reject ports, prefixes, SysEx and unmodeled meta, with actionable bounded errors.
- [ ] Implement global channel ownership, positive-attack budget, supported pairing, lane issues and static program/CC7; retain explicit default flags/counts. Clear paired lists for every unsupported lane.
- [ ] Implement fatal bounded text decode/name choices and ignored metadata/release counts. Test 80 UTF-16 vs emoji, whitespace/controls/malformed bytes/multiple names without truncation.
- [ ] Run `node --experimental-strip-types --test tests/midi-import.test.ts`, scoped ESLint and `npm run typecheck`. Report callable checkpoint to peers; avoid shared production build.

## Task 2 — Reviewed phrase candidate and stale-base apply

**Owner:** review implementer. **Files:** create `src/midi-review.ts`, `tests/midi-review.test.ts` only, under `apps/melody-studio`.

- [ ] Import the frozen parser contracts and publish `MidiLaneChoice`, `MidiImportChoices`, `MidiReviewedLane`, `MidiImportReview`, `buildMidiReview(base,source,choices)` and `applyMidiImport(current,review)` signatures.
- [ ] Write RED tests with independently hand-authored previews for exact source shifts, 1/8 lanes, 256/257 notes, crossing/outside notes and unsupported selection.
- [ ] Validate all input/result domains defensively, including total attacks/lane counts, exact tempo, sorted unique identifiers and supported same-pitch nonoverlap; build detached ascending-channel tracks with explicitly chosen names/instruments, source CC7 volume and separate onset velocity. Require at least one whole note per selected lane.
- [ ] Preserve source `(on-start)/PPQN` and `(off-on)/PPQN` arithmetic without quantization/epsilon; validate the candidate through existing `validateComposition`.
- [ ] Generate fresh UUIDs when building the review with collision checks and at most 32 attempts per ID, compute attack exclusion counts and bounded warnings. Verify source/base/choices immutability and no accidental audio/storage side effect.
- [ ] Observe RED for stale base, cloned/forged review and joint candidate/choices mutation; implement module-private WeakMap receipts containing full canonical review/base and detached candidate. Apply requires exact object identity/unchanged full review and exact current base, then returns the private detached validated candidate.
- [ ] Run the owned Node suite, scoped lint and typecheck. Notify UI when actual functions replace placeholders; no exporter/model changes.

## Task 3 — Stable import review and raw editor lifecycle

**Owner:** UI implementer. **Files:** `src/main.ts`, `src/style.css` only.

- [ ] Coordinate the spec's IDs/labels with browser owner before markup. Mount stable `#midi-import` beside the replaceable editor subtree without changing root index/config or existing control selectors.
- [ ] Publish coherent native File → status/source lane review shell early. It must not use the old JSON/audio replacement path or change current `operation` ownership.
- [ ] Add narrow raw global/per-track draft preservation and capture editor intent before existing change handlers. Preserve all note draft entries, raw spellings, proposal and focus across ordinary async renders.
- [ ] Implement dedicated file epoch + intent + composition generation checks around native arrayBuffer and parse publication; stale finally cannot clear newer status. Cancel affects import state only.
- [ ] Render explicit lane inclusion, title/name choices, source program/CC7/defaults, empty local-instrument selections and whole-beat window. Selection edits invalidate candidate/consent, keep parsed source and draft choices.
- [ ] Build/rebuild current reviewed candidate through `buildMidiReview`; show exact selected/excluded attacks and limitations, including that source window/EOT trailing silence cannot be represented in schema 1. Any editor intent irreversibly invalidates completed review; ordinary controls remain usable.
- [ ] Implement conditional scratch/proposal-discard acknowledgement without early clearing; no generic limitations checkbox. Final native Replace consent includes selected/included/excluded counts/window and explains committed-only Undo.
- [ ] Recheck guards and call `applyMidiImport` before replacement; commit once. Clear raw drafts/proposal/reset selection only after successful validated history commit. Preserve old state on every failure/cancel and show actual save errors.
- [ ] Verify title/name limits, blank/nonfinite numeric inputs, fractional tempo and literal metadata; use accessible keyboard/mobile controls. No automatic audition, all-channel selection or program-to-waveform mapping.
- [ ] Run scoped lint/typecheck and notify root/browser owner of coherent source readiness. Do not build dist while browser gates own it.

## Task 4 — Independent semantic and byte oracle

**Owner:** independent oracle implementer. **Files:** create `tests/midi-import-oracle.test.ts` only.

- [ ] Read the spec and existing destination/export model to derive expected results; avoid future producer implementation while authoring oracle expectations.
- [ ] Build original literal SMF fixtures with hand-derived global state, note events, PPQN/tick timing and exact exclusion counts; do not call parser/exporter to produce expected source semantics.
- [ ] Cover same-channel cross-track state, per-track running status, tempo defaults/changes, initial/repeated/changed program and CC7, velocity-zero off, release velocity, ambiguous pairing, percussion/expression/ports/SysEx and EOT boundaries.
- [ ] Independently assert precise window inclusion, off-grid duration, text/fallback and destination bounds, plus detached/stale candidate behavior. Include rejected events in unselected lanes/tracks to prove whole-file structural validation.
- [ ] Run owned Node suite after callable producers, report any concrete discrepancy without editing production files or weakening oracle expectations.

## Task 5 — Native production browser and downloaded artifacts

**Owner:** browser implementer. **Files:** create `tests/browser/midi-import.spec.ts`, `tests/browser/midi-import-fixtures.ts` only.

- [ ] Preserve existing Melody tests and coordinate the frozen control contract with UI. Create independent fixture bytes and expected phrase events; production tests use actual native File upload and normal localStorage.
- [ ] Observe RED for a real format1 source with selected/unselected parts and outside phrase notes; then prove review/mapping/consent replacement, edit/play and exactly one Undo/Redo transition.
- [ ] Read actual JSON download/storage reload. Decode actual exported MIDI independently (ticks/tempo/program/CC7/velocity/selected-only events); decode actual WAV format/data and distinguishable nonzero mix duration. Include trailing-rest source and assert actual last-note duration plus WAV release, not window/EOT length; account explicitly for 480-tick export rounding.
- [ ] Add deterministic delayed native File read tests for raw input before blur, later commit/Undo/select/new file/cancel, stale completion and stale finally. No producer-injected fake parser or browser-only model override.
- [ ] Preserve raw blank note fields in nonselected notes, global title/tempo/track values, proposal, focus and redo through errors/cancel/refused consent; require new Review after input changed back.
- [ ] Test unsupported shared/percussion/expression lane visibility, global unknown-meta rejection, explicit names/fallback/instrument mapping, mobile keyboard flow, and localStorage failure with a usable JSON export.
- [ ] Coordinate fresh dist/port with root; run owned production suite, then send exact results/artifacts/findings. Do not start a competing preview or change parser/UI to make tests green.

## Task 6 — Integration, honest evidence and closure

**Owner:** root; independent final source review may be assigned to the spec author. **Files:** README/evidence/CI configuration as needed, with root controlling Git/issues.

- [ ] Review cross-owner exported APIs, detached candidates, global channel state, file-intent/raw draft boundaries and one-commit ordering. Require concrete review findings to be fixed under the relevant owner with regression evidence.
- [ ] Run `npm run test`, `npm run lint`, `npm run typecheck`, `npm run build` and all `npm run test:browser` after coordinated fixes. Use actual installed Chromium via optional `CHROMIUM_PATH`; do not weaken existing checks.
- [ ] Independently complete native upload → explicit selected phrase → Undo/Redo → reload → real decoded MIDI/WAV smoke with literal source names and off-grid notes. Record observed limits/test results/artifact sizes; fixtures prove this contract, not universal DAW fidelity.
- [ ] Update README to explain supported formats, strict rejection/subset review, beat-window shift, absent persisted trailing silence/EOT padding, explicit instruments/default state, saved schema, text choices and 480-tick re-export limitation. Do not call this generated AI or source-sound reproduction.
- [ ] Review final diff; commit/push only under root ownership, inspect scoped CI, then close issue #60 after actual gates. No unrelated catalog or source changes.
