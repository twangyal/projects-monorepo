# Gaze spoken phrase selection — #275

## User outcome and design

Users can select interior words without first dragging a pointer range, then use existing exact insertion/replacement and text Undo. `select text Tuesday` requires one literal case-insensitive match; `select second occurrence of Tuesday` or first/last chooses a repeated phrase deliberately. No matching phrase, an unavailable occurrence or an ambiguous unqualified phrase refuses without navigator selection/value/event/history changes. Ordinary target clarification, current writability, native selection restrictions and pause/cancel remain.

Matches are nonoverlapping, counted from the beginning. Original UTF-16 offsets come from escaped Unicode case-insensitive regular-expression matches, not a lowercased copy; punctuation is literal and quoted spaces are retained. This does not normalize Unicode or fold accents. A post-focus value/writability check rejects offsets if the website changed or locked the field. Website callbacks themselves remain outside the navigator's transaction control.

The shared rule parser and native executor serve both the practice site and the isolated MV3 extension. Help and README expose the new flow. No rich-text selection, permission expansion, dependency change, paid service, physical speech/gaze quality or intended-user acceptance is claimed. Gaze remains ACTIVE; #132 remains separate. Owner-deferred projects and skipped #8 are untouched.

## Verification in progress

Base main: `c7401164acfff39b5eeb2e8a52d70a0741adc884`. Task branch: `autonomous/gaze-phrase-selection-275`. No PR requested or created.

Local baseline: 176 unit tests pass. Six added Node cases fail against base for missing parser/range behavior, then the full Node suite passes182. A new native spoken-flow case fails against base with “No control called text tuesday”; after implementation all12 new practice cases pass across the four configured viewports. Syntax (90 files) and test-extension packaging pass. Complete practice browser validation, fresh review and hosted source/main CI remain pending. The local portable Chromium is143; actual isolated-extension verification is delegated to supported hosted Chromium, not inferred from practice-page coverage.
