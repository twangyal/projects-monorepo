import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { withClip } from './melody-fixtures.ts';

test('the melody guide shows the sung notes as pitch bars in the preview and the exported video', async ({ page }, info) => withClip(page, async () => {
  test.setTimeout(120000);
  const melody = page.locator('#melody-guide'), stage = page.locator('#stage');
  await expect(melody).toHaveValue('hide');
  await expect(stage).not.toHaveAttribute('data-melody', /./);
  await melody.selectOption('show');
  await expect(stage).toHaveAttribute('data-melody', '4');
  await expect(page.locator('#melody-guide-status')).toHaveText('4 notes found.');
  // At five seconds the C is at the playhead.
  await page.locator('audio').evaluate(audio => { (audio as HTMLAudioElement).currentTime = 5; });
  await expect(stage).toHaveAttribute('data-melody-now', '60');
  const exported = page.waitForRequest(request => request.url().endsWith('/export') && request.method() === 'POST');
  const download = page.waitForEvent('download', { timeout: 90000 });
  await page.getByRole('button', { name: 'Export karaoke MP4', exact: true }).click();
  expect(JSON.parse((await exported).postData()!)).toEqual({ melody: true });
  const path = info.outputPath('melody.mp4');
  await (await download).saveAs(path);
  // In the video at five seconds, the C's bar just left of the playhead is in the sung colour and just right of it in
  // the colour still to be sung (the lane is 1000 px wide from x = 140, the playhead a fifth of the way along).
  const pixel = (x: number) => [...spawnSync('ffmpeg', ['-v', 'error', '-ss', '5', '-i', path, '-frames:v', '1', '-vf', `crop=1:1:${x}:196`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']).stdout];
  const near = (colour: number[], hex: string) => colour.every((value, i) => Math.abs(value - parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)) < 50);
  expect(near(pixel(328), '#e4b77d'), String(pixel(328))).toBe(true);
  expect(near(pixel(352), '#f7f5ed'), String(pixel(352))).toBe(true);
  await melody.selectOption('hide');
  await expect(stage).not.toHaveAttribute('data-melody', /./);
}));
