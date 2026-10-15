import { test, expect, type Page } from './expanded-workspace';
import { readFile } from 'node:fs/promises';
import { independentPng } from '../oracle/fixtures';
import type { Project } from '../../src/types';

// Test builds serve tests/fixtures/fixture-depth.onnx: depth = mean of the normalized channels,
// so brighter pixels read as nearer. Inference really runs in onnxruntime-web in a worker.
async function backup(page: Page): Promise<Project> {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download project', exact: true }).click()]);
  return JSON.parse((await readFile((await file.path())!)).toString());
}
async function setup(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#save-status')).not.toContainText('Checking local');
  // Three vertical bands: bright (near), mid grey (subject) and dark (far).
  const width = 42, height = 28, rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const v = x < 14 ? 250 : x < 28 ? 128 : 6; rgba.set([v, v, v, 255], (y * width + x) * 4); }
  await page.getByLabel('Import photo', { exact: true }).setInputFiles({ name: 'bands.png', mimeType: 'image/png', buffer: independentPng({ width, height, rgba }) });
  await expect(page.locator('#render-status')).toContainText('Projection ready');
}
const labelsOf = (project: Project): number[] => [...Buffer.from(project.depth.labels, 'base64')];

test('an estimated depth proposal is reviewed, adjusted by clicking the subject, applied as one undoable mask edit and saved', async ({ page }) => {
  await setup(page);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  const original = await backup(page);
  await page.getByRole('button', { name: 'Estimate depth', exact: true }).click();
  await expect(page.locator('#depth-review')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#depth-estimate-status')).toContainText(/Depth estimated in [0-9.]+ s\. Review the proposal; nothing has changed yet\./);
  expect(await backup(page)).toEqual(original);

  // Clicking the grey band centres the subject band on its depth.
  const preview = page.locator('#depth-proposal'), box = (await preview.boundingBox())!;
  await preview.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
  await expect(page.locator('#depth-shares')).toContainText('Near 33% · Subject 33% · Far 33%');
  await page.getByRole('button', { name: 'Apply proposal as depth mask', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Estimated planes applied as one undoable edit');
  const applied = await backup(page), labels = labelsOf(applied);
  for (let y = 0; y < 28; y++) for (let x = 0; x < 42; x++) expect(labels[y * 42 + x]).toBe(x < 14 ? 0 : x < 28 ? 1 : 2);
  expect({ ...applied, depth: original.depth }).toEqual(original);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await backup(page)).toEqual(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('Saved locally');
  await page.reload();
  await expect(page.locator('#render-status')).toContainText('Projection ready');
  expect(labelsOf(await backup(page))).toEqual(labels);
  await expect(page.locator('#depth-review')).toBeHidden();
});

test('limits can be set with sliders, a new photo retires an old estimate, and an unhosted model is explained', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Estimate depth', exact: true }).click();
  await expect(page.locator('#depth-review')).toBeVisible({ timeout: 30000 });
  const setRange = (id: string, value: number) => page.locator(id).evaluate((input, v) => { (input as HTMLInputElement).value = String(v); input.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  await setRange('#depth-near-from', 700);
  await setRange('#depth-far-below', 600); // The grey band (about 0.5) now falls in the far plane.
  await expect(page.locator('#depth-shares')).toContainText('Near 33% · Subject 0% · Far 67%');
  await setRange('#depth-far-below', 800); // At or above the near limit: refused, sliders restored.
  await expect(page.locator('#depth-far-below')).toHaveValue('600');

  page.once('dialog', dialog => dialog.accept()); // Replacing the study is confirmed.
  await page.getByLabel('Import photo', { exact: true }).setInputFiles({ name: 'other.png', mimeType: 'image/png', buffer: independentPng({ width: 4, height: 4, rgba: new Uint8ClampedArray(64).fill(200) }) });
  await expect(page.locator('#render-status')).toContainText('Projection ready');
  await expect(page.locator('#depth-review')).toBeHidden();

  // A uniform photo has no depth variation; the failure is explained and nothing changes.
  await page.getByRole('button', { name: 'Estimate depth', exact: true }).click();
  await expect(page.locator('#depth-estimate-status')).toHaveText('The depth model found no depth variation in this photo.', { timeout: 30000 });
  await expect(page.locator('#depth-review')).toBeHidden();
});

test('without a hosted model people can choose a verified model file; a wrong file is refused', async ({ page }) => {
  await page.route('**/models/fixture-depth.onnx', route => route.fulfill({ status: 404, body: '' }));
  await setup(page);
  await page.getByRole('button', { name: 'Estimate depth', exact: true }).click();
  await expect(page.locator('#depth-estimate-status')).toHaveText('Choose the depth model file to continue.');
  await page.getByLabel('Choose depth model file').setInputFiles({ name: 'wrong.onnx', mimeType: 'application/octet-stream', buffer: Buffer.from('not a model') });
  await expect(page.locator('#depth-estimate-status')).toContainText('This is not the pinned test fixture depth model file');
  await page.getByLabel('Choose depth model file').setInputFiles('tests/fixtures/fixture-depth.onnx');
  await expect(page.locator('#depth-review')).toBeVisible({ timeout: 30000 });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
