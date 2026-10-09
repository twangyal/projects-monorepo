# Motion neighboring drawing guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Help artists draw transitions while seeing the immediately neighboring drawing exposures.

**Architecture:** An admitted detached neighbor plan provides previous/next strokes and one current-frame pose. A dedicated transparent editor canvas renders the guides separately from the existing committed canvas and selection outline. A session checkbox controls visibility; existing draft/gesture/export admission owns transitions.

**Tech Stack:** Existing TypeScript, Canvas, Node tests and production Playwright; no dependencies/schema changes.

**Spec:** GitHub issue #160; portfolio vision in docs/PRODUCT_DIRECTION.md and project #11 in PROJECT_IDEAS.md.

## Global Constraints

- Immediately previous exposure teal #087f8c; next rose #c43d64; alpha 0.25 times current-frame layer opacity.
- Both use current-frame pose; retain blank neighbors, no wrapping or skipping.
- Session-only; no project/history/autosave/export/private-viewer changes. Hidden during playback.
- Pointer preblur and keyboard activation preserve unapplied pose/name/stroke fields. Existing gesture/loading/export locks apply.
- All applications remain ACTIVE and project #8 stays skipped; canonical main, no PR.

## Review Focus

- Blank neighboring exposures must not reveal an earlier nonblank drawing.
- A single-cel drawing and image selection must clear all previous guide pixels.
- Playback pauses guides without committing a setting or changing history.
- Raw valid pose text must not auto-commit because a guide toggle causes pointer blur.
- Actual PNG pixels and complete project bytes must remain identical with guides enabled.

### Task 1: Neighbor plans and native authoring controls

**Files:** Create apps/motion-studio/src/onion-skin.ts and tests/onion-skin.test.ts/.spec.ts; modify src/main.ts/style.css, README.md and PROJECT_IDEAS.md; add project verification receipt.

**Interfaces:** `neighborDrawings(project: Project, layerId: string, frame: number): NeighborDrawing[]` returns detached `side`, `frame`, `strokes`, `pose`; `renderNeighborDrawings(context: CanvasRenderingContext2D, guides: NeighborDrawing[]): void` clears and renders only its own overlay.

- [x] Write and run failing domain tests for immediate previous/next boundaries, current-frame transforms, blank neighbors, missing/image/single-cel selection, strict frame validation and detached geometry.
- [x] Implement plan validation/detachment and renderer; run domain tests green.
- [x] Write/run missing-UI native tests: exact teal/rose guide alpha pixels, no stage/PNG/project changes, frame/layer/end/blank transitions, pause/play/reload, raw draft refusal, Undo/Redo and 390px controls.
- [x] Add dedicated overlay canvas, checkbox/status and guarded session state; keep committed rendering unchanged. Run focused native tests green.
- [x] Run npm run check and full native suite. Inspect narrow screenshot and review diff; independent read-only review before publication. Record any real failure/repair in verification receipt.
- [ ] Update docs/roadmap, commit via GitHub and record hosted CI in issue #160; close only after actual completion.

## Execution ledger

Ruling: Execute autonomously in the authorized repository checkout and publish to canonical main without an interactive handoff, as the owner's run instructions explicitly require. Review remains independent and read-only. Cost if wrong: changes remain ordinary reversible git commits.
Pre-flight: the only new shared interface is the detached neighbor plan consumed by the overlay renderer and status; committed model/render/export interfaces remain unchanged.

Task 1: Domain RED missing module -> four deterministic cases; native RED missing controls -> label and pause-path regressions -> five focused native cases green. Full check passes 251 units/lint/type/build; final full browser gate running.
Final: fixed non-button playback pause restoration — fresh raw pose test RED -> central playback-to-paused controls/overlay redraw -> focused 5/5 green.
Ruling: scroll the stage into view before native mouse gesture; an offscreen pointer was not testing a gesture. No product guard/assertion changes.
Ruling: the raw-pose pause regression checks focused raw text, disabled Undo and native saved graph before blur; ordinary native backup focus change deliberately commits valid pose input under the existing editor contract. Its initial unexpected frame-4 pose remains recorded in the verification receipt. Complete committed PNG/project exclusion is independently checked in the first native case.
Task 1: verification complete — npm run check 251/251 plus lint/type/build; full native 159/159. Final review finding is covered RED→GREEN. Publication and hosted CI are tracked in #160.
