# Real browser depth probe — 2026-10-10

Issue [#172](https://github.com/twangyal/projects-monorepo/issues/172) remains open. Automatic depth is a missing Lens capability. This isolated experiment evaluates the pinned candidate in a real browser worker, using the existing frozen portrait's actual CPU-prepared input. **Browser inference executes, but the worker-retirement gate fails.** No model or runtime dependency is enabled in Lens.

## Observations and integration decision

[Actual receipt](browser-result.json) and [literal run log, including the failed assertion](browser-probe.log) retain real Chromium153.0.8010.12 / ONNX Runtime Web1.23.2 measurements. The model, input, CPU oracle and three served runtime files are SHA256 checked. A separate negative attempt uses unchanged tensor bytes with an intentionally wrong expected input hash; it is refused before session creation. It does not test modified tensor bytes.

- Single-thread CPU WASM, explicit dedicated worker, proxy disabled; cross-origin isolation is false. Session loading2662.2ms; two inference observations26167.6ms and22020.2ms. These are shared-host observations, not isolated benchmarks or physical-device performance guarantees.
- Real finite, nonconstant float32 output `[1,518,784]`; both raw-output hashes are `e17d34f1722c5f57d9ac6f12dbb1f7c3c85f8eff683d8fac94761bf97d1b19d0`. All five predeclared clear portrait orderings and three diagnostic orderings retain their signs. This is the same previously observed portrait, not another held-out quality sample.
- CPU and WASM raw outputs differ: maximum absolute difference1.0949007272720337; mean absolute difference0.028607750653704103 across406112 pixels. No output-dependent numerical tolerance was introduced. Equal ordinal signs do not establish numerical parity or boundary accuracy; affine inverse values are not meters.
- A real Playwright button click completed in236.08ms; its recorded page event timestamp lies inside an actual worker `session.run` interval. This demonstrates one main-thread interaction, not comprehensive UI responsiveness.
- The page requests worker termination102.2ms after receiving the first running-stage message. No later stages/messages arrived during the500ms observation. However, a native `/worker.js` target remained. The receipt explicitly records `lifecycleRetirementPassed: false`; the driver retains its zero-worker assertion and exits1. Page retirement is not evidence of immediate execution retirement or memory reclamation. A [separate reviewer’s rerun](independent-normal-result.json) reproduces both raw hashes, every pair value and both CPU-difference summaries. Native target IDs in [its log](diagnostic.log) distinguish normal completion (target destroyed8ms after the completion snapshot) from the cancelled target. A [cancel-only diagnostic](lifecycle-diagnostic.json) observes that cancelled target at500ms and a further1-second snapshot, then a target-destroyed event and zero targets at the further2-second snapshot, before browser closure ([literal log](cancel-diagnostic.log)). This demonstrates delayed retirement in this observation, not a persistent leak, a precise interruption mechanism or a memory-release guarantee. The original500ms gate remains failed.
- No non-loopback requests were observed. ONNX emitted an unknown-CPU-vendor warning; it is retained. Browser memory, physical devices, WebGPU, multithreading, product preprocessing, recovery, stale-result protection and export were not evaluated.

The candidate can execute locally in this browser. It is **not ready for product admission** on this evidence. Resolve and measure cancellation execution/resource retirement, investigate numeric differences, evaluate relevant devices, and measure boundary/correction utility before integrating editable proposals. Do not silently increase a timeout or remove the lifecycle assertion to declare readiness.

## Provenance and failed attempts

[Tensor provenance](tensor-provenance.json) captures the existing Python harness's actual input and output without changing either. [Capture source](capture-input.py), [CPU oracle](cpu-oracle.json) and [literal CPU capture log](capture.log) are retained. Raw tensor binaries, weights and browser executables are intentionally not bundled. The portrait/model/photo licensing and source-only frozen labels remain in the [extension protocol](../extension-2026-10-10/README.md); this probe changes no pair coordinates or categories.

[Isolated package lock](package-lock.json) pins `onnxruntime-web`1.23.2 (MIT); it does not change application dependencies. Matching JS/WASM files come from the same installed package. The explicit worker is research instrumentation, not production ownership code. Official runtime configuration references: [Web setup](https://onnxruntime.ai/docs/get-started/with-javascript/web.html), [environment flags](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html).

The first shared Chromium executable was truncated and segfaulted before model loading ([launch log](first-launch-failure.log)). Playwright's canonical headless installation returned an invalid archive ([installation log](first-install-failure.log)); direct official Google download succeeded with normal TLS/proxy settings. The independently installed executable's archive size, SHA256, published MD5-header match and all-entry CRC checks are retained in [browser provenance](browser-provenance.json). This separates environmental failures from the actual model/runtime observation. The first completed native experiment also failed worker retirement ([log](first-lifecycle-failure.log)); the follow-up preserves the receipt before rethrowing that same gate failure.

## Reproduce

From repository root, install the measured Python research requirements in an isolated environment and download the pinned model and portrait from the extension manifest. Inputs must match its hashes. Lens's installed Playwright package is used only as a native browser driver. Use a complete compatible Chromium executable; this measurement used the official153.0.8010.12 headless-shell build documented in `browser-provenance.json`.

```sh
mkdir -p /tmp/lens-depth-web
cp docs/research/lens-depth-baseline/browser-2026-10-10/package*.json /tmp/lens-depth-web/
npm ci --prefix /tmp/lens-depth-web --ignore-scripts
/tmp/lens-depth-evaluation/bin/python docs/research/lens-depth-baseline/browser-2026-10-10/capture-input.py /tmp/lens-depth-web --manifest docs/research/lens-depth-baseline/extension-2026-10-10/frozen-portrait.json --manifest-sha256 b076eb4d8734b9aadda2d855d9fbd8bfd6607ef0e454197ce03b4bfbbfcd179f --model /tmp/lens-depth-model.onnx --preprocessor docs/research/lens-depth-baseline/preprocessor_config.json --photo /tmp/lens-depth-portrait.jpg --output /tmp/lens-depth-web/cpu-oracle.json
CHROMIUM_PATH=/tmp/lens-depth-headless/chrome-headless-shell-linux64/chrome-headless-shell timeout 240 node docs/research/lens-depth-baseline/browser-2026-10-10/probe.mjs > /tmp/lens-depth-web/browser-probe.log 2>&1
```

The last command currently exits1 for the native worker-retirement failure and still writes its literal `browser-result.json`. `LENS_PROBE_DATA`, `LENS_PROBE_MODEL` and `PLAYWRIGHT_MODULE` override scratch inputs/driver locations. The server binds only127.0.0.1, serves an exact allowlist, verifies hashes, blocks external browser requests, bounds each worker to90seconds, and closes the browser/server in `finally`. These experiment bounds are not a production inference safety/resource policy. Do not copy a success status into the failed receipt.

The reviewer’s exact measured diagnostic sources are archived as `probe-diagnostic.mjs` and `cancel-diagnostic.mjs`; their `here` constant records this checkout’s path. For another checkout, use the portable primary `probe.mjs`, or deliberately adapt that diagnostic path before running. Diagnostic follow-up samples do not change the original500ms gate.
