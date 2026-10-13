# Recoverable complete-project budget — #247

Continues the owned-upload integration candidate `e519b097`. A fresh schema-level reproduction admitted an 8,102,550-byte aggregate graph, then refused its canonical backup at the existing 6 MiB cap. Individual product asset limits were insufficient. These fake raster strings exercise model admission only, not image decoding or visual validity.

Complete-project validation now bounds the detached canonical, pretty-printed UTF-8 JSON before admitting it to history or storage. The product editor validates the whole candidate before calling its parent commit or reporting success, so a budget refusal retains current work and displays the cap error. The existing individual image and JSON limits remain intact. Compact imports must also fit the canonical export format; otherwise they could be opened but not backed up using the app's own exporter.

All three new regressions failed before repair (missing exception): aggregate admission beyond the cap, four bytes beyond the exact canonical cap, and history replacement by an oversized candidate. They pass after repair. The exact 6 MiB fixture includes a Unicode name, serializes and reopens with its complete graph; rejected commits retain current work and its redo branch.

All 93 unit tests, ESLint, TypeScript and ordinary production build pass locally on 2026-10-13. Independent read-only review found no blockers or recursion: canonical validation precedes history mutations, and editor update/module handlers catch refusal before success notices. Validation now serializes on history getters and repeats during admission; near-cap interactive performance is not profiled. Native and hosted totals are recorded in #247 after execution/publication, without claiming image/physical checks from the schema fixtures.

Remaining original integration blockers: raw product draft retention, immutable tech-pack renders, and raster/header/decode admission. Small artwork below 128px also hit an existing upload admission defect while preparing the ownership tests; repair that alongside raster admission. Canonical Clothing remains unchanged; #247 stays open, Clothing ACTIVE and project8 skipped.
