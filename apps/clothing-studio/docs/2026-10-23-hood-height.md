# Editable hood side height — #315

The template's hood previously used a fixed32cm side-panel height. The existing Fit workflow now accepts optional hoodie-only hoodHeight from24–44cm; absent or explicit32 retains the original pattern/mesh/UV output. It is a side-pattern base-to-top measure without allowances, not measured physical head clearance. The existing loft retains its3cm crown addition and neck-ring assumptions. No solver, frozen research packet or physical-fit claim changes.

The same dimension reaches the pattern, actual3D loft/UV, cloth rest, tech-pack K/assembly text, estimated material use and current exports. Other parts and attributes stay unchanged. Apply/Discard/Reset/history and existing captured export ownership remain; old app versions may refuse backups containing the optional field.

## Verification checkpoint

Three domain regressions first failed on unsupported Fit fields, then pass for actual pattern height, per-row loft displacement, unchanged X/Z and non-hood geometry, UVs, tech-pack method/value, JSON round trip, exact32 defaults, cloth rest propagation, consumption growth and bounds/garment refusal. The first attempt could not load the cached Delaunator dependency; an exact-lock cached dependency tree was then used before the actual RED.

Native RED reached the absent field in both desktop/phone flows. A prior test attempt could not start because the new domain test used a wrong tech-pack property name; corrected to the existing howToMeasure contract. The cached portable Chromium was truncated and crashed before launch; a fresh extraction of the existing Brotli runtime provided working Chromium143. No shipping dependency or browser config changed.

Desktop native output compares actual hood polygon height and independent GLB float positions, plus tech-pack K, complete backup/history and reload. Phone coverage retains invalid drafts across navigation, exercises numeric-key input, refusal without model change, Reset/Undo and template-scope hiding. First phone attempt passed through all editing checks but its redundant setup dialog handler conflicted with the later replacement confirmation; removed only the unused setup listener. Both cases then passed. A real owned worker-drape/captured-GLB case additionally checks changed hood heights; final results recorded after completion.

Fresh independent review found no blocking source defect, independently passed all three domain tests and checked drape cache identity. Full project and canonical results remain pending at this checkpoint and are not inferred from focused cases. Clothing remains ACTIVE; native construction/material/physical validation #290 remains open. Project #8 remains skipped. No PR.

Final focused cohort passes3/3 in40.2seconds, including the real owned hood40→24 worker recomputation and captured GLB difference. All180unit tests, ESLint, TypeScript and Vite build pass. Broad224-case local/native canonical application and unchanged native-preflight gates are checked separately.
