# Clothing entered top torso girths — #269

## Delivered scope

Body & drape now accepts optional independent waist/hip girths for the actual top-body proxy. Blank retains the original chest-based proportions; entered values reach the real drape worker, geometry and cache identity. Chest/waist/hip Apply is atomic, raw drafts survive selection/navigation and deliberate discard/replacement protection, and a held retired result cannot restore the prior torso. Completed-result garment-only exports keep the captured actual draped positions. Defaults preserve original torso geometry and physics; body metadata now identifies the girths used.

Final source `d313d722d653021f3f46f509da2e7bcc1c8a20ab`; local/published tree `a3f292672697e79a39875c2569ca24dfe77334b9`, based on completed #268 receipt `72605b4f9ecf189c18a0ae66d8c796a7f992f9a1`. There is no project-schema/dependency/paid-service/PR/infrastructure change. The original session-only body-setting scope remains: no saved personalized avatar, anatomy/fit calibration or membrane-law integration. Torso heights/depth/limbs and XPBD material/contact approximations remain disclosed. Clothing stays ACTIVE, project #8 skipped and owner-deferred apps excluded.

## Verification

The exact #268 base passes 134 units and 156 native cases in source/main CI. Final local project check passes 137 units, ESLint, TypeScript and production build. Three domain cases check independently calculated stadium circumferences, fixed chest/heights/capsules, explicit default girths 80.84/95.88 cm at 94 cm chest, exact omitted/explicit-default geometry, bounds/nonfinite refusal and actual finite simulation response with changed hip/waist. Full default simulation regressions remain in the project suite.

Five focused native flows pass desktop 1440 / phone 390 actual worker dimensions and independent hip circumference, decoded GLB Front body positions exactly matching the actual result, unchanged complete garment backup, retained session fields/navigation and viewport containment. They also check invalid atomic Apply (including the chest remaining uncommitted), raw-field preservation/replacement guards/discard, an actual held old result after changing only hip, and excessive-stretch guidance after a real extreme-body solve. The final full suite additionally asserts the returned maximum extension exceeds 100% and residual speed is finite. Native unfinished exponent 1e remains invalid/unapplied until corrected or deliberately discarded. Desktop/phone screenshots were inspected; conditional controls and reported girths remain readable. These are software observations, not physical-device/anatomical or fit validation.

| Local evidence | SHA-256 |
| --- | --- |
| Intermediate137-unit/lint/types/build | `85942749d674e3dd9cd90d767e68ceb4ea619a3881f7b32e577e0f967a9b4fd7` |
| Four pre-warning focused native cases | `0585da68334ac81da170333c9990f0cb9c61ddb00edd60f16dfa61b708d2431d` |
| Missing dimension behavior RED | `88b1391a23f8ab301909710575630ead3d38d3264f0c665a936f9ca6f63044de` |
| Missing native controls RED | `082a236b103e7378ef21256c83cf63ea5adb4615c02d9a6ba97a1cafe86a6b3b` |
| Native partial number RED | `eb4ece543d42c82d8d110a06de30fb33a0a5d76eb34e77e5beb34c03e752bcc2` |

## Retained intermediate outcomes

The first three domain tests fail against the existing function ignoring the new dimensions; actual waist remains 80.84 rather than 78, invalid shapes do not refuse, and simulations are identical. The implementation passes all three. First native invocation stops before browser launch on TypeScript's deliberate malformed-value test cast; using an explicit unknown cast permits the intended runtime-refusal test. The corrected pre-UI invocation fails on missing optional-body controls before implementation. Four initial focused flows then pass.

A further actual native probe enters 1e and demonstrates that its empty number-input value is being mistaken for an intentionally blank optional field. The failed expectation observes Body settings applied. Checking validity.badInput before any accepted body assignment repairs that behavior; the unchanged native invalid-input expectation and all four focused flows pass. Existing assertions, storage/simulation deadlines and security controls are not weakened. Fresh local portable Chromium 143.0.7499.0 is used.

## Final gates and review

Independent read-only review finds no Critical/Important geometry/admission/lifecycle/export defect. Its direct comparison against the base confirms exact torso/capsule parity at chest 70/94/140 and exact default simulation positions/metrics at 94 cm and 90 frames. All eight girth boundary combinations produce finite positions/metrics at 90 frames. A minor stale README statement describing one measurement is corrected as documentation consistency required by this milestone; that documentation fix itself does not change application/test code. Review sets aside physical/anatomical/fit calibration, persistent avatars/bottoms and unrelated redesign because this milestone explicitly retains those unfinished destinations; no physical acceptance follows. Initial source CI 38855557917 passes 137 units and 160 browser cases (Chrome 153.0.8010.12), with lint/types/build; its completed job 116826096137 logs were inspected. Final local 161-case, final-source and main gates are recorded below.

