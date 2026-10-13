# WaterSheep target choice — issue #229 (replaces Jev, #206)

## Direction

The owner wrote: "instead of jev look into [WaterSheep](https://github.com/SamratDuttaOfficial/WaterSheep)". Jev (#206) had been blocked on a paid hosted API. WaterSheep is a local, open alternative.

## What WaterSheep is

These notes come from its repository, `main` at c8d466f and `gh-pages` at e70bf94.

- **Model.** ModernBERT-base fine-tuned with a decision head. Each option gets a mask token, and the head scores those positions. Questions are yes/no (`noul`), single choice, rating or multi-label.
- **Calibration.** Probabilities are calibrated by a temperature per question type, fitted on a validation split. The authors report ECE 0.026 in-distribution and 0.043 on held-out datasets.
- **Accuracy.** 77.8% in-distribution and 61.2% on held-out datasets, with wide variation by benchmark.
- **License.** Apache-2.0. The training data is described in its NOTICE.
- **Ways to run it:**
  - the Python package;
  - a local server that answers Jev's `POST /v1/systemone`;
  - in the browser through onnxruntime-web, with a quantized ONNX model and the Hugging Face tokenizers.
- **Distribution.** Weights are published only on Hugging Face (`samratduttaofficial/WaterSheep`). The browser library loads its runtime from jsDelivr.

Calibrated probabilities are what this product needs. A pick can act only when it is very likely, and otherwise falls back to the existing numbered question, which keeps unintended actions rare.

## Design

- **`src/web/watersheep.js`** is a faithful adaptation of WaterSheep's `watersheep.js`, limited to single-choice and yes/no questions. It keeps the same record layout:

  ```
  [CLS] [choose|yes/no] question [SEP] ([MASK] option)… [SEP] state [SEP]
  ```

  It also keeps the length limits from `watersheep.json`, the per-type temperatures, and the grouped scoring of lists with more than 10 options. The ONNX runtime and tokenizer are injected, so the same code runs under Node (onnxruntime-node) for evaluation, and later in the browser and extension without fetching code at run time (MV3 forbids remote code).
- **`src/web/assisted-interpreter.js`.** The rules always run first. The model is consulted only to choose which control a request names:
  1. **No control matched a requested name** ("open the customer reviews"). The rule result now carries `targetQuery`. WaterSheep chooses among the controls inside the circle plus "none of these".
  2. **The rules asked "Which one?"** WaterSheep chooses among exactly those candidates, and the rules' own action is used for the pick. Identical names such as three "Read more" links stay a question.
  3. **Nothing was understood** (`unparsed`). A yes/no question, "does this ask to press, open or select a control?", must reach 0.8 before any pick. A phrase like "hang on" or "sure" therefore cannot press a link.

  The decision thresholds:

  - a pick of 0.8 or more acts;
  - if the top two or three candidates together reach 0.6, the navigator asks a numbered question about them;
  - anything else, and any model failure or malformed answer, keeps the rule answer.

  Every action still passes through the controller's consequential-action confirmation.
- **Privacy.** Only the instruction and each control's role, name, checked state and dropdown choices are sent. Field values, page text and URLs are never sent. A unit test checks that a field's value never reaches the model.
- **Evaluation.** `npm run evaluate:instructions -- --watersheep DIR` loads a local copy of the model repository through onnxruntime-node 1.23.0 and @huggingface/tokenizers 0.2.0 (installed with `--no-save`, so CI stays light). It scores rules plus WaterSheep on the 120-case and 50-case held-out suites, reporting correct, unsafe and abstained results and the median model latency.

## Verification (2026-10-13)

- `npm test`: **130** pass. The 6 new tests cover:
  - confident, split and weak picks;
  - the intent gate, including that "hang on" never requests a pick and that rule-handled instructions never call the model;
  - tie-breaking only among rule candidates, with identical names kept as a question;
  - privacy of field values, model failures and malformed answers;
  - the reference input layout, truncation, int64 feeds, temperatures for both types, grouped scoring of 23 options, and refusal of tokenizers without special tokens.
- `npm run build` passes, and the rule suites are unchanged: 120/120, and 34/50 held-out with 0 unsafe.
- The spoken-navigation and extension Chromium specs pass: **52 cases** at four viewports.
- **Runtime plumbing.** A synthetic ONNX model with WaterSheep's exact input and output signature, plus a WordLevel tokenizer, ran through the real onnxruntime-node and tokenizer libraries and the CLI. Model calls happened, and with uninformative scores nothing crossed the thresholds, so the outcomes equalled the rules with 0 unsafe. This exercises plumbing only and says nothing about WaterSheep's quality.

## Measured with the real model (2026-10-13)

After the network policy was widened, the model was downloaded at revision `236de6496b530d37e36a8ac63ff8412e92940f6e`. The `onnx/model_quantized.onnx` file is 158,196,995 bytes, and its SHA-256 `160ae918…dc25b` matches the published LFS hash. Other file hashes are in [the evaluation record](2026-10-13-watersheep-evaluation.json).

As a sanity check, the port reproduces WaterSheep's README example: "I was charged twice." → billing, 0.85.

**First run** (design as committed in 83c7c5e, scored once):

| Suite | Rules | Rules + WaterSheep |
| --- | --- | --- |
| Tuned (120) | 120 correct, 0 unsafe | 119 correct, **1 unsafe** |
| Held-out (50) | 34 correct, 0 unsafe, 16 abstained | 35 correct, **1 unsafe**, 14 abstained |

Both unsafe actions were gating mistakes, and both were fixed. The held-out protocol allows safety-only changes and no accuracy tuning.

1. **"click remove"** with two identical "Remove" buttons. The model chose one at 0.85, although the two cannot be told apart from words. Tie-breaking now requires every candidate to have a distinct description; otherwise the question stays.
2. **"put Ada in the name field"**. The word "field" made the rules treat it as a request to name a control without an activation verb, and the model focused the field instead of typing. Only a spoken activation verb now marks a target request; anything else must pass the intent question.

**After the fixes:**

| Suite | Rules | Rules + WaterSheep | Model calls | Median call |
| --- | --- | --- | --- | --- |
| Tuned (120) | 120 / 0 unsafe / 0 abstained | **120 / 0 unsafe / 0 abstained** | 2 | 740 ms |
| Held-out (50) | 34 / 0 / 16 | **35 / 0 / 15** | 15 | 358 ms |

**Interpretation**

- WaterSheep improves held-out accuracy from 68% to 70% with no unintended actions. The gain is "click send", which now picks "Send message" at 0.92 instead of asking between it and "Send me a copy".
- The yes/no intent gate never reached 0.8 for any unparsed phrase. For example, "buy it now" scored 0.06 and "hang on" 0.35. As configured, that path is safe but adds nothing. Making it useful needs a better-designed question, chosen on new data rather than this held-out set.
- Cost: the model is called only when the rules could not act. Each call took about 0.35–0.75 s on 4 CPU cores in Node, loading took 0.7 s, and the download is 158 MB.

**Second held-out suite.** Fifty new phrasings, mostly paraphrased or indirect names for controls plus five negatives, were frozen in commit 2614886 before being scored once.

| Held-out-2 (50) | Correct | Unsafe | Abstained |
| --- | --- | --- | --- |
| Rules, first scoring | 18 | 1 | 31 |
| Rules + WaterSheep, first scoring | 27 | 2 | 21 |
| Rules, after safety fixes | 18 | 0 | 32 |
| **Rules + WaterSheep, after safety fixes** | **27** | **0** | **23** |

The two unsafe actions led to safety-only fixes:

- **"choose the audio version"** made WaterSheep open the Format dropdown (0.81). A request starting with choose, select, pick, set or switch no longer lets the model just open a dropdown.
- **"set the subject to book suggestion"** was an older rule behaviour: it rewrote words in the gazed, unfocused name field. Word corrections now need a focused field.

With 0 unsafe on every suite, WaterSheep's picks gave 10 of the 27 correct held-out-2 answers. Examples: "show me how much it costs" → Pricing, "go to the start page" → Home, "show the ratings" → Reviews, "open the topic list" → Topic. All five negatives ("open the blog", "attach a file") still made no pick. Its misses are paraphrases it was not confident about, such as "put it in my basket" and "complete my purchase", and the intent gate still never opened for unparsed phrases.

**Decision.** The gain generalizes: held-out-2 rises from 36% to 54% correct with no unintended actions, at about 0.35–0.4 s for each instruction the rules could not handle. The next milestone is wiring it into the live navigator:

- an asynchronous interpretation path in the controller, keeping cancel and pause instant;
- onnxruntime-web bundled in the extension build;
- the 158 MB model downloaded on request and cached, with the rules still working while it loads or if it fails.

## Live in the navigator — issue #232 (2026-10-13)

- **Controller.** A rule answer of `unknown` or `clarify` that the assistant `needs` returns at once with "Working out which control you mean…" and a `followUp` promise. The follow-up resolves to the model-assisted reply, which goes through the same clarify and confirm handling. It resolves to nothing if any newer instruction arrived first (cancel, pause or anything else) or the navigator is paused. Rule answers, safety words and numbers are unchanged and instant.
- **Overlay.** **Smarter target matching** is an opt-in setting with download progress. It persists for the session and, after a successful load, reloads from cache on the next page. It is hidden when no loader is available. A failed load switches it off and says that instructions still work.
- **Browser loader** (`watersheep-browser.js`):
  - it loads the vendored self-contained runtime and the model at revision `236de64`;
  - the ONNX file's SHA-256 is checked on every load, including from cache, and a mismatch is refused;
  - downloads larger than the published size are aborted.
- **Extension:**
  - an offscreen document (`offscreen.html`, `WORKERS` reason) hosts one model for all tabs, cached in the extension's origin;
  - the background relays `decide`/`yes` calls and progress;
  - the manifest adds the `offscreen` permission and `wasm-unsafe-eval` for extension pages only;
  - the test build substitutes a deterministic stand-in (`test-support/fake-assistant.js`).

**Live checks with the real model:**

| Where | First enable | Later enable | Instruction | Result |
| --- | --- | --- | --- | --- |
| Practice site, Chromium | 12 s | 2.8 s (cache) | "open my profile" | **Account**, 2.5 s |
| Practice site, Chromium | | | "show me all the books", "open the support page", "go to the front page", "I need to get in touch" | No pick: safe abstentions, 1.3–3.5 s |
| Real extension build (host access pre-granted for automation) | 6.6 s | | "open the FAQ" | **Questions**, 1.3 s including navigation |

The website's storage stayed empty.

A live bug found and fixed on the way: the runtime tried to import a separate glue module, which is now avoided by pointing `wasmPaths` at the wasm file only.

**Tests:**

- 133 unit tests, including the controller's follow-up rules: it acts while still the latest instruction, is dropped after cancel or pause, still confirms consequential picks, and keeps the rule answer when the assistant fails.
- Two practice-site browser cases with a stand-in model, at four viewports:
  - off by default, then opt in, see the "Working out" message and navigate;
  - cancel discards a slow answer, only role and name options are sent, and a failure keeps the rule answer.
- An extension case covering the offscreen host.
- Full Chromium suite: 171 of 172 passed on the first run. The failure was "starts automatically on a strict-CSP website" at the short viewport, after 0.5 s. It passed in 8 further runs of that case and in a full rerun of that viewport (43/43). Its error output was overwritten before it could be read, so its cause is unknown.

## Remaining limits

- In-browser latency is noticeable. In the extension, the pages are now cross-origin isolated (`cross_origin_embedder_policy: require-corp`, `cross_origin_opener_policy: same-origin`), so ONNX Runtime uses up to 4 wasm threads. A benchmark in an extension page measured the median `decide` call at **1.13–1.20 s with 1 thread and 0.62–0.72 s with 4 threads**, over two runs each. The live extension still downloads, verifies and acts under isolation. The practice site, served without isolation headers, stays single-threaded.


- The suites are described contexts, not live pages. Real-site and real-speech evaluation with intended users is still outstanding.
- Browser and extension runtime wiring (an asynchronous controller path and bundled onnxruntime-web) waits on that evidence.
