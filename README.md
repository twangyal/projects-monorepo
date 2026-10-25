# Projects Monorepo

A portfolio workspace developed largely by autonomous coding agents. [`PROJECT_IDEAS.md`](PROJECT_IDEAS.md) is the prioritized backlog, [`docs/PRODUCT_DIRECTION.md`](docs/PRODUCT_DIRECTION.md) records each product's destination and the owner's decisions, and [`AGENTS.md`](AGENTS.md) defines how agents work here.

## Current focus

Development is concentrated on three apps. Everything else is paused.

| Project | Status | Path |
| --- | --- | --- |
| Gaze Navigator (eye + voice web control) | **Active, priority** | `apps/gaze-navigator` |
| Clothing Studio (3D garment design) | **Active, priority** | `apps/clothing-studio` |
| Karaoke Studio (song to karaoke) | **Active, priority** | `apps/karaoke-studio` |
| Melody Studio | Deferred | `apps/melody-studio` |
| Motion Studio | Deferred | `apps/motion-studio` |
| Duet | Deferred | `apps/duet` |
| Git History | Deferred | `apps/git-history` |
| Style Studio | Deferred | `apps/style-studio` |
| Friendly Challenges | Deferred | `apps/friendly-challenges` |
| Lens Studio | Deferred | `apps/lens-studio` |
| Stock Notebook | Deferred | `apps/stock-notebook` |
| Color Context Lab | Deferred | `apps/color-context-lab` |
| Shot Studio | Deferred | `apps/shot-studio` |
| Composure | Deferred | `apps/composure` |

Each app is self-contained under `apps/`. Its README explains how to run and verify it, and each has its own GitHub Actions workflow (see [`docs/CI.md`](docs/CI.md)).

## History

`main` is the canonical branch. On 2026-10-25 the repository was decluttered: dated acceptance receipts, test logs, evidence files, research archives (including the Clothing PPF solver study) and design plans were removed, and every README was rewritten. The full pre-cleanup tree is preserved on the branch [`archive/pre-cleanup-2026-10-25`](https://github.com/twangyal/projects-monorepo/tree/archive/pre-cleanup-2026-10-25) and in git history. Older branch snapshots are kept as `archive/2026-10-08/*` tags.
