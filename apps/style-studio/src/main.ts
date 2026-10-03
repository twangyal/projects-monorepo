import './style.css';
import {
  addPiece, addTaggedExample, createProject, deleteExample, deleteLook, deletePiece,
  newId, parseProject, rateLook, saveLook, serializeProject, setExampleLabel,
  setTitle, updateLook, updatePiece,
} from './domain.ts';
import { createDemoProject } from './demo.ts';
import { featuresFromTags, tagsFromFeatures } from './features.ts';
import { assessOutfit, generateAlternatives, trainPreferenceModel } from './model.ts';
import { ProjectHistory } from './history.ts';
import { openProjectStore, type ProjectStore } from './storage.ts';
import { exportLookPng, normalizePhoto, validateProjectPhotos } from './images.ts';
import {
  FITS, FORMALITIES, LIMITS, PALETTES, STYLES,
  type Category, type Label, type Mode, type Occasion, type PhotoAsset,
  type Piece, type Project, type SavedLook, type Tags, type TasteScore,
} from './types.ts';

const mount = document.querySelector<HTMLDivElement>('#app');
if (!mount) throw new Error('The editor mount is missing.');
mount.innerHTML = `
<a class="skip-link" href="#wardrobe">Skip to wardrobe</a>
<header class="site-header"><a class="brand" href="#top"><span class="brand-mark" aria-hidden="true">s.</span> Style Studio</a><nav aria-label="Workspace"><a href="#wardrobe">Wardrobe</a><a href="#taste">Your taste</a><a href="#ideas">Outfit ideas</a><a href="#saved">Saved looks</a></nav><span class="local-badge">Local & private</span></header>
<main id="top">
  <section class="hero" aria-labelledby="hero-title"><div><p class="eyebrow">A wardrobe that feels like you</p><h1 id="hero-title">Good style starts<br>with <em>your taste.</em></h1><p class="hero-copy">Keep the pieces you own. Teach us what you like. Find a few new ways to wear them.</p><button id="load-sample" class="button secondary">Load sample profile</button><p class="quiet">Original sample pieces and labels. Replacing your profile is confirmed and undoable.</p></div><aside class="model-panel" aria-labelledby="model-heading"><div class="panel-top"><span class="eyebrow">Your preference notebook</span><span class="dot" aria-hidden="true"></span></div><h2 id="model-heading">Learning your point of view</h2><p id="model-status" role="status"></p><div id="model-counts" class="counts"></div><p class="quiet">A small model learns from your Like / Pass labels and the tags you enter. Photos are references only; there is no automatic image recognition.</p><p class="quiet">Scores describe estimated taste alignment, not probabilities, fit or objective fashion quality.</p></aside></section>
  <section class="profile-bar" aria-label="Profile and backup"><form id="profile-form"><label for="profile-title">Profile title</label><div class="inline"><input id="profile-title" name="title" maxlength="80" required><button class="button subtle" type="submit">Save profile title</button></div></form><div class="profile-actions"><button id="undo" class="button subtle">Undo</button><button id="redo" class="button subtle">Redo</button><button id="export-profile" class="button subtle">Export profile</button><button id="import-profile" class="button subtle">Import profile</button><input id="profile-import" type="file" accept=".json,application/json" class="visually-hidden" aria-label="Choose profile JSON"><button id="new-profile" class="button subtle">New profile</button></div><div class="save-line"><p id="save-status" role="status">Opening local storage…</p><button id="retry-save" class="button subtle" hidden>Retry saving</button></div></section>
  <div class="message-line"><p id="message" role="status" aria-live="polite">Start with your own pieces, or load the sample profile to try the complete flow.</p><button id="cancel-operation" class="button subtle" hidden>Cancel operation</button></div>
  <section id="wardrobe" class="workspace-section" aria-labelledby="wardrobe-heading"><div class="section-heading"><div><p class="eyebrow">01 / The pieces you reach for</p><h2 id="wardrobe-heading">Your wardrobe</h2></div><p id="wardrobe-count" class="section-caption"></p></div><div class="section-layout"><form id="piece-form" class="editor-panel"><h3 id="piece-form-heading">Add a wardrobe piece</h3><p class="quiet">Use your own photo or keep an illustrated reference. Describe the piece yourself.</p><label for="piece-name">Piece name</label><input id="piece-name" name="name" required maxlength="80" placeholder="The linen shirt"><label for="piece-category">Category</label><select id="piece-category" name="category"><option value="top">Top</option><option value="bottom">Bottom</option><option value="shoes">Shoes</option></select><div id="piece-tags" class="tag-fields"></div><label for="piece-photo">Reference photo (optional)</label><input id="piece-photo" type="file" accept="image/jpeg,image/png,image/webp"><div id="piece-photo-preview" class="photo-draft"></div><p id="piece-photo-status" class="quiet" role="status"></p><button id="remove-piece-photo" class="text-button" type="button" hidden>Remove reference photo</button><div class="form-actions"><button id="piece-submit" class="button" type="submit">Add wardrobe piece</button><button id="cancel-piece-edit" class="button subtle" type="button" hidden>Cancel edit</button></div></form><div><div id="wardrobe-list" class="wardrobe-grid"></div><p id="wardrobe-empty" class="empty">A favorite shirt, a reliable pair of trousers, the shoes you always wear. Add one of each to start making looks.</p></div></div></section>
  <section id="taste" class="workspace-section" aria-labelledby="taste-heading"><div class="section-heading"><div><p class="eyebrow">02 / Your likes, your labels</p><h2 id="taste-heading">Teach your taste</h2></div><p id="example-count" class="section-caption"></p></div><div class="section-layout"><form id="example-form" class="editor-panel"><h3>Keep an outfit opinion</h3><p class="quiet">An outfit can be a reference you like or one you would pass on. Enter the tags you see.</p><label for="example-caption">Outfit caption</label><input id="example-caption" name="caption" required maxlength="160" placeholder="Relaxed weekend layers"><div id="example-tags" class="tag-fields"></div><label for="example-label">Your opinion</label><select id="example-label" name="label"><option value="like">Like</option><option value="pass">Pass</option></select><label for="example-photo">Outfit reference photo (optional)</label><input id="example-photo" type="file" accept="image/jpeg,image/png,image/webp"><div id="example-photo-preview" class="photo-draft"></div><p id="example-photo-status" class="quiet" role="status"></p><button id="remove-example-photo" class="text-button" type="button" hidden>Remove reference photo</button><button id="example-submit" class="button" type="submit">Teach my taste</button></form><div><div id="example-list" class="example-list"></div><p id="example-empty" class="empty">Your opinions make this personal. Start with at least eight examples, including three Likes and three Passes.</p></div></div></section>
  <section id="assessment" class="workspace-section" aria-labelledby="assessment-heading"><div class="section-heading"><div><p class="eyebrow">03 / A second look</p><h2 id="assessment-heading">Does this feel like you?</h2></div><p class="section-caption">You describe the outfit. Your model supplies the estimate.</p></div><div class="assessment-layout"><form id="assessment-form" class="editor-panel"><h3>Assess a new outfit</h3><div id="assessment-tags" class="tag-fields"></div><button class="button" type="submit">Assess this outfit</button></form><div id="assessment-result" class="assessment-result" role="status"><p class="eyebrow">Taste alignment</p><h3>Your point of view, made visible.</h3><p>Choose the tags that describe a look, then assess it against your labeled examples.</p></div></div></section>
  <section id="ideas" class="workspace-section" aria-labelledby="ideas-heading"><div class="section-heading"><div><p class="eyebrow">04 / A little outfit inspiration</p><h2 id="ideas-heading">New combinations, owned pieces</h2></div></div><form id="suggestion-form" class="suggestion-controls"><div><label for="suggestion-mode">Direction</label><select id="suggestion-mode" name="mode"><option value="match">Match my taste</option><option value="explore">Explore a different style</option></select></div><div><label for="suggestion-occasion">Occasion</label><select id="suggestion-occasion" name="occasion"><option value="any">Any occasion</option><option value="casual">Casual</option><option value="smart">Smart</option><option value="formal">Formal</option></select></div><button class="button" type="submit">Suggest looks</button></form><p id="suggestion-rule" class="quiet">Match uses your learned score. Explore combines 35% learned score with 65% declared-tag novelty. Occasion filters use your formality tags, without silently relaxing them.</p><p id="suggestion-status" role="status" class="section-caption">Add a top, bottom and shoes to make a complete outfit.</p><div id="suggestion-list" class="look-grid"></div></section>
  <section id="saved" class="workspace-section" aria-labelledby="saved-heading"><div class="section-heading"><div><p class="eyebrow">05 / Looks worth keeping</p><h2 id="saved-heading">Your saved looks</h2></div><p id="look-count" class="section-caption"></p></div><p class="quiet">Saved looks keep their own piece snapshots. Editing or removing a wardrobe item will not change a look you saved.</p><div id="look-list" class="look-grid"></div><p id="look-empty" class="empty">Save an outfit idea, give it a name, and keep a note about when you would wear it.</p></section>
  <footer><strong>Made for your wardrobe, kept on your device.</strong><p>Local storage is not a backup. Export your profile to keep photos, labels and saved looks together. Outfit boards are images, not editable backups.</p><p>36 pieces · 80 opinions · 30 saved looks · 20 photos. No accounts, paid models or online saving.</p></footer>
</main>`;

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing editor element: ${selector}`);
  return found;
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.className = className;
  result.textContent = text;
  return result;
}
function button(text: string, className: string, action: () => void): HTMLButtonElement {
  const result = node('button', className, text);
  result.type = 'button';
  result.addEventListener('click', action);
  return result;
}
function field(form: HTMLFormElement, name: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const value = form.elements.namedItem(name);
  if (!(value instanceof HTMLInputElement || value instanceof HTMLSelectElement || value instanceof HTMLTextAreaElement)) throw new Error(`Missing field ${name}.`);
  return value;
}
function readTags(form: HTMLFormElement): Tags {
  return { palette: field(form, 'palette').value as Tags['palette'], fit: field(form, 'fit').value as Tags['fit'], style: field(form, 'style').value as Tags['style'], formality: field(form, 'formality').value as Tags['formality'] };
}
function writeTags(form: HTMLFormElement, tags: Tags): void {
  for (const key of ['palette', 'fit', 'style', 'formality'] as const) field(form, key).value = tags[key];
}
function titleCase(text: string): string { return text.charAt(0).toUpperCase() + text.slice(1); }
function tagFields(prefix: string): void {
  const container = element(`#${prefix}-tags`);
  for (const [name, values] of [['palette', PALETTES], ['fit', FITS], ['style', STYLES], ['formality', FORMALITIES]] as const) {
    const group = node('div');
    const label = node('label', '', titleCase(name));
    label.htmlFor = `${prefix}-${name}`;
    const select = node('select');
    select.id = label.htmlFor; select.name = name;
    for (const value of values) { const option = node('option', '', titleCase(value)); option.value = value; select.append(option); }
    group.append(label, select); container.append(group);
  }
}
for (const prefix of ['piece', 'example', 'assessment']) tagFields(prefix);

