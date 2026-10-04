import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { createProject, validateProject, type Project } from '../src/model.ts';
import { validateAssetHeader } from '../src/images.ts';

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(kind: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(kind), data]);
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** Valid one-pixel PNG with bounded ancillary text, avoiding committed huge fixtures. */
function nearLimitProject(): Project {
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
    chunk('tEXt', Buffer.from('padding\0' + 'x'.repeat(1_034_900))),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const project = createProject();
  const drawing = project.layers[0];
  if (drawing.kind !== 'drawing') throw new Error('Expected a drawing layer.');
  drawing.cels[0].strokes = Array.from({ length: 10 }, () => ({
    color: '#123456', width: 1,
    points: Array.from({ length: 1000 }, () => ({ x: 1.23456789, y: 1.23456789 })),
  }));
  const image = { dataUrl: 'data:image/png;base64,' + png.toString('base64'), width: 1, height: 1 };
  validateAssetHeader(image);
  for (let index = 0; index < 4; index++) project.layers.push({
    id: `image-${index}`, name: 'Embedded pixel', kind: 'image', keys: drawing.keys, image,
  });
  return validateProject(project);
}

async function backup(page: Page): Promise<Buffer> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#backup').click()]);
  return readFile((await download.path())!);
}

test('a bounded project with genuine decoded PNGs can reopen its own backup', async ({ page }) => {
  const project = nearLimitProject(), original = Buffer.from(JSON.stringify(project));
  expect(original.length).toBeLessThan(6 * 1024 * 1024);
  // The previous pretty-printed download crossed the import cap for this fixture.
  expect(Buffer.byteLength(JSON.stringify(project, null, 2))).toBeGreaterThan(6 * 1024 * 1024);
  await page.goto('/');
  await page.locator('#project-file').setInputFiles({ name: 'large.motion.json', mimeType: 'application/json', buffer: original });
  await expect(page.locator('#message')).toContainText('Project opened.');
  const exported = await backup(page);
  expect(exported.length).toBeLessThanOrEqual(6 * 1024 * 1024);
  expect(exported.equals(original)).toBe(true);
  await page.locator('#project-file').setInputFiles({ name: 'roundtrip.motion.json', mimeType: 'application/json', buffer: exported });
  await expect(page.locator('#message')).toContainText('Project opened.');
  expect((await backup(page)).equals(original)).toBe(true);
});

test('drawing outside transformed artwork bounds fails cleanly and leaves drawing usable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await page.locator('#new-project').click();
  await page.locator('#pose-scale').fill('0.1');
  await page.locator('#set-key').click();
  const box = (await page.locator('#stage').boundingBox())!;
  await page.locator('#stage').click({ position: { x: 10, y: box.height / 2 } });
  await expect(page.locator('#message')).toContainText('outside the artwork bounds');
  const rejected: Project = JSON.parse((await backup(page)).toString());
  expect(rejected.layers[0].kind === 'drawing' && rejected.layers[0].cels[0].strokes.length).toBe(0);
  await page.locator('#stage').click({ position: { x: box.width / 2, y: box.height / 2 } });
  const recovered: Project = JSON.parse((await backup(page)).toString());
  expect(recovered.layers[0].kind === 'drawing' && recovered.layers[0].cels[0].strokes.length).toBe(1);
  expect(errors).toEqual([]);
});
