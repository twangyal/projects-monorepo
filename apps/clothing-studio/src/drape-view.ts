import { drapeObj, drapeSvg, FABRICS, FABRIC_KINDS, validateFabric, type DrapeResult, type FabricKind } from './drape.ts';
import { validateProject, type Project } from './model.ts';

export const drapeMarkup = `<fieldset id="drape-panel"><legend>Fabric drape simulation</legend>
<label for="drape-fabric">Fabric</label><select id="drape-fabric">${FABRIC_KINDS.map(kind => `<option value="${kind}">${FABRICS[kind].label} · ${FABRICS[kind].gsm} g/m²</option>`).join('')}</select>
<div class="construction-actions"><button id="drape-simulate">Simulate drape</button><button id="drape-cancel" class="quiet" hidden>Cancel simulation</button><button id="drape-obj" class="quiet" disabled>Export draped OBJ</button></div>
<p id="drape-status" role="status">Apply a measured skirt pattern, choose a fabric, then simulate how it hangs.</p>
<div id="drape-view" class="construction-3d" tabindex="0" aria-label="Simulated drape preview; use Left and Right arrows to rotate"></div>
<div class="construction-actions"><button id="drape-left" class="quiet" disabled>Rotate drape left</button><button id="drape-right" class="quiet" disabled>Rotate drape right</button><label><input id="drape-body" type="checkbox" checked> Show body proxy</label></div>
<p id="drape-metrics"></p>
<p class="fine-print">The skirt panels are meshed from their flat patterns and settled under gravity with stretch, shear and bending resistance (an XPBD cloth solver), held at the waistline and kept outside a body proxy shaped from your entered waist, hip and depth (or an assumed profile). Fabric presets are approximate typical weights and stiffnesses, not measured fabric data; there is no friction, wind, motion or fabric thickness. Validate drape and fit with a physical toile.</p></fieldset>`;

