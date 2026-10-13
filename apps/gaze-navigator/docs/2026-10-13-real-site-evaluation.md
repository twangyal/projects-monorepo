# Real-site task evaluation — 2026-10-13

## Why

The product direction defines success as people completing useful tasks on real websites with manageable effort and few unintended actions. Until now the navigator had only been measured on described contexts and the bundled practice site, because this environment could not reach public websites. It now can.

## Method

`scripts/evaluate-real-sites.mjs` drives the **real extension build** in Chromium on live sites. Host access is pre-granted, because automation cannot click the permission prompt.

- **Simulated input.** For each step, the pointer rests on the control a person would look at, standing in for gaze, and the instruction is typed, standing in for speech.
- **Questions.** Numbered questions are answered with the number shown for the intended control, and confirmations with "confirm".
- **Outcomes.** Each step is recorded as done (the intended effect), unintended (the page changed in another way), failed, or unanswered-question. Utterances and questions are counted.
- **Conditions.** Every task runs with the rules alone and with **Smarter target matching** (WaterSheep, the real model).

The seven tasks:

| Site | Task | Steps |
| --- | --- | --- |
| Wikipedia | Find the Ada Lovelace article, open her father's article, come back | "search for Ada Lovelace", "open Lord Byron", "go back" |
| Wikipedia | Reach the log-in page | "sign in" (the link says "Log in") |
| Wikipedia | Open the Main Page's history | "show me the past versions of this page" |
| GOV.UK | Refuse optional cookies, then find passports | "reject additional cookies", "open passports" |
| GOV.UK | Find driving information in everyday words | "take me to the stuff about cars" |
| GOV.UK | Search | "search for renew passport" |
| MDN | Open the HTML reference | "open HTML" |

## Results

| Condition | Tasks completed | Steps done | Unintended actions | Utterances | Questions |
| --- | --- | --- | --- | --- | --- |
| Rules only | 5 / 7 | 8 / 10 | 0 | 10 | 0 |
| Rules + WaterSheep | **7 / 7** | **10 / 10** | **0** | 10 | 0 |

With WaterSheep, the two everyday phrasings succeeded on the live pages: "show me the past versions of this page" opened **View history**, and "take me to the stuff about cars" opened **Driving and transport**. Per-step replies are in [`2026-10-13-real-site-evaluation.json`](2026-10-13-real-site-evaluation.json).

**Before these runs**, a first rules-only run completed 2/7. Three failures were mistakes in the task script: Wikipedia's contents sidebar is hidden at this width, and GOV.UK's visible search box is labelled "Search". The fourth was a real interpreter gap: "sign in" did not match Wikipedia's **Log in** link, because the synonym table only worked one way. Synonyms now apply in both directions (`tests/web-synonyms.test.js`). The instruction suites are unchanged: 120/120, held-out 34/50 and held-out-2 18/50 with the rules, all with 0 unsafe.

## Limits

- Seven tasks on three sites, written by the developer; the first run informed the script fixes. These results show the pipeline working on real pages, not task completion rates for the intended users.
- The pointer stands in for gaze, so gaze jitter and calibration error are not exercised. Typed text stands in for speech, so recognition errors are not exercised.
- Live sites change; rerun the script to refresh the record.
