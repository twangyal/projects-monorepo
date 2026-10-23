# Authored shape fill — #310

Motion now provides optional retained polygon fills through selected-stroke appearance controls. Native canvas nonzero filling implicitly closes only the interior; original outline geometry is unchanged. Existing model2 data without fill retains its representation. Filled files add an optional strict RGB field and may be refused by older readers. No new dependency or permission.

## Verification

- Observed model/admission, appearance, hit and tween tests fail before support existed; malformed/accessor admission already refused and remains protected.
- Native browser initially failed on the missing Enable stroke fill control, before UI implementation.
- All 279 unit tests, ESLint, TypeScript and production build pass. Six focused fill units include independent literal RGB interpolation, double winding, mutated proposal refusal and real worker admission retaining canonical fill bytes.
- All six focused native workflows pass: actual stage and decoded PNG/GIF pixels, complete save/reload/Undo/Redo, raw appearance draft refusal/Discard, transformed interior selection and phone keyboard removal, native neighbor-guide tint, midpoint renderer and endpoint-thumbnail/mixed-pair refusal.
- Initial full suite: 201/203. A new thumbnail fixture omitted opening the tween panel; corrected and passing. An existing canceled-translation fixture expected a valid title to remain unapplied even though valid title inputs intentionally save immediately. That exact failure reproduced twice on unchanged main `82582fc`. The fixture now uses a genuinely uncommittable whitespace title, preserving native focus/selection, late-pointerup, unchanged durable project and final valid-title/Undo checks; corrected fixture passes twice. No production title behavior changed.
- The stronger phone test uses an asymmetric rotated/scaled triangle and an off-center literal stage coordinate, with red-before/white-after pixels; it passes. Its first revision incorrectly reused a square-center pixel now lying on the triangle outline; the oracle was corrected to the actual interior, with no production change.
- Full browser rerun and canonical CI results are pending at this checkpoint.
- Fresh independent read-only review found no Important/Critical defect. Suggested-pair fill compatibility remains an explicit limitation: Review refuses mixed pairs, and users can correct pairing/appearance manually. It is not silently coerced or discarded.

## Scope and limits

Fills are deterministic authored polygons, not flood fill, inferred closure or learned artwork. Degenerate paths have no area. Normal source-over compositing and existing layer opacity apply. Original point/stroke/cel/file budgets, cancellation, raw draft admission and complete-project history remain. Geometric interpolation requires both endpoints filled or both unfilled; fill RGB interpolation is not perceptual color interpolation. Automatic shape matching does not incorporate fill compatibility. Software pixels and persistence do not establish physical drawing ergonomics, animation quality or intended-user usefulness. Motion remains ACTIVE; project #8 remains skipped.