const profileForm = element<HTMLFormElement>('#profile-form');
const pieceForm = element<HTMLFormElement>('#piece-form');
const exampleForm = element<HTMLFormElement>('#example-form');
const assessmentForm = element<HTMLFormElement>('#assessment-form');
const suggestionForm = element<HTMLFormElement>('#suggestion-form');
let project = createProject();
let history = new ProjectHistory(project);
let model = trainPreferenceModel(project.examples);
let generation = 0;
let store: ProjectStore | null = null;
let storageReady = false;
let preserveStoredData = false;
let explicitReplacement = false;
let pendingSave = false;
let saving = false;
let saveFailed = false;
let saveSequence = 0;
let editingPiece: string | null = null;
let assessedTags: Tags | null = null;
let suggestionSignature: string | null = null;
let operation: AbortController | null = null;
const startupController = new AbortController();
const downloads = new Set<string>();
const pieceCards = new Map<string, HTMLElement>();
const exampleCards = new Map<string, HTMLElement>();
const lookCards = new Map<string, HTMLElement>();

function message(text: string, error = false): void {
  const target = element('#message'); target.textContent = text; target.dataset.kind = error ? 'error' : 'info';
}
function describe(error: unknown): string { return error instanceof Error ? error.message : 'The operation could not be completed.'; }
function isAbort(error: unknown): boolean { return error instanceof DOMException && error.name === 'AbortError'; }
function cancelOperation(): void {
  operation?.abort(); operation = null; element('#cancel-operation').hidden = true;
}
function interact(): void {
  generation++; startupController.abort();
  if (operation) message('The pending import or board export was cancelled because the workspace changed.');
  cancelOperation();
}
mount.addEventListener('input', interact, true);
mount.addEventListener('change', interact, true);
profileForm.addEventListener('input', () => { profileForm.dataset.dirty = 'true'; });
pieceForm.addEventListener('input', () => { pieceForm.dataset.dirty = 'true'; });
pieceForm.addEventListener('change', () => { pieceForm.dataset.dirty = 'true'; });
exampleForm.addEventListener('input', () => { exampleForm.dataset.dirty = 'true'; });
exampleForm.addEventListener('change', () => { exampleForm.dataset.dirty = 'true'; });

