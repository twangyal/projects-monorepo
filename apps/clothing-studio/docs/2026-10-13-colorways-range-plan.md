# Colorways and range plan — issue #230

## Intended outcome and gap

Fabra-style tools let a designer turn a style into colorways, compare them side by side and plan a range with costs and margins. This is roadmap step 3 in the [Fabra research](2026-10-13-fabra-research.md). After #226 and #227, a Clothing Studio design had one styling and no costing, so a range had to be worked out elsewhere by hand.

## What was built

- **Model** (`src/product.ts`). Both new fields are optional and validated:
  - `colorways` (at most 8): an ID, a name of up to 40 characters of plain text, a full set of part styles validated like the design's own, and whole planned units from 0 to 1,000,000;
  - `costing`: the currency, the retail, make, trims and print-per-artwork amounts (each 0–10,000), and fabric prices per metre for library fabrics only.

  Older projects without these fields stay valid.
- **Costing** (`src/range.ts`, pure). `costRow` prices each colorway:
  - fabric cost uses `fabricUsage`, the tech pack's consumption estimate (pattern area × 1.15, as linear metres at 150 cm), now shared by both;
  - the unit cost adds the fabric cost, trims, print × the number of placed artworks, and make;
  - margin is (retail − unit cost) / retail;
  - totals use the unit cost rounded to the cent, so the plan adds up.

  `rangePlan` covers all colorways, or the current design when none is saved. `rangePlanXlsx` reuses the tech pack's dependency-free workbook writer, now a generic `xlsx(sheets)`.
- **Editor** (`src/product-view.ts`):
  - save, show, update and delete colorways, and set units, each as one undoable edit;
  - costing inputs, with price fields only for the fabrics in use;
  - the live range table and the Excel download.

  Thumbnails are front PNG renders from a second, detached `ProductScene`, cached by garment look.

## Verification (2026-10-13)

- `npm run check`: 80 unit tests, including 3 new ones:
  - validation of every new field, with a backwards-compatibility check;
  - the costing arithmetic against `fabricUsage`, denim sleeves costing more, artwork print cost, units × cost, retained default prices, a retail of 0 giving no margin, and IDs reused after a deletion;
  - workbook sheets, escaping and numeric units.

  Lint and the production build also pass.
- Native Chromium: **all 81 cases pass**. The new end-to-end case covers:
  - two colorways saved with distinct, decoded renders;
  - units and EUR costing reflected in the table (€40.00 retail, 150 units, €6000.00 revenue) and in the saved project;
  - "Show in editor" restyling the garment, and deletion that can be undone;
  - the Excel download, survival across a reload, and a 390 px width without horizontal scrolling.
- A three-colorway screenshot was reviewed (ecru/red, ecru/navy, all-over stripe).

## Limits

- Prices, make and trims are placeholders until a designer enters quotes. Consumption is an area estimate, not a marker.
- Costing is per garment for the single tee base. Size mixes, MOQs, duty and freight are not modelled.
- All colorways share the garment's measurements and artwork. A colorway changes only part fabrics, colors and prints.
