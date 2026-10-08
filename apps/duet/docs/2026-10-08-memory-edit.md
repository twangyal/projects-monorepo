# Author-owned song-memory correction (#156)

The revised Duet destination includes editable musical history. This milestone lets each private seat correct the date and literal text of its own existing memory, without delete/recreate. Song binding, title, author, ID and creation time remain immutable. Removed audio does not remove that right. Spotify ingestion, automatically populated events and photos remain unfinished.

PUT `/api/rooms/:room/memories/:memory` requires exactly `date`, `text`, `expectedDate` and `expectedText`. Within one store transaction, authorization precedes comparison of the exact old date/text; a stale baseline returns 409 before any write. Storage/export/archive schemas are unchanged.

The editor is a separate stable form outside the rebuilt memory list. Polls do not replace its raw fields or focus. Only a valid current-room acknowledgment containing the same immutable memory identity and exact requested date/text can clear it. No write is retried automatically. Generic mutation operation ownership is retired on room navigation or page suspension, and late finalizers cannot release another operation's controls. Suspended edits remain raw and unconfirmed.

## Local evidence before publication

- Six new domain cases failed before the method existed, then passed: exact Unicode/identity retention, both-seat author authorization, stale/deleted memory refusal, atomic invalid fields, removed audio and two-connection one-winner compare-and-swap. All 19 existing store cases also passed.
- TypeScript's 19 tests, Python Ruff/compile, lint/typecheck and production build passed.
- Seventeen controlled native browser cases passed, covering six new edit cases plus existing invitation/recovery cases. New cases cover stable nodes/focus during polling, conflict, unreadable/wrong-association replies without replay, 390px correction and declined departure, held PUT navigation and pagehide/pageshow ownership. The wrong-association acknowledgment case failed before its admission fix.
- The 390px editing screenshot was inspected: readable form, distinct Save/Cancel, no horizontal overflow. The form has explicit labels and focus remains in the text area through polling.
- Independent review found two Important implementation gaps (mutation busy ownership and immutable acknowledgment admission). Both were fixed and their browser regressions passed; no remaining Critical/Important findings.

A strict HTTP test and real-service two-seat edit/export/removed-audio/reload test are included for hosted CI. Local service startup still refuses this runtime's unavailable `/proc` descriptor behavior; those protections were retained. Hosted full-service verification was pending at publication and its outcome is tracked in #156. Controlled lifecycle events are not a claim of physical-device or real BFCache acceptance.
