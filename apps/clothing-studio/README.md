# Clothing Studio

**Product direction (2026-10-08): ACTIVE.** The destination is a professional garment-design environment with linked 2D patterns, editable 3D garments, credible cloth simulation and personalized fitting. See [the portfolio direction](../../docs/PRODUCT_DIRECTION.md) for the full vision and acceptance expectations. The implementation and verification described below are current milestones, not completion of that destination.

A local garment design workspace. **Style a garment in 3D**: start from a template, drag fabrics, colors and prints onto each part of a real-time 3D tee, place artwork, see the linked pattern pieces, and export renders or a 3D model. The concept tee sketchbook, photo overlay and measured skirt construction are still here. No account, backend, image model, or paid service is required. Photos and projects stay in your browser.

The **approximate photo overlay** is a visual design aid. It does not estimate measurements, garment fit, fabric drape, depth, or body occlusion. Textures are procedural graphics. The concept note records your idea; it does not generate designs. Realistic try-on, generated concepts, and sewing/manufacturing patterns are future projects.

## Run

Use Node **22.18+** (CI uses Node 24) and npm:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. For a production build:

```sh
npm run build
npm run preview
```

The built `dist/` directory can be served by a static web server. Use a current browser with IndexedDB, SVG, Canvas and `createImageBitmap`; Chromium is automated below. Photo decoding can vary between browsers. No external assets, telemetry, or network requests are needed by the production app. The development server uses its local hot-reload connection.

## Style a garment in 3D

**3D product design** follows the approachable workflow of web-based product design tools such as Fabra: start from a product or template, style it part by part in real-time 3D, and export. See the [research and roadmap](docs/2026-10-13-fabra-research.md).

1. **Choose a template**: **Blank tee**, **Breton stripe**, **Ringer tee** or **Garden print**. Templates are remixable starting points. Replacing a design asks first and can be undone.
2. **Style each part.** The garment's parts are the front body, back body, left and right sleeves and the neck rib.
   - Drag a fabric, color or print from the library onto a part of the 3D garment, or select a part (click it, use the part buttons, or click its pattern piece) and click a library item.
   - The inspector sets the selected part's fabric, color, print, print color, **Repeat** (standard, half drop, half brick or mirror) and **Repeat size**.
   - **Use this style on every part** copies the style to all parts; the neck rib keeps its rib knit.
3. **The fabric library** has 8 fabrics with weight and composition, from cotton jersey (180 gsm) to denim twill (340 gsm). Each has a procedural knit or weave structure. Prints come in 6 motifs. Fabric structure and prints are drawn at their real size in centimetres, so a 2 cm stripe is 2 cm on the garment and on the pattern.
4. **Measurements**: chest, body length, sleeve length and crew or V neckline. They reshape the 3D garment and the **linked pattern pieces**. Those are finished flat pieces, without seam allowance, dimensioned in cm and filled with the same fabrics.
5. **Artwork**: upload a PNG (transparency kept), JPEG or WebP for the front or back. Set its width and position in cm from the centre and below the shoulder.
6. **View and export**: orbit by dragging, or use **Front**, **Back**, **Left** and **Right**. **Export front/back render PNG** saves a render, and **Export 3D model (GLB)** saves the styled garment, with its named parts and artwork, for other 3D tools.

Every change is one Undo/Redo step and is saved with the project and its backups. Projects without a 3D design remain valid.

How the 3D garment is built: the tee's flat front and back silhouettes (shoulders, sloped sleeves, side seams, neckline) are triangulated, and each side is shaped outward by its distance from the seams where front and back are joined. The shoulders, sleeve edges and sides therefore meet exactly, while the hem, cuffs and neck stay open. Sleeves join the body along their armhole seams without gaps. This is a **styling model** built from the measurements, not a fitted drape: fabric weight and stretch do not change its shape here, and it is not worn on a body. For fabric drape on a body, see the measured skirt's simulation below. Rendering uses WebGL; if it is unavailable, the pattern pieces and editing still work.

See [3D product editor verification](docs/2026-10-13-product-editor.md).

### Automatic tech pack (#227)

Below the 3D editor, **Factory-ready tech pack** is generated from the design and updates with every change.

