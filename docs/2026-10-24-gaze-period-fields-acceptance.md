# Gaze native month/week integration — #325

Source: `a26b195d233d694acd3a1b6b76cf8dbdc5e3f590` on canonical main. This record supersedes pending verification in the [implementation checkpoint](../apps/gaze-navigator/docs/2026-10-24-period-fields.md) and [plan](superpowers/plans/2026-10-24-gaze-period-fields.md).

Users can explicitly set native month (`YYYY-MM`) and ISO week (`YYYY-Www`, uppercase W) inputs and Undo each kind independently. Native calendar, min/max/step admission, captured identity/focus/locks, consequential confirmation, cancellation, exact input/change events and observed retained site values use the shared extension runtime. Overlay discovery/help and real injected-extension tests cover both kinds. No custom widgets, locale/relative inference, dependencies, permissions, workflow changes or relaxed deadlines.

## Review and regression evidence

Initial217units pass. Eight new intent cases produce6RED failures/2existing refusal passes, then8GREEN. A copied native fixture initially expected the old time action; corrected expectations and a controlled pre-feature interpreter reversion establish2actual native REDs, then restored GREEN. Do not treat the overlapping corrected native run as RED.

Fresh read-only review identified one Important: explicit period intent with extra spaces, Undo sentence punctuation or incomplete syntax could escape into generic editing/activation/model matching. Two new intent regressions reproduce competing text edits; a reserved whitespace-tolerant grammar fixes them, with incomplete/invalid explicit intent deterministically refusing. A separate regression preserves ordinary text payloads containing “month field”. Two native competing-control cases cover both kinds across four viewports. One fix pass, no rereview.

No Critical findings. Minor deferred: direct value-attribute/default step-base and existing >4-digit-year Undo period coverage; the shared native helper remains, but these are not claimed as new direct native tests. Review did not establish physical speech/gaze/intended-user acceptance or unobserved installed-extension/full-suite gates.

## Local verification

Final reviewed source:228/228units, syntax110files and extension-test build pass.56/56focused month/week cases pass47.1s. Earlier96/96date/time/month/week cases pass40.2s before the grammar repair; they are separate evidence. Local Node24.22.1, Playwright1.63.0 and portable Chromium143.0.7499.0 use a temporary uncommitted config; the portable run excludes installed-extension tests. No portable installed-extension success is claimed.

The initial complete portable run loads680cases before review, overlaps the grammar fix, and finishes676passed/4failed in8.8min. It is not final exact-commit full acceptance. Four20-second timeouts occur in unchanged `navigation.spec.js`: desktop confirmation timing, desktop/short maximum20drafts, desktop draft download/reopen. Calibration/compose-click waits are retained below. A one-worker final-source desktop/short retry finishes5passed/1failed in1.4min: desktop maximum20drafts still times out, while the other five cases pass. The standalone app imports and navigation test file are unchanged by this feature. These results cannot erase the failed full run or establish an environmental root cause. No timeout or product gate was loosened.

An attempted nonexistent `build:extension:test` command was corrected to existing `npm run build`; final build actually passes.

## Canonical verification

