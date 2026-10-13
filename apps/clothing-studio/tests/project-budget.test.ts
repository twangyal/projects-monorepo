import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validateProject, serializeProject, parseProject, ProjectHistory, MAX_PROJECT_BYTES, type Project } from '../src/model.ts';
import { template, validateProduct } from '../src/product.ts';
const bytes = (p: Project) => new TextEncoder().encode(JSON.stringify(p, null, 2)).length;
// Schema-level graph-budget fixtures only: these strings do not establish native image admission.
function assets(motifChars: number, artChars: number): Project {
  const p = createProject(); p.product = template('ringer'); p.product.name = 'é'.repeat(40);
  p.product.motifs = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, name: 'motif', dataUrl: 'data:image/png;base64,' + 'A'.repeat(motifChars), width: 768, height: 768 }));
  p.product.artwork = (['front', 'back'] as const).map(part => ({ part, dataUrl: 'data:image/png;base64,' + 'A'.repeat(artChars), width: 1024, height: 1024, name: 'art', xCm: 0, yCm: 10, widthCm: 20 }));
  return p;
}
test('complete project admission refuses individually admitted assets beyond the recoverable backup budget', () => {
  const p = assets(750000, 1800000);
  assert.doesNotThrow(() => validateProduct(p.product));
  assert.ok(bytes(p) > MAX_PROJECT_BYTES);
  assert.throws(() => validateProject(p), /6 MiB/);
});
test('canonical UTF-8 project budget admits exactly 6 MiB and preserves a complete reopenable graph', () => {
  const p = assets(500000, 1500000);
  p.product!.artwork[0].dataUrl += 'A'.repeat(MAX_PROJECT_BYTES - bytes(p));
  assert.equal(bytes(p), MAX_PROJECT_BYTES);
  assert.deepEqual(parseProject(serializeProject(validateProject(p))), p);
  p.product!.artwork[0].dataUrl += 'AAAA';
  assert.throws(() => validateProject(p), /6 MiB/);
});
test('rejected asset admission preserves current complete work and the redo branch', () => {
  const original = createProject(), history = new ProjectHistory(original);
  history.commit({ ...original, title: 'Existing edit' }); history.undo();
  assert.equal(history.canRedo, true);
  assert.throws(() => history.commit(assets(750000, 1800000)), /6 MiB/);
  assert.deepEqual(history.current, original); assert.equal(history.canRedo, true);
  history.redo(); assert.equal(history.current.title, 'Existing edit');
});