- **Details**: **Style number**, **Season** and **Sample size** (XS–XL). Use **Apply details** to save them with the design as one undoable edit.
- **Bill of materials**: one line per distinct fabric, color and print. Each line gives the composition, weight, the parts it covers, and consumption. Consumption is estimated from the pattern-piece areas plus 15% for seam allowance and cutting waste, in m² and in linear metres at 150 cm wide. Then come trims (thread, neck label, care label) and each artwork, with its print size and placement.
- **Points of measure A–K**: chest, body length, sleeve length, armhole depth, shoulder, neck width, front and back neck drop, hem, sleeve opening and rib height.
  - They come from the same dimensions as the 3D garment and pattern pieces.
  - Each has a tolerance and is graded XS–XL around the sample size.
  - A measurement diagram labels each point.
- **Construction**: seam-by-seam operations, with a mitred V or a shoulder-joined crew rib, and artwork application.
- **Download tech pack (Excel)** saves an `.xlsx` workbook with Cover, Bill of materials, Points of measure and Construction sheets. Measurements are numeric cells.
- **Download printable tech pack** saves a self-contained HTML document with front and back renders, the tables and the diagram. Open it in a browser and print, or save it as a PDF.

Consumption, grading and construction are standard starting values for a basic tee. Confirm them with a marker and a fit sample. See [tech pack verification](docs/2026-10-13-tech-pack.md).

### Colorways and range plan (#230)

Below the tech pack, **Colorways and costing** turns one garment into a small range.

- **Save as colorway** stores the current part styling under a name (up to 8). Each colorway card shows its own front render. **Show in editor** restyles the garment with it, **Update** replaces it with the current styling, and **Delete** removes it. Every change is one undoable, saved edit. Renders are made in a separate scene, so the garment you are editing never changes on screen.
- **Units for …** sets the planned quantity of each colorway.
- **Costing inputs**: the currency (USD, EUR, GBP), retail price, make (CMT) per unit, trims per unit, print cost per placed artwork, and a price per metre of 150 cm fabric for each fabric in use. The defaults are indicative placeholders; replace them with supplier quotes, then **Apply costing**.
- The **range plan** lists each colorway with these figures, plus totals:
  - fabric cost (each fabric's estimated metres, from the same pattern-area consumption as the tech pack's bill of materials, times its price);
  - trims, print and make;
  - unit cost, retail and margin;
  - units, total cost and revenue.

  Until a colorway is saved, it shows the current design. Totals multiply the unit cost shown, rounded to the cent.
- **Download range plan (Excel)** saves the plan, the fabric costing per colorway, and notes on the estimates.

See [colorway and range plan verification](docs/2026-10-13-colorways-range-plan.md).

## Create a concept

1. Name the project and adjust body width, body length, sleeve length, and neckline. Silhouette values are drawing units, not physical measurements.
2. Choose a color and plain/striped/woven visual appearance. Draw with a mouse, pen or touch; strokes are clipped to the garment. Reshaping keeps marks in the same canvas position, revealing/hiding marks at the new outline.
3. Upload a PNG, JPEG or still WebP photo, or use the included silhouette. Drag the preview to place the garment. Labeled fields control position, width, height, rotation and opacity. Focus the preview and use arrow keys to move 1%; Shift + arrow moves 5%.
4. Export a transparent garment PNG, an editable garment SVG, a composed preview PNG, or a complete JSON project backup. Open a backup to restore the photo, sketch, colors, note and placement.

**Export garment SVG** downloads the same 400×440 transparent garment illustration as vector paths: silhouette, plain/striped/woven pattern and clipped sketch strokes. Open it in a vector editor to recolor or continue drawing. The file has no external resources and is bounded at 1 MiB, including the maximum 100 strokes and 12,000 points. Geometry uses the renderer's six-decimal drawing precision; drawing units are not physical measurements. Its escaped title is accessible text. Photos, placement, the sample figure and concept notes remain in the complete JSON backup. SVG is an illustration export; use JSON to reopen editable work in Clothing Studio. Export cancels an unfinished sketch/placement preview and uses committed art without adding a history edit.

