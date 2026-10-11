# Retained stroke resizing and quarter turns — issue #179

The selected retained path can grow ×2, shrink ×0.5 or turn clockwise/counterclockwise 90° around the center of its local coordinate bounds. Brush width/color, point order, layer poses, exposure starts, other strokes and original image bytes stay intact. Coordinate and complete canonical JSON admission precede publication; no-op and refused edits retain Redo. These are deterministic authored controls, not learned artwork.

## Evidence

- `domain-before.log`: four expected failures before the transform API existed.
- `browser-before.log`: native test could not find the absent Grow control before UI implementation.
- `domain-four.log`: four independent domain cases pass, including literal geometry, nonzero fractional center, detached results, single-point no-op, invalid targets/actions and coordinate refusal.
- `domain-five.log`: all five domain cases pass after adding a complete exact 6,291,624-byte fixture whose grown coordinate digits exceed the cap; source artwork and Redo remain intact. Its embedded base64 is admission-only padding, not a renderable-image claim.
- `focused-four.log`: four native cases pass, including complete graph, original image and transformed stroke PNG pixels, two-step Undo/Redo, autosave/reload, mobile before-blur raw draft protection, unchanged-dot Redo and coordinate refusal retaining selection.
- `check-262.log`: all 262 unit tests, lint, TypeScript and production build pass.
- `test-lint-types-263.log`: all 263 units and fresh lint/types pass after the additional exact-byte-cap case. Production source is identical to the earlier passing complete check and full browser build.
- `final-types.log`: fresh lint/types pass after the later held-exposure browser case was added.

Independent review found no material defect. Its suggested later held exposure under a 90°/×2 layer pose was added; literal local quarter-turn points and independent PNG samples verify local axes despite the stage transform.

`browser-175.log` records all 175 production Chromium workflows passing (2.2 minutes), including the later held-exposure local-axis test. The exact published-head CI receipt will be attached to issue #179. Maximum serialized artwork admission is enforced through the shared validator; these tests do not claim a new maximum-size transform/render campaign or physical-device acceptance. Existing full-suite capacity campaigns remain intact. Literal test logs preserve reporter whitespace; source/docs whitespace validation excludes only captured logs. Motion remains ACTIVE; project #8 remains skipped.
