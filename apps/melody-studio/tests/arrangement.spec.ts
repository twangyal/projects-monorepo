import { test, expect } from '@playwright/test';
import { savedProject } from './browser/continuation-fixtures.ts';

test('capture, duplicate, transpose, repeat, undo and export a layered idea', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try demo melody' }).click();
  await expect(page.locator('#notice')).toContainText('Detected');
  const captured = await savedProject(page);
  await page.getByRole('button', { name: 'Duplicate track', exact: true }).click();
  await expect(page.getByLabel('Track name')).toHaveValue('Melody copy');
  await page.getByRole('button', { name: 'Transpose down an octave', exact: true }).click();
  await page.getByRole('button', { name: 'Repeat phrase', exact: true }).click();
  const arranged = await savedProject(page);
  expect(arranged.tracks).toHaveLength(2);
  expect(arranged.tracks[1].notes).toHaveLength(captured.tracks[0].notes.length * 2);
  expect(arranged.tracks[1].notes[0].pitch).toBe(captured.tracks[0].notes[0].pitch - 12);
  expect(arranged.tracks[0]).toEqual(captured.tracks[0]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await savedProject(page)).tracks[1].notes).toHaveLength(captured.tracks[0].notes.length);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(await savedProject(page)).toEqual(arranged);
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export MIDI', exact: true }).click();
  expect((await exported).suggestedFilename()).toMatch(/\.mid$/);
  await page.reload();
  expect(await savedProject(page)).toEqual(arranged);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('history restores replaced projects, branches edits and leaves native text undo alone', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load example' }).click();
  const original = await savedProject(page);
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await savedProject(page)).toEqual(original);
  // A text input keeps its native undo; it must not restore the preceding project snapshot.
  await page.getByLabel('Project title').fill('Typing here');
  await page.keyboard.press('Control+z');
  expect(await savedProject(page)).toEqual(original);
  await page.getByLabel('Project title').fill(original.title);
  await page.getByLabel('Project title').press('Tab');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
  await page.keyboard.press('Control+z');
  expect(await savedProject(page)).toEqual(original);
  await page.keyboard.press('Control+Shift+z');
  expect((await savedProject(page)).tracks[0].notes).toHaveLength(original.tracks[0].notes.length + 1);
});

test('a rejected transpose is atomic and does not consume undo history', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await page.getByLabel('Pitch (MIDI)').fill('36');
  await page.getByRole('button', { name: 'Apply note' }).click();
  const before = await savedProject(page);
  await page.getByRole('button', { name: 'Transpose down a semitone', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('C2');
  expect(await savedProject(page)).toEqual(before);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await savedProject(page)).tracks[0].notes[0].pitch).toBe(60);
});
