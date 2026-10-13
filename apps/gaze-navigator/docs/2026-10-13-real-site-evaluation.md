# Real-site task evaluation — 2026-10-13

## Why

The product direction defines success as people completing useful tasks on real websites with manageable effort and few unintended actions. Until now the navigator had only been measured on described contexts and the bundled practice site, because this environment could not reach public websites. It now can.

## Method

`scripts/evaluate-real-sites.mjs` drives the **real extension build** in Chromium on live sites. Host access is pre-granted, because automation cannot click the permission prompt.

- **Simulated input.** For each step, the pointer rests on the control a person would look at, standing in for gaze, and the instruction is typed, standing in for speech.
- **Questions.** Numbered questions are answered with the number shown for the intended control, and confirmations with "confirm".
- **Outcomes.** Each step is recorded as done (the intended effect), unintended (the page changed in another way), failed, or unanswered-question. Utterances and questions are counted.
- **Conditions.** Every task runs with the rules alone and with **Smarter target matching** (WaterSheep, the real model).

The seventeen tasks (six were added in #238 for text entry, correction, dropdowns, scrolling and pagination, and four in #240 for menus, disclosure toggles and checkboxes):

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
| GOV.UK | Open the navigation menu, then close it | "show the navigation menu", "close the menu" |
| Wikipedia | Open the page tools menu | "open tools" |
| GOV.UK | Show the search filters | "open filter and sort" |
| Wikipedia | Tick and untick "Keep me logged in" (without logging in) | "tick keep me logged in", "untick it" |

## Results

| Condition | Tasks completed | Steps done | Unintended actions | Utterances | Questions |
| --- | --- | --- | --- | --- | --- |
| Rules only | 15 / 17 | 23 / 25 | 0 | 25 | 0 |
| Rules + WaterSheep | **17 / 17** | **25 / 25** | **0** | 25 | 0 |

An earlier full run with WaterSheep on the same build completed 16/17: "show me the past versions of this page" was not resolved that time. Run on its own three more times, it succeeded each time. The cause of the one miss was not established, and both runs are in the JSON record.

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

**Third round (#240).** A first rules-only run of the four new tasks found two more real gaps:
- **"close the menu" did nothing.** "Close" was not understood, and GOV.UK renames the open menu's button to "Hide navigation menu", so the name did not match either. The page context now records whether a toggle is open (`aria-expanded`, or an open `<details>`). "Close", "hide", "collapse" and "dismiss" act on an open toggle matching the words, or on a Close/Hide/× control. With neither in the circle, the words are an ordinary control name, so "close account" keeps its confirmation.
- **"open filter and sort" asked for confirmation.** GOV.UK's filter toggle is a `<button>` inside the search form with no `type`, so it defaulted to a submit button and was treated as consequential. Buttons with `aria-expanded` are now disclosures, not submits; consequential names still ask. The practice search page reproduces both, and its browser test fails without the fix.

Two task-script mistakes were also corrected: the menu button's renaming, and a list entry that was not present on every load.

The instruction suites are unchanged: 120/120, held-out 34/50 and held-out-2 18/50 with the rules, all with 0 unsafe.

## Limits

- Seventeen tasks on four sites, written by the developer; the first runs informed the script fixes. These results show the pipeline working on real pages, not task completion rates for the intended users.
- The pointer stands in for gaze, so gaze jitter and calibration error are not exercised. Typed text stands in for speech, so recognition errors are not exercised.
- Live sites change; rerun the script to refresh the record.
