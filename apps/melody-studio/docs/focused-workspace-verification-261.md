# Focused composing workspace (#261)

Base: main `86761ca0a2ea26d2384696d3c493fcac46c90899`, 2026-10-15. Melody remains ACTIVE toward the full DAW destination.

Compose emphasizes tracks, piano roll and transport. Capture, Sound, Notes, Arrange, Reference and Project & export reveal existing mounted controls. An actual expanded view remains available. The persistent toolbar spans the entire page, including reference/library/MIDI hosts; its measured height controls navigation offsets. Phone project/track controls are compact, with detailed guidance available through native disclosure controls. Global Stop, active-operation Cancel, visible save/recovery state and keyboard back are retained.

## Verification record

- Baseline: 428 unit tests, lint, type checking and production build passed.
- Final focused native suite: 18 passed; the same targeted run also passed both existing stereo-mix gates (20 total). Covers all sections and actual expanded view, exact control identity, valid/invalid raw drafts, expanded-mode keyboard navigation, selection/history, exact retained reference bytes, load/edit/listen/MIDI/reload on desktop and 390px phone, authorized pending library read, retired playback response, late microphone permission cleanup, corrupt-storage recovery, visible cancellation focus, toolbar/field geometry successful demo capture/WAV export, passive Stop/help draft retention and an authorized library read surviving a passive title blur.
- Native RED evidence caught missing navigation, unintended expanded-mode keyboard blur commit, missing recovery route, piano roll below the phone viewport, and contextual fields obscured by the toolbar. These cases pass after implementation.
- Independent read-only review found no definite newly introduced Critical/Important correctness regression. Its visible-focus acceptance gap and redundant legacy-page wrapping were addressed. Later layout adjustments were checked through native geometry and rendered desktop/phone inspection.
- The first full regression run passed231/233. One synthetic backed-microphone capture failed under concurrent audio load; another short ordinary-playback test naturally ended between its enabled assertion and Stop click. Both passed in an isolated serial run with the same assertions and deadlines. A final full serial regression is in progress; no full final pass or hosted result is claimed in this checkpoint.
- First hosted source run [38713547011](https://github.com/twangyal/projects-monorepo/actions/runs/38713547011) passed243/244 browser cases and exposed a real stereo-slider regression: the new blur guard treated range controls as text. Deferral now applies only to title, tempo and track-name fields. Existing stereo assertions pass unchanged. Two further RED utility cases and one RED authorized-read case caught passive Stop/help focus committing a draft or retiring a library read; those cases now pass.
- Legacy feature gates use the real expanded product control. They do not inject a hidden mode or weaken product admission checks. New focused tests use the default product layout.

## Limits

Drafts remain session-only and are not added to backups or restored after reload. Native departure warnings remain browser-controlled. This is Chromium desktop and emulated390px validation with synthetic audio, not physical microphone quality, intended-musician usability, other-browser acceptance or full DAW completion. No schema, synthesis, storage representation, dependencies or production infrastructure changed. Hosted/source/main evidence will be added to the issue and this record after publication.
