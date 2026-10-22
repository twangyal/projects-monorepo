# Karaoke passage-copy integration — 2026-10-22 (#303)

Canonical implementation: `4f1364ced5c236a29dc586b1756d5965d27e5799` at `apps/karaoke-studio`.

Selected corrected choruses or verses can be copied to a new first-line start time in an empty clip span. Originals, literal text, durations and internal gaps remain intact. Whole-graph validation preserves clip bounds and existing cue/text limits; rejected requests leave the editor, history, playback and pending reviews alone. A successful copy is one unsaved Undo/Redo edit, retains untouched raw timing fields and title/pasted drafts, retires pending playback/import/timing work, and requires fresh passage selection after structural/history changes. Save, reopen and timed SRT export retain the result.

Verification:

- Canonical [run 39813175329, attempt 2](https://github.com/twangyal/projects-monorepo/actions/runs/39813175329/attempts/2), job `120085251061`: **206 Python tests**, **140 TypeScript tests**, **124 browser cases**, syntax/lint/types/build, real video output and media boundary checks all pass. Hosted browser duration is 5.0 minutes.
- Fresh local Chromium 143 run completes **124/124 browser cases** in 7.2 minutes. Earlier local check passes 140 units plus lint/types/build. New browser coverage includes copy/refusal, untouched raw fields, pasted drafts, exact Undo/Redo, Save/reopen/SRT and phone keyboard multi-line copy with gaps and pending playback/import ownership.
- Fresh read-only review reports no product defects. The first new Undo assertion used a snapshot from before changing pasted words; the corrected expected snapshot passes, and that initial failure remains recorded in #303.
- The first hosted attempt passed Python and TypeScript checks but cancelled during browser verification at the 20-minute job boundary after video dependency installation consumed 16m22s. It is retained as an incomplete attempt, not acceptance. The unchanged retry supplies complete canonical verification.

README and portfolio roadmap describe the new authoring flow. Karaoke remains ACTIVE: this improves correction reuse, not automatic transcription or real-song alignment quality. Those evaluations remain open in #241. Project #8 stays skipped. No pull request was opened.
