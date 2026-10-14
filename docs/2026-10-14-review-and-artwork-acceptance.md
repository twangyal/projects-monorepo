# Reviewed lyrics and artwork rotation — acceptance

## Karaoke #253

Reviewed automatic words can now be corrected while auditioning captured recognition timings. Original words remain available; filtering and reopening the same review retain staged corrections. The existing validator admits all lines, including hidden ones, before one undoable unsaved Apply. Invalid text does not alter captured audition boundaries. Save/reload retains exact corrected cues without rewriting recognition.

Both [source CI 38603522987](https://github.com/twangyal/projects-monorepo/actions/runs/38603522987) and [canonical-main CI 38604861023](https://github.com/twangyal/projects-monorepo/actions/runs/38604861023) passed 206 Python, 128 TypeScript and 109 browser tests plus Ruff/ESLint/typecheck/build/compile checks on implementation `e234e1194331bf89385cf63af727f00bffe76364`. Karaoke app tree: `96243ba364b92af80778b6b0d2b6d7abc74c99b8`.

Local baseline/final project checks passed 128 TypeScript cases; 27 combined automatic/SRT cases plus expanded title/Save checks passed. A 390px review screenshot was inspected. The meaningful red test first failed for the missing review field; configuration-path and Save-message/API-wrapper harness assumptions were repaired and documented. Independent review found no critical/important issue. Staged reviews remain session-only and are retired by main lyric edits or replacement work; finish or cancel reviewed corrections before that boundary. Real-user correction-effort and multilingual timing measurements remain open in #241.

## Clothing #254

Front/back artwork now has bounded rotation about its existing centre, positive clockwise as viewed from outside. Placement drafts retain their angle through selection/redraw and apply as one Undo step. Legacy omission stays unchanged/upright; explicit nonfinite/out-of-range values are refused. PNG, GLB and tech-pack renders share the rotated decal, including the existing settled-drape mapping. Tech-pack print dimensions stay original, with the angle separately described.

Local final verification passed 111 unit tests, lint/type/build and all eight targeted artwork/legacy workflow cases. Native ±90° front/back tests independently measure exported PNG aspect and asymmetric-corner direction, inspect actual GLB position bounds, check tech-pack text and backup/Undo/Redo/reload. A front +90° graphic remains visible in real settled-drape export. Independent review found no critical/important issue and separately passed the three new unit tests.

Initial local setup lacked cached Three.js/delaunator dependencies; restoring the existing cache gave 108 clean baseline tests. The rotation contract failed before implementation. Native label/role/filter harness mistakes are retained in app notes. [First source gate 38605502252](https://github.com/twangyal/projects-monorepo/actions/runs/38605502252) passed all 111 units/checks and 132 browser cases but failed the original photo-overlay test because its substring Rotation query matched two controls. The exact-selector repair changes only that harness and its documentation, without changing production code, assertions, limits or visual thresholds.

Corrected [source CI 38606526723](https://github.com/twangyal/projects-monorepo/actions/runs/38606526723) and [canonical-main CI 38607344078](https://github.com/twangyal/projects-monorepo/actions/runs/38607344078) independently passed 111 unit and 133 browser tests, ESLint/typecheck/build on `4c36e1d8f2fa40286bf1a351aa50bcb9f857cbce`. Final Clothing app tree: `1d3a7a7aaf148e0972545dfd5a416582657912fc`. Local/source/main comparisons were clean, and main was reread and leased before integration.

## Portfolio state

README/setup and roadmap entries describe the new flows. Both apps remain ACTIVE: no actual correction-effort benefit, calibrated fabric behaviour or physical manufacturing fit is claimed. All other apps, standing product direction and the entire project #8 skip section are unchanged. No PR, paid service, model download, billing/security or production infrastructure change was made. This root-only acceptance commit does not change either verified app tree.