## Extreme-body observations and warning

A separate coordinator probe used the Ringer tee and all eight accepted chest/waist/hip bound combinations with the default 240 simulation frames. All positions/metrics were finite. This is insufficient evidence of fit, settling or accurate contact:

| Chest / waist / hip (cm) | Maximum edge extension (%) | Residual speed (cm/s) | Minimum proxy clearance (cm) |
| --- | --- | --- | --- |
| 70 / 50 / 50 | 50.77 | 6.633 | 0.349997 |
| 70 / 50 / 220 | 41.35 | 395.980 | 0.349997 |
| 70 / 180 / 50 | 335.72 | 8.043 | 0.349997 |
| 70 / 180 / 220 | 597.27 | 113.392 | 0.349998 |
| 140 / 50 / 50 | 287.26 | 76.606 | 0.115798 |
| 140 / 50 / 220 | 286.83 | 77.312 | 0.117290 |
| 140 / 180 / 50 | 346.95 | 89.039 | 0.239833 |
| 140 / 180 / 220 | 354.73 | 98.304 | 0.217612 |

The nominal 0.35 cm clearance can be undershot, and a low-speed result can still have extreme extension. The original residual-speed message alone was inadequate. An actual Blank-tee browser case at 70/180/50 first fails because the completed summary omits excessive-stretch guidance. The fixed summary explicitly warns at greater than 100% maximum structural-edge extension, independently of motion, and suggests adjusting garment/body before interpretation. This is a disclosed engineering guard, not a measured yield threshold or calibrated fabric admissibility boundary. The same regression passes after the fix. Its title was then corrected to avoid implying that the particular Blank-tee fixture has low motion, and assertions of actual >100% extension and finite speed were added before the final full run.

The first final local full invocation was intentionally interrupted after 133 passing cases to add this finding; it is partial evidence, not a full pass. One warning-patch command used an incorrect working directory and stopped before writing; its inadvertently launched old-source check was interrupted, then the patch and all checks were executed from the correct paths. No existing assertion, storage/simulation deadline, or security control was relaxed. The earlier focused fifth test passes before its title/metric-assertion strengthening; the final full gate covers that exact stronger test.

The independent review preceded this additive warning, which was handled with a reproduced RED and unchanged expectation GREEN rather than a second review pass. Real anatomy, physical fit/material/contact calibration, persistence of custom avatars, bottoms and garment membrane-law integration remain unfinished. The small unloaded interior-mesh overlay omission from #268 remains deferred in that milestone's receipt.

## Final integration gates

Final local check passes 137 units, ESLint, TypeScript and production build. The frozen final full native suite passes 161/161 in 5.6 min on portable Chromium 143.0.7499.0, one worker; log SHA-256 `24033594b0126700898ee478e00c0c69d0152c1c93e65208a534765a8a01e2eb`.

Final source [CI 38856290557](https://github.com/twangyal/projects-monorepo/actions/runs/38856290557) passes 137 units and 161 native cases (3.6min), ESLint, TypeScript and build. Completed job 116828382498 logs were inspected; hosted Chrome 153.0.8010.12.

Source d313d722d653021f3f46f509da2e7bcc1c8a20ab is integrated into main with an expected-head lease from 72605b4f9ecf189c18a0ae66d8c796a7f992f9a1. Main [CI 38856765172](https://github.com/twangyal/projects-monorepo/actions/runs/38856765172) passes 137 units and 161 native browser cases (3.4 min), ESLint, TypeScript and production build. Completed job116829873031 logs were inspected; hosted Chrome 153.0.8010.12. The source stayed frozen during the full run; remaining integration edits are root evidence/direction documentation only.

Final 137-unit/lint/types/build: SHA-256 `db6d645e7d6a9f56f0c4c914956d3b6aa4c0d72b171f009581718b68a6ad99c1`.

Five focused native flows before stronger metric assertions: SHA-256 `f84ecedfe58b84b8327d2bc629fd666fe4b393cc3e48bd002456e48612c3f6de`.

Absent excessive-stretch warning RED: SHA-256 `8784989a941803f605f5f2fbe238dc64a43f9e22f70bf77c51f76b927a1a82f7`.

Eight default 240-frame boundary observations: SHA-256 `6345e52a46a6e0b3247da2bd3b345360c30ba99af3aa041f21e7880d38cf49a1`.

Integration receipt and delivery note change only root documentation. The application, tests, project README/roadmap and workflow remain exactly at the tested source tree. Both scoped milestones268/269 are complete as software increments; Clothing remains ACTIVE with the disclosed research/product gaps.
