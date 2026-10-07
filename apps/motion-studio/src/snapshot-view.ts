import { playbackFrame } from './playback.ts';
import './style.css';
import { FPS, HEIGHT, WIDTH, validateProject, type Project } from './model.ts';
import { createFrameRenderer, loadAssets, closeAssets, type Assets, type FrameRenderer } from './render.ts';
import { validateProjectImages } from './images.ts';
import { History } from './history.ts';
import { exportGif } from './export.ts';
import { exportPngFrames } from './png-export.ts';
import { ProjectLibrary } from './library-storage.ts';
import { fetchSnapshot, parsePrivateFragment, revokeSnapshot, type PrivateCredential, type SnapshotReceipt } from './private-api.ts';

// Capture and scrub even malformed fragments before any private request.
const originalFragment = location.hash;
history.replaceState(null, '', location.pathname);
const host = document.querySelector<HTMLElement>('#snapshot-app')!;
host.innerHTML = `<header><a class="brand" href="/">Motion Studio</a><span>Private captured animation</span></header><main class="snapshot-page"><section class="panel" aria-label="Private snapshot"><h1 id="snapshot-title">Private snapshot</h1><p id="snapshot-status" role="status" aria-live="polite">Reading the original private link…</p><p class="hint">This is an immutable captured copy. It never follows later editor changes. Private links grant access, not proof of authorship.</p><button id="snapshot-cancel-read" hidden>Cancel private snapshot read</button><div id="snapshot-content" hidden><div class="canvas-surround"><canvas id="snapshot-stage" width="640" height="360" aria-label="Captured animation" tabindex="0"></canvas></div><div class="snapshot-controls"><button id="snapshot-play">Play snapshot</button><label class="field">Snapshot frame <output id="snapshot-frame-label"></output><input id="snapshot-frame" type="range" min="0" value="0"></label></div><div class="snapshot-actions"><button id="snapshot-png">Save frame PNG</button><button id="snapshot-gif">Export animation GIF</button><button id="snapshot-png-frames">Export PNG frames ZIP</button><button id="snapshot-cancel-export" hidden>Cancel export</button><button id="snapshot-project">Save project file</button><button id="snapshot-open-local">Save as new local project</button></div><progress id="snapshot-progress" max="1" hidden aria-label="Snapshot export progress"></progress><p id="snapshot-local-status" aria-live="polite"></p><a id="snapshot-open-studio" href="/" hidden>Open local studio</a><p class="hint">Save as new local project creates an independent editable copy in this browser. It preserves other saved projects; later edits do not change the shared snapshot.</p></div><button id="snapshot-revoke" hidden>Revoke this private snapshot</button><p id="snapshot-revoke-hint" hidden>Revocation prevents future authorized reads. Copies already received and downloads remain outside its control. This management link cannot view the project.</p></section></main>`;
const node = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const status = node('snapshot-status'), canvas = node<HTMLCanvasElement>('snapshot-stage'), ctx = canvas.getContext('2d')!;
const slider = node<HTMLInputElement>('snapshot-frame'), play = node<HTMLButtonElement>('snapshot-play');
let credential: PrivateCredential | null = null, receipt: SnapshotReceipt | null = null;
let assets: Assets = new Map(), renderer: FrameRenderer | null = null;
let epoch = 0, controller: AbortController | null = null, busy = false, suspended = false;
let animation = 0, playing = false, frame = 0, started = 0, from = 0;
let exportController: AbortController | null = null, exportEpoch = 0;
let library: ProjectLibrary | null = null;
const urls = new Set<string>();
function stop() { playing = false; cancelAnimationFrame(animation); play.textContent = 'Play snapshot'; }
function draw() { if (!renderer) return; renderer.render(ctx, frame); canvas.dataset.frame = String(frame); slider.value = String(frame); node('snapshot-frame-label').textContent = `${frame + 1} / ${renderer.frameCount}`; }
function controls() {
  for (const id of ['snapshot-play','snapshot-frame','snapshot-png','snapshot-gif','snapshot-png-frames','snapshot-project','snapshot-open-local']) node<HTMLButtonElement>(id).disabled = !receipt || busy || suspended;
  node('snapshot-cancel-read').hidden = !controller;
  node('snapshot-cancel-export').hidden = !exportController;
  node<HTMLButtonElement>('snapshot-revoke').disabled = busy || suspended;
}
function retire() {
  epoch++; controller?.abort(); controller = null; exportEpoch++; exportController?.abort(); exportController = null;
  library?.close(); library = null; stop(); closeAssets(assets); assets = new Map(); renderer = null; receipt = null; credential = null; busy = false;
  for (const url of urls) URL.revokeObjectURL(url); urls.clear();
  ctx.clearRect(0,0,WIDTH,HEIGHT); node('snapshot-content').hidden = true; node('snapshot-revoke').hidden = true; node('snapshot-revoke-hint').hidden = true; node('snapshot-open-studio').hidden = true; node('snapshot-progress').hidden = true;
  node('snapshot-title').textContent = 'Private snapshot'; node('snapshot-local-status').textContent = ''; controls();
}
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); urls.add(url); const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 1000);
}
async function deadline<T>(work: Promise<T>, owner: AbortController, dispose?: (value:T)=>void): Promise<T> {
  let finished = false;
  const expires = performance.now()+10000;
  const pending = work.then(value => { if (finished) dispose?.(value); return value; });
  let fail: () => void = () => {};
  const stopped = new Promise<never>((_resolve,reject) => {
    fail = () => reject(new DOMException('Snapshot operation cancelled or timed out.', 'AbortError'));
    if (owner.signal.aborted) fail(); else owner.signal.addEventListener('abort', fail, { once:true });
  });
  const timeout = setTimeout(() => owner.abort(),10000);
  try {
    const value = await Promise.race([pending,stopped]);
    if (owner.signal.aborted || performance.now() >= expires) { owner.abort(); dispose?.(value); throw new DOMException('Snapshot operation cancelled or timed out.', 'AbortError'); }
    return value;
  } finally { finished = true; clearTimeout(timeout); owner.signal.removeEventListener('abort',fail); }
}
async function prepare(project: Project, signal?: AbortSignal): Promise<{ project: Project; assets: Assets }> {
  const safe = validateProject(project), history = new History(safe);
  await validateProjectImages(safe);
  if (signal?.aborted) throw new DOMException('Cancelled','AbortError');
  const decoded = await loadAssets(safe);
  if (signal?.aborted) { closeAssets(decoded); throw new DOMException('Cancelled','AbortError'); }
  return { project: history.current, assets: decoded };
}
async function openLink(fragment: string) {
  retire(); const token = epoch;
  let link: PrivateCredential | null;
  try { link = parsePrivateFragment(fragment); } catch { status.textContent = 'The private link is malformed. Its fragment was removed; use the exact original viewing or revocation link.'; return; }
  if (!link) { status.textContent = 'Open the original private viewing or revocation link. Reloading this page clears its in-memory access; no private credentials are stored.'; return; }
  credential = link;
  if (link.kind === 'revoke') { status.textContent = 'Private revocation link ready. No project has been fetched; choose Revoke explicitly.'; node('snapshot-revoke').hidden = false; node('snapshot-revoke-hint').hidden = false; controls(); return; }
  const owner = new AbortController(); controller = owner; busy = true; controls(); status.textContent = 'Reading and verifying the captured project…';
  let prepared: { project: Project; assets: Assets } | null = null;
  try {
    const loaded = await deadline((async () => {
      const received = await fetchSnapshot(link.id, link.token, owner.signal);
      const decoded = await prepare(received.project,owner.signal);
      return { received, decoded };
    })(),owner,value=>closeAssets(value.decoded.assets));
    prepared = loaded.decoded;
    if (token !== epoch || suspended || owner.signal.aborted || controller !== owner) return;
    receipt = { ...loaded.received, project: prepared.project }; assets = prepared.assets; prepared = null;
    renderer = createFrameRenderer(receipt.project,assets); frame = 0; slider.max = String(renderer.frameCount-1); draw();
    node('snapshot-title').textContent = receipt.project.title; node('snapshot-content').hidden = false;
    status.textContent = `Verified captured snapshot · ${receipt.json.length.toLocaleString('en-US')} UTF-8 bytes · ${renderer.frameCount} frames at ${FPS} fps.`;
  } catch (error) { if (token === epoch && !suspended) status.textContent = owner.signal.aborted ? 'Snapshot read cancelled or timed out. No project was opened or saved. Reopen the original link for a fresh read.' : error instanceof Error ? error.message : 'Could not open this private snapshot.'; }
  finally { if (prepared) closeAssets(prepared.assets); if (token === epoch && controller === owner) { controller = null; busy = false; controls(); } }
}
function consumeFragment() { const fragment = location.hash; history.replaceState(null,'',location.pathname); void openLink(fragment); }
window.addEventListener('hashchange',consumeFragment);
node('snapshot-cancel-read').addEventListener('click',()=> { controller?.abort(); library?.close(); });
slider.addEventListener('input',()=> { stop(); frame = Number(slider.value); draw(); });
play.addEventListener('click',()=> {
  if (!renderer || busy) return; if (playing) { stop(); return; }
  if (frame === renderer.frameCount-1) frame = 0;
  playing = true; from = frame; started = performance.now(); play.textContent = 'Stop snapshot';
  const tick = (now:number) => {
    if (!playing || !renderer) return;
    frame = Math.min(renderer.frameCount - 1, playbackFrame(from, now - started)); draw();
    if (frame === renderer.frameCount-1) stop(); else animation = requestAnimationFrame(tick);
  }; animation = requestAnimationFrame(tick);
});
node('snapshot-project').addEventListener('click',()=> { if (receipt && !busy) download(new Blob([receipt.json],{type:'application/json'}),'private-snapshot.motion.json'); });
node('snapshot-png').addEventListener('click',()=> {
  if (!receipt || !renderer || busy) return; stop(); const token = epoch, captured = frame;
  const output = document.createElement('canvas'); output.width = WIDTH; output.height = HEIGHT; renderer.render(output.getContext('2d')!,captured);
  output.toBlob(blob=> { if (blob && token === epoch && !suspended) download(blob,`snapshot-frame-${captured+1}.png`); },'image/png');
});
node('snapshot-gif').addEventListener('click',()=> { void exportAnimation(false); });
node('snapshot-png-frames').addEventListener('click',()=> { void exportAnimation(true); });
async function exportAnimation(pngFrames: boolean) {
  if (!receipt || busy) return; stop(); const captured = receipt.project, token = epoch, request = ++exportEpoch;
  const owner = new AbortController(); exportController = owner; busy = true; controls(); const progress = node<HTMLProgressElement>('snapshot-progress'); progress.hidden = false; progress.value = 0;
  try { const blob = await (pngFrames ? exportPngFrames : exportGif)(captured,fraction=> { if (token === epoch && request === exportEpoch) progress.value = fraction; },owner.signal); if (token === epoch && request === exportEpoch && !owner.signal.aborted && !suspended) { download(blob,pngFrames ? 'private-snapshot-frames.zip' : 'private-snapshot.gif'); status.textContent = pngFrames ? 'Captured full-color PNG frames exported at exactly 12 fps.' : 'Captured animation GIF exported. No editor overlays or private credentials are included.'; } }
  catch (error) { if (token === epoch && request === exportEpoch) status.textContent = owner.signal.aborted ? 'Snapshot export cancelled.' : error instanceof Error ? error.message : 'Snapshot export failed.'; }
  finally { if (token === epoch && exportController === owner) { exportController = null; busy = false; progress.hidden = true; controls(); } }
}
node('snapshot-cancel-export').addEventListener('click',()=>exportController?.abort());
node('snapshot-open-local').addEventListener('click',()=> { void saveLocal(); });
async function saveLocal() {
  if (!receipt || busy || suspended) return;
  const project = validateProject(receipt.project), token = epoch, owner = new AbortController(), storage = new ProjectLibrary();
  controller = owner; library = storage; busy = true; stop(); controls(); node('snapshot-local-status').textContent = 'Preparing an independent new local project…';
  const prepared: { value: { project: Project; assets: Assets } | null } = { value: null }; let writeStarted = false;
  const cancel = () => storage.close(); owner.signal.addEventListener('abort',cancel,{once:true});
  try {
    const result = await deadline((async()=> {
      const view = await storage.read();
      if (owner.signal.aborted || token !== epoch) throw new DOMException('Cancelled','AbortError');
      if ((view.head?.entries.length ?? 0) >= 8) throw new Error('This browser already holds eight projects. Delete a saved project in the local studio before saving this copy.');
      prepared.value = await prepare(project,owner.signal);
      if (owner.signal.aborted || token !== epoch) throw new DOMException('Cancelled','AbortError');
      storage.acceptRead(view.receipt);
      if (view.legacy) {
        const legacy = await prepare(view.legacy.project,owner.signal);
        try { if (owner.signal.aborted || token !== epoch) throw new DOMException('Cancelled','AbortError'); storage.acceptProject(view.legacy.receipt); }
        finally { closeAssets(legacy.assets); }
      }
      if (owner.signal.aborted || token !== epoch) throw new DOMException('Cancelled','AbortError');
      writeStarted = true; return await storage.create(prepared.value.project);
    })(),owner);
    if (token !== epoch || suspended || owner.signal.aborted || controller !== owner) return;
    node('snapshot-local-status').textContent = `“${project.title}” was saved as a new local project. Other saved projects were kept. Open the local studio when you are ready; the captured viewer is unchanged.`;
    node('snapshot-open-studio').hidden = false;
    if (!result.entry) throw new Error('Local creation completion was not confirmed.');
  } catch (error) { if (token === epoch && !suspended) node('snapshot-local-status').textContent = `${error instanceof Error ? error.message : 'The local copy was not confirmed.'}${writeStarted ? ' A new local entry may exist if completion was interrupted. Check Projects in the local studio before another deliberate attempt; no create is replayed.' : ' Existing saved projects were kept.'}`; }
  finally { if (prepared.value) closeAssets(prepared.value.assets); owner.signal.removeEventListener('abort',cancel); storage.close(); if (token === epoch && controller === owner) { controller = null; library = null; busy = false; controls(); } }
}
node('snapshot-revoke').addEventListener('click',()=> { void revoke(); });
async function revoke() {
  const link = credential; if (!link || link.kind !== 'revoke' || busy || suspended) return;
  if (!confirm('Revoke this private snapshot? Future viewing requests will be refused. Copies already received are not removed.')) return;
  if (credential !== link || suspended || busy) return;
  const token = epoch, owner = new AbortController(); controller = owner; busy = true; controls();
  try { await revokeSnapshot(link.id,link.token,owner.signal); if (token === epoch && controller === owner && !suspended) { credential = null; node('snapshot-revoke').hidden = true; status.textContent = 'Snapshot revoked. Future viewing requests are refused; copies already received cannot be removed.'; } }
  catch (error) { if (token === epoch && !suspended) status.textContent = `${error instanceof Error ? error.message : 'Revocation was not confirmed.'} It may have arrived; no command is replayed.`; }
  finally { if (token === epoch && controller === owner) { controller = null; busy = false; controls(); } }
}
window.addEventListener('pagehide',()=> { suspended = true; retire(); status.textContent = 'Private access was cleared. Reopen the original link to read again.'; });
window.addEventListener('pageshow',()=> { if (suspended) { suspended = false; controls(); } });
void openLink(originalFragment);
