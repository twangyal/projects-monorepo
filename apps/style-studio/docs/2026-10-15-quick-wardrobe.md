# No-typing owned wardrobe (#265) — 2026-10-15

## Outcome

The visual onboarding path now continues into clothes the user owns. Explicit top, bottom and shoes starters prepare a globally unused suggested name and visible neutral/regular/minimal/casual defaults in the existing piece form. Name and tags remain editable in optional details; category remains visible. These are declared starting choices, not photo recognition or learned facts. An actual optional photo uses the existing local normalization, color-reading and save pipeline. Applying its measured palette is still an explicit action, and the visible quick review updates to the exact submitted values.

Nothing enters the profile until the ordinary Add wardrobe piece submission. Category progress enables Show my combinations only after all three categories exist; it submits the existing suggestion form with its current mode, occasion and wear-history choices. Existing empty-state explanations and insufficient-evidence behavior remain authoritative. A generated candidate can be saved with its existing suggested name, downloaded as a photo PNG and retained in complete JSON/autosave without typing. Saving does not create personal votes.

Quick setup refuses replacement of a raw/manual/edit/photo draft. Editing saved clothing refuses to erase an active quick piece, including its pending real photo decode. Confirmed piece-level discard clears only unapplied fields and photos, retires pending decode ownership and preserves committed clothing. A manual draft has the same explicit escape, even after its typed name is erased. No parallel writer or profile schema is introduced; existing atomic capacity, operation, history, recovery and save-conflict rules remain intact.

## Verification

Three new domain tests cover declared defaults without profile mutation, globally unique names, and atomic per-category, complete36-piece and unknown-category refusals.

Six native browser cases cover:

- Desktop1440 and phone390: no typing through three original synthetic PNG fixtures, actual JPEG normalization, category progress, an actual-photo combination, independent saved snapshots, complete JSON, full reload and an actual1200×1000 PNG. Independent browser decoding finds more than1,000 pixels of each fixture color in the exported board. These fixtures establish media plumbing, not garment recognition.
- Raw manual draft preservation and explicit discard of a held actual native image decode, with no late photo resurrection.
- Category changes updating only the generated name, preserved custom names, optional measured-palette application and exact visible review/submitted tags.
- Saved-piece Edit preserving a quick draft and its pending photo; explicit discard then permits ordinary editing.
- A typed-then-erased manual draft retaining committed clothing through piece-level discard. The clean form hides its discard control immediately.

Local check passes67 unit tests, ESLint, TypeScript and production build. The six focused native cases and complete84-case native suite pass after review. Published-source/main evidence is recorded in the root integration receipt after those gates finish. The existing browser assertions, real storage deadlines and export checks remain intact.

## Retained failures and review

The first implementation probe fails at both widths because the quick wardrobe heading does not exist. Read-only review identifies three Important issues: stale visible tags after measured palette application, silent quick-draft loss on Edit, and no discard path for an erased manual draft. Native RED cases reproduce each before repair. All six focused cases then pass; re-review finds no remaining Critical/Important issue. A minor stale discard control is corrected by resetting the dirty flag before the existing photo reset triggers presentation; a focused assertion confirms it hides. The first full run passes83/84: its already-built bundle still has the stale control while the newly added assertion reads the updated test. This retained failure reproduces the minor issue; the final run rebuilds the frozen repaired source before running the entire suite. An intermediate shell edit used repository-relative paths from the app directory and failed before changing files; its unintended old-source test invocation was interrupted, paths corrected, and the focused run repeated. No successful gate is inferred from that invocation.

## Limits

Portable local Chromium143.0.7499.0 and viewport emulation are software evidence. Synthetic uniform colors and one constructed subject image do not establish real-user clothing-photo quality, touch behavior, useful taste matching, physical fit or intended-user setup effort. Starter defaults require review and can make early combinations generic. Style remains ACTIVE under the broader style-assistant vision. No external image service, account, paid dependency or inference call is added; project #8 remains skipped.
