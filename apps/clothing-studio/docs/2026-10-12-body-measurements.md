# Entered body measurement comparison — #201

This milestone adds an optional saved waist/hip/depth profile to the complete concept and compares it with the linked rigid skirt construction. It moves toward personalized fitting without claiming anatomy reconstruction or physical fit acceptance.

## Model and geometry

Body data has exactly three enumerable numeric data fields: waist 50–180cm, hip 50–220cm, vertical hipDepth 5–40cm. Non-finite values, extras, accessors and non-plain objects are rejected; validation returns a detached copy. Absence is preserved for legacy concepts.

The open proxy uses 32 straight segments on each nominal circular circumference, +Y downward, at waist 0 and entered hipDepth. It is a measurement proxy, not an anatomical avatar. Readouts use nominal circular measurements, not the inscribed polygon perimeter. Waist difference is garment waist minus entered waist. Hip circumference interpolates garment waist→hem at the entered vertical depth using the existing slant-derived frustum height. A skirt shorter than that depth reports no hip comparison; no extrapolation is made. Positive/zero/negative differences describe geometry only, not safe or comfortable ease.

Transparent garment comparison and yaw are view-only. Original garment pattern SVG, tiled patterns and OBJ exports exclude body geometry. Backups, autosave, Undo/Redo and whole-project import retain/reset the profile alongside the original concept. Pattern, grading and unrelated raw drafts must be resolved before applying a profile; blocked pointer/label activation preserves focused input before blur.

## Executed verification

On 2026-10-12, Node 24 and Chrome for Testing headless shell 153.0.8010.12:

- `npm run check`: **66 unit tests**, ESLint, TypeScript and production Vite build passed.
- `CHROMIUM_PATH=… npm run test:browser -- --workers=2`: **73 browser tests passed**.
- Four new browser cases cover real JSON/SVG/OBJ download bytes, body proxy/transparency, profile removal, short skirt, Undo/Redo, autosave reload, identical-profile backup import replacing abandoned raw fields, invalid numeric input, keyboard Apply, focused placement-label refusal and 390px containment.
- Native mobile screenshots of the controls and translucent shell were inspected; controls fit and the proxy is visible.
- Independent source review found no correctness blockers.

Test setup initially failed because an old temporary browser path no longer existed and a different cached executable crashed. The official headless shell was restored before executed browser verification. A test oracle initially clicked Backup after correctly refused label activation, thereby intentionally blurring and committing its valid placement draft. The oracle now downloads without moving focus to inspect the preserved committed snapshot. No product fix was needed for that test failure.

These are local checks, not a hosted CI claim. Physical measurements, anatomical accuracy, cloth contact, fabric simulation, comfort, mobility, sizing standards, sewing and manufacturing have not been validated. The full project remains ACTIVE; project #8 remains skipped.
