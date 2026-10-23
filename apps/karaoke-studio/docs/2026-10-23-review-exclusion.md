# Automatic recognition line exclusion — #313

The automatic song-to-karaoke destination needs correction of false recognized phrases as well as their words and timing. Previously automatic review required accepting every line before removing false lines in the main editor. Each original row now has an explicit, keyboard-accessible exclusion checkbox. Its raw words/times remain available, its original numbering and recognition-confidence filter stay unchanged, and unchecking restores the draft. Excluded intervals remain listenable. Changing inclusion retires owned reviewed playback.

Apply validates every included row, including hidden rows, retains original error numbering, and replaces cues once through existing complete Undo/Redo history. Excluding every row is explicitly described as clearing cues. Save remains separate; existing title/paste/raw-draft guards are unchanged. Cancel, a new transcript or a fresh review retires staged exclusions. Recognition source JSON and backend schemas are unchanged.

## Verification checkpoint

- Four new domain tests first failed without exclusion support; now the complete **150 TS tests**, lint, typecheck and production build pass.
- Native RED trace reached the absent checkbox. The fixture cleanup request inherited the test timeout and masked the displayed stack; the trace confirms the missing control.
- Four new native cases cover exact saved/reloaded/SRT output and source integrity; complete Undo/Redo with raw prior drafts; restored invalid excluded rows and hidden included errors; all-excluded empty Apply/save; phone keyboard and retained detached controls; playback retirement and deliberate audition of excluded intervals.
- First browser attempt: 3 passed, one timed out because its retained pasted draft correctly disabled Save. Corrected only that fixture to assert the guard and deliberately discard the paste after its history assertions. No production guard or timeout was weakened.
- Fresh independent read-only review found no blocking source defects and independently passed seven review/exclusion domain tests. It identified the same Save fixture requirement and the README wording, both corrected.
- The final four focused native cases passed **4/4** (37.6 seconds).
- Local Python verification encountered the previously documented `test_subprocess_rss_limit_is_enforced` failure in this runtime; the security gate was not relaxed. Full results and canonical host verification remain pending.
- Full Python/browser and canonical CI results will be recorded in the final root acceptance receipt. No claim that this checkpoint certifies unrun gates.

Tests use deterministic recognition and real local WAV playback/server/storage; no new pretrained recognition quality measurement was performed. Real multilingual singing acceptance remains #241, and Karaoke stays ACTIVE. Project #8 remains skipped.
