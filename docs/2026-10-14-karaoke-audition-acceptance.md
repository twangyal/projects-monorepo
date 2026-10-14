# Automatic lyric audition acceptance — #252

## Delivered behavior

Recognized passages can be listened to once or repeated before replacing editor cues. Pause/resume/stop and a low-confidence-only filter support reviewing likely mistakes. Playback uses captured recognition timing on the selected Original/Vocals/Backing source at normal speed. Invalid raw title/timing/pasted drafts and ordinary practice selection remain unchanged; listening/filtering never applies or saves lyrics. Filtering preserves original line numbers and explicitly keeps complete Apply semantics, followed by ordinary Undo and separate Save.

The existing PracticeController owns playback. Review/project/edit/recognition/media/track/source/duration ownership prevents cancelled or stale work from reviving audio. Imported SRT keeps its existing behavior. No schema, backend, model pin or paid-service change was made.

## Evidence

- Reviewed implementation: `1b195afbb388cd93b09be46a11fe6180ed870e49`, based on current owner/canonical main `aed051f8afb31d527e98a105a211e6190b6d0752`.
- [Source CI 38562820537](https://github.com/twangyal/projects-monorepo/actions/runs/38562820537) passed 206 Python tests, 128 TypeScript tests, 105 standard-Chromium browser cases, Ruff/ESLint/typecheck/build and Python compileall.
- Main was reread/leased and fast-forwarded to that exact source. Direct local/published/main comparison confirms Karaoke app tree `de350d599983a15be1c8c97e2ff347c1ece10be1`. Other applications, standing product direction and the complete #8 skip section are unchanged.
- [Main CI 38563771423](https://github.com/twangyal/projects-monorepo/actions/runs/38563771423) passed the same full 206 Python / 128 TypeScript / 105 browser gate, with Ruff/ESLint/typecheck/build. Both published events independently verified the same implementation.
- Four new native cases test real fixture-WAV playback at recognized 8.85→11.75s while raw corrections remain invalid, full Apply/Undo under filtering, Repeat/Pause/Resume/Cancel/edit retirement, track changes and delayed results from actual native play after cancellation. The combined automatic/SRT gate passed 24 cases; all four new cases were repeated after owned-fixture cleanup repair. Ordinary SRT checks remain intact.
- Independent review found no critical/important product issue and independently passed typecheck. A test-cleanup issue was fixed to capture the exact accepted upload project ID, cancel/delete only that ID and preserve existing/unrelated projects. Re-review found no remaining important issue.
- Supplementary visible-review QA in portable Chromium143 with web security enabled: 390px viewport/page width, one filtered row retaining original line3 numbering, explicit complete3-line apply count, and inspected screenshot. Two initial standalone probes could not connect to a separately started fixture service; an owned service/browser runner with readiness admission passed. The temporary service was shut down.
- The native missing-filter test was observed failing before implementation. Earlier harness-selector/timeout errors and the initial TypeScript parallel-SRT-loop replacement error were repaired before browser acceptance; app notes preserve those failures. No acceptance assertions or timing tolerances were weakened.

## Limits and next work

Synthetic original tones and injected recognition test UI/media ownership, not recognition quality. Confidence is the existing model signal and does not guarantee that other lines are correct. Actual user correction effort and #241's real multilingual onset/line-alignment measurements remain open; dataset audio/annotations and verified ML models are absent here. This milestone does not complete Karaoke's wider automatic workflow quality evaluation. Karaoke remains ACTIVE.
