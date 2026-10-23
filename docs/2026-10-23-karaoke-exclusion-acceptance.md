# Karaoke automatic-review exclusion acceptance — #313

Application source `c8009efa62a43971efd4759c5967f7e8b84f106d`, verified on canonical main at workflow commit `b112c65ff887a62cd81671ebd597be52bb425f58`. The app directory is unchanged between these commits. [Full run40000133169](https://github.com/twangyal/projects-monorepo/actions/runs/40000133169) completed successfully; full job logs were inspected:

- **206 Python tests** in84.462seconds, including unchanged subprocess RSS enforcement and real video/HTTP/storage checks.
- **150 TypeScript tests**, Ruff, ESLint, compilation, typecheck and production build.
- **135 Chromium browser cases** in6.2minutes, including all four new exclusion flows and both native-audio pause cases that failed in the local portable runtime.

Each original recognition row can be explicitly excluded and restored without deleting its words/times, source recognition or original numbering. Included hidden rows still validate, and errors retain original row numbers. Excluded intervals remain inspectable/auditionable; changing inclusion retires owned playback. Apply is one unsaved Undo/Redo edit preserving prior raw editor/title/paste state. Excluding every row explicitly clears cues. Save is separate; cancellation/fresh review resets exclusions. The native saved-output test compares exact exported SRT and unchanged recognition JSON.

Fresh independent review found no blocking defects. [Implementation receipt](../apps/karaoke-studio/docs/2026-10-23-review-exclusion.md) and [preceding checkpoint](2026-10-23-karaoke-exclusion-checkpoint.md) retain the missing-control RED, first Save fixture timeout, corrected explicit pasted-draft discard, local133/135browser and205/206Python results, and infrastructure attempts. Those failures are not relabeled passes.

Hosted attempt1 on c8009ef passed service/TS/static/build checks but hit the original20-minute aggregate job boundary during browser dependency setup after15min26s of FFmpeg downloads; no browser acceptance came from that attempt. An unchanged retry was superseded. The workflow's bounded aggregate allowance became35minutes, leaving all application commands, media/browser/HTTP deadlines and assertions unchanged. The final successful run used fast downloads; the allowance change is not evidence of faster provisioning or application performance. No security, billing or runner-class changes were made.

This final receipt supersedes the checkpoint's pending acceptance status. #313 is complete as correction tooling. Real multilingual singing quality and intended-user correction effort remain #241; Karaoke stays ACTIVE. No PR created. Project #8 remains skipped.
