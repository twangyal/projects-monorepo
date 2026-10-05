# Native persistent-download compatibility (#128)

The neutral `scripts/download-compatibility.mjs` imports no application code. It downloads a deterministic 11,554,385-byte native Blob, checks every byte length and SHA-256, closes the browser process, and downloads again using the same synthetic profile. Default: one initial download and one after restart. `--initial-downloads 16` reproduces the separate original stress workload; it is bounded and does not retry failures or change download permissions.

The first PR measurement at `63e2e72` reproduced native full Chromium 153 crashes after restart with both temporary and persistent download directories. The headless reference passed all 17 downloads. The independent push measurement stopped at the 11th initial download in every environment, before restart; its failure is preserved and is inconclusive for restart compatibility. Reports and complete browser stderr are in `failures/2026-10-05-download-compatibility/`.

Upstream Playwright [42506](https://github.com/microsoft/playwright/issues/42506#issuecomment-5956123799), updated October 2, 2026, identifies Chromium [556160935](https://issues.chromium.org/issues/556160935), fixed by [CL 8378127](https://chromium-review.googlesource.com/c/chromium/src/+/8378127) (`34fe0e520e14`), and reports a fix in Chromium 155. This is an upstream report, not our Linux acceptance evidence.

The compatibility workflow separately installs exact `playwright@1.64.0-alpha-2026-10-02` from the committed isolated lockfile to obtain official full Chromium 155.0.8059.12 (revision 1247, [upstream registry](https://github.com/microsoft/playwright/blob/48688e0f92dd/packages/playwright-core/browsers.json)). Application/test dependencies remain pinned to Playwright 1.63.0. The neutral post-fix case asserts its browser version. A separate job runs the original full-minute soundtrack, archive, actual restart, silent-take preservation, pixel and decoded-audio gates with that full browser. Those gates and their fixture are unchanged. These jobs record distinct browser environments; green neutral measurement alone is not product acceptance. Await the actual receipts before claiming the fix is verified.

Run the control after `npm ci` and `npx playwright install chromium`:

```sh
node scripts/download-compatibility.mjs --output /tmp/new-neutral-report
```

To include the post-fix case, install the isolated browser and supply its executable:

```sh
npm ci --ignore-scripts --prefix scripts/browser-155
node scripts/browser-155/node_modules/playwright/cli.js install chromium
export SHOT_POSTFIX_CHROMIUM_PATH="$(node --input-type=module -e "import {chromium} from './scripts/browser-155/node_modules/playwright/index.mjs'; console.log(chromium.executablePath())")"
node scripts/download-compatibility.mjs --output /tmp/new-postfix-report
```

Only harness-owned synthetic profiles are deleted. No existing browser history is edited. Physical headset, headed-browser and other platform compatibility remain separate unverified claims.
