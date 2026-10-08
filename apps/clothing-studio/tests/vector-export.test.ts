import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, MAX_TOTAL_POINTS } from '../src/model.ts';
import { exportGarmentSvg, garmentSvg } from '../src/graphics.ts';

test('vector download is stable, transparent and contains garment shapes only', async () => {
  const project = createProject();
  project.title = 'A & <script>vector</script>\u0000';
  project.note = 'PRIVATE NOTE';
  project.photo = { dataUrl: 'data:image/jpeg;base64,/9j/2Q==', width: 300, height: 400, name: 'PRIVATE PHOTO' };
  project.garment.pattern = 'stripe';
  project.strokes = [{ id: 'mark', color: '#ff0000', width: 4, points: [{ x: .5, y: .5 }] }];
  const before = JSON.stringify(project);
  const blob = exportGarmentSvg(project);
  assert.equal(blob.type, 'image/svg+xml;charset=utf-8');
  const svg = await blob.text();
  assert.match(svg, /width="400" height="440" viewBox="0 0 400 440"/);
  assert.match(svg, /A &amp; &lt;script&gt;vector&lt;\/script&gt;\ufffd/);
  assert.match(svg, /<circle cx="200" cy="220" r="2" fill="#ff0000"/);
  assert.match(svg, /<pattern /);
  assert.doesNotMatch(svg, /<image|<script|<foreignObject|PRIVATE|data:image|data-sample-person|href=/);
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  for (const ref of svg.matchAll(/(?:url\(#|aria-labelledby=")([^)"]+)/g)) assert.ok(ids.includes(ref[1]));
  garmentSvg(project); // Rendering a workspace view cannot alter portable bytes.
  assert.equal(await exportGarmentSvg(project).text(), svg);
  assert.equal(JSON.stringify(project), before);
});

test('maximum vector artwork retains all 100 paths and 12000 points within 1 MiB', async () => {
  const project = createProject();
  project.garment.pattern = 'weave';
  project.strokes = Array.from({ length: 100 }, (_, stroke) => ({
    id: `mark-${stroke}`, color: '#123456', width: 20,
    points: Array.from({ length: 120 }, (_, point) => ({ x: point / 119, y: stroke / 99 })),
  }));
  const blob = exportGarmentSvg(project), svg = await blob.text();
  assert.ok(blob.size <= 1024 * 1024);
  assert.equal([...svg.matchAll(/stroke="#123456"/g)].length, 100);
  // Count only sketch paths, excluding the outline and procedural pattern.
  const paths = [...svg.matchAll(/<path d="([^"]+)" fill="none" stroke="#123456"/g)];
  assert.equal(paths.reduce((count, path) => count + path[1].split(/ [ML] /).length, 0), MAX_TOTAL_POINTS);
});

test('vector export rejects unsafe project fields and artwork quotas before producing a file', () => {
  const project = createProject();
  project.garment.color = 'url(https://example.com)';
  assert.throws(() => exportGarmentSvg(project), /color/i);
  project.garment.color = '#123456'; project.garment.bodyWidth = Infinity;
  assert.throws(() => exportGarmentSvg(project), /bodyWidth/i);
  project.garment.bodyWidth = 220;
  project.strokes = Array.from({ length: 101 }, (_, i) => ({ id: String(i), color: '#123456', width: 1, points: [{ x: .5, y: .5 }] }));
  assert.throws(() => exportGarmentSvg(project), /100/);
});
