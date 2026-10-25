# Autonomous Monorepo Development

This repository contains multiple independent projects.

You have broad autonomy to develop, improve, create, and maintain projects within this repository.

## Portfolio focus

As of 2026-10-25 the owner has narrowed development to three projects: **Gaze Navigator** (`apps/gaze-navigator`), **Clothing Studio** (`apps/clothing-studio`) and **Karaoke Studio** (`apps/karaoke-studio`). Only these are `ACTIVE`. Every other app is `DEFERRED`; do not select work in a deferred app, and do not create new projects, unless the owner explicitly asks. The one exception is a deferred app's broken build or failing CI on `main`, which may be fixed minimally.

Rotate between the three priority apps rather than spending every run on one. Within an app, choose the milestone that most advances its core loop described in `docs/PRODUCT_DIRECTION.md`.

## Source of direction

Read these first on every run:

- `docs/PRODUCT_DIRECTION.md`
- `PROJECT_IDEAS.md`
- this `AGENTS.md`
- project-specific README or AGENTS.md files
- recent git history
- relevant TODOs, tests, and documentation

`PROJECT_IDEAS.md` describes the general product ideas and their status. It is direction, not a detailed implementation plan.

You are expected to make reasonable product and engineering decisions independently within the stated product direction. Preserve the owner's destination when defining milestones; do not silently narrow it to the existing prototype.

## Direction precedence and next-task selection

Read `docs/PRODUCT_DIRECTION.md` before choosing or resuming work. Its revised visions and completion standard take precedence over older project descriptions, README scope statements, design plans, issue acceptance criteria and historical completion labels wherever they conflict. A newer explicit instruction from the owner takes precedence over repository documents.

Before implementation, state the intended user outcome, the gap between the current application and that vision, and how the selected milestone closes the gap. Reconcile an older plan with the revised destination before continuing it. Prototype caps, local-only architecture and manual substitutes are current implementation constraints, not permanent product requirements.

After urgent correctness or data-loss problems, prioritize meaningful missing capabilities and usable end-to-end experiences. Do not repeatedly select peripheral hardening or additional verification while the defining experience remains unimplemented. Real quality, accessibility and relevant domain validation remain part of delivering the vision; do not weaken safety or erase failed evidence to claim progress.

`main` is the canonical development and integration branch. Base new work on current `main`, use short-lived task branches when useful, and integrate verified work back into `main`. Archive refs (the `archive/2026-10-08/*` tags and the `archive/pre-cleanup-2026-10-25` branch) preserve historical or superseded work and do not establish current product direction.

## Pull request authorization

Create a pull request, including a draft, only when the owner explicitly asks for one for the current work. Implementation, review, completion or push requests do not authorize PR creation. Identify the explicit request before creating a PR, and carry this boundary into delegated tasks. Without that request, complete the authorized work and verification without opening a PR.

## Every run

1. Inspect the current state of the monorepo.
2. Determine which project or repository-wide improvement currently offers the most value.
3. Prefer continuing useful unfinished work over starting many projects.
4. Select a coherent task.
5. Implement it fully.
6. Run the appropriate project-specific verification.
7. Fix regressions caused by your work.
8. Review your diff.
9. Commit completed work with a clear commit message. Code, tests and any documentation change go in the same commit; do not add follow-up "accept gates" or "retain evidence" commits.
10. Update the app README or `PROJECT_IDEAS.md` only when user-facing capabilities, commands or status actually change, following the documentation policy below.

Do not wait for me to assign individual tasks.

## Creating projects

Do not create new projects while the portfolio focus above is in effect. If the owner later asks for one, when creating a project:

1. Create a dedicated directory under the appropriate monorepo location.
2. Choose a reasonable architecture and technology stack consistent with the repository unless the idea specifies one.
3. Establish development, build, lint, and test commands.
4. Create a README explaining the project and how to run it.
5. Implement a usable vertical slice instead of only scaffolding.
6. Add reasonable automated verification.
7. Update `PROJECT_IDEAS.md` from `IDEA` to `ACTIVE`.

## Prioritization

Prefer work in roughly this order:

1. failing builds or tests
2. serious bugs
3. nearly-complete projects that can become usable
4. major missing functionality
5. user-facing UX problems
6. reliability and correctness
7. maintainability
8. developer experience
9. performance
10. minor cosmetic work

Apply this order within the three priority apps.

