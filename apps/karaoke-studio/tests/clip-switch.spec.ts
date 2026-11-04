import { expect } from '@playwright/test';
import { test, openTiming, captureTwo, editorCues, fromServer, INITIAL_CUES } from './sequential-timing-fixtures.ts';

test('declining a saved clip switch keeps staged timing, and accepting opens the selected clip', async ({ page, timingClips }) => {
  const original = await timingClips.create();
  const next = await timingClips.create();
  await openTiming(page, original);
  await captureTwo(page);
  const selector = page.getByRole('combobox', { name: 'Saved clips', exact: true });

  const prompts: string[] = [];
  let allowSwitch = false;
  page.on('dialog', async dialog => {
    prompts.push(dialog.message());
    await (allowSwitch ? dialog.accept() : dialog.dismiss());
  });
  await selector.selectOption(next.id);
  await expect(selector).toHaveValue(original.id);
  await expect(page.locator('#timing-apply')).toBeEnabled();
  expect(prompts).toEqual(['Discard staged lyric work and open a different clip?']);
  expect(await editorCues(page)).toEqual(INITIAL_CUES);

  allowSwitch = true;
  await selector.selectOption(next.id);
  await expect(page).toHaveURL(new RegExp(`project=${next.id}$`));
  await expect(selector).toHaveValue(next.id);
  await expect(page.locator('#timing-review')).toBeHidden();
  expect(prompts).toHaveLength(2);
});

test('declining deletion keeps captured timing and the saved clip', async ({ page, request, timingClips }) => {
  const original = await timingClips.create();
  await openTiming(page, original);
  await captureTwo(page);
  const prompts: string[] = [];
  page.on('dialog', async dialog => {
    prompts.push(dialog.message());
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Delete selected clip' }).click();
  await expect(page.locator('#timing-apply')).toBeEnabled();
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain('cannot be undone');
  expect(await fromServer(request, original.id)).toEqual(original);

  await page.locator('#timing-apply').click();
  expect(await editorCues(page)).not.toEqual(INITIAL_CUES);
});