export function mountDrape(options: { current: () => Project; commit: (next: Project) => void; guard: () => boolean; notice: (text: string, error?: boolean) => void; download: (blob: Blob, suffix: string) => void }) {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const fabricSelect = element<HTMLSelectElement>('drape-fabric'), simulate = element<HTMLButtonElement>('drape-simulate'), cancel = element<HTMLButtonElement>('drape-cancel');
  const obj = element<HTMLButtonElement>('drape-obj'), status = element('drape-status'), view = element('drape-view'), metrics = element('drape-metrics');
  const left = element<HTMLButtonElement>('drape-left'), right = element<HTMLButtonElement>('drape-right'), showBody = element<HTMLInputElement>('drape-body');
  let worker: Worker | null = null, yaw = -30;
  let result: { draped: DrapeResult; fabric: FabricKind; signature: string } | null = null;
  const signature = (p: Project) => JSON.stringify([p.construction ?? null, p.bodyMeasurements ?? null]);
  const fabricOf = (p: Project): FabricKind => p.construction?.fabric ?? 'cotton';

  function draw(): void {
    if (!result) { view.innerHTML = ''; metrics.textContent = ''; return; }
    view.innerHTML = drapeSvg(result.draped, yaw, '#b8613d', showBody.checked);
    const m = result.draped.metrics, body = result.draped.body;
    metrics.textContent = `${FABRICS[result.fabric].label}: ${m.folds} folds around the hem; hem hangs at ${Math.round(m.hemFlare * 100)}% of the rigid cone's flare and ${m.hemDrop.toFixed(1)} cm lower. Largest fabric stretch ${(m.maxStrain * 100).toFixed(1)}%; closest approach to the body ${m.minClearance.toFixed(1)} cm. Body proxy: waist ${body.waist} cm, hip ${body.hip} cm at ${body.hipDepth} cm${result.draped.bodyAssumed ? ' (assumed — apply body measurements to use yours)' : ' (your entered measurements)'}.`;
  }
  function render(p: Project): void {
    const busy = worker !== null;
    fabricSelect.value = fabricOf(p); fabricSelect.disabled = !p.construction || busy;
    simulate.disabled = !p.construction || busy; cancel.hidden = !busy;
    const fresh = !!result && result.signature === signature(p) && result.fabric === fabricOf(p);
    obj.disabled = !fresh || busy; left.disabled = right.disabled = !result;
    if (!p.construction) { status.textContent = 'Apply a measured skirt pattern, choose a fabric, then simulate how it hangs.'; result = null; draw(); return; }
    if (result && !fresh && !busy) status.textContent = 'The pattern, fabric or body changed since this simulation. Simulate again to update it.';
  }
  function stop(): void { worker?.terminate(); worker = null; }

  fabricSelect.addEventListener('change', () => {
    const p = options.current();
    if (!p.construction || !options.guard()) { fabricSelect.value = fabricOf(p); return; }
    try {
      const fabric = validateFabric(fabricSelect.value);
      options.commit(validateProject({ ...p, construction: { ...p.construction, fabric } }));
      options.notice(`${FABRICS[fabric].label} chosen for this skirt. Simulate drape to see it hang.`);
    } catch (error) { options.notice(error instanceof Error ? error.message : 'Could not choose this fabric.', true); fabricSelect.value = fabricOf(p); }
  });
  simulate.addEventListener('click', () => {
    const p = options.current();
    if (!p.construction || worker) return;
    const snapshot = signature(p), fabric = fabricOf(p), started = performance.now();
    const pending = new Worker(new URL('./drape.worker.ts', import.meta.url), { type: 'module' });
    worker = pending; status.textContent = 'Settling the fabric under gravity…'; render(p);
    const timer = setTimeout(() => finish('The simulation took longer than 60 seconds and was stopped.'), 60000);
    function finish(error?: string, draped?: DrapeResult): void {
      if (worker !== pending) return;
      clearTimeout(timer); stop();
      if (draped) {
        result = { draped, fabric, signature: snapshot };
        status.textContent = `Drape simulated in ${((performance.now() - started) / 1000).toFixed(1)} s. Rotate to inspect folds.`;
        draw();
      } else if (error) status.textContent = error;
      render(options.current());
    }
    pending.onmessage = (event: MessageEvent<{ kind: string; frame?: number; frames?: number; result?: DrapeResult; message?: string }>) => {
      const data = event.data;
      if (data.kind === 'progress') { status.textContent = `Settling the fabric under gravity… ${Math.round((data.frame! / data.frames!) * 100)}%`; return; }
      if (data.kind === 'result' && data.result && data.result.positions instanceof Float32Array && data.result.positions.length === (data.result.rows + 1) * data.result.columns * 3) finish(undefined, data.result);
      else finish(data.message ?? 'The drape simulation returned an unexpected result.');
    };
    pending.onerror = event => { event.preventDefault(); finish('The drape simulation failed in this browser.'); };
    pending.postMessage({ construction: p.construction, fabric, ...(p.bodyMeasurements ? { body: p.bodyMeasurements } : {}) });
  });
  cancel.addEventListener('click', () => { if (!worker) return; stop(); status.textContent = 'Simulation cancelled. Nothing was changed.'; render(options.current()); });
  const rotate = (step: number) => { if (!result) return; yaw = ((yaw + step + 540) % 360) - 180; draw(); };
  left.addEventListener('click', () => rotate(-30)); right.addEventListener('click', () => rotate(30));
  view.addEventListener('keydown', event => { if (event.key === 'ArrowLeft') { rotate(-15); event.preventDefault(); } if (event.key === 'ArrowRight') { rotate(15); event.preventDefault(); } });
  showBody.addEventListener('change', draw);
  obj.addEventListener('click', () => {
    if (!result || obj.disabled) return;
    options.download(new Blob([drapeObj(result.draped, result.fabric)], { type: 'model/obj' }), `-draped-${result.fabric}.obj`);
    options.notice('Draped surface exported as OBJ (centimetres, +Y toward the hem).');
  });
  return { render };
}
