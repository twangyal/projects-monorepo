# Melody pan automation — #298

## Delivered behavior and scope

The existing Sound workflow now admits optional 1–64 per-track pan points, with zero-based beats0–512 internally/one-based1–513 in the UI and signed positions−1left/0centre/+1right. Positions interpolate linearly and hold endpoints. The committed curve replaces retained static Pan for the dry track; disabling and applying restores the static setting. The shared mono pre-pan reverb send/independent stereo return and existing peak/frame/tail guards remain. No new routing is implied.

Playback/solo/backing/edited-note mix, stereo WAV/stems and absolute section crops share the renderer. Continuation audition shifts the curve with its selected ending. Both MIDI exports omit pan automation. One-edit Apply/Discard and per-track raw fields use existing guards, history, complete reference documents, portable backups, saved library and autosave. Absent settings retain exact legacy PCM/mono behavior. The full DAW, physical listening and intended-musician acceptance remain unfinished; Melody stays ACTIVE. Project#8 remains skipped and owner-deferred projects are untouched.

## Development evidence and corrections

The clean baseline passed428unit tests. New model/PCM/continuation cases first failed because pan automation was absent. Core pan/volume tests then passed12/12; independent read-only review separately repeated them with no Critical/Important findings. The first full app check passed433units, lint/types/build. The initial browser test failed at the absent UI before its implementation.

The first focused browser suite then reported6passes/5failures. Actual Apply was refused by the separate strict complete-reference-document track whitelist; legacy broad Pan locators also became ambiguous with new pan controls. A targeted complete-document regression reproduced the whitelist rejection before its fix. The complete optional field is now admitted through the unchanged strict validators; role-specific slider locators resolve label ambiguity. The Apply helper now asserts actual success instead of accepting an always-visible graph as evidence. No test threshold or behavior was weakened. Final-source checks and canonical acceptance are recorded below as they complete.

## Final local verification

Final-source `npm run check`:433unit tests pass, with lint, TypeScript and production build. The targeted native Chromium suite passes **all11cases in51.2seconds**:4new pan flows plus all existing volume-curve and stereo-mix cases. Checks include decoded actual two-channel WAV coefficients, exact absolute section crops/aligned stems, original MIDI bytes, actual playback/solo buffer parity, one-edit history, reference preservation, saved-copy/portable recovery, malformed import refusal, retained static-pan bypass and phone navigation/raw drafts. The rendered390px phone panel was visually inspected and the native layout check confirms no horizontal overflow. The final help-text spacing is a presentation-only follow-up; canonical checks below run the exact integrated source.

No physical speaker/headphone comparison or musician acceptance is claimed. The earlier failed browser runs remain documented above.

## Canonical acceptance

Source is integrated in main commit`6cee5cfa91f5b9bee7998a18bce4b80d608819d5`, tree`4a71d275e66a29b4cb24c42843187dd135a178bf` identical to local verified source. Melody subtree`042c33afa3094f58b2f80c30d2b889b423e75e9d` is the accepted application identity.

[Canonical Melody run39669537678](https://github.com/twangyal/projects-monorepo/actions/runs/39669537678), job119463430240, passes **433unit tests, all251browser cases (3.9minutes), lint, TypeScript and production build**. All required job steps conclude successfully; failure-artifact upload was correctly skipped. No source gate remains pending for #298. This acceptance update changes only the root receipt; subsequent chord work is separately tracked and verified as #299. The full-DAW/physical-listening limits above remain.
