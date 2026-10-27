# Clothing Studio

A browser garment-design workspace. It is for designers who want to go from a template to a styled 3D garment, linked pattern pieces, a tech pack and a costed range. You pick a base product, style each part in real-time 3D, adjust measurements and construction, drape garments on an approximate body, and export renders, 3D models, patterns and spreadsheets. It runs entirely in the browser: no account, backend or paid service.

**Status:** ACTIVE — portfolio priority. Direction: [docs/PRODUCT_DIRECTION.md](../../docs/PRODUCT_DIRECTION.md)

## What works today

- **3D-first workspace.** The editable garment is the main screen. Focused tool sections cover Templates, Materials & prints, Artwork, Patterns & measurements, Body & drape, and Exports. Secondary dialogs open the tech pack, range plan, concept sketch and skirt construction. It works on desktop and phone.
- **Base products and templates**: T-shirt (Blank tee, Breton stripe, Ringer tee, Garden print), Crew sweatshirt, Pullover hoodie, Pull-on shorts, Straight trousers and Flared skirt. Modules switch hem shape, sleeve length and a chest pocket.
- **Part-by-part styling**: drag fabrics, colours and prints onto parts in 3D, or pick a part and click. The library has 8 fabrics with weight and composition, plus 6 print motifs. Repeat layout and size are in real centimetres. You can upload up to 6 of your own repeat motifs, and front/back artwork with size, position and rotation. **Pick colours from a photo** (a product shot, mood picture or swatch) reads its main colours on the device, middle of the picture first, and keeps them as swatches with the design (not the photo); **Use them on the garment** puts the main colour on the body and a contrasting one on trims and prints in one undoable step. Artwork can be placed by clicking the 3D garment.
- **Describe a style or a garment**: a local, deterministic text parser (no AI). For one part it reads about 700 colour names (fashion names plus everyday names from the xkcd colour survey, with modifiers such as pale or dusty), fabrics, motifs, stripe direction, repeat size and layout. **Apply to the garment** also reads the garment type (starting from its template), neckline, sleeve length, hem, chest pocket and fit ("oversized", "cropped", "wide leg"), and styles each named part from its own clause ("oversized navy hoodie with a cream hood and white cuffs"). It reports each change with its scope and lists what it could not apply, including unsupported construction accents such as red topstitching, which do not change the garment colour. One Undo restores the design.
- **Linked measurements and fit**: each sleeve is drafted from its armhole, its cap cut 3% longer than the armhole it is sewn into. Body measurements, plus points of measure (shoulder, neck, armhole, hem, sleeve opening, shoulder drop, back neck, rib/cuff/hem-band heights, hood size, pocket placement, waistband height). These update the 3D garment, pattern pieces and tech pack together. Pattern handles can be dragged or moved with the keyboard.
- **Drape on a body** for every base: tees, sweatshirts, hoodies, flared skirts, shorts and trousers. Each garment is sewn from its pattern pieces: a top's front and back meet at the shoulder and side seams, its sleeves are set into the armholes as tubes along the arms, and rib cuffs and hem bands, cut 15% shorter, gather the edges they finish. An XPBD cloth solver runs in a Web Worker on a measurement-driven body proxy, shown as a smooth mannequin (its torso, arms, neck and head or legs blended into one dress-form surface, drawn just inside the shape the cloth keeps clear of) (chest, optional waist/hip girths and chest depth for tops; waist and hip for skirts, which hang from a held waistline, and for shorts and trousers, whose elastic waistband gathers onto the body waist above two legs). Each fabric's weight, bending rigidity and stretch stiffness change the result: on the same tee and body, knits cling while linen and denim stand off the body with smoother hems. You can compare two fabrics side by side on any garment, skirts and trousers included, and save top body profiles by name. An optional body height sets torso heights, arm length and trouser leg length, and the drape then says where the hem, sleeves and trouser legs end on that body ("the hems would reach 6 cm below the floor"). Applied chest, waist, hip, depth and height measurements stay with each design through reload, backups, the saved library and Undo/Redo; typing stays as an unapplied draft.
- **Outfits**: in Body & drape, **Wear with** pairs a top with shorts, trousers or a skirt (a template or a saved design), kept with the design as a copy and undoable. The bottoms drape first on the outfit's body, with their waistline at the body's waist, then the top drapes over them, untucked, and the 3D view shows both. Automatic waist and hip girths are ones both garments fit. The bottoms do not feel the top's weight, and exports show the design on its own.
- **Fabric drape test** beside each part's fabric: the garment solver drapes a 30 cm disc of that fabric over an 18 cm support, like a Cusick drape tester, and reports its drape coefficient, its number of folds and its shadow seen from above, next to the range drape testers report for that construction.
- **Material experiments**: tensile, bending and membrane swatch comparisons with SI-unit result downloads. These are illustrative and do not feed the garment solver.
- **Tech pack**: bill of materials with estimated consumption, graded points of measure (XS–XL) with a diagram, and construction steps. Exports as Excel (`.xlsx`) or a printable self-contained HTML file.
- **Colorways and range plan**: up to 8 named colorways with renders, plus costing inputs (fabric price per metre, make, trims, print, retail). The range plan shows unit cost, margin and totals, and exports to Excel.
- **Exports**: front/back PNG renders, GLB 3D model (styled or draped), DXF pattern (AutoCAD R12, cut/sew/grain/text layers, 1 cm seam allowance), and a 1:1 printable SVG pattern.
- **Product flared skirt**: style its front/back with the same fabric, print and colour tools as tops. Apply waist, hem circumference and side-seam slant together; linked annular-sector patterns, a rigid 3D shell, tech pack, colorways/costing and PNG/GLB/SVG/DXF exports follow. Body & drape simulates it held at the waist using the shared product solver and fabric library. It has no waistband or closure, and size columns repeat the sample measurements without invented grading.
- **Measured two-panel skirt** (legacy dialog, preserved independently): waist/hem/slant input, optional waistband, seam and hem allowances, and linear size grading. Exports include a full-size SVG, A4/US Letter tiled print HTML, and rigid or draped OBJ. Its drape simulation uses the product solver and the fabric library; skirts saved with the earlier presets (chiffon, cotton, linen, denim) drape as their library equivalents. **Replace 3D product with this skirt** copies the applied waist, hem and slant to a product skirt with default linen styling in one undoable edit. Existing product body settings stay; legacy waistband, allowances, fabric, body and grading remain separately saved. The copy is not linked to later legacy edits.
- **Concept sketchbook** (dialog): tee sketching, a photo overlay, and PNG/SVG/JSON export. Edits have Undo/Redo; consecutive title/note typing in one focused field is one step, preserving earlier garment edits. Leaving the field or making another edit starts a new step. Valid text still autosaves locally as you type, and a library holds up to 12 saved named copies. Autosave reuses checked images while you edit, avoiding repeated decoding of unchanged photos and graphics.

