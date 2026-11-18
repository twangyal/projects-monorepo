import { test, expect } from '@playwright/test';
import { withClip } from './melody-fixtures.ts';

// The fixture sings four notes from 0.5 to 15 s, but recognition hears words only at 1-2.4, 4-5.6 and 9-11.4 s: the
// singing after the second line and most of the last note have no words.
test('singing with no words is pointed out, to listen to, recognize again or give its words', async ({ page }, info) => withClip(page, async id => {
  test.setTimeout(120000);
  const section = page.locator('#unheard-singing'), rows = section.locator('li');
  await expect(section).toBeVisible({ timeout: 20000 });
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#unheard-status')).toContainText('singing in 2 places where no words were recognized and the lyrics have no line');
  expect(await rows.first().locator('span').textContent()).toMatch(/^0:0[67]\.\d–0:0[89]\.\d$/);
  const label = (await rows.last().locator('span').textContent())!;
  expect(label).toMatch(/^0:1[12]\.\d–0:15\.0$/);
  await section.screenshot({ path: info.outputPath('unheard-singing.png') });
  const [start, end] = label.split('–').map(time => { const [minutes, seconds] = time.split(':'); return Number(minutes) * 60 + Number(seconds); });

  // Listen plays that passage.
  await page.getByRole('button', { name: `Listen: singing at ${label}`, exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(audio => !(audio as HTMLAudioElement).paused)).toBe(true);
  const at = await page.locator('audio').evaluate(audio => (audio as HTMLAudioElement).currentTime);
  expect(at).toBeGreaterThanOrEqual(start - 0.1);
  expect(at).toBeLessThanOrEqual(end + 0.1);
  await page.getByRole('button', { name: 'Stop practice', exact: true }).click();

  // Recognize again asks for that passage with a second of context either side (answered here, so no job runs).
  let asked: { start: number; end: number } | null = null;
  await page.route(`**/api/projects/${id}/transcribe-passage`, async route => {
    asked = route.request().postDataJSON();
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Held by the test.' }) });
  });
  await page.getByRole('button', { name: `Recognize again: singing at ${label}`, exact: true }).click();
  await expect.poll(() => asked).not.toBeNull();
  expect(asked!.start).toBeCloseTo(start - 1, 1);
  expect(asked!.end).toBeCloseTo(16, 1);
  await expect(page.locator('#recognition-passage-tools')).toHaveAttribute('open', '');
  await page.unroute(`**/api/projects/${id}/transcribe-passage`);

  // Add the words puts the passage into Add lyric line, ready for its words; inserting them takes it off the list.
  await page.getByRole('button', { name: `Add the words: singing at ${label}`, exact: true }).click();
  await expect(page.locator('#line-insert-text')).toBeFocused();
  expect(Number(await page.locator('#line-insert-start').inputValue())).toBeCloseTo(start, 1);
  expect(Number(await page.locator('#line-insert-end').inputValue())).toBeCloseTo(end, 1);
  await expect(page.locator('#line-insert-status')).toContainText(`Type the words sung at ${label}`);
  await page.locator('#line-insert-text').fill('la la la');
  await page.getByRole('button', { name: 'Insert lyric line', exact: true }).click();
  await expect(page.locator('#line-insert-status')).toContainText('Lyric line inserted');
  await expect(rows).toHaveCount(1);
  await expect(page.getByRole('button', { name: `Listen: singing at ${label}`, exact: true })).toHaveCount(0);
  // Undone, the passage is listed again.
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click();
  await expect(rows).toHaveCount(2);
}));
