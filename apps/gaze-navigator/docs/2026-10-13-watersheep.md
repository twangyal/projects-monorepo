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

## Not established — blocked

**WaterSheep itself has not been run.** This environment's network policy refuses huggingface.co, hf-mirror.com, cdn.jsdelivr.net and the project's GitHub Pages site, and the weights are published only on Hugging Face. Once the owner adds `huggingface.co` to the environment's allowed domains, the next steps are:

1. Download the model.
2. Run the evaluation on both suites.
3. Tune nothing on the held-out suite.
4. Wire it into the live controller only if it beats the rules without unintended actions. This needs an asynchronous interpreter path in `controller.js` and bundled onnxruntime-web files in the extension build.
