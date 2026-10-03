import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project } from '../src/model.ts';
import { exportPng, garmentPath, garmentSvg, previewSize, previewSvg } from '../src/graphics.ts';

function createProject(): Project {
  return {
    schemaVersion: 1, title: 'Test shirt', note: '',
    garment: { bodyWidth: 220, bodyLength: 250, sleeveLength: 45, neckline: 'round', color: '#c07858', pattern: 'plain', patternColor: '#f4ece1' },
    strokes: [], placement: { x: 0.5, y: 0.42, width: 0.6, height: 0.5, rotation: 0, opacity: 1 }, photo: null,
  };
}

test('every extreme T-shirt shape stays within the 400 by 440 garment stage', () => {
  const project = createProject();
  for (const bodyWidth of [160, 260]) for (const bodyLength of [180, 300]) for (const sleeveLength of [25, 65]) for (const neckline of ['round', 'v'] as const) {
    const path = garmentPath({ ...project.garment, bodyWidth, bodyLength, sleeveLength, neckline });
    assert.ok(path.startsWith('M ') && path.endsWith('Z'));
    const numbers = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    for (let i = 0; i < numbers.length; i += 2) {
      assert.ok(numbers[i] >= 0 && numbers[i] <= 400);
      assert.ok(numbers[i + 1] >= 0 && numbers[i + 1] <= 440);
    }
  }
});

test('neckline, sleeve, width, and length controls all change real garment geometry', () => {
  const garment = createProject().garment;
  for (const change of [{ neckline: garment.neckline === 'round' ? 'v' : 'round' }, { bodyWidth: garment.bodyWidth === 160 ? 260 : 160 }, { bodyLength: garment.bodyLength === 180 ? 300 : 180 }, { sleeveLength: garment.sleeveLength === 25 ? 65 : 25 }]) {
    assert.notEqual(garmentPath({ ...garment, ...change } as typeof garment), garmentPath(garment));
  }
});

test('garment SVG clips procedural textures and normalized sketch strokes to the silhouette', () => {
  const project = createProject();
  project.garment.pattern = 'stripe';
  project.strokes = [{ id: 'sketch', color: '#123456', width: 8, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }];
  const svg = garmentSvg(project);
  assert.match(svg, /viewBox="0 0 400 440"/);
  assert.match(svg, /<clipPath id="[^"]+"[^>]*>/);
  assert.match(svg, /<pattern /);
  assert.match(svg, /clip-path="url\(#[^)]+\)"/);
  assert.match(svg, /stroke="#123456"/);
  assert.match(svg, /d="M 0 0 L 400 440"/);
  assert.match(svg, /stroke-width="8"/);
  assert.doesNotMatch(svg, /<rect[^>]+width="400"[^>]+height="440"/);
  project.strokes[0].points = [{ x: 0.5, y: 0.5 }];
  assert.match(garmentSvg(project), /<circle cx="200" cy="220" r="4"/);
});

test('plain, stripe, and weave textures have distinct shared rendering', () => {
  const project = createProject();
  project.garment.pattern = 'plain';
  assert.doesNotMatch(garmentSvg(project), /<pattern /);
  project.garment.pattern = 'stripe';
  assert.match(garmentSvg(project), /<pattern /);
  project.garment.pattern = 'weave';
  const woven = garmentSvg(project);
  assert.match(woven, /<pattern /);
  assert.match(woven, /stroke-opacity=/);
});

test('SVG user labels are escaped and every internal reference resolves within its own document', () => {
  const project = createProject();
  project.title = 'A <shirt> & "style"';
  project.garment.pattern = 'weave';
  const documents = [garmentSvg(project), previewSvg(project), garmentSvg(project)];
  const allIds: string[] = [];
  for (const svg of documents) {
    assert.match(svg, /A &lt;shirt&gt; &amp; &quot;style&quot;/);
    assert.doesNotMatch(svg, /<shirt>/);
    const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    allIds.push(...ids);
    for (const reference of svg.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(reference[1]));
  }
  assert.equal(new Set(allIds).size, allIds.length);
});

test('sample preview has authored vector person, neutral background, and exact placement transforms', () => {
  const project = createProject();
  assert.deepEqual(previewSize(project), { width: 600, height: 800 });
  project.placement = { x: 0.25, y: 0.5, width: 0.5, height: 0.5, rotation: 30, opacity: 0.6 };
  const svg = previewSvg(project);
  assert.match(svg, /viewBox="0 0 600 800"/);
  assert.match(svg, /data-sample-person/);
  assert.match(svg, /<rect[^>]+width="600"[^>]+height="800"/);
  assert.match(svg, /translate\(150 400\) rotate\(30\) scale\(0.75 0.909091\) translate\(-200 -220\)/);
  assert.match(svg, /opacity="0.6"/);
});

test('photo preview uses validated local JPEG only and follows its dimensions', () => {
  const project = createProject();
  project.photo = { dataUrl: 'data:image/jpeg;base64,/9j/2Q==', width: 1200, height: 600, name: 'Sample & photo.jpg' };
  assert.deepEqual(previewSize(project), { width: 1200, height: 600 });
  const svg = previewSvg(project);
  assert.match(svg, /viewBox="0 0 1200 600"/);
  assert.match(svg, /<image[^>]+href="data:image\/jpeg;base64,\/9j\/2Q=="/);
  assert.doesNotMatch(svg, /data-sample-person/);
  assert.doesNotMatch(svg, /href="https?:/);
});

test('all public SVG functions reject unvalidated numbers and unsafe colors or photo URLs', () => {
  const invalid = createProject();
  invalid.garment.bodyWidth = NaN;
  for (const render of [garmentSvg, previewSvg, previewSize]) assert.throws(() => render(invalid));
  assert.throws(() => garmentPath(invalid.garment));
  const unsafe = createProject();
  unsafe.garment.color = 'url(https://example.com)';
  assert.throws(() => garmentSvg(unsafe));
  unsafe.garment.color = '#123456';
  unsafe.photo = { dataUrl: 'https://example.com/photo.jpg', width: 600, height: 800, name: 'Remote' };
  assert.throws(() => previewSvg(unsafe));
});

test('PNG export rejects invalid project data and kind before touching browser resources', async () => {
  const project = createProject();
  project.placement.rotation = Infinity;
  await assert.rejects(exportPng(project, 'garment'), /rotation/i);
  await assert.rejects(exportPng(createProject(), 'other' as 'garment'), /kind/i);
});

test('labels containing XML-invalid characters cannot break SVG image decoding', () => {
  const project = createProject();
  project.title = 'Shirt\u0000\u000b\uffff\ud800 & style';
  for (const svg of [garmentSvg(project), previewSvg(project)]) {
    assert.ok(Array.from(svg).every(character => ![0, 11, 65535, 55296].includes(character.codePointAt(0)!)));
    assert.match(svg, /&amp; style/);
  }
});
