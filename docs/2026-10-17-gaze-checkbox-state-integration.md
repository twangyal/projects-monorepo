# Gaze native checkbox state integration (#286)

## Initial checkbox execution source

Implementation `b898af88d78c8a49599ef21b1e57bcc4f4aae522`, source tree `444d05d53bebe1e290da245365d9605a0d9fbe50`, app tree `df817baf381e0189217e7de3c96c59c33266bbdf`.

[Source CI39077251661](https://github.com/twangyal/projects-monorepo/actions/runs/39077251661) passed190units/lint/extension build per runner and all396browser cases:

| Shard | Job | Browser cases | Browser duration |
| --- | --- | ---: | ---: |
|1|117526863962|140|4.5m|
|2|117526864191|146|2.7m|
|3|117526864150|110|2.4m|

Local verification passed190units,24focused real Chromium cases across all four viewports, syntax92files and extension build. Portable local Chromium is not full-Chrome extension acceptance; the complete hosted gate includes that flow. Runtime/test files are unchanged after source acceptance; the app milestone document adds this source result/link. Main verification will establish the final canonical app tree including that documentation change.

## Behavior, review and failures

“Check”/“tick” request true; “uncheck”/“untick” request false. Native binary checkboxes perform zero or one browser-native click. No-op requests dispatch no events; canceled or site-overridden/replaced activation does not claim retained state. Named/gazed/ordinal clarification, consequential confirmation and pause/cancel remain intact. Mixed/custom ARIA controls refuse; generic click/toggle keep normal activation. [Design and actual regression history](../apps/gaze-navigator/docs/2026-10-17-checkbox-state.md).

The pre-fix native browser reproduced uncheck checking an empty control; parser assertion likewise returned generic activation. Review reproduced an ordinal bypass, repaired with a failing then passing check-second/uncheck-first regression. The initial full gate187/188 failure was obsolete check/tick fixture action semantics; expected booleans and versionv2 were updated without lowering thresholds/changing inputs/scoring. An added checkout test initially had an unmatched label and was corrected, rather than claiming a runtime fix. Independent safety review found no further important issue, including an investigated detached-frame hypothesis.

## Canonical main

The original190-test checkpoint main `6478a30e4b6203c8306652797679bf8845ac06eb` passed [CI39077676585](https://github.com/twangyal/projects-monorepo/actions/runs/39077676585):140/146/110browser cases with190units per runner. This remains historical execution evidence; final scorer acceptance uses the corrected source below. No physical speech/gaze or intended-user acceptance is claimed; Gaze remains ACTIVE and issue132 remains open. Clothing research #285 is preserved. Project8 remains skipped.


## Final scorer correction

A final self-check caught missing check/range/select-text entries in PAGE_ACTIONS. Wrong targets/states were being classified as abstained rather than unsafe. Paired sync/async regression failed before repair and passed afterward; full local gate191units plus syntax/build passes. [Actual RED output](2026-10-17-gaze-checkbox-scorer-red.txt). Thresholds/scoring categories are unchanged; the action list now covers the newly supported page actions. New source/main gates supersede the190-test checkpoint for final acceptance.


## Corrected accepted source

Corrected source `02126ed5dc6027175992e773b51ab60bfb0e40f5`, tree `803f5f39bea10156e84146785fdc06e4bc6ded1e`, app tree **`760096ab1c2e9c2ec24a679cdf30e7e3b43093fd`** passed [CI39077869489](https://github.com/twangyal/projects-monorepo/actions/runs/39077869489):191units/lint/extension build on every runner, all396browser cases. Jobs117528670053/117528670083/117528669816 pass140/146/110cases (4.5m/2.7m/2.3m). No app files changed after this corrected source. Main integration additionally preserves native bending#287 and clarifies its workflow label/documentation; no new physical-material claim.

## Final canonical acceptance

Canonical implementation **`300859d5f8f0026a04b9eec1bed2181f514eceef`**, tree `d77fa020d112c72a294db36fa14a25e89115bb17`, passed [main CI39078266006](https://github.com/twangyal/projects-monorepo/actions/runs/39078266006). Every runner passes191units, syntax and extension build; all396browser cases pass:

| Shard | Job | Browser cases | Browser duration |
| --- | --- | ---: | ---: |
|1|117529820391|140|4.6m|
|2|117529820149|146|2.4m|
|3|117529820439|110|2.5m|

Final accepted app tree **`760096ab1c2e9c2ec24a679cdf30e7e3b43093fd`** exactly matches corrected source and main. Clothing app remains `d97b167e5e376e69bb55607183585b71ab0e3d7e`. Subsequent changes are outside both applications.

The lightweight research gate also passes [main CI39078537742](https://github.com/twangyal/projects-monorepo/actions/runs/39078537742), job117530602299, at `651e5d2ec00e11e7df417e57c5bf4562352a19ef`:all54standard-library coupon/collector/input/manifest/metadata regressions in13.944seconds. This is separate from the actual native CPU tensile/bending gates, whose complete archives are retained in#285/#287.

This final root-only receipt preserves both accepted app trees and numerical research inputs. Issue286 is complete against the native binary-checkbox milestone; Gaze stays ACTIVE against extension-first accessibility goals, with physical speech/gaze and intended-user evaluation still unverified. Native research does not calibrate physical fabrics or select an engine. Project8 remains skipped; no PR was created.
