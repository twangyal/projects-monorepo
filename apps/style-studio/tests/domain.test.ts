import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newId, createProject, validateProject, parseProject, serializeProject, setTitle,
  addPiece, updatePiece, deletePiece, addTaggedExample, setExampleLabel, deleteExample,
  saveLook, updateLook, deleteLook, rateLook, collectUnusedPhotos,
} from '../src/domain.ts';
import { LIMITS, ID_PATTERN, type Project, type PhotoAsset, type Tags, type Category } from '../src/types.ts';

const tags: Tags = { palette: 'neutral', fit: 'regular', style: 'minimal', formality: 'casual' };
const id = (value: number) => value.toString(16).padStart(32, '0');
function photo(value: number): PhotoAsset {
  const bytes = Buffer.from([255, 216, 255, 192, 0, 11, 8, 2, 208, 2, 208, 1, 1, 17, 0, 255, 217]);
  return { id: id(value), mime: 'image/jpeg', width: 720, height: 720, dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}` };
}
function wardrobe(): Project {
  let project = createProject();
  for (const category of ['top', 'bottom', 'shoes'] as const) project = addPiece(project, { name: category, category, tags, photoId: null });
  return project;
}
function withLook(project = wardrobe()): Project {
  return saveLook(project, [project.pieces[0].id, project.pieces[1].id, project.pieces[2].id], 'Quiet afternoon', 'Original note');
}

test('new profiles and generated IDs have detached validated defaults', () => {
  const project = createProject(); assert.equal(project.title, 'My style');
  assert.deepEqual(project, { schemaVersion: 1, title: 'My style', pieces: [], examples: [], looks: [], photos: [] });
  const ids = Array.from({ length: 100 }, newId); assert.equal(new Set(ids).size, 100);
  for (const value of ids) assert.match(value, ID_PATTERN);
  assert.equal(ID_PATTERN.test(`${ids[0]}\n`), false);
  const changed = setTitle(project, '  My notebook  '); assert.equal(changed.title, 'My notebook'); assert.equal(project.title, 'My style');
});

test('strict schema rejects unknown fields, prototypes, broken IDs and malformed shapes', () => {
  const project = wardrobe();
  for (const change of [
    (p: Project) => Object.assign(p, { schemaVersion: 2 }),
    (p: Project) => Object.assign(p, { surprise: true }),
    (p: Project) => Object.assign(p.pieces[0], { id: 'x' }),
    (p: Project) => Object.assign(p.pieces[0], { id: `${id(1)}\n` }),
    (p: Project) => Object.assign(p.pieces[0].tags, { extra: true }),
    (p: Project) => Object.assign(p.pieces[0].tags, { palette: 'purple' }),
    (p: Project) => Object.assign(p.pieces[0], { photoId: id(100) }),
    (p: Project) => { p.pieces[1].id = p.pieces[0].id; },
    (p: Project) => Object.setPrototypeOf(p, { unexpected: true }),
  ]) { const candidate = structuredClone(project); change(candidate); assert.throws(() => validateProject(candidate)); }
  assert.throws(() => validateProject(null)); assert.throws(() => validateProject([]));
  const sparse = structuredClone(project); delete sparse.pieces[0]; assert.throws(() => validateProject(sparse));
});

test('text bounds preserve captions and notes but reject invalid Unicode and controls', () => {
  assert.equal(setTitle(createProject(), 'x'.repeat(80)).title.length, 80);
  for (const title of ['', ' ', 'x'.repeat(81), 'x\u0000', '\ud800']) assert.throws(() => createProject(title));
  let project = addTaggedExample(createProject(), { caption: '  A\ncaption\tkept  ', label: 'like', tags, photoId: null });
  assert.equal(project.examples[0].caption, '  A\ncaption\tkept  ');
  project = withLook(wardrobe()); project = updateLook(project, project.looks[0].id, { notes: '\nNotes\tkept\n' });
  assert.equal(project.looks[0].notes, '\nNotes\tkept\n');
  assert.throws(() => updateLook(project, project.looks[0].id, { notes: 'x'.repeat(501) }));
  assert.throws(() => addTaggedExample(project, { caption: 'x'.repeat(161), label: 'like', tags, photoId: null }));
});

test('validation and serialization detach nested snapshots without changing caller input', () => {
  const project = withLook(); const original = structuredClone(project);
  const copy = validateProject(project); copy.looks[0].pieces[0].tags.palette = 'bright'; copy.pieces[0].name = 'Changed';
  assert.deepEqual(project, original);
  assert.deepEqual(parseProject(serializeProject(project)), project);
});

test('JSON rejects duplicate decoded keys, malformed syntax, deep nesting and UTF-8 size overflow', () => {
  const valid = serializeProject(createProject());
  assert.throws(() => parseProject(valid.replace('"title":', '"title":"first","ti\\u0074le":')), /duplicate/i);
  assert.throws(() => parseProject('{"nested":{"a":1,"a":2}}'), /duplicate/i);
  for (const text of ['{', '{"__proto__":{}}', `${'['.repeat(10000)}0${']'.repeat(10000)}`, valid + 'x']) assert.throws(() => parseProject(text));
  assert.throws(() => parseProject(' '.repeat(LIMITS.projectBytes) + valid), /8 MiB|large|limit/i);
  assert.throws(() => parseProject(`"${'é'.repeat(LIMITS.projectBytes / 2)}"`), /8 MiB|large|limit/i);
});

test('piece quotas include the destination category and errors are atomic', () => {
  let project = createProject();
  for (const category of ['top', 'bottom', 'shoes'] as const) for (let i = 0; i < 12; i++) project = addPiece(project, { name: `${category} ${i}`, category, tags, photoId: null });
  assert.equal(project.pieces.length, 36); const original = serializeProject(project);
  assert.throws(() => addPiece(project, { name: 'Extra', category: 'top', tags, photoId: null }));
  assert.throws(() => updatePiece(project, project.pieces[12].id, { category: 'top' }));
  assert.equal(serializeProject(project), original);
  project = deletePiece(project, project.pieces[0].id);
  const moved = updatePiece(project, project.pieces[11].id, { category: 'top' });
  assert.equal(moved.pieces.filter(piece => piece.category === 'top').length, 12);
});

test('unknown mutation fields, missing targets and malformed outfit selections reject without mutation', () => {
  const project = withLook(), original = serializeProject(project);
  assert.throws(() => updatePiece(project, project.pieces[0].id, { id: id(99) } as never));
  assert.throws(() => updateLook(project, project.looks[0].id, { pieces: [] } as never));
  for (const edit of [deletePiece, deleteExample, deleteLook]) assert.throws(() => edit(project, id(999)));
  assert.throws(() => setExampleLabel(project, id(999), 'like'));
  assert.throws(() => rateLook(project, id(999), 'like'));
  assert.throws(() => updatePiece(project, id(999), { name: 'Missing' }));
  assert.throws(() => saveLook(project, [project.pieces[1].id, project.pieces[0].id, project.pieces[2].id], 'Wrong order'));
  assert.equal(serializeProject(project), original);
});

test('saved look snapshots retain names, tags and photos after wardrobe edits and deletion', () => {
  const asset = photo(1000);
  let project = addPiece(createProject(), { name: 'Original top', category: 'top', tags, photoId: asset.id }, asset);
  for (const category of ['bottom', 'shoes'] as const) project = addPiece(project, { name: category, category, tags, photoId: null });
  project = withLook(project); const captured = structuredClone(project.looks[0]); const top = project.pieces[0].id;
  project = updatePiece(project, top, { name: 'New name', tags: { ...tags, palette: 'bright' }, photoId: null });
  project = deletePiece(project, top);
  assert.deepEqual(project.looks[0], captured); assert.equal(project.photos[0].id, asset.id);
  project = deleteLook(project, captured.id); assert.equal(project.photos.length, 0);
});

test('photo publication is atomic and collection traces all three reference locations', () => {
  const asset = photo(1000), other = photo(1001), original = createProject();
  assert.throws(() => addPiece(original, { name: '', category: 'top', tags, photoId: asset.id }, asset)); assert.equal(original.photos.length, 0);
  assert.throws(() => addPiece(original, { name: 'Top', category: 'top', tags, photoId: other.id }, asset));
  const project = addTaggedExample(original, { caption: 'Reference', label: 'like', tags, photoId: asset.id }, asset);
  project.photos.push(other);
  const collected = collectUnusedPhotos(project); assert.equal(collected.photos.length, 1); assert.equal(project.photos.length, 2);
  assert.equal(deleteExample(collected, collected.examples[0].id).photos.length, 0);
});

test('photo quota allows atomic replacement after garbage collection but rejects a 21st reference', () => {
  let project = createProject();
  for (let i = 0; i < 20; i++) { const asset = photo(1000 + i); project = addTaggedExample(project, { caption: 'Reference', label: 'like', tags, photoId: asset.id }, asset); }
  const extra = photo(2000), original = serializeProject(project);
  assert.throws(() => addTaggedExample(project, { caption: 'Extra', label: 'like', tags, photoId: extra.id }, extra));
  assert.equal(serializeProject(project), original);
  project = deleteExample(project, project.examples[0].id);
  project = addPiece(project, { name: 'Top', category: 'top', tags, photoId: extra.id }, extra);
  const replacement = photo(2001);
  project = updatePiece(project, project.pieces[0].id, { photoId: replacement.id }, replacement);
  assert.equal(project.photos.length, 20); assert.equal(project.photos.some(p => p.id === extra.id), false);
});

test('examples validate feature origins and root IDs are globally unique', () => {
  const project = addTaggedExample(wardrobe(), { caption: 'Example', label: 'like', tags, photoId: null });
  for (const patch of [
    { features: [NaN, ...project.examples[0].features.slice(1)] },
    { features: Array(14).fill(1 / 3) }, { sourceLookId: id(88) },
    { origin: 'other' }, { label: 'neutral' }, { id: project.pieces[0].id },
  ]) { const candidate = structuredClone(project); Object.assign(candidate.examples[0], patch); assert.throws(() => validateProject(candidate)); }
  const saved = withLook(project), rated = rateLook(saved, saved.looks[0].id, 'like');
  assert.equal(rated.examples.length, 2);
});

test('rating a saved look upserts at quota and remains independent after look deletion', () => {
  let project = withLook(); const lookId = project.looks[0].id;
  project = rateLook(project, lookId, 'like'); const exampleId = project.examples[0].id;
  for (let i = 1; i < 80; i++) project = addTaggedExample(project, { caption: `Example ${i}`, label: 'pass', tags, photoId: null });
  const previous = structuredClone(project.examples[0]);
  project = rateLook(project, lookId, 'pass'); assert.equal(project.examples.length, 80); assert.equal(project.examples[0].id, exampleId); assert.equal(project.examples[0].label, 'pass');
  assert.throws(() => addTaggedExample(project, { caption: 'Extra', label: 'like', tags, photoId: null }));
  project = setExampleLabel(project, exampleId, 'like'); assert.equal(project.examples[0].label, 'like');
  project = deleteLook(project, lookId); assert.deepEqual(project.examples[0].features, previous.features); assert.equal(project.examples[0].sourceLookId, lookId);
  assert.equal(project.examples[0].origin, 'outfit'); assert.equal(project.examples[0].photoId, null);
});

test('look quota, exact snapshot category order and duplicate rating sources are validated', () => {
  let project = wardrobe(); const ids = project.pieces.map(piece => piece.id) as [string, string, string];
  for (let i = 0; i < 30; i++) project = saveLook(project, ids, `Look ${i}`);
  assert.throws(() => saveLook(project, ids, 'Extra'));
  const wrong = structuredClone(project); (wrong.looks[0].pieces[0] as { category: Category }).category = 'shoes'; assert.throws(() => validateProject(wrong));
  project = rateLook(project, project.looks[0].id, 'like');
  const duplicate = structuredClone(project.examples[0]); duplicate.id = id(999); project.examples.push(duplicate);
  assert.throws(() => validateProject(project));
});

test('saved outfit ratings average actual snapshot tags and retain those features after live edits', () => {
  let project = wardrobe();
  project = updatePiece(project, project.pieces[1].id, { tags: { palette: 'warm', fit: 'relaxed', style: 'classic', formality: 'smart' } });
  project = updatePiece(project, project.pieces[2].id, { tags: { palette: 'warm', fit: 'fitted', style: 'playful', formality: 'formal' } });
  project = withLook(project); const lookId = project.looks[0].id;
  project = rateLook(project, lookId, 'like');
  assert.deepEqual(project.examples[0].features, [1 / 3, 2 / 3, 0, 0, 1 / 3, 1 / 3, 1 / 3, 1 / 3, 1 / 3, 0, 1 / 3, 1 / 3, 1 / 3, 1 / 3]);
  const features = [...project.examples[0].features];
  project = updatePiece(project, project.pieces[1].id, { tags });
  project = updateLook(project, lookId, { name: '  Renamed look  ', notes: 'Remembered differently' });
  project = rateLook(project, lookId, 'pass');
  assert.deepEqual(project.examples[0].features, features); assert.equal(project.examples[0].caption, 'Renamed look');
});

test('normalized photo validation rejects corrupt headers and never accepts an external URL', () => {
  const good = photo(1000);
  for (const patch of [{ dataUrl: 'https://example.com/photo.jpg' }, { width: 1 }, { dataUrl: 'data:image/jpeg;base64,eA==' }, { extra: true }]) {
    const invalid = { ...good, ...patch };
    assert.throws(() => addPiece(createProject(), { name: 'Top', category: 'top', tags, photoId: good.id }, invalid as PhotoAsset));
  }
});

test('profile validation rejects non-data photo objects before reading their fields', () => {
  const inherited = photo(1000); Object.setPrototypeOf(inherited, { injected: true });
  const symbol = photo(1001); Object.assign(symbol, { [Symbol('hidden')]: true });
  const accessor = photo(1002); let read = false;
  Object.defineProperty(accessor, 'dataUrl', { enumerable: true, get() { read = true; return photo(1002).dataUrl; } });
  for (const asset of [inherited, symbol, accessor]) {
    const project = createProject(); project.photos.push(asset);
    assert.throws(() => validateProject(project), /object|fields|data/i);
  }
  assert.equal(read, false);
});
