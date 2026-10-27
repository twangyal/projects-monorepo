# Clothing Studio

A browser garment-design workspace. It is for designers who want to go from a template to a styled 3D garment, linked pattern pieces, a tech pack and a costed range. You pick a base product, style each part in real-time 3D, adjust measurements and construction, drape tops on an approximate body, and export renders, 3D models, patterns and spreadsheets. It runs entirely in the browser: no account, backend or paid service.

**Status:** ACTIVE — portfolio priority. Direction: [docs/PRODUCT_DIRECTION.md](../../docs/PRODUCT_DIRECTION.md)

## What works today

- **3D-first workspace.** The editable garment is the main screen. Focused tool sections cover Templates, Materials & prints, Artwork, Patterns & measurements, Body & drape, and Exports. Secondary dialogs open the tech pack, range plan, concept sketch and skirt construction. It works on desktop and phone.
- **Base products and templates**: T-shirt (Blank tee, Breton stripe, Ringer tee, Garden print), Crew sweatshirt, Pullover hoodie, Pull-on shorts, Straight trousers and Flared skirt. Modules switch hem shape, sleeve length and a chest pocket.
- **Part-by-part styling**: drag fabrics, colours and prints onto parts in 3D, or pick a part and click. The library has 8 fabrics with weight and composition, plus 6 print motifs. Repeat layout and size are in real centimetres. You can upload up to 6 of your own repeat motifs, and front/back artwork with size, position and rotation. Artwork can be placed by clicking the 3D garment.
- **Describe a style**: a local, deterministic text parser (no AI). It covers colour names, fabrics, motifs, stripe direction, repeat size and layout, applies to one part or all parts, and lists details it could not apply, including extra colours and unsupported construction accents such as red topstitching. These accents do not change the garment colour.
- **Linked measurements and fit**: body measurements, plus points of measure (shoulder, neck, armhole, hem, sleeve opening, shoulder drop, back neck, rib/cuff/hem-band heights, hood size, pocket placement, waistband height). These update the 3D garment, pattern pieces and tech pack together. Pattern handles can be dragged or moved with the keyboard.
- **Drape on a body** for tees, sweatshirts and hoodies. An XPBD cloth solver runs in a Web Worker on a measurement-driven body proxy (chest, optional waist/hip girths and chest depth). Each fabric's weight, bending rigidity and stretch stiffness change the result: on the same tee and body, knits cling while linen and denim stand off the body with smoother hems. You can compare two fabrics on the same garment, and save body profiles by name. Applied chest, waist, hip and depth measurements stay with each design through reload, backups, the saved library and Undo/Redo; typing stays as an unapplied draft.
- **Material experiments**: tensile, bending and membrane swatch comparisons with SI-unit result downloads. These are illustrative and do not feed the garment solver.
- **Tech pack**: bill of materials with estimated consumption, graded points of measure (XS–XL) with a diagram, and construction steps. Exports as Excel (`.xlsx`) or a printable self-contained HTML file.
- **Colorways and range plan**: up to 8 named colorways with renders, plus costing inputs (fabric price per metre, make, trims, print, retail). The range plan shows unit cost, margin and totals, and exports to Excel.
- **Exports**: front/back PNG renders, GLB 3D model (styled or draped), DXF pattern (AutoCAD R12, cut/sew/grain/text layers, 1 cm seam allowance), and a 1:1 printable SVG pattern.
- **Product flared skirt**: style its front/back with the same fabric, print and colour tools as tops. Apply waist, hem circumference and side-seam slant together; linked annular-sector patterns, a rigid 3D shell, tech pack, colorways/costing and PNG/GLB/SVG/DXF exports follow. The shell has no waistband, closure or drape, and size columns repeat the sample measurements without invented grading.
- **Measured two-panel skirt** (legacy dialog, preserved independently): waist/hem/slant input, optional waistband, seam and hem allowances, and linear size grading. Exports include a full-size SVG, A4/US Letter tiled print HTML, and rigid or draped OBJ. Its drape simulation offers four fabric presets.
- **Concept sketchbook** (dialog): tee sketching, a photo overlay, and PNG/SVG/JSON export. Edits have Undo/Redo; consecutive title/note typing in one focused field is one step, preserving earlier garment edits. Leaving the field or making another edit starts a new step. Valid text still autosaves locally as you type, and a library holds up to 12 saved named copies. Autosave reuses checked images while you edit, avoiding repeated decoding of unchanged photos and graphics.

