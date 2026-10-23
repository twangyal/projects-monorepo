# Missed lyric insertion — #309

The lyric editor now adds one manually supplied line into an empty time span without replacing existing corrected cues. Same schemas, local service and Save/export path; no inference or dependency changes.

## Verification and review

Three new unit tests were observed failing before insertCue existed. They now pass as part of all 146 TypeScript unit tests. Lint, TypeScript and production build pass. The initial native workflow failed at the missing Add lyric line control before UI implementation. Three initial workflow cases then passed: exact saved/reopened SRT, invalid raw-field/draft/Redo preservation, and empty-clip narrow keyboard insertion.

Fresh read-only review found a real browser-number sanitization defect: accepted `+1e0`/`2.` spellings were passed into native number fields and displayed blank despite a valid underlying cue. A new browser regression was observed failing; only newly inserted boundaries are now displayed canonically, preserving unrelated existing spellings.

All 4 final focused native browser cases pass (20.6 seconds), including canonical inserted boundaries through Undo/Redo. Full local suite and canonical CI remain pending at this implementation commit.

## Retained verification limits

The first full 206-test Python run failed only `test_subprocess_rss_limit_is_enforced`: its subprocess hit the existing 2-second timeout instead of producing the expected memory-limit refusal. An isolated rerun passed in 0.006 seconds. No Python implementation or test changed. The cause remains unproven; neither result is erased. A complete rerun also failed that same case (206 tests, 96.582 seconds); its cause remains unresolved. The canonical implementation run reached the browser installation step after its Python gate succeeded, but full source CI remains pending.

The first broad browser attempt was interrupted to apply the review fix; it is not a complete pass. A fresh full suite uses the final implementation. Real-song recognition quality, physical listening and multilingual model acceptance are not established by synthetic stems/editor tests. #241 remains open.


## Broad-run follow-through

The next full local browser attempt was stopped after it exposed a real regression in this change: the new panel reused `.timing-shift`, so the unchanged phone passage screenshot resolved two panels. The new panel now has its own `.line-insert` class. The original failed case and all four insertion flows pass together on corrected source (5 cases, 18.1 seconds), with all 146 units, lint, types and build passing again.

That interrupted run also failed two unchanged automatic-audition cases while waiting for native playback to pause: `automatic review listens to captured recognized timing while invalid raw corrections remain untouched` and `reviewed timing auditions the staged interval and applies words and times in one recoverable edit`. Their native pause predicates exceeded the existing 6/5-second deadlines. No audio code or gate was changed. These failures remain unresolved locally; canonical final-source CI must verify the complete suite. Neither interrupted broad run is counted as a full pass.
