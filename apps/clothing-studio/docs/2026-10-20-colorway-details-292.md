# Saved colorway details — #292

The range-plan workflow previously allowed saving a colorway, replacing its styles and changing its quantity on blur, but offered no way to rename it. Designers can now revise saved names and planned quantities together, review the drafts and choose one **Apply colorway details** action. **Discard colorway details** restores only this group. Applied data drives the table, labels, thumbnails, backups, reload and Excel. Styling, artwork, colorway identities and the saved schema are unchanged.

Names retain the existing40-character nonempty plain-text validation. Quantities retain the existing integer0–1,000,000 limit; blank/bad numeric input refuses. All rows validate before committing, so one invalid card cannot partially update another. One Apply is one history entry; a no-op preserves Redo. Other draft groups remain untouched. Closing a contextual dialog or styling another part keeps these drafts; replacement/history and deletion refuse until they are finished or discarded. Global Discard still works. Exports include committed data only.

The existing draft map tracks stable colorway field IDs. Cards are rebuilt only when committed identities/names/quantities change; ordinary style/image/drape redraws keep the input nodes mounted, preserving actual focus, selection and raw values. Nondraft synchronization restores committed values on Discard/no-op without events. Thumbnail rendering continues independently and can update saved styles without rebuilding inputs.

## Verification

- The first native test failed while looking for the missing saved-name input on the original application.
- The initial implementation passed the two editing/data tests. Independent review identified a focus/caret gap caused by unconditional card DOM replacement.
- A held real motif decode then reproduced that gap: the raw name survived but the field was no longer focused after redraw. Retaining stable card nodes makes the same test pass with exact selection[4,7].
- All5 focused native cases (four new plus the original range workflow) pass22.6s, covering batch names/quantities, unchanged complete styling, backups, Undo/Redo, actual two-colorway renders, Excel names/totals, reload, invalid values, other-group isolation and async focus. The additional focused phone-dialog case and complete-suite results are recorded below after execution.
- The first portable local Chromium file was truncated and could not start. Re-extracting its complete existing Brotli payload restored execution; adjacent SwiftShader libraries were then needed for real WebGL thumbnail rendering. The original range test first reported naturalWidth0 in that incomplete runtime; it passes unchanged after runtime repair. Production code and its rendering assertions were not weakened. Overlapping initial local runs also collided in their shared trace-output directory; subsequent extra focused runs use separate output paths.
- Desktop and390px phone contextual-dialog screenshots were inspected. The garment thumbnail, fields and controls fit their existing layout, with deliberate vertical scrolling on phone.

`npm run check` passes all161unit tests, lint, TypeScript and production build. Run all browser cases with `npm run test:browser`; the default CI Chromium remains the supported hosted gate. The local portable Chromium143 exercise is a separate executed observation. Combined browser/hosted verification is pending at this record's initial creation.

No physical fit, costing quote, manufacturing or intended-user acceptance is claimed. Clothing remains ACTIVE against the full professional garment-design direction. Native PPF research and all frozen captures are untouched by this UI milestone. No PR was requested or created; project #8 remains skipped.