PNG exports retain the artwork and filename from the concept snapshot captured when export starts. You can rename, start a new concept or open a backup while encoding finishes; the pending download remains named for its original concept. See [snapshot verification](docs/2026-10-08-png-snapshot.md).

Undo/redo keeps the latest **40 edits** in this session. It includes sketch gestures, placement, clear, photo replacement and starting a new concept. Ctrl/⌘ Z and Ctrl/⌘ Shift Z work outside text/number fields; those fields retain native editing shortcuts. A blank concept name becomes “Untitled concept.” New edits after undo discard the redo branch.

## Local saving and image handling

- A single current project autosaves committed edits to IndexedDB after startup successfully restores or confirms no saved concept exists. Failed or superseded startup restoration protects the previous saved concept while current work remains editable in memory. **Replace saved concept** requires confirmation and enables autosave only after its native write succeeds; cancel or failure keeps protection active. Export the current backup before reloading memory-only work. Edits made during replacement are saved afterward; canceled sketch and placement previews are never persisted. Wait for **Locally saved** before closing the page. Undo history is session-only. Multiple tabs share the same local save; the last successful write wins.
- Load, save and clear transactions have a nominal **10-second deadline** from native transaction creation, including time queued behind another tab. Pending work is aborted and the save queue waits for native rollback before retrying. If native completion already happened, its eventual callback reports the actual result. Browser scheduling may delay timers and terminal callbacks; this is transaction recovery, not cross-tab conflict prevention.
- Storage restrictions, quota failures and invalid saved data are reported. The active concept remains available and can be exported as a backup. Browser data can be cleared by the browser or user; keep a backup for work you want to retain.
- Photo import accepts up to **10 MiB**, **16 million pixels**, and **8000 pixels on either edge**. Header bounds are checked before browser decoding. Photos are resized to at most **1200 pixels per edge** and normalized as JPEG, flattening transparency onto white and discarding original metadata. Your original file is not modified.
- Invalid containers, unsupported types, conflicting dimensions and undecodable data are rejected without replacing the active concept. Browsers can recover some damaged JPEGs, so successful decoding does not guarantee that every source pixel was intact; review the resulting preview.
- Backups are capped at **6 MiB**. Embedded photos must be bounded normalized JPEG data with dimensions matching the image. Names/notes, numeric ranges, colors, stroke data and version are validated; imported markup and external image URLs are not accepted.
- Sketches allow **100 strokes**, at most **1000 points per stroke**, and **12,000 total points**. Garment PNGs are 400×440; preview PNGs follow the resized photo dimensions, or 600×800 for the sample. No export exceeds 2048 pixels on an edge.
- Cancelled or superseded imports cannot replace your current work. Typing (even a changed-back draft), editing controls, starting a sketch/placement gesture, undo/redo, another import or leaving the page retires a pending photo/backup import. Late completion preserves current fields, focus, artwork and history. Start the import again when you want to replace that newer work. Startup restore cannot overwrite editing that begins while a saved photo is decoding.

## Verify

```sh
npm run check             # unit tests, ESLint, TypeScript, production build
npx playwright install chromium
npm run test:browser      # starts and tests a production preview automatically
```

To use an existing Chromium binary:

