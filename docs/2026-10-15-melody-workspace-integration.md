# Melody focused workspace integration — #261

Owner direction remains a full music-production DAW. This milestone makes the existing creative flow understandable through focused sections, preserving underlying notes, takes, raw drafts, selected notes, history, storage protection and owned asynchronous work. It does not complete the DAW or establish real musician acceptance.

## Delivered

- Compose emphasizes tracks, piano roll and transport. Capture, Sound, Notes, Arrange, Reference and Project & export reveal related tools; Expand workspace remains a real product option.
- View changes keep mounted editors, file inputs and persistent hosts. Valid/invalid drafts survive navigation and keyboard utility focus. Enter explicitly applies retained basic text; sliders remain immediate edits.
- Persistent audio stop, operation Cancel, recovery status and back/Escape behavior remain accessible. Contextual scroll placement uses measured toolbar height; phone composing shows the piano roll without unrelated forms.
- Complete native journeys cover importing an original reference-backed project, editing/history/listening, independent MIDI checks, backups/reload, demo capture and WAV export. Race coverage includes retained authorized library reads, passive blur, cancelled worker replies and late microphone permission cleanup.

## Evidence

Source code commits: [38b8b46](https://github.com/twangyal/projects-monorepo/commit/38b8b465bc415f2981d33671767a322a85b98f68), [6b03aec](https://github.com/twangyal/projects-monorepo/commit/6b03aec8ed98e42ed37527dc584b61282b4477b3), based on main86761ca.

| Gate | Verified result |
| --- | --- |
| Local unit/lint/type/build baseline |428 units passed; checks passed |
| Final local focused + stereo gates |20 passed (18 focused,2 existing stereo) |
| Updated local unit/lint/types |428 units passed; lint/types passed |
| Final source CI |[38714678813](https://github.com/twangyal/projects-monorepo/actions/runs/38714678813):428 units,247 browser tests, lint/types/build passed |
| Main CI |Pending integration run |
| Final full local guarded tree |In progress; result will be recorded below |

Independent read-only review found no definite newly introduced Critical/Important correctness defect. Its visible-focus acceptance gap and redundant fixture wrapping were addressed; later layout corrections passed native geometry and visual desktop/phone inspection.

Retained failures: first local233 run had231 passes plus a synthetic microphone failure and short-playback timing failure; both passed isolated unchanged. The full serial pre-guard checkpoint and [first source CI38713547011](https://github.com/twangyal/projects-monorepo/actions/runs/38713547011) each passed243/244, exposing range changes incorrectly treated as navigation blur. Restricting that guard to actual text fields restored the unchanged stereo assertions. Additional native RED cases caught utility-focus draft application and passive-blur library retirement; all now pass. No assertion or deadline was weakened.

## Limits

Chromium desktop and emulated390px phone validation uses synthetic audio and authored/reference fixtures. Physical microphone quality, intended-musician usability and broader browser/device behavior remain unverified. Drafts remain memory-only; departure warnings are browser-controlled. No schema, synthesis representation, dependency, billing or infrastructure changes. Project8 remains skipped; owner-deferred apps were untouched.