## Known gaps

- Fabric properties (bending rigidity, membrane stiffness) are typical published values per fabric construction, not measurements of these fabrics, and the model is isotropic (no warp/weft/bias). Drape is not compared against reference drapes. The 3D mesh is about 2 cm, so folds finer than that (soft jersey) cannot form.
- Product bottoms are not draped. The legacy skirt dialog still has its separate simulation, fabric presets and body proxy; solver/body and project-conversion unification remain unfinished. There is no cloth-to-cloth contact, so a hood lies over the back as a single layer. The body is a proxy with assumed heights and limbs, not a personalized avatar.
- 3D garments are styling shells built from measurements, not simulated from sewn pattern pieces. Patterns are simplified finished shapes, not graded production patterns. Hood and pocket shapes use fixed proportions.
- Describe a style is a keyword parser. AI interpretation has not been built.
- No layered outfits, darts or pleats, no sketch-to-garment or reference-to-garment flow, and no rendering beyond the WebGL preview.
- Consumption, grading, construction steps and costing defaults are starting values. Confirm them with a marker, supplier quotes and a fit sample.
- An evaluation of the PPF Contact Solver did not lead to adopting it (see the direction doc). The app uses its own XPBD solver.

## Run locally

Prerequisites: Node.js 22.18+ (`engines`; CI uses 24) and npm. You need a current browser with WebGL, IndexedDB, Canvas and `createImageBitmap`. Without WebGL, pattern editing still works.

```sh
cd apps/clothing-studio
npm ci
npm run dev        # Vite dev server on 127.0.0.1; open the printed URL
```

Production build: `npm run build`, then `npm run preview`. The `dist/` output can be served by any static server. The production app makes no network requests.

## Verify

```sh
npm test               # Node unit tests (tests/*.test.ts)
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run build          # typecheck + Vite production build
npm run check          # test + lint + build
npx playwright install chromium
npm run test:browser   # builds with the storage test harness, serves a preview on port 4186, runs tests/*.spec.ts
```

Use `CHROMIUM_PATH=/path/to/chromium` to run against an existing browser, and `CLOTHING_TEST_PORT` to change the port. CI: `.github/workflows/clothing-studio.yml` (`npm run check`, then the browser tests).

## Project layout

- `src/main.ts`, `src/workspace.ts`: app shell and the focused-workspace navigation.
- `src/product.ts`, `src/product-skirt.ts`, `src/product-view.ts`, `src/product-3d.ts`: base products, templates, fabrics and measurements; the product editor UI; the three.js garment.
- `src/garment-drape.ts`, `src/garment-drape.worker.ts`, `src/garment-comparison*.ts`: top draping and fabric comparison.
- `src/drape*.ts`, `src/construction*.ts`, `src/grading*.ts`, `src/print-pattern.ts`: skirt drape, construction, grading and tiled printing.
- `src/techpack.ts`, `src/range.ts`, `src/pattern-export.ts`: tech pack, range plan and costing, DXF/SVG export.
- `src/style-prompt.ts`: Describe a style parser.
- `src/tensile*.ts`, `src/bending*.ts`, `src/membrane*.ts`: swatch experiments (each with its worker).
- `src/model.ts`, `src/storage.ts`, `src/design-library*.ts`, `src/top-body-profiles*.ts`, `src/media.ts`: project model and validation, persistence, image admission.
- `tests/`: unit tests (`*.test.ts`) and Playwright specs (`*.spec.ts`).

## Data & privacy

- Everything stays in the browser. The current project autosaves to IndexedDB (`clothing-studio`), and saved named copies go to a second IndexedDB database (`clothing-studio-designs`). Saved body profiles are kept in `localStorage`. Unapplied drafts and Undo history last only for the session.
- Uploaded photos are resized to at most 1200 px and re-encoded as JPEG without metadata. Motifs and artwork are size-checked before decoding. Nothing is uploaded.
- Saved designs, backups and body-profile exports contain your photos, artwork and measurements. Clearing browser data removes the local library, so keep downloaded JSON backups of work you want to keep. Several tabs share one autosave, and the last write wins.
