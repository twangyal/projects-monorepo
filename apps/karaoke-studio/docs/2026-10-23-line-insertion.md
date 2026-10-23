# Missed lyric insertion — #309

The lyric editor now adds one manually supplied line into an empty time span without replacing existing corrected cues. Same schemas, local service and Save/export path; no inference or dependency changes.

## Verification and review

Three new unit tests were observed failing before insertCue existed. They now pass as part of all146TypeScript unit tests. Lint, TypeScript and production build pass. The initial native workflow failed at the missing Add lyric line control before UI implementation. Three initial workflow cases then passed: exact saved/reopened SRT, invalid raw-field/draft/Redo preservation, and empty-clip narrow keyboard insertion.

Fresh read-only review found a real browser-number sanitization defect: accepted `+1e0`/`2.` spellings were passed into native number fields and displayed blank despite a valid underlying cue. A new browser regression was observed failing; only newly inserted boundaries are now displayed canonically, preserving unrelated existing spellings.

All4final focused native browser cases pass (20.6seconds), including canonical inserted boundaries through Undo/Redo. Full local suite and canonical CI remain pending at this implementation commit.

## Retained verification limits

The first full206-test Python run failed only `test_subprocess_rss_limit_is_enforced`: its subprocess hit the existing2-second timeout instead of producing the expected memory-limit refusal. An isolated rerun passed in0.006seconds. No Python implementation or test changed. The cause remains unproven; neither result is erased. A complete rerun is pending.

The first broad browser attempt was interrupted to apply the review fix; it is not a complete pass. A fresh full suite uses the final implementation. Real-song recognition quality, physical listening and multilingual model acceptance are not established by synthetic stems/editor tests. #241 remains open.
