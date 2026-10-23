import { test, expect, openSession, discover, openSource, manualReport, downloadText } from './fixtures.js';

test.use({ githubDirectIssues: true });

test('direct commit referenced issue is opt-in, safely quoted and retained in both native downloads', async ({ page, workbench }) => {
  await openSession(page, workbench);
  await discover(page); await openSource(page); await manualReport(page);
  const frame = page.frameLocator('#report-frame');
  await expect(frame.locator('#discussions')).toHaveCount(0);
  expect(JSON.parse(await downloadText(page, '#download-json')).retrieved_discussions).toBeUndefined();
  await page.locator('#fetch-discussions').check(); await manualReport(page);
  const issue = frame.locator('#referenced-issue-9');
  await expect(issue.getByRole('heading')).toHaveText('Referenced issue #9: Direct issue <script>');
  await expect(issue).toContainText('The direct change needs this task context.');
  await expect(issue).toContainText('reference does not establish intent or closure');
  await expect(issue.getByRole('link', { name: 'Open referenced issue ↗' })).toHaveAttribute('href', 'https://github.com/fixture/local-evidence/issues/9');
  await expect(issue.locator(`a[href="about:srcdoc#commit-${workbench.changed}"]`)).toHaveCount(1);
  const data = JSON.parse(await downloadText(page, '#download-json'));
  expect(data.retrieved_discussions.pulls).toEqual([]);
  expect(data.retrieved_discussions.referenced_issues.map(i => [i.number, i.commits])).toEqual([[9, [workbench.changed]]]);
  expect(data.synopsis.referenced_issues[0].evidence_anchor).toBe('referenced-issue-9');
  const html = await downloadText(page, '#download-html');
  expect(html).toContain('Direct issue &lt;script&gt;');
  expect(html).not.toContain('Direct issue <script>');
});
