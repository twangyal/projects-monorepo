# Real-site task evaluation — 2026-10-13

## Why

The product direction defines success as people completing useful tasks on real websites with manageable effort and few unintended actions. Until now the navigator had only been measured on described contexts and the bundled practice site, because this environment could not reach public websites. It now can.

## Method

`scripts/evaluate-real-sites.mjs` drives the **real extension build** in Chromium on live sites. Host access is pre-granted, because automation cannot click the permission prompt.

- **Simulated input.** For each step, the pointer rests on the control a person would look at, standing in for gaze, and the instruction is typed, standing in for speech.
- **Questions.** Numbered questions are answered with the number shown for the intended control, and confirmations with "confirm".
- **Outcomes.** Each step is recorded as done (the intended effect), unintended (the page changed in another way), failed, or unanswered-question. Utterances and questions are counted.
- **Conditions.** Every task runs with the rules alone and with **Smarter target matching** (WaterSheep, the real model).

The thirteen tasks (the last six were added in #238 to cover text entry, correction, dropdowns, scrolling and pagination):

| Site | Task | Steps |
| --- | --- | --- |
| Wikipedia | Find the Ada Lovelace article, open her father's article, come back | "search for Ada Lovelace", "open Lord Byron", "go back" |
| Wikipedia | Reach the log-in page | "sign in" (the link says "Log in") |
| Wikipedia | Open the Main Page's history | "show me the past versions of this page" |
| GOV.UK | Refuse optional cookies, then find passports | "reject additional cookies", "open passports" |
| GOV.UK | Find driving information in everyday words | "take me to the stuff about cars" |
| GOV.UK | Search | "search for renew passport" |
| MDN | Open the HTML reference | "open HTML" |
| Wikipedia | Dictate a search, correct a misheard word, send it | "type Alan Turnig", "change Turnig to Turing", "press enter" |
| Wikipedia | Read down an article and return to the top | "scroll down", "go to the top" |
| Python docs | Switch the documentation to Python 3.12 | "choose 3.12" (version dropdown) |
| Python docs | Switch to the dark theme | "choose dark" (a dropdown with no label) |
| GOV.UK | Go to the second page of search results | "next page" |
| MDN | Scroll the reference sidebar, not the page | "scroll the list down" |

## Results

| Condition | Tasks completed | Steps done | Unintended actions | Utterances | Questions |
| --- | --- | --- | --- | --- | --- |
| Rules only | 11 / 13 | 17 / 19 | 0 | 19 | 0 |
| Rules + WaterSheep | **13 / 13** | **19 / 19** | **0** | 19 | 0 |

The rules alone miss only the two everyday phrasings. With WaterSheep both succeed on the live pages: "show me the past versions of this page" opened **View history**, and "take me to the stuff about cars" opened **Driving and transport**. Dictation, the spoken correction, Enter, both dropdowns (including one with no label), page and region scrolling, and pagination all worked with the rules alone. Per-step replies are in [`2026-10-13-real-site-evaluation.json`](2026-10-13-real-site-evaluation.json).

### What the runs found

**First set (7 tasks).** A first rules-only run completed 2/7.
- Three failures were mistakes in the task script: Wikipedia's contents sidebar is hidden at this width, and GOV.UK's visible search box is labelled "Search".
- The fourth was a real interpreter gap. "sign in" did not match Wikipedia's **Log in** link, because the synonym table only worked one way. Synonyms now apply in both directions (`tests/web-synonyms.test.js`).

**Expanded set (#238).** The first rules-only run completed 8/13.
- **"next page" went back through history instead of following the Next page link.** The rule treated it as a synonym for "go forward". It now activates a pagination link or button inside the gaze circle, such as "Next page", "Previous page" or an arrow like ›; with no such control, it still moves through history. Covered by `tests/web-interpreter.test.js`.
- **A typed correction lost its field.** After "type Alan Turnig", the next instruction "change Turnig to Turing" was refused with "first select the text field". Typing the instruction into the navigator's panel had moved focus away from the page field. Spoken instructions were unaffected, but keyboard users of the typed fallback could never correct dictated text. The navigator now remembers the page field that had focus while focus is inside its own panel. It forgets the field when focus leaves for the page background. Covered by a browser test that fails without the fix.
- Two failures were task-script mistakes: Wikipedia replaces its search input on focus, and the Python docs have a hidden duplicate theme dropdown.
- The remaining two were the everyday phrasings.

The instruction suites are unchanged: 120/120, held-out 34/50 and held-out-2 18/50 with the rules, all with 0 unsafe.

## Limits

- Thirteen tasks on four sites, written by the developer; the first runs informed the script fixes. These results show the pipeline working on real pages, not task completion rates for the intended users.
- The pointer stands in for gaze, so gaze jitter and calibration error are not exercised. Typed text stands in for speech, so recognition errors are not exercised.
- Live sites change; rerun the script to refresh the record.
