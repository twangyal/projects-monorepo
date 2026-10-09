# Manual measured size grading — 2026-10-09

Issue #168 extends linked pattern construction with saved linear increments and3–7 relative sizes. A rule is strict plain data: waistStep/hemStep/slantStep finite within±20cm, steps integer1–3, at least one nonzero increment. Every derived measured skirt must validate before the project or export is admitted. Rules are optional; legacy field absence remains exact. Signed fractional increments are supported. Labels are relative, not standardized body sizes or fit guidance.

## Evidence

- Four domain cases first failed on absent grading module, then passed: independently calculated increments, invalid/accessor/unchanging/derived refusal, detached complete-project/legacy optional data, labelled physical SVG sets.
- Full `npm run check`:52unit cases, lint/typecheck/production build pass.
- Production native checks cover actual nested SVG panel perimeters against independently derived waist/hem/slant, root/nested physical dimensions, unique IDs and labels; full backup/history/autosave/reload; invalid set refusal preserving raw input and Redo; pointer-before-blur protection; identical imported saved rules reset abandoned drafts; seven-size390px keyboard flow; reversible rule removal with retained artwork/base drafts.
- First native fixture incorrectly used nonexistent Design notes instead of actual Concept note and timed out. Corrected the exact label; focused3cases passed4.8s and full60cases passed19.3s.
- Fresh independent review found one Important integration defect: shared commit catches project validation errors, so a valid single-size base could invalidate a saved grade yet reset the raw draft and overwrite refusal with success. Native regression failed first; the pattern controller now validates the whole candidate before commit. Full52units/61native passed21.1s after repair. The grading controller validates its complete candidate too.
- Rule-removal regression first failed on absent button. Explicit removal was then implemented; final full gate recorded below after inspection. No resource guards or assertions weakened.

## Decisions and scope

Continue a third coherent milestone after durable pattern/shell work: the revised product vision explicitly needs size grading. Add reversible saved-rule removal so the user can resume single-size construction at the admitted limits without rebuilding the concept; cost if wrong is a removable UI command. Base SVG/OBJ exports may still export their committed single-size construction while grading drafts remain unapplied; graded-set export refuses both raw base and grading drafts. These commands do not consume unapplied grading. Whole-project admission remains strict.

Use standing autonomous authorization for independent design choices and expected-SHA publication to canonical main, with no interactive menu or PR. Both application additions preserve ACTIVE status and skip project8. Any mistaken choice can be corrected with an ordinary follow-up commit. The shell's coarse circle approximation and far-side seam guides remain explicitly disclosed; higher-resolution geometry would be the remedy, not a claim of cloth simulation. Surface export is part of the same linked construction milestone, a reversible optional command.

Outputs remain seam-line studies: no allowances, closures, thickness, material/body/cloth simulation, standard size certification or physical production acceptance. Combined SVG is one large sheet without automatic printer tiling. Mathematical and retention tests do not establish fit. No paid services, dependencies or credentials added.

Final complete local gate:52units plus62native browser cases pass, lint/typecheck/build; native duration21.0s. The seven-size390px screenshot was inspected: all four raw controls, Apply/Discard/Remove/Export and the full measurement table are readable and contained. The final full rerun includes complete original JPEG/sketch retention and malformed-import assertions,62/62native pass21.0s with52units/check green. Exact-head hosted CI remains pending publication; issue stays open until verified.
