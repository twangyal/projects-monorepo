# Fabra research and Clothing Studio roadmap (2026-10-13)

The owner asked for Clothing Studio to become "something like" [Fabra](https://www.fabra.com/). The research below covers what Fabra is and does, how Clothing Studio compares, and the plan to close the gap.

## Method and limits

`fabra.com` and most articles about it could not be fetched from the development environment (DNS was blocked), so this research is based on search results. Those results quote Fabra's own pages:
- the homepage;
- the *What's in Fabra V2* launch article;
- the *Range Plan*, *Product Library* and *Repeat Print Library* feature pages;
- the FAQ.

They also quote launch coverage (SmartCompany, Business News Australia, Capital Brief, Forbes Australia), founder interviews (Fashion Forward with Christabel, The Interline), an independent newsletter comparison with CLO 3D, and a design agency case study.

Most sources are Fabra's own marketing or investor material. No independent hands-on review of sampling accuracy was found, and the only production-sample claim is a sponsored post. Treat feature details as Fabra's claims.

## What Fabra is

Fabra is a browser-based, web-native 3D product design, simulation and collaboration tool for fashion. It is pitched as "the Canva of fashion product design" for small brands, solo creators and indie designers who cannot justify desktop CLO or Browzwear licences and training. The company was founded in Sydney in 2023 by Luke Grana, Gloria Yu and Nick Manks, who previously worked on Canva's design platform. It raised a US$2.8M pre-seed in 2025, launched a public beta, then V2, and planned general availability with more categories in early 2026.

Its promise runs "from idea to production-ready specs": design in the browser, with no powerful laptop or technical training, and the tech pack generates automatically.

### Core workflow (as described)

1. **Start from the product library.** A *product* is a blank base garment with no materials, colors, graphics or prints. A *template* is a product with pre-designed materials, colors, graphics and/or prints that you remix. Products are modular and built by Fabra's in-house designers, and elements such as sleeve length are customizable.
2. **Design in real-time 3D.**
   - Drag and drop materials, colors, prints and graphics from an asset library ("thousands of pro-curated materials, color palettes, prints, and graphics") onto the garment.
   - Trims (buttons, zips, labels) are part of the design and the bill of materials.
   - The preview updates in real time, and sharing is collaborative and cloud-based.
3. **Prints.** The Repeat Print Library and Repeat Print Maker (beta) build seamless tiles from library motifs, uploads or a pen tool, with *standard, half-brick, half-drop and mirror* repeats.
4. **Pattern editing (beta).**
   - The 2D pattern view is linked to the 3D garment: adjust seams, curves and measurements, then simulate fit.
   - Patternmakers can import DXF patterns or draft from a blank canvas.
5. **Tech pack (automatic, kept in sync with the design).** It contains:
   - a cover sheet;
   - materials and trims in a bill of materials (BoM), filled by dragging materials and trims in;
   - measurements drawn on the garment;
   - construction callouts;
   - 3D previews.

   It exports to Excel or is shared as a cloud link. Tech packs are a paid feature.
6. **Range plan.** Styles and colorways sit side by side on one board, "the way real collections get merchandised", with a costing table kept in sync.
7. **AI.**
   - Generate materials and trims from a text prompt.
   - Export AI-generated flat-lay and on-model images, from a described model or an uploaded reference.
   - The founders describe AI as an assistant still being expanded, not the core.
8. **Pricing.**
   - Free: 3 designs and 300 AI credits.
   - Starter: about US$15–25 a month, with unlimited designs, tech packs and one range board.
   - Pro: US$50 a month, with more credits, 30 tech pack downloads a month, brand kits and unlimited boards.

Fabra plans WebGPU and real-time material simulation next. The independent comparison notes that experimental or avant-garde combinations are constrained by its template-and-module approach. That is the trade-off for its simplicity.

## Where Clothing Studio stands

| Fabra capability | Clothing Studio today |
|---|---|
| Product library of base products and templates | One parametric T-shirt concept (2D) and one measured skirt pattern |
| Real-time 3D garment styled by part | 2D silhouette with one color and texture; rigid SVG skirt shell; skirt drape simulation |
| Asset library: materials, palettes, prints, graphics, trims | Three procedural textures, free colors, freehand sketch |
| Repeat print maker | None |
| Linked 2D patterns and 3D, measurements, DXF | Measured skirt pattern linked to its 3D shell, relative grading, body measurements, drape; no DXF |
| Automatic tech pack (BoM, POM, construction, previews, Excel) | None (pattern SVG, OBJ and JSON exports only) |
| Colorways and range plan with costing | None |
| AI materials and on-model images | None; paid image APIs are deferred unless spending is authorized |

Clothing Studio is already deeper than Fabra's public beta in places: real measured patterns, cloth drape and fit comparison. But it lacks Fabra's defining, approachable loop: **pick a product, style its parts in 3D, get a tech pack**.

## Roadmap

Each milestone delivers a usable end-to-end slice. All of it stays local and account-free, and paid services are excluded.

1. **3D product editor** (done in #226).
   - A product library: base T-shirt plus remixable templates.
   - The garment is built from named parts (front, back, two sleeves, neck rib), rendered in real-time WebGL with orbit view.
   - A library of fabric materials (procedural and physically scaled), colors and repeat prints.
   - Drag a swatch onto a part in 3D, or select the part and pick.
   - Artwork placement on front and back.
   - The linked 2D pattern-piece view shows the same parts and fabrics.
   - It is saved in the project, with undo, and exports PNG renders.
2. **Automatic tech pack** (done in #227; see [verification](2026-10-13-tech-pack.md)).
   - Cover with front and back renders.
   - BoM generated from part materials, colors, prints, artwork and trims.
   - Points of measure from the garment dimensions, graded across sizes.
   - Construction callouts by seam.
   - Printable HTML/PDF and spreadsheet export, synced to the design.
3. **Repeat print maker and colorways/range plan** (colorways, range plan and costing done in #230; repeat print maker from uploaded motifs done in #231).
   - Tile motifs or uploads in standard, half-brick, half-drop and mirror repeats.
   - Duplicate designs as colorways side by side.
   - A costing table built from material consumption estimated from pattern areas.
4. **More base products and modular options** (sweatshirt and hoodie done in #234; hem shape, chest pocket and sleeve-length modules done in #237; pull-on shorts and trousers done in #239).
   - Hoodie, sweatshirt, shorts and trousers, plus the existing skirt.
   - Modules such as sleeve length, neckline, hem and pocket.
5. **Pattern editing in the product editor** (DXF and printable 1:1 pattern export with seam allowance done in #235; editable points of measure driving the pattern, 3D and tech pack, with draggable handles on the front piece, done in #243; tops draped on a body proxy in the 3D view done in #248; free-form outline editing, draping bottoms and DXF import still to do).
   - Edit piece measurements and seams with live 3D, building on the skirt pattern work.
   - Drape the T-shirt.
   - DXF import and export.
6. **Assistive generation** (describing a style in words, read by a local deterministic interpreter, done in #245).
   - Prompt-to-material and prompt-to-print using local procedural generators.
   - Model-based images only with a genuinely free provider or owner-authorized spending.
