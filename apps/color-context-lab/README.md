# Color Context Lab

Issue [#70](https://github.com/twangyal/projects-monorepo/issues/70). Implementation follows the reviewed [design](../../docs/superpowers/specs/2026-10-04-color-context-lab-design.md).

## Current milestone: lossless comparison core

This first unit is a browser-compatible TypeScript library, not yet the artist-facing application. It provides strict self-contained raw-RGBA project validation/serialization, bounded reversible edit history, exact solid/checker surround comparison, numerical diagnostics, PNG structure admission and direct lossless PNG export. Normalized artwork bytes, including invisible RGB and low alpha, are copied exactly. No surrounding-context transform changes the center artwork.

Numerical RGB/luminance differences measure encoded pixels, not perceived similarity or art protection. PNG structure admission does not decompress uploaded files: the future browser normalization path must independently decode admitted input. No model has been fitted and there are no experiment results. The preregistration/manifest gate in the design remains required before fitting.

## Verification

Node 24 or newer; no dependencies or installation required:

```sh
cd apps/color-context-lab
npm test
```

Node runs erasable TypeScript directly. This command is behavioral verification, not TypeScript static type checking. Unit fixtures independently calculate geometry/metrics and decode PNG using Node zlib plus a separate bitwise CRC oracle.

Optional second decoder (Python with Pillow installed):

```sh
node scripts/export-fixtures.ts
python scripts/verify-pillow.py
```

The scripts write only temporary fixtures under `/tmp` and compare every byte at 2×2 and the maximum 976×976 export size. The runtime library does not depend on Python/Pillow or Node APIs.

## Next work

Complete worker-owned native PNG normalization/cancellation, persistent recovery, report export and the keyboard-usable browser workspace. Add production build/type checking and native browser gates before marking this project ACTIVE with a usable vertical slice. Then freeze the procedural experiment generator/manifest before any training or test inference. The catalog intentionally remains IDEA until the usable application exists.