```sh
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

Unit tests cover project validation, immutable bounded history, geometry/escaping, clipping, and image-header resource limits. Browser tests exercise the actual create/sketch/photo/backup/export workflow, local restore, invalid data preservation, cancellation/replacement races, storage failure, active-draft restore protection, portrait layout, keyboard controls and a narrow viewport. PNG checks verify dimensions and transparency. Tests generate synthetic photos locally and do not access personal files or services.

The app is independent of other monorepo projects. Source modules separate the validated project model, SVG/PNG graphics, photo processing, persistence and workspace interactions; no shared backend or framework is needed.


Startup recovery (#49) was verified on 2026-10-04 at `593f67aa880b7e84eb646bb26266d0955c2b5746` in [run 37197789513](https://github.com/twangyal/projects-monorepo/actions/runs/37197789513): 36 unit tests, lint/typecheck/build and all 17 production Chromium cases passed. Independent review found and reproduced a pending-replacement gesture race in two native cases before its committed-history correction. See [verification evidence](docs/2026-10-04-startup-recovery-verification.json).

The final presence-boundary correction at `f83e1b6` distinguishes a stored `undefined` from an absent key, keeping invalid records protected until explicit replacement. The added native case failed before this fix, and [run 37198211480](https://github.com/twangyal/projects-monorepo/actions/runs/37198211480) passes all 36 unit and 18 browser cases with lint/typecheck/build.


Vector illustration export (#92) is complete: [PR #94](https://github.com/twangyal/projects-monorepo/pull/94), implementation `fc5de6a`, passes **39 unit and 24 native browser cases**, lint/typecheck/build in [run 37217988856](https://github.com/twangyal/projects-monorepo/actions/runs/37217988856). Actual downloaded vectors match PNG raster hashes for plain, stripe and weave; literal red/green/transparent pixels separately check artwork and clipping. The 100-stroke/12,000-point fixture exports a 280,872-byte SVG and preserves its exact complete backup. Native keyboard export cancels an unfinished gesture without losing redo; 390px layout and external-resource absence are verified. [The verification record](docs/2026-10-04-vector-export-verification.json) records exact checkout and claim limits.


Held transaction recovery (#101) now preserves the native saved record and releases ordered autosaves after rollback. The four original #102 regression cases remain unchanged. Three independent native cases verify complete photo/sketch retention during timed-out clear, synchronous failure after a real `put`, and a deliberately delayed rollback callback. The complete local gate passes **39 unit and 31 Chromium cases**, lint, type checking and production build. The test harness is excluded from ordinary production builds. See [verification record](docs/2026-10-05-storage-deadline-verification.json) for first failures, CI status and timing limits.

Both [push](https://github.com/twangyal/projects-monorepo/actions/runs/37250018943) and [PR](https://github.com/twangyal/projects-monorepo/actions/runs/37250023195) CI pass the full 39-unit/31-browser gate at implementation `cdfcc3545ed880f99a7276d1b73aeb9e5f7b8d48`.


Pending import ownership (#118) fixes three reproduced whole-concept data-loss paths:
an older backup could replace a newer committed title, unblurred placement draft
or active sketch, then autosave itself. Imports now retire on newer editing intent
without normalizing controls or canceling the new gesture. Native photo processing
still closes its real bitmaps; old success/error/finalization cannot publish or
release a newer operation. Normal imports remain single reversible edits.

The local gate passes **39 units and 39 native browser cases**, lint, type checking
and normal production build. Eight independently authored cases verify complete
original JPEG/stroke/placement graphs, actual downloads and PNG pixels, raw fields,
text selection, Undo/Redo, native pointer gestures, held genuine file/image results,
cancellation and fresh retry. Controlled page-transition events verify ownership
policy only. The first full run's two hardcoded-test-port failures remain preserved;
only those tests' exact origin was corrected. See the [verification receipt](docs/2026-10-05-import-ownership-verification.json)
for original failures and published CI status.

Both [push](https://github.com/twangyal/projects-monorepo/actions/runs/37251968052)
and [PR](https://github.com/twangyal/projects-monorepo/actions/runs/37251970510) CI
pass the complete 39-unit/39-browser gate at
`0c249520c7d3de30096f81335d4329793aa3e855`. The [CI receipt](docs/2026-10-05-import-ownership-ci.json)
confirms the actual PR checkout has the identical implementation tree.

Independent #118 retention acceptance adds an original 1200×1200 photo and 100-stroke/12,000-point complete graph. A held exact 6 MiB File read cannot replace a newer title; complete native backups and three actual garment PNG downloads remain byte-identical through a fresh Chromium process. Input whitespace padding tests file admission, not artwork size or peak memory. The published implementation is preserved. The local full gate passes **39 units and 40 browser cases**, lint/typecheck/build. See [retention evidence](docs/2026-10-05-import-retention.json); the added check's published CI is pending.

## Measured skirt construction

The **Draft a two-panel skirt** workspace is separate from the tee illustration and photo overlay. Enter garment waist circumference (50–150cm), hem circumference (70–300cm), and **slant seam length** (20–120cm), including your intended ease in the garment circumferences. Slant is the length along the fabric, not the assembled vertical height. Hem must exceed waist by at least 5cm; combinations that cannot form a positive-height conical frustum refuse.

**Apply measured pattern** creates two matching annular-sector panels. Each has half the complete waist/hem arc length and two side seams of the entered slant length. Join the two pairs of side edges to form the shell. Parameters, rather than arbitrary drawing units, determine physical geometry. The draft is retained alongside the complete photo, sketch, tee, note and placement, with one-edit Undo/Redo, autosave, backup/import and reload. Earlier backups keep their original field absence.

Raw settings remain unapplied until Apply. Invalid settings stay editable; **Discard pattern edits** restores committed values. Finish other raw fields and active gestures first. Construction editing intent retires older pending imports. **Export full-size pattern SVG** exports committed settings only, with two labeled pieces, grainlines, seam lengths and a **5cm×5cm** calibration square. SVG dimensions are in millimetres; the geometry is in centimetres. Open in a vector editor or print at 100%, checking the calibration square. The SVG export is one large sheet. For a home printer, use **Export A4 tiled pattern** or **Export US Letter tiled pattern** to download a self-contained HTML file. Open that file in your browser and print on its labelled paper at 100%, disabling fit-to-page and browser headers/footers. The first page has a 5cm square (measure between stroke centres) and assembly instructions. The remaining pages show numbered row/column pieces of the original sheet with 1cm overlap, repeated alignment crosses and trim borders. Assemble columns left to right and rows top to bottom. Both measured stitching and saved cutting lines are retained. The export uses no scripts/network resources or private artwork/metadata, and does not change the concept or history. Printing is bounded to 256 tiles and 2MB of UTF-8 HTML; all admitted skirt extremes have been checked within those limits. Graded sets currently retain the single-sheet SVG export.

The saved base measurements describe **stitch lines**. Optional **Seam / waist allowance** (0–2.5cm) and **Hem allowance** (0–5cm) add separate cutting lines. Zero is the default: earlier projects retain their original absent allowance field. Apply stores both settings as one complete, undoable concept edit; graded exports inherit the same allowance choices for every relative size. With nonzero allowances, solid orange lines mark cutting and dashed green lines mark stitching. Side edges offset outward by the seam allowance, the waist arc offsets inward by that amount, and the hem arc offsets outward by the hem allowance; corners are intersections of those parallel lines and concentric arcs. The measured stitch dimensions and assembled rigid shell stay unchanged. The SVG expands to contain the cutting pieces, including wide arcs. This is a [constant normal offset](https://mathworld.wolfram.com/ParallelCurves.html), not a validated garment construction method.

An optional measured waistband is now provided; closure mechanics and body fitting are not simulated. They are a construction study, not a sewing-ready pattern or validated physical fit. Add those details and validate a toile before cutting final fabric. The linked rigid geometric shell is a foundation for further construction; material simulation, personalized avatars, editable darts/pleats, AI creation and manufacturing evaluation remain ACTIVE product work. Geometry derives from arc length and the [right conical-frustum slant/height relation](https://mathworld.wolfram.com/ConicalFrustum.html); this mathematical reference does not establish garment fit.

### Add a measured waistband (#192)

Enable **Include measured waistband**, enter **Finished waistband height** (2–10cm) and **Waistband closure extension** (0–5cm), then choose **Apply measured pattern**. The straight folded piece has stitch length equal to garment waist plus extension and stitch height twice the finished height. The saved seam allowance applies to all four edges; the skirt's hem allowance does not apply to the band. A fold line, grain direction and extension mark are labelled. Zero extension is permitted as a construction study; this does not create a working fastening or ensure that the garment can be put on.

The full-scale, A4/Letter tiled and relative graded exports include the band. Relative waist changes resize its attachment length; finished height and extension stay the same in every derived size. Earlier concepts keep the absent optional field. Unchecking and applying removes it in one undoable edit; invalid settings remain raw, and Apply/Discard, backups, autosave and reload preserve the complete concept.

The 3D preview/OBJ adds a 32-quad rigid ring of the entered finished height above the skirt waist. Its circular waist matches the shell; the 2D closure extension, folds, fastening mechanics, thickness and cloth/body contact are not modelled. With a band the combined surface has 128 vertices and 64 quads; without one the original 64/32 shell remains. Review materials, closure construction and a physical toile before production. This is an intermediate construction milestone ([#192](https://github.com/twangyal/projects-monorepo/issues/192)), not validated manufacture or the full garment-design destination.

### Linked rigid shell and surface export (#167)

The committed skirt measurements also assemble into a rotatable **Rigid 3D construction preview**. The same circumference radii and slant/height relation drive both views; two opposite joining seams identify the front/back panels. Use rotation buttons or Left/Right arrows on the focused preview. Rotation is session-only: it does not edit, save or consume Undo/Redo. Raw measurement drafts leave both committed views unchanged until Apply; Apply, Undo/Redo, import and reload update both together. The 32-segment approximation uses 64 vertices and 32 outward-facing quads; circumference measurements describe the underlying circles, not the shorter polygonal rim perimeter. Dashed seam guides include the far side.

**Export construction OBJ** exports the committed surface independently of camera rotation. Apply/discard raw pattern edits and finish other raw fields first. OBJ includes named Front_Panel/Back_Panel groups and two seam lines, without external materials or photos. Coordinates are **centimetres**, with origin at the waist centre and **+Y pointing toward the hem**; OBJ itself has no universal unit metadata, so configure your importing tool accordingly. This open rigid surface has no thickness, allowances, functional closure, cloth drape, material physics, body or fit validation. An enabled waistband adds a separate rigid cylindrical surface; its 2D closure extension is excluded from 3D. The original tee illustration remains separate.

Local verification passes 48 unit and 57 native browser cases, lint, typecheck and production build. Native cases verify actual SVG projection coordinates, linkage/history/saved reload, unapplied fields, raw placement before blur, keyboard/mobile rotation and real OBJ downloads. See [construction evidence](docs/2026-10-09-linked-construction.md). Professional garment modelling and real production evaluation remain ACTIVE work.

### Saved relative size grading (#168)

Apply a measured base, then enter **waist/hem/slant increments per size** (-20..20cm) and **1–3 steps on each side of base**. Apply grading rule saves a manual linear rule alongside the complete concept; the table shows 3–7 relative measurement sets. At least one increment must be nonzero. Negative increments are supported; relative labels do not promise that higher offsets are larger or correspond to standardized body sizes.

Every derived size must satisfy the same measured-skirt limits. A base edit that invalidates any saved graded size refuses, retaining your raw input, existing views and Undo/Redo. Apply/Discard grading edits affects its own drafts. **Remove grading rule** is undoable and retains the base, artwork and unapplied pattern measurements; use it to return to single-size construction or revise the base beyond an old grading range. Rule changes, removal, backup/import, autosave and reload preserve the complete concept. Legacy projects retain absent optional fields.

**Export graded pattern set SVG** produces one large full-scale sheet containing all labelled sizes, two panels per size, individual 5cm calibration squares, cm measurements and mm physical dimensions. It exports committed rules/base only; apply/discard raw rule/base drafts and finish other fields/gestures first. The base's explicit seam/hem allowances accompany every size, with separate cut/stitch labels. There is no graded-set page tiling, standardized grading system, body fitting or manufacture validation. Review the chosen increments and validate each size physically before production. [Grading evidence](docs/2026-10-09-size-grading.md) records checks and failure repairs.

The grading milestone passes the complete52unit/62native-browser local gate with lint/typecheck/build, including actual original photo/sketch retention, malformed import refusal and full physical size-set downloads. Hosted publication is tracked in issue168.


Milestone #182 adds saved cutting allowances. The complete local gate passes 55 unit and 65 production Chromium cases plus lint/typecheck/build; see [cutting allowance evidence](docs/2026-10-11-cutting-allowances/README.md). Physical toile evaluation and the broader professional garment-design vision remain ACTIVE.

Milestone #183 adds home-printer A4/US Letter base-pattern tiling. Native checks verify the real downloaded HTML, physical SVG calibration and actual Chromium PDF page dimensions/counts, with complete artwork/history and raw drafts retained. See [tiled print evidence](docs/2026-10-11-tiled-print/README.md). Physical printer output and toile acceptance remain untested.

## Fabric drape simulation (#219)

**Fabric drape simulation** shows how the applied skirt actually hangs.

1. Choose a **Fabric**. The choice is saved with the skirt as one undoable edit and kept when you change the pattern.
2. **Simulate drape** runs a cloth solver in a background worker, taking about 2–3 s in desktop Chromium. **Cancel simulation** stops it without changing anything.
3. The shaded view shows the settled folds. Rotate it with the buttons or the arrow keys, optionally showing the body proxy.
4. **Export draped OBJ** writes the settled surface in centimetres, with front and back panel groups.

How it works:
- **Mesh.** Both panels are meshed directly from their flat annular-sector patterns, 24 rows down the slant and 48 columns per panel. Every rest length is therefore a real fabric distance, and the assembled cone starts unstretched.
- **Solver.** An extended position-based (XPBD) solver settles the cloth under gravity for 4 simulated seconds. It uses stretch, shear and two-segment bending constraints, and long-range warp attachments for woven fabric that barely stretches. The waist row is held at the waistline.
- **Body.** The fabric is kept outside a body surface of revolution: your entered waist, hip and waist-to-hip depth, constant below the hip (legs together). With no profile saved, it assumes a waist 2 cm smaller than the garment and a hip 20 cm larger, and says so.
- **Results.** The panel reports:
  - folds around the hem;
  - hem flare relative to the rigid cone;
  - hem drop;
  - largest fabric stretch;
  - closest approach to the body.

| Fabric preset | Weight | Character |
| --- | --- | --- |
| Chiffon | 50 g/m² | very low bending stiffness |
| Cotton poplin | 120 g/m² | |
| Linen | 190 g/m² | |
| Denim | 380 g/m² | very stiff |

These are **approximate typical values with relative stiffnesses, not measured fabric data** (professional tools calibrate from fabric test instruments). The simulation has no friction, wind, motion, collisions of the fabric with itself, or thickness beyond a 4 mm contact offset. On the same skirt, softer fabric consistently forms more and narrower folds and hangs closer to the body; see [drape verification](docs/2026-10-13-drape.md). Validate drape and fit with a physical toile.

## Entered body measurement comparison

Enable **Use body measurements**, enter waist and hip circumferences plus the vertical **waist-to-hip depth**, then **Apply body measurements**. The optional profile travels with JSON backups, autosave and Undo/Redo. Uncheck and apply to remove it; Discard restores the committed profile. Legacy concepts have no profile. Finish other raw concept, pattern and grading edits before applying a profile.

The linked preview adds an open, two-ring circular measurement proxy at the skirt waist and entered hip depth. Waist and hip differences are garment circumference minus entered body circumference, in centimetres. The hip comparison interpolates the rigid skirt's circumference at that vertical depth; a skirt ending above it reports no comparison rather than extrapolating. Negative, zero and positive values describe geometry only. Display rings use 32 straight segments around nominal circular measurements; they are not anatomical body scans or exact polygon perimeter measurements. The two-decimal readout does not establish measurement accuracy or suitable wearing ease.

**Transparent garment comparison** and rotation are view-only. Full-size/tiled pattern SVGs and construction OBJ remain garment-only, independent of the profile or transparency. The proxy does not model anatomical shape, cloth drape, collisions, contact, comfort, mobility or manufacturing fit. Personalized avatars and validated cloth/body fitting remain ACTIVE work. Supported entered ranges: waist 50–180cm, hip 50–220cm, depth 5–40cm; other ranges require a future validated geometry design. See [#201](https://github.com/twangyal/projects-monorepo/issues/201).

[Body comparison evidence](docs/2026-10-12-body-measurements.md) records the local verification and physical limits.

When a profile and grading rule are saved, the **Committed relative sizes** table also shows waist and hip differences for every derived size. Values are garment minus entered body circumferences in cm; negative means smaller, zero equal, positive larger. Each size independently reports **Not reached** when it ends above the entered hip depth. Profile edits and history update every row; removing the profile restores the original garment-only columns. The focusable table scrolls horizontally on narrow screens. These comparisons are geometry only and do not recommend a comfortable size or validate physical fit. Graded pattern exports retain their original garment-only bytes. Tracked in [#202](https://github.com/twangyal/projects-monorepo/issues/202).