Prefer finishing useful projects over endlessly polishing one project. Select coherent milestones against the intended user experience and its major missing capabilities. Storage, recovery, exports and test coverage support that experience; their completion alone does not complete the product.

Avoid repeatedly switching between projects without completing coherent work.

## Project status

Use these statuses in `PROJECT_IDEAS.md`:

- `IDEA` — not started
- `ACTIVE` — meaningful product development remains against the intended vision
- `MAINTENANCE` — the intended product experience is substantially delivered and evaluated in relevant real use; no major capability gap remains that requires active development
- `BLOCKED` — cannot reasonably proceed without external information or resources
- `DEFERRED` — paused by the owner; exclude from scheduled/autonomous task selection until the owner explicitly resumes it
- `DONE` — fulfills its intended purpose and has no obvious high-value missing work

Gaze Navigator, Clothing Studio and Karaoke Studio are ACTIVE. All other implemented apps are DEFERRED (Composure and Shot Studio since 2026-10-14, the rest since 2026-10-25); do not resume them, run investigations on them or choose platform migrations for them without a new owner instruction. The phone-restriction and handwriting projects retain their recorded blockers, and paper trading remains skipped. A completed prototype, bounded MVP or successful automated gate is an intermediate milestone. Before a future MAINTENANCE or DONE transition, document evidence against the intended vision and remaining user-facing gaps; do not reduce the vision to justify the status.

## Documentation and evidence policy

The repository previously accumulated hundreds of dated acceptance receipts, test logs, evidence JSON files and research archives (about 200 MB), plus READMEs that grew into 800-line milestone logs. They were removed on 2026-10-25 and are preserved on the `archive/pre-cleanup-2026-10-25` branch. Do not recreate them.

- **Git history and CI are the record.** Commit messages and CI runs show what changed and that it passed. Do not commit dated `*-acceptance.md`, `*-integration.md`, `*-verification.*`, red/green test logs, "local attempt" JSON or similar receipts.
- **Do not commit generated evidence or large binaries.** Simulation output, recordings, archives and benchmark results belong in CI artifacts or an issue comment. Committed test fixtures must be small and live next to the tests that use them.
- **READMEs describe the present.** Each app README covers what the app is, what works, known gaps, how to run it, how to verify it and its layout. Edit it in place; never append milestone narratives. Keep it under about 150 lines.
- **`PROJECT_IDEAS.md` stays short.** Each entry has a status, the owner's description and a few lines of current state. Replace the current-state lines when they change; do not append milestone paragraphs.
- **`docs/PRODUCT_DIRECTION.md` records destinations and owner decisions only.** Add a dated owner decision when the owner gives one; do not add delivery notes.
- **No CI run IDs, test counts, issue-number chains or SHAs in prose docs.** They go stale immediately.
- **Research must stay bounded.** Before starting a research investigation, state the product question it answers and a stopping point. Keep research code and results on a task branch or in CI artifacts, and record only the conclusion (a short paragraph) in `docs/PRODUCT_DIRECTION.md` or the app README. Do not keep extending a study across many runs without a user-facing outcome.
- **Write normal prose.** Put spaces between words and numbers, use short paragraphs, and prefer plain language over "admission", "gates" and "retained" jargon.

## Independence

When multiple reasonable approaches exist, choose one and proceed.

Do not ask for clarification merely because:
- architecture choices are open
- UI details are unspecified
- a dependency needs to be selected
- implementation details are ambiguous

Infer intent from the project description and existing code.

## Scope

You may autonomously:

- create new projects only when the owner asks
- add or remove files
- add dependencies when justified
- refactor
- redesign project internals
- improve UI/UX
- add features
- fix bugs
- add tests
- improve accessibility
- improve documentation
- improve developer tooling
- update dependencies
- remove dead code

Avoid unnecessary repository-wide rewrites.

## Safety boundaries

Do not:

- commit or expose credentials
- intentionally destroy user data
- incur paid service charges
- modify billing
- weaken security for convenience
- make irreversible production infrastructure changes

Otherwise, assume broad authority over this monorepo.

## Monorepo hygiene

Keep projects reasonably isolated.

Prefer shared packages only when multiple projects genuinely benefit from the abstraction.

Do not create shared infrastructure merely because two projects contain superficially similar code.

Run verification targeted to the affected project whenever possible. Run repository-wide checks when changes affect shared infrastructure.

Before finishing a run, leave the repository in a working state.
