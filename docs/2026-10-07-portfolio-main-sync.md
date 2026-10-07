# Main-to-portfolio synchronization — issue #135

Astra now incorporates main's completed Gaze milestones #7, #130, #131, #133
and #134. The merge has no conflicts. Only the Gaze project and its progress
paragraph change; all other roadmap sections, paths/statuses, project #8 skip,
root files and workflows remain unchanged. PR #12 stays a draft; this does not
merge the portfolio branch into main or deploy anything.

Parents: Astra `b08326ad2872913383e12e607bf80f061cf39ee6` and main `73b04fb6160a696bfbf69860496e4eaa39f0340d`.
Gaze tree matches verified main exactly: `4d5c3bb57761fda864911667d61b21dbbda8f1a2`.

Baseline Gaze passes 61 unit tests. The integrated tree passes 65 unit tests and
lint/build syntax checks. Its identical Gaze tree passed all 76 native cases at
four viewports on main's local checkout, with no retries, using Playwright 1.63.0
and explicit Sparticuz Chromium 153.0.8010.0. Independent integration review and
published CI observations are recorded in #135. This is not a new physical
webcam or hardware acceptance claim.

The following thirteen complete project trees are byte-identical to the Astra
parent, including code, tests, assets and project documentation. All thirteen
normal project PR workflows passed at that parent. No repeated local tests of
unchanged projects are claimed; fresh published integration CI is tracked in the
issue, including any pending checks.

| Project | Retained tree SHA |
| --- | --- |
| clothing-studio | `2b8ec67efbb14a95076b89406a11cd2688cfd427` |
| color-context-lab | `2f82e23fa3b78ec9cb8a11b42de597e660e8bd1f` |
| composure | `43a4215cd36a2e427cd8e719852fb05482ee6ed9` |
| duet | `251033387235a366e1aa6ef9e7d8fe3b76f1b0ea` |
| friendly-challenges | `f38db375ac7f918421caf2aeb1a4a4d9a6541618` |
| git-history | `902d5f542813771c68ecd82741cd3c3ed6903435` |
| karaoke-studio | `951cc94b37e2704ff73ac931bbd4b6bddb4af9b1` |
| lens-studio | `5b8e3b942d2b8748a38394b40b3d814628e5c7d1` |
| melody-studio | `5015fb4f50786e76232321f3c66ae498eba8e359` |
| motion-studio | `2f96c6a636e5d46ee2423255b2a8b3fdadf1152d` |
| shot-studio | `c32d1bf4ab580b91535510942ccd19ee45522e4e` |
| stock-notebook | `922fcc04b929ee87068712c7994d1049bd739f64` |
| style-studio | `6904d087b6d26034b2e99c5a7a231cca40e456ac` |

## Published synchronization acceptance

The exact synchronization commit is `04ead28ae30c465acc6fb48be3a667aabd523098`.
All thirteen normal project PR workflows pass at that head on 2026-10-07:

| Project check | Run | Conclusion |
| --- | --- | --- |
| Clothing Studio | [37569571855](https://github.com/twangyal/projects-monorepo/actions/runs/37569571855) | success |
| Style Studio | [37569571697](https://github.com/twangyal/projects-monorepo/actions/runs/37569571697) | success |
| Git History | [37569571689](https://github.com/twangyal/projects-monorepo/actions/runs/37569571689) | success |
| Color Context Lab | [37569571810](https://github.com/twangyal/projects-monorepo/actions/runs/37569571810) | success |
| Lens Studio | [37569571700](https://github.com/twangyal/projects-monorepo/actions/runs/37569571700) | success |
| Stock Notebook | [37569571674](https://github.com/twangyal/projects-monorepo/actions/runs/37569571674) | success |
| Motion Studio | [37569571661](https://github.com/twangyal/projects-monorepo/actions/runs/37569571661) | success |
| Melody Studio | [37569571869](https://github.com/twangyal/projects-monorepo/actions/runs/37569571869) | success |
| Composure | [37569571793](https://github.com/twangyal/projects-monorepo/actions/runs/37569571793) | success |
| Friendly Challenges | [37569571713](https://github.com/twangyal/projects-monorepo/actions/runs/37569571713) | success |
| Duet | [37569571750](https://github.com/twangyal/projects-monorepo/actions/runs/37569571750) | success |
| Karaoke Studio | [37569571672](https://github.com/twangyal/projects-monorepo/actions/runs/37569571672) | success |
| Shot Studio | [37569571798](https://github.com/twangyal/projects-monorepo/actions/runs/37569571798) | success |

Main Gaze at `73b04fb` also passes [37569428033](https://github.com/twangyal/projects-monorepo/actions/runs/37569428033): decoded job112624462181 logs confirm65 unit and76 native cases plus lint/build. PR #12 remains draft, mergeable and unmerged.

The separate [full-Chromium compatibility experiment37569571709](https://github.com/twangyal/projects-monorepo/actions/runs/37569571709) fails its unchanged155 maximum. It is not included in the thirteen normal checks above. Instrumented evidence localizes the recurrence to the application's70-second deadline before the95-second download waiter, with the browser alive. No production code changed in the synchronization. Raw evidence is retained in [the #128 failure receipt](../apps/shot-studio/docs/failures/2026-10-07-chromium-155/README.md); root cause within render/encoding remains unisolated. Subsequent acceptance-documentation commits do not alter the synchronized implementation trees.
