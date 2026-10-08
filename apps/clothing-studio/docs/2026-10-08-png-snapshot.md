# PNG snapshot ownership — 2026-10-08

Issue: [#147](https://github.com/twangyal/projects-monorepo/issues/147).

The PNG encoder already retained the rendered artwork, but the download helper read the live title after asynchronous encoding. Native Chromium reproduced the bug: Original A garment bytes were downloaded as `Renamed B-garment.png`.

The handler now validates and captures a detached project snapshot before awaiting export, then passes its title explicitly to the download helper. The garment, placement, strokes, points and photo belong to that snapshot. Other synchronous downloads retain their existing behavior. Editing remains available while the encoder finishes.

Six new production Chromium cases cover garment and preview PNGs across Rename, New and Open. They hold the callback from the real Canvas encoder, then verify original suggested filename, exact equality with an actual baseline PNG download, the newer concept title and released export controls. They do not substitute image bytes or the encoder.

Local verification: 39 unit tests, ESLint, TypeScript and production build pass; all six targeted cases and all 46 production Chromium cases pass. Chromium 153.0.8010.0 ran through a temporary external executable wrapper. Independent read-only review found no Critical or Important blocker. No private photos or paid services were used.

Published-head CI is recorded on the issue after publication. This correction does not deliver linked 2D patterns, editable 3D garments, cloth simulation or personalized fitting; Clothing Studio remains ACTIVE against the revised product direction.
