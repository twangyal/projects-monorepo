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

**Decision.** The benefit is real but small, so WaterSheep is **not wired into the live navigator yet**. The next step is a fresh held-out suite with more name-mismatch and indirect requests, written before any further design changes, to see whether the target pick generalizes beyond one case.

## Remaining limits

- The suites are described contexts, not live pages. Real-site and real-speech evaluation with intended users is still outstanding.
- Browser and extension runtime wiring (an asynchronous controller path and bundled onnxruntime-web) waits on that evidence.