function saveStatus(text: string, retry = false): void {
  element('#save-status').textContent = text; element('#retry-save').hidden = !retry;
}
function persist(): void {
  pendingSave = true;
  if (!storageReady || !store || preserveStoredData) return;
  pendingSave = false;
  const sequence = ++saveSequence;
  saving = true;
  saveStatus('Saving on this device…');
  void store.save(project).then(() => {
    if (sequence === saveSequence) {
      saving = false; saveFailed = false;
      saveStatus('Saved on this device · export a profile for backup');
    }
  }).catch(error => {
    if (sequence === saveSequence) {
      saving = false; saveFailed = true;
      saveStatus(`Local save failed: ${describe(error)} Your edits remain available; export a backup.`, true);
    }
  });
}
function publish(next: Project, text: string, alreadyInHistory = false): boolean {
  if (!alreadyInHistory && !history.apply(next)) { message('No changes to save.'); return false; }
  interact();
  project = alreadyInHistory ? next : history.current;
  model = trainPreferenceModel(project.examples);
  render(); persist(); message(text);
  return true;
}
function attempt(action: () => void): void { try { action(); } catch (error) { message(describe(error), true); } }
function confirmDelete(kind: string, name: string, action: () => void): void {
  if (window.confirm(`Delete ${kind} “${name}”? Only this selected ${kind} will be removed. You can undo this edit.`)) attempt(action);
}

