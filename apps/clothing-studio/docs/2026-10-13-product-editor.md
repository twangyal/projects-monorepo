# 3D product editor — issue #226

## Intended outcome and gap

The owner wants Clothing Studio to be "something like" Fabra; see [the research](2026-10-13-fabra-research.md). Fabra's defining loop is to pick a product or template, style its parts in real-time 3D by dragging materials, colors, prints and graphics, see the result at real size, and export. Before this milestone, Clothing Studio had a 2D tee illustration with one color and texture, and a separate measured skirt. This milestone is roadmap step 1.

## What was built

- **Product model** (`src/product.ts`):
  - a base tee with chest, length, sleeve and neckline measurements;
  - five named parts (front, back, left and right sleeve, neck rib), each with a library fabric, a color and an optional print (motif, color, repeat size and layout);
  - up to one artwork per side (a PNG/JPEG/WebP data URL with its pixel size and a cm width and position);
  - strict validation, four templates, and the flat pattern pieces;
  - stored as an optional `product` field on the project.
- **Library:**
  - 8 fabrics with gsm and composition, ready for the tech-pack BoM;
  - 6 print motifs;
  - repeat layouts: standard, half drop, half brick and mirror (`motifPlacements`).

  Procedural tiles (`src/fabric-texture.ts`) cover a known number of centimetres, so the 3D UVs (cm) and the pattern SVG fills (cm user units) show fabrics at real size.
- **3D construction** (`teeMesh`):
  - Front and back silhouettes are split into body and sleeve regions along the armhole seams. Each region is sampled every 1.5 cm on its edges and every 2 cm inside, then Delaunay-triangulated (delaunator).
  - Each vertex is lifted by `depth·√(1 − (1 − d/depth)²)`, where *d* is its distance from the joined seams (shoulders, sleeve edges, sides) and *depth* ≈ 0.85·chest/2π. Distances below 1e-6 cm snap to the seam.
  - The neck rib is a 2 cm band along the open 3D neck edge.
- **Rendering** (`src/product-3d.ts`):
  - three.js 0.186 with hemisphere, key and rim lights and orbit controls, lazily loaded as a separate chunk;
  - per-part standard materials with tile textures;
  - selection highlight, raycast picking for clicks and drops, and artwork decals projected onto the panel;
  - PNG renders and GLB export with named parts.
- **Editor** (`src/product-view.ts`):
  - template cards; a draggable, click-to-apply library;
  - a parts radio group, an inspector, measurements and artwork controls;
  - clickable linked pattern pieces and exports.

  Every change goes through the existing undoable project commit and autosave.

## Verification (local)

- **Unit tests** (`tests/product.test.ts`, 4 new):
  - templates validate, and 8 kinds of invalid designs are refused;
  - projects keep the design, and old projects stay valid;
  - pattern pieces follow the measurements, including the 15 cm V-neck dip;
  - the mesh faces correctly, with front z ≥ 0 and back z ≤ 0;
  - side-seam vertices sit exactly at z = 0 on both sides;
  - the open hem stands more than 5 cm off the seam plane;
  - each sleeve shares at least 15 exact vertices with the body along its armhole;
  - front UVs span the panel's flat width in cm;
  - a longer sleeve reaches more than 25 cm further;
  - repeat-layout offsets are exact.
- **Browser tests** (`tests/product.spec.ts`, 2 new, production Chromium with WebGL):
  - load the Ringer template;
  - drag denim onto the middle of the 3D front, which changes only the front;
  - select the back through its pattern piece and apply a polka-dot print with a 4 cm half-drop repeat;
  - change the chest to 120 cm, which makes the front piece 62×72 cm;
  - upload transparent artwork and place it at 12 cm wide and 8 cm below the shoulder;
  - check that the front PNG render is a real PNG with at least 400 of 4,096 sampled pixels painted;
  - check that the GLB has named nodes for all five parts and the front artwork;
  - Undo and Redo, then reload and get the exact saved design;
  - at 390 px with click-only styling, no horizontal overflow.
- `npm run check`: 74 unit tests, lint, typecheck and build. The full browser suite passes all 79 cases.
- Renders of the four templates from front, back and side were inspected during development. The early tube-and-cylinder mesh was replaced after inspection showed floating sleeves and a detached neck. A swapped sleeve/body classification and a jagged armhole were also found by inspection and fixed.

## Limits and next steps

- A styling model, not a fitted drape: no body, no fabric physics, and fabric weight and stretch do not change the shape. The side view is a simplified shell.
- One base product (a tee). Pattern pieces are simplified and not production patterns. There is no DXF.
- No trims and no tech pack yet. Those are roadmap step 2: BoM from these fabrics, points of measure, construction callouts, renders, and spreadsheet and print output.
- No repeat print maker for custom motifs yet, and no colorways or range plan (step 3).
- three.js adds a lazily loaded chunk of about 600 kB (153 kB gzipped).
