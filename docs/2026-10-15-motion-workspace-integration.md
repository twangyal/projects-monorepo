# Motion focused workspace integration — 2026-10-15 (#263)

## Delivered behavior

Motion starts with the artwork stage and drawing tools, with contextual Draw, Layers, Poses, Drawings, Projects, Share, Export and Help sections plus a real expanded workspace. Existing nodes/controllers remain mounted. Navigation keeps raw pose/stroke fields, selection, history, reviewed in-betweens and owned imports/exports. Back/Escape restore visible focus; playback stop and export cancellation/progress remain global. Gesture ownership, schema, private-link security and export budgets are retained. A deferred numeric blur captures editor authority and cannot commit after suspension. Phone wrappers span their panel and pressed-hover navigation remains readable.

The implementation and README/roadmap changes are in `cd5e4e58cfe18bdb7207d86301174f993a80edd4`; the link-driven private-copy acceptance correction is `755e0f28e141bad1923a6fc896caeaf4addcb638`. The final local and published tree is `363acb5e400e48f750506b3d76fc6c699331c0b0`. No PR was opened, consistent with standing main integration policy.

## Local verification

`npm run check` passes all **273 unit tests**, ESLint, TypeScript and production build. Nine focused native Chromium cases pass, including 1440px/390px draw→pose→preview/stop→independently decoded PNG/GIF (12 frames)→editable project reload, all sections/expanded/Back/Escape, valid/blank raw pose and selected-stroke/review retention, held image reads, actual worker completion delivered after cancellation, phone geometry/hover and queued blur after pagehide. The complete HTTPS snapshot export/local-copy/edit/service-restart case passes separately after adding the real Projects navigation step. Desktop and phone screenshots were inspected; independent read-only review has no remaining Critical or Important findings.

Local runtime is portable Chromium 143.0.7499.0 with machine-specific launch configuration. These are screen-size emulation and native browser checks, not physical-touch or intended-person usability acceptance. The optional HTTPS fixture retains exact generated-SPKI trust; no web-security bypass was introduced.

Log SHA-256 receipts:

| Scope | SHA-256 |
| --- | --- |
| 273 units / lint / types / build | `249d8190a1a1b2a1517552237bf841798f74b4a521a4b7c471b57c615983c8eb` |
| Nine focused browser cases | `60b1f8fcda6e56cf5cde020dda8e7911e2d9d20176a954bb14da36f655cdf879` |
| Corrected complete HTTPS snapshot case | `014dd3b54907263d5a5111e4971219f35cf1dc0020749a34c767243fee94ee2d` |
| First full local invocation (193/195) | `c299bc51f801bc60a4ff54f2a09bdc8c344ace8c4ec66604f3af1e21146306be` |
| Unchanged-main maximum PNG reproduction | `aed994f5fabd8f79cab55e8dd6776b025d69038025a2a9e40ab76240fb261036` |

## Retained failures and scope

Initial focused runs exposed navigation blur applying a valid raw pose and later a queued blur surviving pagehide; both have passing regressions after repair. Review caught half-width phone controls and unreadable active hover; both repaired and tested. Test-only initial parseGIF argument/import and Pause-label assumptions were corrected. One intermediate cancellation test raced a completed export; the final gate holds actual worker completion for late delivery. An overlapping intermediate output directory lost a failure trace; subsequent focused output is isolated.

The first local full invocation completed **193/195 cases in 12.0 minutes**. It used the pre-final owner/style bundle and first seven focused cases. Its maximum 96-frame PNG archive hit the existing 30-second worker deadline; the same failure reproduces against unchanged main `e9f0609` under the same portable browser configuration. Its HTTPS snapshot case reached local-editor adoption but timed out filling a now-hidden project title; explicit real Projects navigation fixes the test without weakening media, storage, restart or trust assertions. Do not treat that first full invocation as green or as verification of later source.

## Hosted integration

The superseded first-source run `38754185312` passed all 273 units, lint/type/build and began 197 browser cases before cancellation when the corrected source was published. It is not a completed browser gate. Final-source [CI 38754654598](https://github.com/twangyal/projects-monorepo/actions/runs/38754654598), job `116490252903`, passes **273 units and all 197 Chromium cases (2.4 minutes)**, with lint, TypeScript and production build at `755e0f28e141bad1923a6fc896caeaf4addcb638`. The actual maximum frame PNG and complete HTTPS snapshot cases pass. Main was fast-forwarded with an expected-head lease from `e9f0609` to this exact source; integrated-main [CI 38755406021](https://github.com/twangyal/projects-monorepo/actions/runs/38755406021), job `116492384004`, independently passes **273 units and all 197 browser cases**, plus lint, TypeScript and production build. Both gates use Playwright Chromium/Chrome Headless Shell **153.0.8010.12**. Completed job logs were inspected for exact counts. The subsequent root-document receipt changes no application code.

## Remaining product work

Motion remains **ACTIVE**. Learned animation assistance, live synchronization and real-person/physical-device evaluation remain outside this information-density milestone. Broader product direction is preserved, including the explicit project #8 skip.
