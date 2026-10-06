# Session draft workflow — issue #133

The practice inbox now reopens and updates saved drafts in place. IDs, order and
unrelated records remain unchanged. Compose preserves the current unsaved fields;
New draft or opening another record reviews dirty text with explicit Keep/Replace
gaze controls. Replacement closes the gaze keyboard before assigning new fields.
All data remains session-only, with no sending or persistence.

New domain regressions fail before implementation: draft reopening is absent and
the twenty-record capacity is unenforced. The original native flow also fails
because saved drafts have no Open control. Four domain tests now pass, including
atomic field/capacity refusals and detached record snapshots. All 63 Node tests,
lint and build syntax checks pass.

Eight focused native cases pass across 1280×900, 390×740, 390×480 and 390×651:
gaze reopens/updates the same record, Keep retains typing entered after review,
Close/Compose preserves fields and explicit replacement starts a new blank draft.
The corrected full native gate passes all 72 cases and additionally checks twenty 200-character-subject/
10,000-character-message records, full text reopening despite short previews,
safe 21st-record refusal, updates at capacity and session clearing on refresh.
Independent review reports no actionable issues.

The first full run passed 68/72: four existing keyboard assertions expected
the previous list text without its new Open control. Those assertions now verify
the saved content and Open control; the corrected run exits successfully.

Native checks use Playwright 1.63.0 and explicit Sparticuz Chromium 153.0.8010.0,
pointer simulation and a controlled clock. They do not establish physical webcam
accuracy or arbitrary browser control. Full gate and published CI completion are
recorded in the issue; physical webcam acceptance remains in #132.
