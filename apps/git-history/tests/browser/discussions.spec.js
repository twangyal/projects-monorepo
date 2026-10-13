import { test, expect, openSession, discover, openSource, manualReport, downloadText } from './fixtures.js';

test.use({ githubDiscussion: true });

test('pull-request discussion is retrieved only when asked, quoted safely, linked to its commit and kept in both downloads', async ({ page, workbench }) => {
  await openSession(page, workbench);
  await discover(page);
  await openSource(page);
  await expect(page.locator('#fetch-discussions')).not.toBeChecked();
  await manualReport(page);
  const frame = page.frameLocator('#report-frame');
  await expect(frame.locator('#overview')).toBeVisible();
  await expect(frame.locator('#discussions')).toHaveCount(0);
  await expect(frame.locator('.evidence-note')).toContainText('have not been fetched');
  expect(JSON.parse(await downloadText(page, '#download-json')).retrieved_discussions).toBeUndefined();

  await page.locator('#fetch-discussions').check();
  await manualReport(page);
  await expect(page.locator('#report-description')).toContainText('GitHub pull-request discussion retrieved');
  const section = frame.locator('#discussions');
  await expect(section.locator('h3').first()).toHaveText('Raise the return value <img src=x onerror="globalThis.OWNED=1">');
  await expect(section).toContainText('The caller needed a two-step offset.');
  await expect(section).toContainText('Why two rather than one? <b>bold</b>');
  await expect(section).toContainText('Closes issue #3: Offset is off by one');
  await expect(section.getByRole('link', { name: 'Open pull request ↗' })).toHaveAttribute('href', 'https://github.com/fixture/local-evidence/pull/1');
  // The changing commit's timeline entry points at its pull request.
  await expect(frame.locator(`[id="commit-${workbench.changed}"] .change-meta`)).toContainText('Pull request #1');
  await expect(frame.locator('#synopsis')).toContainText('Quoted description excerpt');
  expect(await page.evaluate(() => globalThis.OWNED)).toBeUndefined();

  const json = JSON.parse(await downloadText(page, '#download-json'));
  expect(json.retrieved_discussions.pulls.map(pull => [pull.number, pull.commits])).toEqual([[1, [workbench.changed]]]);
  expect(json.retrieved_discussions.pulls[0].comments.map(comment => comment.kind)).toEqual(['file-review-comment', 'review']);
  const html = await downloadText(page, '#download-html');
  expect(html).toContain('&lt;script&gt;globalThis.OWNED=1&lt;/script&gt;');
  expect(html).not.toContain('<script>globalThis.OWNED');
});
