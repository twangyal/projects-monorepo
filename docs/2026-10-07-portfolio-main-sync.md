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
