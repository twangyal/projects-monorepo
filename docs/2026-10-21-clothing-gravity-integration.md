# Clothing gravity-pair integration — 2026-10-21

Issue: [#290](https://github.com/twangyal/projects-monorepo/issues/290), still open. Clothing remains ACTIVE at `apps/clothing-studio`. Project #8 remains skipped.

The declared normal/zero-gravity native pair completes 362 real frames and 926 verified native files. All 46 native input arrays match, scene metadata is exact, only session gravity differs, and recorded executable digests match. The reference reproduces all 181 frames of both prior duration references. Full official ZIPs and derived replay receipts are retained in the repository; ZIP SHA256 values match GitHub artifact metadata.

Final peak principal strain is 40.885% with gravity and 20.759% without it, both at back underarm triangle 3091. Both start at a 47.891% global peak at another triangle before native motion. The zero-gravity observation shows substantial underarm strain does not require weight in this fixture. Separate AMD CPU models and one pair do not establish precise causal effect sizes or broad repeatability. Construction, bending, contact and the prepared pose remain possible sources.

[Protocol, observations, raw artifacts, replay and limits](research/ppf-cpu/GARMENT_GRAVITY.md). No shipping solver change, calibrated fabric, physical fit, sustained settling or adoption claim.

## Verification

Initial tooling is integrated at `a8de10382604dbf3ec4185a18d8d85dfff84111b`: [196 research tests](https://github.com/twangyal/projects-monorepo/actions/runs/39543263310) in 428.814s and [139 garment checks](https://github.com/twangyal/projects-monorepo/actions/runs/39543263274) in 420.310s pass on main, including complete capture/source reproduction. Independent code review found no critical or important issues.

[Native run 39542765732](https://github.com/twangyal/projects-monorepo/actions/runs/39542765732) succeeds at frozen source `5bc1ae3c3658b82449118a4c4e2474a50213c377`. Native solve times are 101.080s /79.063s (reference /zero); each unchanged 300-second supervisor completes with no remaining children. The full retained-pair regression passes locally in 12.647s and reproduces the complete derived receipt.

Evidence and replay are integrated on canonical main at `e4dfee6045f4d90bf3e49b6f158f7cf95bc15ccc`, tree `d8cf1aa07353cf3b7e85dae86b56d6b09182129e`. The complete final local research suite passes **197 tests in 328.588s**. Independent final review reproduces the entire comparison receipt, checks both archive digests and all reported observations, and finds no blockers.

Final hosted checks on that exact source commit all pass:

| Check | Verified result | Run |
| --- | --- | --- |
| Research evidence harness | 197 tests, 481.025s | [39544559544](https://github.com/twangyal/projects-monorepo/actions/runs/39544559544) |
| Actual-garment preflight | 140 checks, 338.824s; complete packet/warm/rest/body/source reproduction | [39544559621](https://github.com/twangyal/projects-monorepo/actions/runs/39544559621) |
| Application | 163 unit tests, lint/types/build; 209 browser cases (6.4m) | [39544559607](https://github.com/twangyal/projects-monorepo/actions/runs/39544559607) |

Research/preflight job budgets increase from 8 to 10 minutes for additional immutable raw-archive replay; the final research command itself takes 481.025s on its hosted worker. Native solve budgets remain 300 seconds. This final receipt changes only documentation; the verified implementation, source capture and retained evidence remain unchanged.

## Remaining work

#290 remains open. A concrete next investigation is to localize the initial 47.891% strain through the original browser-warm and outward-clearance preparation stages, then choose a contact-preserving construction/pose control. Do not rewrite the rest pattern to erase strain or treat zero gravity as a wearable-assembly result. Representative garment/body coverage, sustained settling and independent physical fabric/fit references remain separate acceptance gates.
