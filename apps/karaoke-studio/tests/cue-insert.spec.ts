import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { test, openTiming, fromServer } from './sequential-timing-fixtures';
async function fillInsert(page: Page, text: string, start: string, end: string) {
  await page.getByText('Add lyric line', { exact: true }).click();
  await page.getByLabel('New lyric words', { exact: true }).fill(text);
  await page.getByLabel('New line start (seconds)', { exact: true }).fill(start);
  await page.getByLabel('New line end (seconds)', { exact: true }).fill(end);
}
test('insert missed words with one Undo/Redo edit and exact saved reopened SRT', async ({ page, timingClips, request }) => {
  const project = await timingClips.create([{ start: 0, end: 1, text: 'First' }, { start: 3, end: 6, text: 'Last' }]);
  await openTiming(page, project);
  await page.getByLabel('End line 1', { exact: true }).fill('1.000');
  await page.getByLabel('Start line 2', { exact: true }).fill('3.000');
  await fillInsert(page, '  missed café 🌓  ', '1.25', '2.75');
  await page.getByRole('button', { name: 'Insert lyric line', exact: true }).click();
  await expect(page.locator('[data-cue]')).toHaveCount(3);
  await expect(page.getByLabel('Lyric line 2', { exact: true })).toHaveValue('  missed café 🌓  ');
  await expect(page.getByLabel('End line 1', { exact: true })).toHaveValue('1.000');
  await expect(page.getByLabel('Start line 3', { exact: true })).toHaveValue('3.000');
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click(); await expect(page.locator('[data-cue]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Redo lyric edit', exact: true }).click(); await expect(page.locator('[data-cue]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click(); await expect(page.locator('#message')).toContainText('saved locally');
  expect((await fromServer(request, project.id)).cues).toEqual([{ start: 0, end: 1, text: 'First' }, { start: 1.25, end: 2.75, text: '  missed café 🌓  ' }, { start: 3, end: 6, text: 'Last' }]);
  await page.reload(); await expect(page.getByLabel('Lyric line 2', { exact: true })).toHaveValue('  missed café 🌓  ');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export timed lyrics', exact: true }).click()]);
  expect(await readFile((await download.path())!, 'utf8')).toBe('1\n00:00:00,000 --> 00:00:01,000\nFirst\n\n2\n00:00:01,250 --> 00:00:02,750\n  missed café 🌓  \n\n3\n00:00:03,000 --> 00:00:06,000\nLast\n');
});
test('refused insertion keeps raw invalid cue fields new words title pasted draft and Redo', async ({ page, timingClips }) => {
  await openTiming(page, await timingClips.create([{ start: 0, end: 1, text: 'First' }]));
  await page.getByLabel('Clip title').fill('Title draft'); await page.getByLabel('Paste lyrics, one line per cue').fill('Unapplied words');
  await page.getByLabel('End line 1', { exact: true }).fill('');
  await fillInsert(page, 'Missed', '2', '3');
  await page.getByRole('button', { name: 'Insert lyric line', exact: true }).click();
  await expect(page.locator('#line-insert-status')).toContainText('kept'); await expect(page.locator('[data-cue]')).toHaveCount(1);
  await expect(page.getByLabel('End line 1', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('New lyric words', { exact: true })).toHaveValue('Missed');
  await expect(page.getByLabel('Clip title')).toHaveValue('Title draft'); await expect(page.getByLabel('Paste lyrics, one line per cue')).toHaveValue('Unapplied words');
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Redo lyric edit', exact: true })).toBeEnabled();
  await page.getByLabel('New line start (seconds)', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Insert lyric line', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Redo lyric edit', exact: true })).toBeEnabled();
});
test('empty-clip insertion works with narrow-screen keyboard entry and resets utility drafts on reopen', async ({ page, timingClips }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  const project = await timingClips.create([]); await openTiming(page, project);
  await fillInsert(page, 'First supplied line', '0', '6');
  await page.getByRole('button', { name: 'Insert lyric line', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('First supplied line');
  await expect(page.getByLabel('New lyric words', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click(); await expect(page.locator('#message')).toContainText('saved locally');
  await page.getByLabel('New lyric words', { exact: true }).fill('Utility draft');
  await page.reload(); await page.getByText('Add lyric line', { exact: true }).click();
  await expect(page.getByLabel('New lyric words', { exact: true })).toHaveValue('');
});

test('accepted decimal spellings become valid native cue fields after insertion', async ({ page, timingClips }) => {
  await openTiming(page, await timingClips.create([]));
  await fillInsert(page, 'Literal line', '+1e0', '2.');
  await page.getByRole('button', { name: 'Insert lyric line', exact: true }).click();
  await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('End line 1', { exact: true })).toHaveValue('2');
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click();
  await page.getByRole('button', { name: 'Redo lyric edit', exact: true }).click();
  await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue('1');
});
