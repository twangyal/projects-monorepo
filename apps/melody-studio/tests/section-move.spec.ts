import { test, expect } from './helpers/expanded-workspace.ts';
import { openRoll, readRoll, rollBackup, rollDownload, storedRoll, assertMidi, assertWav } from './roll-edit-fixtures.ts';
async function range(page: Parameters<typeof openRoll>[0], start = '1', end = '3', destination = '7') {
  await page.getByLabel('Section start beat', { exact: true }).fill(start);
  await page.getByLabel('Section end beat (exclusive)', { exact: true }).fill(end);
  await page.getByLabel('Move section to beat', { exact: true }).fill(destination);
}
test('all-track move preserves complete project identity through native history reload and independent MIDI/WAV', async ({ page }) => {
  const fixture = rollBackup(); fixture.document.composition.tracks[1].notes[0].start = 1.5;
  await openRoll(page, fixture); const before = await readRoll(page), expected = structuredClone(before);
  expected.document.composition.tracks[0].notes[0].start = 6 + 1 / 3;
  expected.document.composition.tracks[0].notes[1].start = 6.5;
  expected.document.composition.tracks[1].notes[0].start = 7.5;
  await range(page); await page.getByRole('button', { name: 'Move section', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Section moved'); expect(await readRoll(page)).toEqual(expected);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(await readRoll(page)).toEqual(before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(await readRoll(page)).toEqual(expected);
  assertMidi(await rollDownload(page, 'Export MIDI'), expected.document.composition);
  assertWav(await rollDownload(page, 'Export WAV'), expected.document.composition);
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser'); await page.reload(); expect(await readRoll(page)).toEqual(expected);
});
test('phone keyboard move keeps raw destination across navigation and no-op keeps Redo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 }); await openRoll(page); const before = await readRoll(page);
  await range(page, '1', '3', '7');
  const destination = page.getByLabel('Move section to beat', { exact: true }); await destination.fill(' 7x ');
  await page.getByRole('button', { name: 'Arrange', exact: true }).click(); await page.getByRole('button', { name: 'Compose', exact: true }).click(); await page.getByRole('button', { name: 'Arrange', exact: true }).click();
  await expect(destination).toHaveValue(' 7x '); await page.locator('#workspace-mode').click(); await destination.fill('7');
  await page.getByRole('button', { name: 'Move section', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#notice')).toContainText('Section moved'); const after = await readRoll(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(await readRoll(page)).toEqual(before);
  await page.getByLabel('Move section to beat', { exact: true }).fill('1'); await page.getByRole('button', { name: 'Move section', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('unchanged'); await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(await readRoll(page)).toEqual(after);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('collision and source boundary refusals preserve native project and Redo', async ({ page }) => {
  await openRoll(page); await page.getByRole('button', { name: 'Add note', exact: true }).click(); await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const before = await readRoll(page), stored = await storedRoll(page);
  for (const [start, end, destination, message] of [['1', '3', '3', 'occupied'], ['1.5', '3', '7', 'crosses'], ['1', '3', '512', 'Destination']]) {
    await range(page, start, end, destination); await page.getByRole('button', { name: 'Move section', exact: true }).click();
    await expect(page.locator('#notice')).toContainText(message); expect(await readRoll(page)).toEqual(before); expect(await storedRoll(page)).toEqual(stored);
    await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
  }
});
test('move refuses before pointer blur or keyboard can commit a valid unrelated project draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 }); await openRoll(page); await range(page);
  const before = await storedRoll(page), title = page.getByLabel('Project title'); await title.fill('Keep this unsent title');
  await page.getByRole('button', { name: 'Move section', exact: true }).click(); await expect(page.locator('#notice')).toContainText('unapplied');
  await expect(title).toHaveValue('Keep this unsent title'); await expect(title).toBeFocused(); expect(await storedRoll(page)).toEqual(before);
  // Valid basic names deliberately commit on blur. Use an explicit-Apply note draft for keyboard refusal.
  await title.fill('Original fractional overlap'); await page.locator('[data-note="fractional-low"]').click();
  const duration = page.getByLabel('Duration (beats)', { exact: true }); await duration.fill('1.25');
  await page.getByRole('button', { name: 'Move section', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#notice')).toContainText('unapplied'); await expect(duration).toHaveValue('1.25'); expect(await storedRoll(page)).toEqual(before);
});
