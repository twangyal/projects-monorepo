# Motion Studio Implementation Plan

> Agentic workers use the executing-plans workflow with independent ownership and a fresh final review.

**Goal:** Complete the local drawing-to-keyframe-to-animated-GIF flow in issue #16.
**Architecture:** Pure validated model/history, shared Canvas renderer, normalized embedded raster assets, isolated GIF worker, browser editor and IndexedDB autosave.
**Tech Stack:** TypeScript/Vite, Canvas 2D, gifenc, independent GIF decoder in tests, Playwright.
**Spec:** `docs/superpowers/specs/2026-10-03-motion-studio-design.md` defines exact shared interfaces/bounds/ownership.

## Global constraints

640×360 stage, 12 fps, 12–96 frames, 8 layers, 24 keys per layer, 100 strokes and 10,000 points total. JSON is limited to 6 MiB. Image uploads are limited to 4 MiB and 16 megapixels; normalized images have a maximum side of 800 pixels, with at most 4 images. History retains up to 30 states within 20 MiB. GIF output is limited to 32 MiB with a 30-second export timeout. Local data only; no claims of AI assistance or sharing.

## Review focus

- Import/restore finishing after a newer user operation cannot replace newer work.
- Pointer cancellation and gestures at rotated/scaled poses preserve intended artwork.
- Images with malformed headers, deceptive dimensions and huge encodings fail before publication.
- GIF frame timing, ordering and transforms must match visible preview using independent decoding.
- Storage failure, cancellation and unsupported export must preserve the editable project.

## Tasks

- [x] Model/history: write failing bounds/interpolation/mutation tests; implement exact spec interfaces; run Node pure tests. Include inverse-coordinate and timeline-shortening tests.
- [x] Rendering/images: write invalid-header, dimension, and image-bounds tests; implement the decoder, normalizer, and shared renderer; verify real images and transformed stroke pixels in Chromium.
- [x] Export: write frame palette, delay, and cancellation checks; implement the bounded worker and client; verify independently decoded GIF count, duration, and pixel movement.
- [x] Editor: scaffold the independent app; implement drawing, moving, timeline, numeric poses, layers, and history. Numeric pose field changes automatically create or replace the current key; Set keyframe remains available. Run production-browser draw → keyframe → preview checks.
- [x] Persistence/outputs: add atomic validated restore and guarded autosave; test reload, invalid restore, storage failure, and latest-operation precedence; verify GIF/PNG/JSON downloads.
- [x] Finish: add docs/CI/catalog; run lint/typecheck/build/unit/browser checks; inspect desktop/mobile; obtain fresh review and fix findings; commit/push; update the issue/PR and immediately reassess.

Each owner reports test commands/results and leaves commit/push to root to preserve coherent shared-working-tree milestones.

Verification: 38 native unit tests and 24 production Chromium tests pass, along with ESLint, typecheck and production build. Browser tests independently decode real GIFs, check exact duration and moving pixels, real image imports, persistence/failures, undo, cancellation and large backup round trips. Independent review fixes passed reproduced regressions. Desktop/mobile screenshots and a 48-frame 4-second decoded demo export were inspected.
