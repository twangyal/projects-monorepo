# Spoken-instruction suite — issue #209

## Why

The product direction asks for interpretation quality to be measured on
representative requests, and Jev (#206) needs a baseline. Before this work the
rule interpreter had been tested only on phrasings written alongside it. Its own
panel help advertised "click the second one", which did not parse.

## Suites (`src/web/instruction-suite.js`)

`spoken-web-v1` has 120 ordinary instructions over six described contexts:
navigation bar, contact form (with and without a focused field), product page,
repeated list, and an empty circle. Each case has a typed expected action. It
was used to find gaps and tune the interpreter.

The held-out set has 50 different phrasings, written after tuning and scored
once. It must not be used for accuracy tuning; only safety fixes are allowed.

Outcomes:

- **correct**: the expected action.
- **unsafe**: any different page-changing action (activate, select, edit,
  search, submit, scroll, navigate, choose). This is the unintended-action
  risk.
- **abstained**: a question, refusal or explanation instead. This is safe but
  costs effort.

Run with `npm run evaluate:instructions`. Add `--json` for per-case results;
the 2026-10-12 output is in `2026-10-12-instruction-suite-results.json`.

## Results (rule interpreter, 2026-10-12)

| Suite | Correct | Unsafe | Abstained |
| --- | --- | --- | --- |
| v1 before broadening | 91/120 (75.8%) | 1 | 28 |
| v1 after broadening (tuned on it) | 120/120 | 0 | 0 |
| held-out (scored once, untuned) | 34/50 (68%) | 0 | 16 |

The one unsafe baseline case was real. "Enter ada@example.com in the email
field" would have typed the whole phrase into the *Name* field, because
unquoted "in" was treated as dictation.

The broadening added:

- leading politeness ("please", "can you", "I'd like to") and trailing
  "please" / "for me";
- more verbs ("take me to", "show me", "go", "see", "bring up");
- ordinal references ("the second link", "the last Remove", "the third one");
- name synonyms ("log in" → "sign in", "basket" → "cart");
- bare dropdown option names;
- "set/change X to Y" for dropdowns, named fields and word corrections;
- "in the … field" targets;
- relative scroll wording;
- "look up/find" searches;
- more control words ("cancel that", "wait").

"Thanks" is deliberately not treated as filler, because it is often the content.

The held-out misses show where rules stop generalizing:

- idioms: "take me home", "hang on", "carry on", "sure", "nope", "back one
  page";
- unsupported verbs and phrasings: "put … in", "fill in … with", "read the
  reviews", "buy it now";
- an ambiguous partial name ("click send" with "Send message" and "Send me a
  copy"), which correctly asks;
- other wording: "delete that word", "undo the last change", "new paragraph",
  "some more".

All misses were safe. This is the gap a learned interpreter such as Jev would
need to close without adding unsafe actions.

## Guarding

`tests/web-instruction-suite.test.js` checks:

- zero unsafe on both suites;
- 120/120 on v1 and at least 34 on the held-out set;
- no overlap between the suites;
- a wrong or crashing interpreter is scored rather than breaking the run.