[Run40136272669](https://github.com/twangyal/projects-monorepo/actions/runs/40136272669) verifies the exact source across three isolated shards, including installed-extension cases. Two successful jobs establish518/780cases: [shard3/job120998340241](https://github.com/twangyal/projects-monorepo/actions/runs/40136272669/job/120998340241) passes255/255 in3.3min; [shard2/job120998340420](https://github.com/twangyal/projects-monorepo/actions/runs/40136272669/job/120998340420) passes263/263 in3.2min. Both confirm228units, syntax110 and build. Real installed-extension month/week set, step refusal and Undo pass in short/compact-boundary viewports. Shard1/job120998340417 remains in Chromium installation; complete780-case acceptance is still pending.

## Remaining destination

Gaze remains ACTIVE against the full extension-first vision. Physical speech/gaze accuracy, lifecycle and intended-user acceptance remain unverified in #132. Owner-deferred work and project#8 remain untouched; no PR was created.

Excerpts below remove trailing whitespace only; they are readable error records, not byte-exact full logs.

## Retained portable full-run failure excerpt

```text
  1) [desktop] › browser-tests/navigation.spec.js:112:1 › confirmation timing is gaze reachable and slower holds cannot activate prematurely

    Test timeout of 20000ms exceeded.

    Error: locator.click: Test timeout of 20000ms exceeded.
    Call log:
      - waiting for locator('#calibrationStage button')
        - locator resolved to <button class="calibration-dot" aria-label="Calibration point 1">3</button>
      - attempting click action
        - waiting for element to be visible, enabled and stable


      23 |
      24 | async function calibrate(page) {
    > 25 |   for (let i = 0; i < 27; i++) await page.locator('#calibrationStage button').click();
         |                                                                               ^
      26 |   await expect(page.locator('#playground')).toBeVisible();
      27 | }
      28 |
        at calibrate (/workspace/scratch/dea0b0842cca/melody-filter-323/apps/gaze-navigator/browser-tests/navigation.spec.js:25:79)
        at simulate (/workspace/scratch/dea0b0842cca/melody-filter-323/apps/gaze-navigator/browser-tests/navigation.spec.js:31:3)
        at /workspace/scratch/dea0b0842cca/melody-filter-323/apps/gaze-navigator/browser-tests/navigation.spec.js:143:3

    Error Context: test-results/navigation-confirmation-ti-ba7d1-cannot-activate-prematurely-desktop/error-context.md

  2) [desktop] › browser-tests/navigation.spec.js:310:1 › twenty maximum session drafts retain full text and refuse a new record without losing fields

    Test timeout of 20000ms exceeded.

    Error: locator.click: Test timeout of 20000ms exceeded.
    Call log:
      - waiting for locator('#composeButton')
        - locator resolved to <button id="composeButton" class="demo-target" data-gaze-target="" data-action="compose">Compose</button>
      - attempting click action
        - waiting for element to be visible, enabled and stable
        - element is visible, enabled and stable
        - scrolling into view if needed


      312 |  const body='字'.repeat(10000),title='题'.repeat(199);
      313 |  for(let i=0;i<20;i++){
    > 314 |   await page.locator('#composeButton').click();
          |                                        ^
      315 |   await page.locator('#draftSubject').fill(title+String.fromCharCode(65+i));
      316 |   await page.locator('#draftBody').fill(body);await page.locator('#saveDraft').click();
      317 |  }
        at /workspace/scratch/dea0b0842cca/melody-filter-323/apps/gaze-navigator/browser-tests/navigation.spec.js:314:40

    Error Context: test-results/navigation-twenty-maximum--35ee8-ecord-without-losing-fields-desktop/error-context.md

  3) [desktop] › browser-tests/navigation.spec.js:346:1 › gaze downloads saved drafts and reopens exact text after refresh without saving the composer

    Test timeout of 20000ms exceeded.

    Error Context: test-results/navigation-gaze-downloads--ef084-without-saving-the-composer-desktop/error-context.md

  4) [short] › browser-tests/navigation.spec.js:310:1 › twenty maximum session drafts retain full text and refuse a new record without losing fields

    Test timeout of 20000ms exceeded.

    Error: locator.click: Test timeout of 20000ms exceeded.
    Call log:
      - waiting for locator('#calibrationStage button')
        - locator resolved to <button class="calibration-dot" aria-label="Calibration point 4">2</button>
      - attempting click action
        - waiting for element to be visible, enabled and stable
        - element is visible, enabled and stable
        - scrolling into view if needed


      23 |
      24 | async function calibrate(page) {
    > 25 |   for (let i = 0; i < 27; i++) await page.locator('#calibrationStage button').click();
         |                                                                               ^
      26 |   await expect(page.locator('#playground')).toBeVisible();
      27 | }
      28 |
        at calibrate (/workspace/scratch/dea0b0842cca/melody-filter-323/apps/gaze-navigator/browser-tests/navigation.spec.js:25:79)
        at simulate (/workspace/scratch/dea0b0842cca/melody-filter-323/apps/gaze-navigator/browser-tests/navigation.spec.js:31:3)
        at /workspace/scratch/dea0b0842cca/melody-filter-323/apps/gaze-navigator/browser-tests/navigation.spec.js:329:22

    Error Context: test-results/navigation-twenty-maximum--35ee8-ecord-without-losing-fields-short/error-context.md

  4 failed
    [desktop] › browser-tests/navigation.spec.js:112:1 › confirmation timing is gaze reachable and slower holds cannot activate prematurely
    [desktop] › browser-tests/navigation.spec.js:310:1 › twenty maximum session drafts retain full text and refuse a new record without losing fields
    [desktop] › browser-tests/navigation.spec.js:346:1 › gaze downloads saved drafts and reopens exact text after refresh without saving the composer
    [short] › browser-tests/navigation.spec.js:310:1 › twenty maximum session drafts retain full text and refuse a new record without losing fields
  676 passed (8.8m)

```

## Retained one-worker retry failure excerpt

```text
  1) [desktop] › browser-tests/navigation.spec.js:310:1 › twenty maximum session drafts retain full text and refuse a new record without losing fields

    Test timeout of 20000ms exceeded.

    Error: locator.click: Test timeout of 20000ms exceeded.
    Call log:
      - waiting for locator('[data-draft-id="draft-20"] button')
        - locator resolved to <button data-gaze-target="">Open draft: 题题题题题题题题题题题题题题题题题题题题题题题题题题题题题题题题题题题题题…</button>
      - attempting click action
        - waiting for element to be visible, enabled and stable


      325 |  await page.locator('#draftBody').fill('Updated first maximum');await page.locator('#saveDraft').click();
      326 |  await expect(page.locator('#draftList [data-draft-id]')).toHaveCount(20);
    > 327 |  await page.locator('[data-draft-id="draft-20"] button').click();
          |                                                          ^
      328 |  await expect(page.locator('#draftSubject')).toHaveValue(title+'T');await expect(page.locator('#draftBody')).toHaveValue(body);
      329 |  await page.reload();await simulate(page);await expect(page.locator('#draftList [data-draft-id]')).toHaveCount(0);
      330 | });
        at /workspace/scratch/dea0b0842cca/melody-filter-323/apps/gaze-navigator/browser-tests/navigation.spec.js:327:58

    Error Context: test-results/navigation-twenty-maximum--35ee8-ecord-without-losing-fields-desktop/error-context.md

  1 failed
    [desktop] › browser-tests/navigation.spec.js:310:1 › twenty maximum session drafts retain full text and refuse a new record without losing fields
  5 passed (1.4m)

```
