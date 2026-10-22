# Selected-note chord construction — #299

## Outcome and product boundary

The existing contextual Notes workflow now builds Major[4,7], Minor[3,7], Suspended2[2,7] or Suspended4[5,7] tones above a selected melodic root. Root identity/pitch and exact fractional timing/velocity remain; two fresh ordinary notes are inserted after it. Other notes/tracks, sounds, automation and reference data are retained. Each added tone can be selected and edited normally.

Drums, stale selection, unsupported quality, invalid/duplicate IDs, pitch above MIDI96/C7 and insufficient256-note capacity refuse atomically. Existing same-pitch target voices that overlap the root’s half-open interval refuse instead of being doubled or silently skipped. Touching non-overlapping voices remain. The parameter choice is session-only and persists across navigation; explicit Add uses existing pointer-before-blur and keyboard draft/gesture/suggestion guards. Changed results are one complete Undo/Redo/autosave edit and ordinary notes in backups/library, MIDI and shared playback/WAV.

This advances original polyphonic composition toward the full DAW destination. It is not learned harmony, key detection, inversion, voice leading or musician/physical-listening acceptance. Melody remains ACTIVE. Project#8 remains skipped; owner-deferred projects remain untouched.

## Development and verification

Three model cases first failed because the command did not exist, then pass for all qualities, exact graph preservation, strict refusal and overlapping/touching boundary behavior. A browser test first hit a test-only circular TypeScript annotation; it was corrected, and the real browser then failed at the missing Chord quality control before UI implementation. The full app unit suite now passes436tests. Final local browser, lint/type/build, independent review and canonical acceptance are recorded below as they complete; no unrun gate is claimed.

## Local acceptance

`npm run check` passes **436unit tests**, lint, TypeScript and production build. Targeted real Chromium verification passes **all6cases in20.3seconds** (2new chord flows plus every split/join browser regression). Original independent MIDI and WAV oracles verify expected polyphony; complete backup comparison retains every other voice, sound setting and original reference byte. Undo/Redo/reload, selecting a generated tone for ordinary editing, overlapping-voice refusal, raw title/note-draft pointer/keyboard guards and focused390px navigation/session choice pass. Native layout has no horizontal overflow.

The new3unit cases independently pass again under read-only review with no Critical/Important findings. The390px contextual chord panel was visually inspected and the actual focused UI added two notes (five total in the selected fixture track) with successful feedback. No physical audio output was evaluated. Canonical full-suite acceptance and retained first failures are recorded below.

## Canonical acceptance and unresolved recording evidence

Canonical source `e7145eaea86a67766532631a906bf39f9b26d5a4` has tree `a92d4814742ddffcb03bd580878eca18cf7dbf43`; Melody subtree `ea0ebf610373069e312bcb815f9520294ae87234`. [Run39670574675](https://github.com/twangyal/projects-monorepo/actions/runs/39670574675) first passed436units, lint, types and build, then252/253browser cases. The selected-track backed-recording case failed before observing count-in. The original failure artifact12380460611 has SHA256`4528e33837e6cc33758eec4b16ba32c35245a204c064038310e3cf59f587c610`; the downloaded archive was independently hash-verified before reading its trace.

That trace shows all five native sources scheduled, followed by protected microphone failure/release before count-in. It does **not** establish a mere missed-status poll: “Finding the notes…” was generic inactive progress text after refusal. The chord change does not change recorder/frame-collection code. An unchanged local Chromium143 replay passed2/3; its other failure reached capture but failed the original microphone frequency oracle (5Hz error against the unchanged2Hz limit). A separate temporary diagnostic replay passed9/10 with the same frequency failure, and did not reproduce the startup refusal. Temporary instrumentation was removed. Neither local series is an all-green gate.

One **unchanged full canonical rerun**, job119578652077, succeeds with436units and **all253native browser cases**, plus lint/types/build. No test timeout, audio threshold, armed-frame continuity, input, or source code changed between those canonical attempts. This accepts the authored-chord milestone while retaining intermittent backed-recording investigation in [#300](https://github.com/twangyal/projects-monorepo/issues/300); a passing retry does not establish the original failure's cause or physical microphone reliability. Melody remains ACTIVE.