interface PhotoDraft { asset: PhotoAsset | null; existingId: string | null; controller: AbortController | null; sequence: number; busy: boolean }
const photoDrafts: Record<'piece' | 'example', PhotoDraft> = {
  piece: { asset: null, existingId: null, controller: null, sequence: 0, busy: false },
  example: { asset: null, existingId: null, controller: null, sequence: 0, busy: false },
};
function renderPhotoDraft(kind: 'piece' | 'example'): void {
  const draft = photoDrafts[kind];
  const area = element(`#${kind}-photo-preview`); area.replaceChildren();
  const asset = draft.asset ?? project.photos.find(photo => photo.id === draft.existingId);
  if (asset) { const image = node('img'); image.src = asset.dataUrl; image.alt = 'Selected local reference photo'; area.append(image); }
  element(`#remove-${kind}-photo`).hidden = !(draft.asset || draft.existingId);
  element<HTMLButtonElement>(`#${kind}-submit`).disabled = draft.busy;
}
function clearPhotoDraft(kind: 'piece' | 'example'): void {
  const draft = photoDrafts[kind]; draft.controller?.abort(); draft.sequence++;
  draft.asset = null; draft.existingId = null; draft.controller = null; draft.busy = false;
  element<HTMLInputElement>(`#${kind}-photo`).value = '';
  element(`#${kind}-photo-status`).textContent = '';
  renderPhotoDraft(kind);
}
for (const kind of ['piece', 'example'] as const) {
  element<HTMLInputElement>(`#${kind}-photo`).addEventListener('change', event => {
    const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
    const draft = photoDrafts[kind]; draft.controller?.abort();
    const controller = new AbortController(); const sequence = ++draft.sequence;
    draft.controller = controller; draft.busy = true;
    element(`#${kind}-photo-status`).textContent = 'Preparing a local reference photo…'; renderPhotoDraft(kind);
    void normalizePhoto(file, newId(), controller.signal).then(asset => {
      if (controller.signal.aborted || sequence !== draft.sequence) return;
      draft.asset = asset; draft.existingId = null;
      element(`#${kind}-photo-status`).textContent = 'Photo ready. It will be saved with this form, not before.';
    }).catch(error => {
      if (controller.signal.aborted || sequence !== draft.sequence) return;
      element(`#${kind}-photo-status`).textContent = `Photo rejected: ${describe(error)} Previous reference and form values were preserved.`;
    }).finally(() => {
      if (sequence !== draft.sequence) return;
      draft.busy = false; draft.controller = null; renderPhotoDraft(kind);
    });
  });
  element(`#remove-${kind}-photo`).addEventListener('click', () => {
    interact();
    (kind === 'piece' ? pieceForm : exampleForm).dataset.dirty = 'true';
    clearPhotoDraft(kind);
  });
}

function resetPieceForm(): void {
  editingPiece = null; pieceForm.reset(); clearPhotoDraft('piece');
  pieceForm.dataset.dirty = 'false';
  element('#piece-form-heading').textContent = 'Add a wardrobe piece';
  element('#piece-submit').textContent = 'Add wardrobe piece'; element('#cancel-piece-edit').hidden = true;
}
function resetEditors(): void {
  resetPieceForm(); exampleForm.reset(); clearPhotoDraft('example'); exampleForm.dataset.dirty = 'false';
  profileForm.dataset.dirty = 'false'; field(profileForm, 'title').value = project.title;
  assessedTags = null; suggestionSignature = null; element('#suggestion-list').replaceChildren();
  renderAssessment();
}
pieceForm.addEventListener('submit', event => {
  event.preventDefault(); if (photoDrafts.piece.busy) return;
  attempt(() => {
    const draft = photoDrafts.piece;
    const input = { name: field(pieceForm, 'name').value, category: field(pieceForm, 'category').value as Category, tags: readTags(pieceForm), photoId: draft.asset?.id ?? draft.existingId };
    const next = editingPiece ? updatePiece(project, editingPiece, input, draft.asset ?? undefined) : addPiece(project, input, draft.asset ?? undefined);
    const text = editingPiece ? 'Wardrobe piece updated. Your saved looks retain their original snapshots.' : 'Wardrobe piece added.';
    publish(next, text); resetPieceForm();
  });
});
element('#cancel-piece-edit').addEventListener('click', resetPieceForm);
exampleForm.addEventListener('submit', event => {
  event.preventDefault(); if (photoDrafts.example.busy) return;
  attempt(() => {
    const draft = photoDrafts.example;
    const next = addTaggedExample(project, { caption: field(exampleForm, 'caption').value, label: field(exampleForm, 'label').value as Label, tags: readTags(exampleForm), photoId: draft.asset?.id ?? draft.existingId }, draft.asset ?? undefined);
    publish(next, 'Opinion added. Your preference model now uses this label.');
    exampleForm.reset(); clearPhotoDraft('example'); exampleForm.dataset.dirty = 'false';
  });
});
profileForm.addEventListener('submit', event => {
  event.preventDefault(); attempt(() => {
    const next = setTitle(project, field(profileForm, 'title').value);
    profileForm.dataset.dirty = 'false'; publish(next, 'Profile title updated.');
  });
});

