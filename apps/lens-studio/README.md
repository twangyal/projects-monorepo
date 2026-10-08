# Lens Studio

A private photo workspace for exploring focal framing and manually authored depth. Import a photo, declare the source and target focal lengths, compare the original with the simulated result, then save a PNG or an editable project backup. Everything runs in your browser; photos are not uploaded.

## Run locally

Use Node.js 22.18 or newer (CI uses Node 24) and a current desktop Chromium browser with workers, `createImageBitmap`, OffscreenCanvas and IndexedDB.

```sh
cd apps/lens-studio
npm ci
npm run dev
```

Open the printed local URL, normally `http://localhost:4260`. For a production build:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 4260 --strictPort
```

The application has no backend, account, model download or API key. Browser storage belongs to the exact origin; changing host or port opens a different notebook. Use **Download project** before moving between origins or clearing browser data.

## A first study

1. Choose **Import photo** for a PNG, JPEG or static WebP, or **Try authored demo** for an original three-plane illustration.
2. Set **Source focal length** and **Target focal length**, then apply the settings. Both values must use the same sensor/crop basis. The default 50 mm is a declaration to edit, not detected camera metadata.
3. In **Fixed camera**, a longer focal length crops into the center; a shorter length makes the known image occupy less of the frame. Use **Shift X** and **Shift Y** to move that framing on the output plane.
4. To explore perspective, acknowledge the manual-plane approximation and choose **Manual perspective**. Assign source pixels to near, subject or far with the source-view brush or **Fill plane**. Adjust relative near/far distances and focal length. All pixels initially belong to the subject, so a new photo will not show depth differences until you assign near or far pixels.
5. Use **Undo**, **Redo** and **Reset projection** to compare choices. Export the result with **Export PNG** and retain editable work with **Download project**. **Import project** reopens that backup.

The original and result stay at the same dimensions and aspect ratio. A checkerboard represents transparency. Original transparency is retained; missing field of view and newly uncovered regions also remain transparent. No content is generated to fill them.

## What the simulation means

Fixed-camera mode assumes a centered rectilinear projection and the same sensor for both focal values. With ratio `r = target / source`, points scale by `r` around the image center before the framing offset. Changing 50 to 100 mm therefore fills the output from the middle half of each source dimension. Changing 50 to 25 mm reduces the known image to half its original width and height.

Manual perspective is an experimental three-plane model, not estimated scene depth. The subject distance is 1; near and far distances are relative to it. Focal length and axial camera distance change together to keep the subject plane the same size. A plane at distance `Z` scales by `r × Z / (Z + r − 1)`. Near pixels can cover farther pixels; newly exposed regions remain unknown. The editor rejects settings that would cross the near plane.

This approximation cannot recover actual 3D geometry or unseen surfaces. Cropped, resized, distorted or unknown-camera source photos further limit physical interpretation. It does not simulate optical blur, lens distortion, camera rotation, lighting changes or a calibrated real camera. The framing shift is a two-dimensional output offset.

The displayed missing percentage estimates **sampled geometric coverage** at output pixels, independently of the source photo's alpha. It is not continuous scene area: tiny or odd-sized images can differ from the ideal area fraction. Output colors use premultiplied bilinear resampling and near-over-far alpha composition. These are sampling rules, not optical depth of field.

## Files, limits and recovery

- Import PNG, JPEG or static WebP up to 8 MiB, at most 8,192 pixels per side and 16 million source pixels. Animated images, malformed headers and conflicting metadata are rejected.
- Orientation is normalized once, including mirrored EXIF orientations. The longest edge is reduced to at most 1,280 pixels without upscaling; the normalized photo is a metadata-free PNG up to 7 MiB. Output uses these normalized dimensions.
- Focal values are 10–300 mm with two decimal places; target/source ratio is 0.25–4. Shifts are −0.5 to 0.5 output dimensions. Near depth is 0.1–0.95 and far depth 1.05–10; subject depth stays 1.
- Each source-pixel brush gesture is bounded at 2,048 points and 8,192 pixels of path. Brush radius is 1–100 source pixels. Each completed gesture is one undo step; canceling a pointer gesture discards it.
- History retains up to 30 edit states within 32 MiB. The fixed photo is stored once outside history. Importing another photo or project starts new history.
- A project backup contains one embedded normalized photo, settings and one depth-label mask. JSON is limited to 12 MiB and validated before replacement. It contains no original EXIF metadata.
- One project is saved locally in IndexedDB after completed edits. Before writing, the app compares the complete saved photo, mask and settings with the copy this page accepted. Save success is reported only after the transaction finishes. Conflicts and failed storage keep current work editable, with explicit recovery and backup actions.
- Rendering and export run in cancellable workers with a 30-second deadline. A newer valid job supersedes the older one. PNG output is bounded at 7 MiB; the image contains no checkerboard, painted labels or interface overlays.

PNG export preserves the pixel kernel's exact straight RGBA bytes using a lossless encoder. Browser Canvas presentation can quantize very low-alpha colors, so Canvas readback is not used as the export source. Original image decoding and downsampling use the browser's color conversion and sampling; an exported simulation is based on that normalized raster.

Keep downloaded backups for work you need to retain. Browser storage can be cleared or unavailable, and it is not cross-device synchronization.

If another tab changes the saved study, autosave stops. This page retains its
photo, authored mask, session history, unapplied numeric/title fields and local
PNG/project exports. Further edits remain in memory until you deliberately
resolve the saved copy.

**Reload saved study** asks before discarding this page's unsaved study, fields
and history. It admits the complete saved photo and mask before replacing the
editor. **Replace saved copy** reviews the current saved study, then asks to
replace it with this page's committed study. Unapplied fields and unfinished
strokes are excluded. If another tab saves during review or image validation,
replacement refuses and requires a fresh review. Importing a photo/project or
starting the demo does not bypass protection of a conflicting or unreadable
saved study. Recovery controls remain visible even when startup has no photo.

A confirmed rolled-back save can offer **Retry saving**. Unknown results,
canceled restores and storage deadlines keep the saved copy protected. Local
opening has a five-second limit, native transactions ten seconds, and storage
image validation thirty seconds; browser scheduling can delay these checks.
If native image decoding is already underway, the browser cannot cancel it.
Recovery waits for its cleanup before opening another storage operation, while
the current editor and backups remain usable. A browser decoder that never
returns requires reopening the page after keeping a backup.

Version 0.2.0 upgrades the existing local database to version 2 to fence older
clients that lack these checks. Close older tabs if the upgrade is blocked.
The upgrade preserves existing saved data without rewriting it, and portable
project JSON remains schema 1.

## Verification

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

With an existing system Chromium, use `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`. The production browser suite reserves port 4261 (`LENS_TEST_PORT` selects another unused port) and builds its image, worker and storage harnesses only for tests. Normal production builds include only the application.

Tests cover strict project/mask validation, bounded history, actual source image formats and orientations, worker cancellation, IndexedDB recovery and the complete editor/export/reopen flow. A separately derived scalar renderer checks focal geometry, subject anchoring, occlusion, alpha edges and missing coverage. An independent PNG decoder checks exported bytes, including colors at low alpha. See `docs/runtime-verification.json` for measured runtime evidence. The local unit gate has 67 tests, including 24 independent numerical cases; the current browser suite has 65 cases, including 48 source-orientation combinations inside the image test. The complete remote CI gate passed all 30 browser cases together at commit `c63ac79`; the independent numerical and source-orientation checks passed as well.

## Project status

The local milestone is implemented and verified under [issue #31](https://github.com/twangyal/projects-monorepo/issues/31): fixed-camera framing, experimentally verified manual perspective, local recovery, history and real exports. Learned depth, generated disocclusion and comparisons against calibrated camera captures are separate future work and are not claimed by this milestone.

Issue [#53](https://github.com/twangyal/projects-monorepo/issues/53) corrects an asynchronous assertion race: a finished PNG download can precede the replacement preview paint. A controlled real-worker regression reproduced the old 255-byte presentation difference, then verified the correct eventual preview. The suite now waits for the current rendered state and published replacement dimensions; the independent PNG/scalar and exact Canvas pixel assertions are unchanged. All 67 unit and 31 browser cases, lint, type checking and build passed locally and in [CI at `a0f3e9e`](https://github.com/twangyal/projects-monorepo/actions/runs/37175117242). See [the timing verification record](docs/2026-10-04-preview-export-test-verification.json).


Issue [#68](https://github.com/twangyal/projects-monorepo/issues/68) guards failed IndexedDB schema creation. Native regression tests first reproduced an uncaught private browser exception, then verified sanitized backup guidance, no uncaught page error and successful save/reopen after retry. The complete gate passed 67 unit and 32 production Chromium cases, lint, type checking and build at [`82a090b`](https://github.com/twangyal/projects-monorepo/actions/runs/37198623345). See [the setup verification record](docs/2026-10-04-storage-setup-verification.json).

A later repository-wide CI run exposed a timing assumption in the queued-storage
fixture: its 50 ms delay could finish before real PNG validation started the
IndexedDB transaction. The test now waits for its first actual kept-alive request
to succeed, preserving its pending-save, immutable snapshot and ordered-clear
assertions. A controlled native decode gate reproduces the hazard, and the fixed
case passes locally with lint and type checking. No product code or timeout
changed. The [verification receipt](docs/2026-10-04-storage-readiness-verification.json)
preserves the actual CI failure and limits; its precise original interleaving was
not captured.

The repair at `f19cd6551699d5385de2434b000dc4fbe96826df` passes all **67 units
and 32 browser cases**, lint, type checking and build in both
[push](https://github.com/twangyal/projects-monorepo/actions/runs/37224210032) and
[PR](https://github.com/twangyal/projects-monorepo/actions/runs/37224213108) CI on
Chromium153. All thirteen project PR workflows pass. See the [exact CI receipt](docs/2026-10-04-storage-readiness-ci.json).

Issue [#117](https://github.com/twangyal/projects-monorepo/issues/117) protects the
complete saved study after reproducing a stale tab erasing another tab's painted
mask and framing settings. Version 0.2.0 passes **67 unit and 65 production
Chromium cases**, lint, type checking and build locally and in both
[push](https://github.com/twangyal/projects-monorepo/actions/runs/37250786108) and
[PR](https://github.com/twangyal/projects-monorepo/actions/runs/37250789487) CI at
`d2dc7560bbb5f7c111f5389c12cc760cd1149fed`. The [CI receipt](docs/2026-10-05-saved-copy-ci.json)
verifies the identical implementation and actual PR checkout trees. The 33 new cases cover
competing native writers, complete PNG/mask/settings identity, accepted-load and
replacement authority, older-client fencing, actual ten-second transaction and
thirty-second image deadlines, late cleanup and preserved editor drafts/history.
Existing independent numerical, decoded PNG and orientation checks remain intact.

The [verification receipt](docs/2026-10-05-saved-copy-verification.json) preserves
the original data-loss reproduction and the first run's three test-flow failures:
canceled-replacement wording and two unhandled local-import confirmations. The
narrow corrections retain all complete-record, raw-field and pixel assertions.
Synthetic persisted-page events test ownership rules; they do not establish
physical device behavior or actual browser back/forward-cache eligibility.

The independent maximum run passed with a 1280 × 1280 original PNG and all
1,638,400 authored depth labels. Actual normalization checks every RGBA byte;
exact 12 MiB input is accepted and one extra byte is refused. Competing tabs retain
the complete photo, mask, settings, raw fields and painting history; a third writer
invalidates stale replacement approval. Fifteen retained edit states produce
14 Undo and 14 Redo transitions within the 32 MiB history budget. The complete
10,926,179-byte backup and native saved revision survive a new browser process
exactly. Four PNG exports pass independent scalar samples within one RGBA level.

The [maximum receipt](docs/2026-10-05-saved-copy-maximum.json) preserves the first
failed run: the fixture used a five-decimal shift where the existing contract
permits four. Only that declaration changed to -0.0312 before the successful
367.7-second run; original files, image/mask bounds and tolerances are retained.
Raw-input capacity includes disclosed trailing whitespace. These measurements
do not establish peak memory or general latency.
