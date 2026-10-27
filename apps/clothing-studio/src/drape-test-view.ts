import { SPECIMEN_RADIUS, SUPPORT_RADIUS, TYPICAL_DRAPE, type DrapeTestResult } from './drape-test.ts';
import { material } from './product.ts';

/** A fabric's drape test beside the part's fabric choice: coefficient, folds and the shadow seen from above. */
export const drapeTestMarkup = `<div class="drape-test"><button id="drape-test" class="quiet">Test this fabric’s drape</button>
  <p id="drape-test-result" class="fine-print" role="status"></p>
  <svg id="drape-test-shadow" viewBox="-16 -16 32 32" width="132" height="132" role="img" hidden><circle r="${SPECIMEN_RADIUS}" fill="none" stroke="currentColor" stroke-width="0.25" stroke-dasharray="0.8 0.8" opacity="0.6"></circle><path fill="currentColor" opacity="0.35"></path><circle r="${SUPPORT_RADIUS}" fill="currentColor" opacity="0.5"></circle></svg></div>`;

const feel = (coefficient: number) => coefficient < 0.35 ? 'soft: it falls in deep folds' : coefficient < 0.55 ? 'medium: it folds and still holds some shape'
  : coefficient < 0.75 ? 'firm: it stands away from the body in wide folds' : 'stiff: it barely folds';

/** In words, for the status line and the shadow's description. */
export function describeDrapeTest(materialId: string, result: DrapeTestResult): string {
  const fabric = material(materialId), [low, high] = TYPICAL_DRAPE[fabric.texture];
  return `${fabric.name}, ${fabric.gsm} gsm: drape coefficient ${result.coefficient.toFixed(2)} with ${result.nodes} folds, ${feel(result.coefficient)}. `
    + `Drape testers typically measure ${low.toFixed(2)}–${high.toFixed(2)} for this construction (0 hangs straight down, 1 stays flat).`;
}

/** `materialId` names the fabric shown; `sync` updates the panel when it changes, cancelling a test in progress. */
export function mountDrapeTest(materialId: () => string): { sync: () => void } {
  const $ = <T extends Element>(id: string) => document.getElementById(id) as unknown as T;
  const button = $<HTMLButtonElement>('drape-test'), status = $<HTMLElement>('drape-test-result'), svg = $<SVGSVGElement>('drape-test-shadow');
  // The test is deterministic, so each fabric's result is kept for the session.
  const results = new Map<string, DrapeTestResult>();
  let worker: Worker | null = null, testing = '', shown = '';
  const stop = () => { worker?.terminate(); worker = null; testing = ''; button.disabled = false; };
  function show(id: string) {
    shown = id;
    const result = results.get(id);
    svg.toggleAttribute('hidden', !result);
    if (!result) { status.textContent = ''; return; }
    status.textContent = describeDrapeTest(id, result);
    svg.querySelector('path')!.setAttribute('d', `M${result.outline.map(([x, z]) => `${x.toFixed(2)} ${z.toFixed(2)}`).join('L')}Z`);
    svg.setAttribute('aria-label', `The hanging fabric seen from above: ${result.nodes} folds round an 18 cm support, inside the 30 cm flat specimen.`);
  }
  function sync() {
    const id = materialId();
    if (testing && testing !== id) { stop(); status.textContent = ''; }
    if (id !== shown && !testing) show(id);
  }
  button.addEventListener('click', () => {
    const id = materialId();
    if (results.has(id)) { show(id); return; }
    stop();
    try { worker = new Worker(new URL('./drape-test.worker.ts', import.meta.url), { type: 'module' }); }
    catch { status.textContent = 'The drape test could not start. Try again.'; return; }
    testing = id; button.disabled = true; svg.setAttribute('hidden', ''); status.textContent = 'Draping a 30 cm sample over an 18 cm support…';
    const current = worker;
    current.onmessage = (event: MessageEvent<{ kind: 'progress'; frame: number; frames: number } | { kind: 'result'; result: DrapeTestResult } | { kind: 'error'; message: string }>) => {
      if (current !== worker) return;
      const data = event.data;
      if (data.kind === 'progress') { status.textContent = `Draping a 30 cm sample over an 18 cm support… ${Math.round(100 * data.frame / data.frames)}%`; return; }
      stop();
      if (data.kind === 'result') { results.set(id, data.result); show(id); }
      else status.textContent = `${data.message} Try again.`;
    };
    current.onerror = () => { if (current === worker) { stop(); status.textContent = 'The drape test could not run. Try again.'; } };
    current.postMessage({ materialId: id });
  });
  return { sync };
}