function illustration(piece: Piece): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 160 160'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${piece.tags.palette} ${piece.category} illustration, not a photo`);
  const path = document.createElementNS(svg.namespaceURI, 'path');
  const shapes: Record<Category, string> = { top: 'M49 25 67 18 Q80 36 93 18 L111 25 139 53 117 73 108 62 110 139 50 139 52 62 43 73 21 53Z', bottom: 'M48 20H112L120 141H88L80 76 72 141H40Z', shoes: 'M32 73 71 73 81 90 117 99Q140 102 140 120V132H22V111Q24 90 32 73Z' };
  const colors = { neutral: '#c0b29a', warm: '#ba7451', cool: '#799ba2', bright: '#d4ae43' };
  path.setAttribute('d', shapes[piece.category]); path.setAttribute('fill', colors[piece.tags.palette]); path.setAttribute('stroke', '#403e35'); path.setAttribute('stroke-width', '2'); path.setAttribute('stroke-linejoin', 'round');
  svg.append(path); return svg;
}
function visual(piece: Piece, compact = false): HTMLElement {
  const frame = node('div', compact ? 'piece-visual compact' : 'piece-visual');
  const photo = project.photos.find(asset => asset.id === piece.photoId);
  if (photo) { const img = node('img'); img.src = photo.dataUrl; img.alt = `${piece.name} — your reference photo`; frame.append(img); }
  else frame.append(illustration(piece));
  return frame;
}
function tagsText(tags: Tags): string { return [tags.palette, tags.fit, tags.style, tags.formality].map(titleCase).join(' · '); }
function prune(map: Map<string, HTMLElement>, ids: Set<string>): void {
  for (const [id, card] of map) if (!ids.has(id)) { card.remove(); map.delete(id); }
}
function renderWardrobe(): void {
  prune(pieceCards, new Set(project.pieces.map(piece => piece.id)));
  const list = element('#wardrobe-list');
  for (const piece of project.pieces) {
    let card = pieceCards.get(piece.id);
    if (!card) {
      card = node('article', 'piece-card'); card.dataset.pieceId = piece.id;
      card.append(node('div', 'visual-slot'), node('p', 'category-label'), node('h3'), node('p', 'tag-summary'), node('div', 'card-actions'));
      const actions = card.querySelector('.card-actions')!;
      actions.append(button('Edit piece', 'text-button', () => {
        const current = project.pieces.find(item => item.id === piece.id); if (!current) return;
        clearPhotoDraft('piece'); editingPiece = current.id;
        pieceForm.dataset.dirty = 'false';
        field(pieceForm, 'name').value = current.name; field(pieceForm, 'category').value = current.category; writeTags(pieceForm, current.tags);
        photoDrafts.piece.existingId = current.photoId; renderPhotoDraft('piece');
        element('#piece-form-heading').textContent = 'Edit a wardrobe piece'; element('#piece-submit').textContent = 'Save wardrobe piece'; element('#cancel-piece-edit').hidden = false;
        element('#piece-name').focus();
      }), button('Delete piece', 'text-button danger', () => {
        const current = project.pieces.find(item => item.id === piece.id); if (!current) return;
        confirmDelete('piece', current.name, () => { publish(deletePiece(project, current.id), 'Selected piece deleted; saved looks are unchanged.'); if (editingPiece === current.id) resetPieceForm(); });
      }));
      pieceCards.set(piece.id, card); list.append(card);
    }
    card.querySelector('.visual-slot')!.replaceChildren(visual(piece));
    card.querySelector('.category-label')!.textContent = titleCase(piece.category);
    card.querySelector('h3')!.textContent = piece.name; card.querySelector('.tag-summary')!.textContent = tagsText(piece.tags);
  }
  element('#wardrobe-empty').hidden = project.pieces.length > 0;
  element('#wardrobe-count').textContent = `${project.pieces.length} / ${LIMITS.pieces} pieces · ${project.photos.length} / ${LIMITS.photos} photos`;
}
function renderExamples(): void {
  prune(exampleCards, new Set(project.examples.map(example => example.id)));
  const list = element('#example-list');
  for (const example of project.examples) {
    let card = exampleCards.get(example.id);
    if (!card) {
      card = node('article', 'example-card'); card.dataset.exampleId = example.id;
      card.append(node('div', 'example-photo'), node('div', 'example-copy'), node('div', 'example-actions'));
      card.querySelector('.example-copy')!.append(node('h3'), node('p', 'tag-summary'));
      const actions = card.querySelector('.example-actions')!;
      for (const label of ['like', 'pass'] as const) {
        const control = button(titleCase(label), 'rating-button', () => attempt(() => publish(setExampleLabel(project, example.id, label), 'Opinion corrected. The model has been refitted.')));
        control.dataset.label = label; actions.append(control);
      }
      actions.append(button('Delete opinion', 'text-button danger', () => {
        const current = project.examples.find(item => item.id === example.id); if (current) confirmDelete('opinion', current.caption, () => publish(deleteExample(project, current.id), 'Selected opinion deleted.'));
      }));
      exampleCards.set(example.id, card); list.append(card);
    }
    card.querySelector('h3')!.textContent = example.caption;
    card.querySelector('.tag-summary')!.textContent = example.origin === 'tagged' ? tagsText(tagsFromFeatures(example.features)) : 'Saved outfit · average of its three piece snapshots';
    const imageArea = card.querySelector('.example-photo')!;
    imageArea.replaceChildren();
    const photo = project.photos.find(item => item.id === example.photoId);
    if (photo) { const img = node('img'); img.src = photo.dataUrl; img.alt = `${example.caption} reference`; imageArea.append(img); }
    else imageArea.append(node('span', '', example.label === 'like' ? '✓' : '—'));
    for (const control of card.querySelectorAll<HTMLButtonElement>('[data-label]')) control.setAttribute('aria-pressed', String(control.dataset.label === example.label));
  }
  element('#example-empty').hidden = project.examples.length > 0;
  element('#example-count').textContent = `${project.examples.length} / ${LIMITS.examples} opinions`;
}
function scoreContent(score: TasteScore): HTMLElement {
  const wrapper = node('div', 'score-content');
  const value = node('p', 'score', String(score.score)); value.append(node('span', '', ' / 100')); wrapper.append(value, node('p', 'score-label', 'Estimated taste alignment'));
  const contributions = node('ul', 'contributions');
  for (const item of score.contributions) {
    contributions.append(node('li', '', `${item.contribution >= 0 ? '+' : '−'} ${item.name.replace(':', ': ')} (${Math.abs(item.contribution).toFixed(2)} model contribution)`));
  }
  wrapper.append(contributions, node('p', 'quiet', 'Contributions describe this small linear model, not causal style advice. The score is not a calibrated probability.'));
  return wrapper;
}
function renderAssessment(): void {
  const output = element('#assessment-result');
  if (!assessedTags) {
    output.replaceChildren(node('p', 'eyebrow', 'Taste alignment'), node('h3', '', 'Your point of view, made visible.'), node('p', '', 'Choose the tags that describe a look, then assess it against your labeled examples.')); return;
  }
  const score = assessOutfit(featuresFromTags(assessedTags), model);
  output.replaceChildren(node('p', 'eyebrow', 'Taste alignment'), node('p', 'tag-summary', tagsText(assessedTags)));
  if (score) output.append(scoreContent(score));
  else output.append(node('h3', '', 'A few more opinions first.'), node('p', '', model.status === 'insufficient' ? model.reason : 'Your model is not ready.'), node('p', 'quiet', 'No learned score is shown until you have enough Likes and Passes.'));
}
assessmentForm.addEventListener('submit', event => { event.preventDefault(); attempt(() => { assessedTags = readTags(assessmentForm); renderAssessment(); }); });

