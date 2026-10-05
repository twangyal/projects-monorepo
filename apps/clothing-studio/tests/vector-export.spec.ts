import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createProject, type Project } from '../src/model.ts';

async function download(page: Page, name: string) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name, exact: true }).click()]);
  return { bytes: await readFile((await file.path())!), name: file.suggestedFilename() };
}

async function importProject(page: Page, project: Project) {
  await page.getByLabel('Import project backup').setInputFiles({ name: 'vector.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.getByLabel('Concept name')).toHaveValue(project.title);
}

async function decode(page: Page, bytes: Buffer, type: string) {
  return page.evaluate(async ({ data, type }) => {
    const blob = new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type });
    const url = URL.createObjectURL(blob), image = new Image();
    try {
      image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const at = (x: number, y: number) => [...pixels.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4)];
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(b => b.toString(16).padStart(2, '0')).join('');
      return { width: canvas.width, height: canvas.height, hash, center: at(200, 220), corner: at(0, 0), clipped: at(20, 308), line: at(200, 308) };
    } finally { image.src = ''; URL.revokeObjectURL(url); }
  }, { data: bytes.toString('base64'), type });
}

for (const pattern of ['plain', 'stripe', 'weave'] as const) {
  test(`downloaded ${pattern} vector renders exact PNG pixels and keeps editable paths`, async ({ page }) => {
    await page.goto('/');
    const project = createProject(); project.title = 'A & <vector>'; project.note = 'PRIVATE NOTE';
    project.garment.pattern = pattern; project.garment.color = '#3f5468';
    project.strokes = [
      { id: 'dot', color: '#ff0000', width: 10, points: [{ x: .5, y: .5 }] },
      { id: 'line', color: '#00ff00', width: 10, points: [{ x: .05, y: .7 }, { x: .95, y: .7 }] },
    ];
    await importProject(page, project);
    const svg = await download(page, 'Export garment SVG');
    expect(svg.name).toBe('A  vector-garment.svg');
    const parsed = await page.evaluate(markup => {
      const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
      const ids = new Set([...doc.querySelectorAll('[id]')].map(node => node.id));
      return { error: !!doc.querySelector('parsererror'), title: doc.querySelector('title')?.textContent, namespace: doc.documentElement.namespaceURI,
        bad: doc.querySelectorAll('script, image, foreignObject').length,
        refs: [...doc.querySelectorAll('[clip-path], [fill], [aria-labelledby]')].every(node => [...node.attributes].every(attribute => {
          const id = attribute.value.match(/^url\(#(.+)\)$/)?.[1] ?? (attribute.name === 'aria-labelledby' ? attribute.value : undefined);
          return id === undefined || ids.has(id);
        })) };
    }, svg.bytes.toString('utf8'));
    expect(parsed).toEqual({ error: false, title: project.title, namespace: 'http://www.w3.org/2000/svg', bad: 0, refs: true });
    expect(svg.bytes.toString('utf8')).not.toContain('PRIVATE NOTE');
    const vector = await decode(page, svg.bytes, 'image/svg+xml');
    const png = await decode(page, (await download(page, 'Export garment PNG')).bytes, 'image/png');
    expect(vector).toEqual(png);
    expect([vector.width, vector.height]).toEqual([400, 440]);
    expect(vector.center).toEqual([255, 0, 0, 255]);
    expect(vector.line).toEqual([0, 255, 0, 255]);
    expect(vector.corner[3]).toBe(0); expect(vector.clipped[3]).toBe(0);
    expect(JSON.parse((await download(page, 'Export project backup')).bytes.toString())).toEqual(project);
  });
}

test('maximum vector topology downloads, decodes and preserves complete artwork', async ({ page }) => {
  await page.goto('/'); const project = createProject(); project.garment.pattern = 'weave';
  project.strokes = Array.from({ length: 100 }, (_, stroke) => ({ id: `mark-${stroke}`, color: '#123456', width: 20,
    points: Array.from({ length: 120 }, (_, point) => ({ x: point / 119, y: stroke / 99 })) }));
  await importProject(page, project);
  const svg = await download(page, 'Export garment SVG');
  expect(svg.bytes.length).toBeLessThanOrEqual(1024 * 1024);
  expect([...svg.bytes.toString().matchAll(/stroke="#123456"/g)]).toHaveLength(100);
  expect(await decode(page, svg.bytes, 'image/svg+xml')).toEqual(await decode(page, (await download(page, 'Export garment PNG')).bytes, 'image/png'));
  expect(JSON.parse((await download(page, 'Export project backup')).bytes.toString())).toEqual(project);
});

test('keyboard vector download retires an unfinished sketch and preserves redo', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Ink blue' }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const before = await download(page, 'Export project backup');
  const box = (await page.getByRole('img', { name: 'Garment sketch canvas', exact: true }).boundingBox())!;
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5); await page.mouse.down();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export garment SVG', exact: true }).press('Enter'); await waiting;
  await page.mouse.up();
  expect((await download(page, 'Export project backup')).bytes).toEqual(before.bytes);
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
  await expect(page.locator('#stroke-count')).toHaveText('0 strokes');
});

test('vector download is available on a narrow screen without external requests', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const external: string[] = [], errors: string[] = [];
  const origin = new URL(baseURL!).origin;
  page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) external.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await download(page, 'Export garment SVG');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(external).toEqual([]); expect(errors).toEqual([]);
});
