# Lyric find integration — 2026-10-22 (#305)

Canonical implementation is `e92510c8763ca466c1cfc7e264e3876f1c097437`, followed by the integration correction `fb49d17c5577cdad37f1a007cec8f85915d5e0af`, at `apps/karaoke-studio`.

The contextual Find lyric line panel searches current cue words literally and case-insensitively, including Unicode and punctuation. Next/Previous and Enter/Shift+Enter wrap through results and focus existing lyric textareas. Navigation retains raw timing fields, title/pasted drafts, history, pending import/timing work and audio position. Explicit Play lyric match uses the existing single-line practice owner and readiness checks. Invalid timing/title does not hide searchable words, but ordinary playback validation remains. Results recompute after corrections; retired cue identities require fresh navigation. Another clip clears the ephemeral query. Pending pasted/imported/recognized words are not searched.

README and portfolio roadmap describe the flow. Karaoke remains ACTIVE; automatic real-song alignment/correction effort remains open in#241. Project#8 stays skipped.

## Verified corrected-source checks

- **143/143 unit tests**, lint, TypeScript and production build pass.
- **Five targeted native browser cases pass in19.2seconds**, with separate Playwright output: all three new find cases plus the unchanged phone timing-shift case and archive uncertain-reply case.
- Native coverage verifies literal/Unicode repetitions, no matches, invalid raw timing/title/pasted drafts, cue-node and history preservation, pending review preservation, phone keyboard use, explicit real audio practice, live word corrections, Undo/Redo identity retirement, same-clip query retention, clip-switch reset and owned fixture cleanup.
- Fresh read-only review finds no material issues, including the final class correction and added history/clip case.

## Initial integration failures retained

The broad local run completed **124/126**, not a full pass. It started before the third new find case was appended (the final canonical suite contains127 cases):

1. Existing `cue-edit.spec.ts:298`, “phone keyboard shifts one passage line while preserving its neighbors”, completed its timing/overflow assertions but failed its `.timing-shift` screenshot because Find reused that class. Giving Find the distinct `.lyric-find` class restores the original unique selector; the original test is unchanged. No CSS depended on the old class, and behavior/style are unchanged.
2. Existing `archive.spec.ts:353`, “an unreadable accepted archive reply keeps the uncertain-restore guard until deliberate status review”, reported ENOENT while disposing/copying Playwright trace files. A concurrent focused run shared the same default output directory. Both original cases and all new cases pass when replayed with an isolated output directory. No archive or trace acceptance bounds were changed.

Initial full-log SHA256: `dd7d6830d54a2da0f608cbaa7d7548f7507bd02375c18f2a46ae01f5d29da4ab`.
Corrected focused-log SHA256: `432c0fc4e76faba4642f5c73999c01c7615c87d6285e604b3df5e9c16f2ae178`.
These identify observed transient logs, not retained complete log byte streams. The issue records both initial failures and their disposition.

## Canonical status

The first canonical [run39856064293](https://github.com/twangyal/projects-monorepo/actions/runs/39856064293) on the earlier source was superseded/cancelled after the class fix. It is not final acceptance.

Corrected-source [run39856845198](https://github.com/twangyal/projects-monorepo/actions/runs/39856845198) is running when this receipt is recorded. **Issue#305 remains OPEN pending its complete result.** Do not interpret targeted checks as a full canonical pass. The linked run and issue are the durable continuation points. No PR was opened.