function outfitStrip(pieces: readonly Piece[]): HTMLElement {
  const strip = node('div', 'outfit-strip');
  for (const piece of pieces) { const item = node('div'); item.append(visual(piece, true), node('p', '', piece.name)); strip.append(item); }
  return strip;
}
function currentSuggestionSignature(): string { return JSON.stringify([project.pieces, project.examples]); }
function renderSuggestions(): void {
  const mode = field(suggestionForm, 'mode').value as Mode;
  const occasion = field(suggestionForm, 'occasion').value as Occasion;
  const suggestions = generateAlternatives(project.pieces, model, { mode, occasion });
  const list = element('#suggestion-list'); list.replaceChildren(); suggestionSignature = currentSuggestionSignature();
  element('#suggestion-status').textContent = `${suggestions.eligibleCount} occasion-valid combinations. ${suggestions.ranked ? (mode === 'match' ? 'Ranked by learned taste alignment.' : 'Ranked by learned alignment and declared novelty.') : 'Unranked ideas; more labels are needed for personalization.'} ${suggestions.diversityFallback ? 'Shared pieces were necessary with this wardrobe.' : ''} ${suggestions.reason ?? ''}`;
  for (const [index, candidate] of suggestions.candidates.entries()) {
    const pieces = candidate.pieceIds.map(id => project.pieces.find(piece => piece.id === id)!);
    const card = node('article', 'look-card candidate-card'); card.dataset.candidateKey = candidate.pieceIds.join('-');
    card.append(node('p', 'eyebrow', `Outfit idea ${index + 1}`), outfitStrip(pieces));
    if (candidate.taste) card.append(node('p', 'candidate-score', `${candidate.taste.score} / 100 estimated taste alignment`));
    else card.append(node('p', 'candidate-score', 'Unranked outfit idea'));
    if (candidate.novelty !== null && mode === 'explore') card.append(node('p', 'quiet', `${Math.round(candidate.novelty * 100)} / 100 declared-tag novelty (a distance rule)`));
    const form = node('form', 'save-look-form');
    form.dataset.dirty = 'false';
    const input = node('input'); input.name = 'name'; input.required = true; input.maxLength = 80; input.value = `Look ${project.looks.length + index + 1}`;
    const label = node('label', '', 'Look name'); input.id = `candidate-name-${index}`; label.htmlFor = input.id;
    const submit = node('button', 'button secondary', 'Save look'); submit.type = 'submit';
    form.addEventListener('input', () => { form.dataset.dirty = 'true'; });
    form.append(label, input, submit); form.addEventListener('submit', event => {
      event.preventDefault(); attempt(() => {
        if (suggestionSignature !== currentSuggestionSignature()) throw new Error('Your wardrobe or opinions changed. Suggest looks again before saving this idea.');
        const next = saveLook(project, candidate.pieceIds, input.value);
        publish(next, 'Look saved as an independent snapshot.');
        form.dataset.dirty = 'false';
      });
    });
    card.append(form); list.append(card);
  }
  if (suggestions.candidates.length === 0) list.append(node('p', 'empty', 'No outfits satisfy this occasion. Add missing categories or change the explicit occasion filter.'));
}
suggestionForm.addEventListener('submit', event => { event.preventDefault(); attempt(renderSuggestions); });

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob); downloads.add(url);
  const link = node('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 30_000);
}
function fileName(title: string): string { return title.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 60) || 'style-profile'; }
async function exportBoard(lookId: string): Promise<void> {
  cancelOperation(); const controller = new AbortController(); operation = controller;
  const snapshot = project; const look = snapshot.looks.find(item => item.id === lookId); if (!look) return;
  message('Rendering your outfit board on this device…'); element('#cancel-operation').hidden = false;
  try {
    const blob = await exportLookPng(snapshot, lookId, controller.signal);
    if (controller.signal.aborted || operation !== controller) return;
    download(blob, `${fileName(look.name)}.png`); message('Outfit board downloaded. Export a profile JSON for an editable backup.');
  } catch (error) { if (!controller.signal.aborted && operation === controller) message(describe(error), true); }
  finally { if (operation === controller) cancelOperation(); }
}
function createLookCard(look: SavedLook): HTMLElement {
  const card = node('article', 'look-card'); card.dataset.lookId = look.id;
  const heading = node('h3'); heading.dataset.part = 'heading';
  const visuals = node('div'); visuals.dataset.part = 'visuals';
  const tags = node('p', 'quiet'); tags.dataset.part = 'tags';
  const form = node('form', 'look-edit-form'); form.dataset.dirty = 'false';
  const nameLabel = node('label', '', 'Look name'); const name = node('input'); name.name = 'name'; name.required = true; name.maxLength = 80; name.id = `look-name-${look.id}`; nameLabel.htmlFor = name.id;
  const notesLabel = node('label', '', 'Notes'); const notes = node('textarea'); notes.name = 'notes'; notes.maxLength = 500; notes.rows = 3; notes.id = `look-notes-${look.id}`; notesLabel.htmlFor = notes.id;
  const save = node('button', 'button subtle', 'Save changes'); save.type = 'submit';
  form.append(nameLabel, name, notesLabel, notes, save);
  form.addEventListener('input', () => { form.dataset.dirty = 'true'; });
  form.addEventListener('submit', event => { event.preventDefault(); attempt(() => {
    const next = updateLook(project, look.id, { name: name.value, notes: notes.value });
    form.dataset.dirty = 'false'; publish(next, 'Saved look name and notes updated.');
  }); });
  const ratings = node('div', 'look-ratings'); ratings.append(node('span', 'quiet', 'Teach from this look:'));
  for (const label of ['like', 'pass'] as const) {
    const control = button(titleCase(label), 'rating-button', () => attempt(() => publish(rateLook(project, look.id, label), 'Look opinion saved. Changing this vote updates its existing example.')));
    control.dataset.label = label; ratings.append(control);
  }
  const actions = node('div', 'card-actions'); actions.append(button('Download outfit board', 'text-button', () => { void exportBoard(look.id); }), button('Delete look', 'text-button danger', () => {
    const current = project.looks.find(item => item.id === look.id); if (current) confirmDelete('look', current.name, () => publish(deleteLook(project, current.id), 'Selected look deleted; its existing opinion remains in your training examples.'));
  }));
  card.append(heading, visuals, tags, form, ratings, actions); return card;
}
function renderLooks(): void {
  prune(lookCards, new Set(project.looks.map(look => look.id))); const list = element('#look-list');
  for (const look of project.looks) {
    let card = lookCards.get(look.id);
    if (!card) { card = createLookCard(look); lookCards.set(look.id, card); list.append(card); }
    card.querySelector('[data-part="heading"]')!.textContent = look.name;
    card.querySelector('[data-part="visuals"]')!.replaceChildren(outfitStrip(look.pieces));
    card.querySelector('[data-part="tags"]')!.textContent = 'Top / bottom / shoes · saved piece snapshots';
    const form = card.querySelector<HTMLFormElement>('form')!;
    if (form.dataset.dirty !== 'true') { field(form, 'name').value = look.name; field(form, 'notes').value = look.notes; }
    const rating = project.examples.find(example => example.sourceLookId === look.id && example.origin === 'outfit');
    for (const control of card.querySelectorAll<HTMLButtonElement>('[data-label]')) control.setAttribute('aria-pressed', String(control.dataset.label === rating?.label));
  }
  element('#look-empty').hidden = project.looks.length > 0; element('#look-count').textContent = `${project.looks.length} / ${LIMITS.looks} looks`;
}
function render(): void {
  if (profileForm.dataset.dirty !== 'true') field(profileForm, 'title').value = project.title;
  element('#model-status').textContent = model.status === 'trained' ? 'Your personal model is ready. Small datasets make these estimates provisional.' : model.reason;
  const counts = element('#model-counts'); counts.replaceChildren();
  for (const [value, label] of [[model.counts.total, 'opinions'], [model.counts.likes, 'Likes'], [model.counts.passes, 'Passes']] as const) {
    const item = node('div'); item.append(node('strong', '', String(value)), node('span', '', label)); counts.append(item);
  }
  element<HTMLButtonElement>('#undo').disabled = !history.canUndo; element<HTMLButtonElement>('#redo').disabled = !history.canRedo;
  renderWardrobe(); renderExamples(); renderLooks(); renderAssessment();
  if (suggestionSignature !== null && suggestionSignature !== currentSuggestionSignature()) {
    element('#suggestion-status').textContent = 'Your profile changed. Suggest looks again to update these ideas and their estimates.';
    for (const control of element('#suggestion-list').querySelectorAll<HTMLButtonElement>('button[type="submit"]')) control.disabled = true;
  }
}

