# Motion imported-artwork copy integration — #326

Exact source `3811eead3de1c04418a4da4e1f63d5b7e360a724` on canonical main. This record supersedes pending checks in the [implementation checkpoint](../apps/motion-studio/docs/2026-10-24-image-copy.md) and [plan](superpowers/plans/2026-10-24-motion-image-copy.md).

Select an imported image in Layers and choose **Duplicate image layer** to reuse a prop with independent complete pose keys. The copy is selected immediately above its source at the same timeline frame. One Undo removes it; Redo, saved projects, reload and PNG/GIF/frame rendering retain it. New copies decode separately owned bitmap resources before publication; source deletion, history, decode failure or page suspension preserve ownership. Existing four-image/eight-layer/file limits, raw draft/gesture/library/recovery/export guards, schema and dependencies are unchanged. The legacy drawing-only model API and UI behavior remain supported.

## Verification and review

Baseline283unit tests pass. New model cases first fail on missing general copy API, then4pass: detached image/pose content, both kinds/legacy drawing refusal, IDs, admitted fourth image/refused fifth, eighth/ninth layer, file cap and Unicode names. Native RED is the formerly disabled selected-image copy button. Before review,287units/lint/types/build and8focused native cases pass12.3s.

Fresh review finds one Important: deleted copies remained in the asset map, allowing repeated copy/delete to accumulate decoded memory beyond the layer cap. The native repetition regression first observes0closed bitmaps where1is expected. Successful commits now retire consumers and close/remove absent image bindings; Undo redecodes from its retained JSON. Three copy/delete repetitions, source pixel survival and Undo/Redo pass. No Critical/Minor findings; one fix pass/no rereview. Review did not judge then-running full/canonical gates or broader learned-animation/intended-person acceptance. Observed gates below stand separately; broader acceptance remains unverified.

Final reviewed source passes287units, lint, types and production build, plus9focused native cases in26.2s. Image test artwork has two pose keys; native decoded PNG and first/last GIF pixels prove rendered independent animation after source deletion. Backups, exact history, reload, phone draft/capacity guards, failed decode preserving selection/source pixels/Redo, and a late decoded bitmap after pagehide closing without publication are tested.

Fixture corrections are retained in the checkpoint rather than misreported as product defects: reversed layer list required explicit source ID; ordinary numeric blur commits by existing policy (one-coordinate pose change gives the correct three-step history oracle); valid raw pointer and invalid raw keyboard drafts use separate checks; suspended pages deliberately disable backup; image byte/easing fixtures were corrected to admitted values. No product policy was relaxed for these checks.

## Full local and canonical gates

The initial214-case full run passes3.1min, but overlaps review/source/build changes and omits the new lifetime regression; it is not exact final-source acceptance. A fresh215-case local run uses Node24.22.1, Playwright1.63.0 and portable Chromium143.0.7499.0. It passes215/215cases in2.8min on the final reviewed source, including the bitmap-lifetime regression. No failure or partial run is silently replaced by later success.

[Canonical run40158311029](https://github.com/twangyal/projects-monorepo/actions/runs/40158311029), job121064321753, verifies the exact source with the unchanged Motion workflow. It completes successfully at2026-10-25T03:31:36Z (October24local):287/287units, ESLint, TypeScript, production build, a separate typecheck and215/215production Chromium browser cases in2.1min. The exact run head is3811eead3de1c04418a4da4e1f63d5b7e360a724. All newly added image-copy workflows and existing decoded media/private-link/lifecycle tests are included; no retries, test deadlines or workflows were changed.

## Remaining destination

Motion remains ACTIVE. Reusable authored image props are a focused capability toward the animation workspace; useful learned animation, live synchronization and intended-person evaluation remain open. The separate Melody#300 research unit identifies an armed pre-start overlap without establishing a production fix or physical microphone quality. No PR was opened; project#8 and owner-deferred work were untouched.

## Completion

Software milestone#326 is complete and may close with these exact gates. The9focused local cases, fresh215-case local pass and215-case canonical pass support separate claims; the older214mixed-source run is retained as prior evidence only. The single Important review repair is verified by native RED→GREEN and the complete final suites; no rereview and no deferred minors. Broader intended-user/learned-animation acceptance remains open against the unchanged ACTIVE destination.
