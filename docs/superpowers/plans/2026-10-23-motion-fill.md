# Motion authored shape fills — #310

Native execution under the owner's autonomous/noninteractive instruction.

Outcome: edit optional solid interiors in Edit strokes, animate held filled artwork, and export the same committed shapes. Existing schema2 gains an optional strict #RRGGBB fill field; absent fill preserves old bytes/appearance. Older readers may reject filled files. Canvas nonzero polygon fill implicitly closes only the interior; the original open outline stays unchanged. Degenerate paths have no interior. This is a polygon fill, not flood-fill or semantic recognition.

Approach: extend existing appearance Apply/Discard and history ownership rather than add a separate mode or rasterize artwork. Share the stroke paint kernel across preview/export, guides and thumbnails. Preserve fill through copy and path edits. Geometric in-betweens interpolate RGB fill only when both paired endpoints have fill; mixed filled/unfilled pairs refuse before proposal. Filled interiors must be clickable with nonzero winding and paint-order selection.

- [x] Observe meaningful model/edit/hit/tween unit failures before production edits.
- [x] Implement optional validation, atomic appearance edit, shared paint kernel and interior hit selection. Retain strict malformed/accessor/budget admission.
- [x] Observe missing fill-control browser failure, then extend existing raw appearance lifecycle with Enable fill and Fill color.
- [x] Validate interpolation/proposal admission, guides and thumbnails. Native pixels and decoded PNG/GIF, backups/reload, Undo/Redo, raw draft/navigation guards and phone keyboard flow.
- [ ] Full project checks, independent read-only review, fix verified regressions, documentation/roadmap, connected-GitHub commits and issue completion based on actual CI.

Review focus: accidental fill loss through clone/admission/tween; stale draft commits; filled interior hit order; fill/outline closure semantics; no-fill rendering changes; unsupported mixed endpoint styles; private/shared snapshots preserving complete admitted data.