element('#undo').addEventListener('click', () => attempt(() => { const previous = history.undo(); if (previous) publish(previous, 'Undid the last profile edit.', true); }));
element('#redo').addEventListener('click', () => attempt(() => { const next = history.redo(); if (next) publish(next, 'Redid the profile edit.', true); }));
function replaceProfile(next: Project, text: string): void {
  // A confirmed whole-profile replacement discards form drafts, including
  // keyed look forms whose IDs also exist in the imported profile.
  for (const card of lookCards.values()) card.querySelector<HTMLFormElement>('form')!.dataset.dirty = 'false';
  preserveStoredData = false;
  explicitReplacement = true;
  if (store) storageReady = true;
  if (!publish(next, text)) {
    // A confirmed empty reset still replaces a corrupt stored record, even
    // when the in-memory empty profile has no history change to record.
    interact(); persist(); message(text);
  }
  resetEditors(); render();
}
function storedReplacementNotice(): string {
  return preserveStoredData ? ' The unreadable stored record will also be replaced; Undo cannot restore that record.' : '';
}
element('#load-sample').addEventListener('click', () => {
  if (window.confirm(`Replace the current profile with clearly labeled sample pieces and opinions? This is undoable. Export your profile first for a backup.${storedReplacementNotice()}`)) attempt(() => replaceProfile(createDemoProject(), 'Sample profile loaded. These original sample labels are not your personal preferences; replace them with your own.'));
});
element('#new-profile').addEventListener('click', () => {
  if (window.confirm(`Start a new empty profile? This replaces the current profile and is undoable. Export a backup first.${storedReplacementNotice()}`)) attempt(() => replaceProfile(createProject(), 'Started an empty profile.'));
});
element('#export-profile').addEventListener('click', () => attempt(() => {
  download(new Blob([serializeProject(project)], { type: 'application/json' }), `${fileName(project.title)}.json`);
  message('Profile backup exported with photos, labels and saved snapshots. Keep this file somewhere safe.');
}));
element('#import-profile').addEventListener('click', () => element<HTMLInputElement>('#profile-import').click());
element<HTMLInputElement>('#profile-import').addEventListener('change', event => {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''; if (!file) return;
  if (!window.confirm(`Import this profile and replace the current one? Invalid files preserve your profile. A successful import is undoable.${storedReplacementNotice()}`)) return;
  cancelOperation(); const controller = new AbortController(); operation = controller; const startGeneration = generation;
  element('#cancel-operation').hidden = false; message('Validating the complete profile and its local photos…');
  void (async () => {
    try {
      if (file.size > LIMITS.projectBytes) throw new Error('Profile JSON exceeds 8 MiB.');
      const text = await file.text(); if (controller.signal.aborted || startGeneration !== generation) return;
      const incoming = parseProject(text); await validateProjectPhotos(incoming, controller.signal);
      if (controller.signal.aborted || startGeneration !== generation || operation !== controller) return;
      replaceProfile(incoming, 'Profile imported after complete validation.');
    } catch (error) { if (!controller.signal.aborted && operation === controller) message(`Import rejected: ${describe(error)} Current profile preserved.`, true); }
    finally { if (operation === controller) cancelOperation(); }
  })();
});
element('#cancel-operation').addEventListener('click', () => { cancelOperation(); message('Operation cancelled. Your profile was preserved.'); });
element('#retry-save').addEventListener('click', () => {
  void (async () => {
    try {
      if (preserveStoredData && !window.confirm('Save the current in-memory profile instead of the unreadable stored profile? This replaces the stored record. Export the current profile first if you want a backup.')) return;
      if (!store) {
        if (!window.confirm('Save this current profile on this device? It will replace any previous profile stored here.')) return;
        store = await openProjectStore();
      }
      preserveStoredData = false; storageReady = true; persist();
    } catch (error) { saveStatus(`Local storage unavailable: ${describe(error)} Export your profile to keep your work.`, true); }
  })();
});