## Known gaps

- Fabric properties (bending rigidity, membrane stiffness) are typical published values per fabric construction, not measurements of these fabrics. Bending is scaled per construction so each fabric's drape test lands mid-range in the coefficients reported for it (knits needed about three times their elastic rigidity, standing in for the yarn friction that holds real folds open); those ranges are approximate, and garments are not yet compared with reference drapes. Stretch depends on direction to the grain (wovens are soft on the bias, knits stretch more across), but the model is elastic: at garment-weight loads this barely changes the hang, and slow bias drop (creep) is not modelled. The 3D mesh is about 1.5-2 cm; a 1 cm mesh doubled the drape time without visibly changing the default tee, whose smooth hang comes from the T-posed proxy body rather than the mesh.
- Trouser legs are straight and posed apart, and a tight front rise shows as stretch at the crotch point rather than as drag lines. The legacy skirt dialog shares the solver and fabric library but keeps its own body proxy (a surface of revolution); body and project-conversion unification remain unfinished. Cloth-to-cloth contact is limited to an outfit's top resting outside its bottoms (a radial envelope round the body, so a top cannot be tucked in); a hood lies over the back as a single layer, without contact with the body panels. The body is a proxy, not a personalized avatar: an optional height sets its proportions from typical fractions, not a body scan.
- Every garment is meshed from its own pattern pieces, but those are simplified finished shapes, not graded production patterns: a top's front and back armholes are the same curve (real fronts scoop deeper), the sleeve cap is a fixed shape whose width is fitted to the armhole, and hood and pocket shapes use fixed proportions. The hood's neck edge is drafted to the neckline's length; the hood starts folded back and drapes down the back.
- Descriptions are read by a keyword parser with a fixed vocabulary. Small local language models were tried and not adopted (see the direction doc), and logos, graphics and construction details are not read.
- Outfits are two garments (a top over bottoms), without tucking, jackets or other layers. No darts or pleats, no sketch-to-garment or reference-to-garment flow, and no rendering beyond the WebGL preview.
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
- `src/drape-test*.ts`: the fabric drape test (Cusick geometry) in the garment solver, its worker and its panel.
- `src/drape*.ts`, `src/construction*.ts`, `src/grading*.ts`, `src/print-pattern.ts`: skirt drape, construction, grading and tiled printing.
- `src/techpack.ts`, `src/range.ts`, `src/pattern-export.ts`: tech pack, range plan and costing, DXF/SVG export.
- `src/style-prompt.ts`, `src/design-prompt.ts`: description parsers for one part and for the whole garment.
- `src/tensile*.ts`, `src/bending*.ts`, `src/membrane*.ts`: swatch experiments (each with its worker).
- `src/model.ts`, `src/storage.ts`, `src/design-library*.ts`, `src/top-body-profiles*.ts`, `src/media.ts`: project model and validation, persistence, image admission.
- `tests/`: unit tests (`*.test.ts`) and Playwright specs (`*.spec.ts`).

## Data & privacy

- Everything stays in the browser. The current project autosaves to IndexedDB (`clothing-studio`), and saved named copies go to a second IndexedDB database (`clothing-studio-designs`). Saved body profiles are kept in `localStorage`. Unapplied drafts and Undo history last only for the session.
- Uploaded photos are resized to at most 1200 px and re-encoded as JPEG without metadata. Motifs and artwork are size-checked before decoding. Nothing is uploaded.
- Saved designs, backups and body-profile exports contain your photos, artwork and measurements. Clearing browser data removes the local library, so keep downloaded JSON backups of work you want to keep. Several tabs share one autosave, and the last write wins.
