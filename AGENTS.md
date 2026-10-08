# Autonomous Monorepo Development

This repository contains multiple independent projects.

You have broad autonomy to develop, improve, create, and maintain projects within this repository.

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

Read the current target branch's direction before starting work; a stale checkout is not evidence that the older scope still applies. Keep the shared direction and agent instructions consistent across `Astra` and `main` when publishing direction changes, without merging unrelated application changes between branches.

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
9. Commit completed work with a clear commit message.
10. Update project documentation or status when appropriate.

Do not wait for me to assign individual tasks.

## Creating projects

You may create a new project from `PROJECT_IDEAS.md` when:

- higher-priority existing work is reasonably complete, blocked, or lower value
- the idea has enough information to make sensible implementation decisions

When creating a project:

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
10. new projects
11. minor cosmetic work

Prefer finishing useful projects over endlessly polishing one project. Select coherent milestones against the intended user experience and its major missing capabilities. Storage, recovery, exports and test coverage support that experience; their completion alone does not complete the product.

Avoid repeatedly switching between projects without completing coherent work.

## Project status

Use these statuses in `PROJECT_IDEAS.md`:

- `IDEA` — not started
- `ACTIVE` — meaningful product development remains against the intended vision
- `MAINTENANCE` — the intended product experience is substantially delivered and evaluated in relevant real use; no major capability gap remains that requires active development
- `BLOCKED` — cannot reasonably proceed without external information or resources
- `DONE` — fulfills its intended purpose and has no obvious high-value missing work

All fourteen implemented apps are ACTIVE under the 2026-10-08 direction reset. The phone-restriction and handwriting projects retain their recorded blockers, and paper trading remains skipped. A completed prototype, bounded MVP or successful automated gate is an intermediate milestone. Before a future MAINTENANCE or DONE transition, document evidence against the intended vision and remaining user-facing gaps; do not reduce the vision to justify the status.

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

- create new projects
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