render();
void (async () => {
  const initialGeneration = generation;
  try {
    store = await openProjectStore();
    const saved = await store.load();
    if (saved && generation === initialGeneration) {
      try { await validateProjectPhotos(saved, startupController.signal); }
      catch (error) { if (!isAbort(error) && !startupController.signal.aborted) throw error; }
      if (generation === initialGeneration && !startupController.signal.aborted) {
        project = saved; history = new ProjectHistory(project); model = trainPreferenceModel(project.examples);
        resetEditors(); render(); message('Your local profile is ready. Photos and preferences stayed on this device.');
      }
    }
    storageReady = true;
    if (pendingSave) persist(); else if (saveSequence === 0) saveStatus('Local storage ready · export a profile for backup');
  } catch (error) {
    if (explicitReplacement && store) {
      // A later result from the old read cannot revoke the user's explicit
      // choice to replace that record with the current validated profile.
      preserveStoredData = false; storageReady = true; persist(); return;
    }
    preserveStoredData = store !== null;
    storageReady = false;
    saveStatus(`Local profile could not be loaded: ${describe(error)} Current edits are in memory; export a backup.`, true);
  }
})();
function hasUnsavedDrafts(): boolean {
  if (pendingSave || saving || saveFailed) return true;
  if (field(profileForm, 'title').value !== project.title) return true;
  if (pieceForm.dataset.dirty === 'true' || exampleForm.dataset.dirty === 'true') return true;
  if (Object.values(photoDrafts).some(draft => draft.busy || draft.asset !== null)) return true;
  for (const look of project.looks) {
    const form = lookCards.get(look.id)?.querySelector<HTMLFormElement>('form');
    if (form?.dataset.dirty === 'true' && (field(form, 'name').value !== look.name
        || field(form, 'notes').value !== look.notes.replace(/\r\n?/g, '\n'))) return true;
  }
  return [...element('#suggestion-list').querySelectorAll<HTMLFormElement>('form')].some(form => form.dataset.dirty === 'true');
}
window.addEventListener('beforeunload', event => {
  if (hasUnsavedDrafts()) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('pagehide', () => {
  startupController.abort(); cancelOperation();
  for (const draft of Object.values(photoDrafts)) draft.controller?.abort();
  for (const url of downloads) URL.revokeObjectURL(url);
  downloads.clear();
});
