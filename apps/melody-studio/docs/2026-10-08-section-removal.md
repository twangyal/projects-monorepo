# All-track song trimming — 2026-10-08

Issue: [#145](https://github.com/twangyal/projects-monorepo/issues/145). Parent: `de2c00fca0770676378b195992f25631b34faae2`. Branch: `Astra`.

## User outcome and boundaries

Remove section and close gap uses the existing one-based, end-exclusive section bounds to remove wholly contained notes from every track and move later notes left by the exact span. Muted tracks participate. Surviving IDs/order/pitches/durations/velocities and track settings remain. Crossings on any track refuse the complete edit before transformations. Input is validated into a detached graph, including the resulting composition.

The existing complete-project commit owns Undo/Redo, autosave, draft pruning and playback/review retirement. Reference bindings and original PCM bytes stay untouched, including when removing every note. Captured audio is not cut or shifted. Guards admit the action before focused-field pointer blur and refuse retained unapplied drafts or active gestures. Raw invalid bounds remain editable. The session-only range is retained; after a trim, it may need adjustment to fit the shorter song.

An empty rest may close a gap when later notes move. The existing section bound must fit the last-note song extent: a rest beyond the song refuses. No new trailing-song duration or unchanged-history branch was invented. Failed admission/boundaries/ranges keep Undo/Redo intact. Editable audio clips, broader playlist management, instruments/effects/routing and musician/device evaluation remain outstanding.

## Verification history

- Before implementation, all five new unit cases failed against the explicit unavailable helper; the native baseline failed because Remove section and close gap did not exist.
- Final units pass frozen-source exact all-track changes, fractional whole boundaries/empty-gap closure, crossings anywhere and malformed bounds, full-song empty-track retention, and the full **2,048-note/512-beat** graph. Removing the middle 256 beats leaves 1,024 notes ending at beat 256 with independently calculated IDs/offsets and unchanged source graph.
- Unit/lint/TypeScript/production build gate: **341 units passed**, zero failures.
- First native run: four passed, one test-driver failure. Focusing the button after editing a valid title legitimately triggered its existing commit-on-blur. The pointer test keeps the valid title focused; keyboard rejection now uses an invalid note draft. No product guard was weakened.
- Targeted native run: **six passed (8.6 seconds)**. Actual complete backups preserve reference bytes through one-edit Undo/Redo and reload; independent decoded MIDI and scalar PCM/envelope WAV checks match the shortened arrangement. Boundary/past-song refusal retain backup and redo; blank bounds retain raw text. A 390px keyboard case removes the whole song while keeping tracks/capture and Undo, without page overflow. A near-512-beat fractional empty-gap case preserves capture and MIDI through reload.
- The long-song case was strengthened afterward: bounds are set before Review/Play, and Stop/Apply timing readiness is asserted immediately before Remove, so successful cut is the cause of retiring live playback/review. Fresh read-only review found no Critical/Important product blocker.
- Full serial native Chromium regression: **168 passed (3.4 minutes)**, zero failures, including the strengthened long-song case. Command: `CHROMIUM_PATH=/tmp/melody-chromium-wrapper npm --prefix apps/melody-studio run test:browser -- --workers=1`.
- Final affected check was repeated after test corrections: **341 units**, lint, TypeScript and production build passed; the final targeted native run passed **six cases (9.6 seconds)**. Diff whitespace check was clean.

Commands are serialized to protect shared production/harness dist and test results. Local native Chromium 153.0.8010.0 and Node 24.19 are used; temporary browser files/dependencies are not committed. Automated synthetic browser evidence does not measure physical output fidelity or musician usefulness. Exact-head CI is recorded in the issue after publication.
