import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import type {} from '../jobs-harness.ts';

test.beforeEach(async ({ page }) => { await page.goto('/tests/jobs-harness.html'); await page.waitForFunction(() => !!window.lensJobs); });
for (const target of [40, 50, 85]) test(`real worker and exact PNG agree at ${target}mm, including low alpha and displayed pixels`, async ({ page }) => {
  const result = await page.evaluate(target => window.lensJobs.roundTrip(target), target);
  expect(result.rgba).toEqual(result.expected); expect(result.coverage).toBe(result.expectedCoverage);
  const png = PNG.sync.read(Buffer.from(result.png), { checkCRC: true });
  expect([png.width, png.height]).toEqual([31, 19]); expect([...png.data]).toEqual(result.rgba);
  expect(result.decodedDisplay).toEqual(result.displayed); expect(result.preserved).toBe(true);
  expect(result.stats).toEqual({ created: 2, stopped: 2, live: 0 });
});
test('real jobs keep valid work alive through invalid/pre-aborted calls and recover from supersession/live abort', async ({ page }) => {
  const result = await page.evaluate(() => window.lensJobs.lifecycle());
  expect(result.invalid).toBe('Error'); expect(result.preAborted).toBe('AbortError');
  expect(result.afterInvalid).toEqual({ created: 1, stopped: 0, live: 1 }); expect(result.afterPreAborted).toEqual(result.afterInvalid);
  expect(result.superseded).toBe('AbortError'); expect(result.abortedName).toBe('AbortError'); expect(result.recovered).toBe(true);
  expect(result.stats).toEqual({ created: 4, stopped: 4, live: 0 });
});
test('real worker compressed-image decode failure rejects safely, cleans its worker and allows recovery', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const result = await page.evaluate(() => window.lensJobs.decodeFailure());
  expect(result).toEqual({ failed: 'Error', preserved: true, recovered: true, stats: { created: 2, stopped: 2, live: 0 } }); expect(errors).toEqual([]);
});
