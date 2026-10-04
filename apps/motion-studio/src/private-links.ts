import { MAX_JSON_BYTES, validateProject, type Project } from './model.ts';
import { getPrivateStatus, publishSnapshot, type PrivateStatus } from './private-api.ts';
export interface PublisherHooks {
  capture(): { project: Project; generation: number; intent: number } | null;
  state(): { generation: number; intent: number; locked: boolean; drafts: boolean };
}
/** Stable publisher controls never rebuild editor inputs or participate in local saves. */
export function createPrivateLinks(host: HTMLElement, hooks: PublisherHooks) {
  host.innerHTML = `<h3>Private snapshot links</h3><p>Publish one committed animation to an optional operator-run service. Unapplied fields, drawing previews, in-between scratch, Undo history and local project IDs are excluded. Later edits never update a published snapshot.</p><p id="private-link-status" aria-live="polite">Checking the optional sharing service…</p><button id="private-link-retry" hidden>Check sharing service</button><div id="private-link-controls" hidden><label class="field">Operator setup key<input id="private-link-setup" type="password" maxlength="64" autocomplete="off" spellcheck="false"></label><p id="private-link-capture" class="hint"></p><button id="publish-snapshot">Publish committed snapshot</button><button id="cancel-publication" hidden>Cancel publication request</button></div><div id="private-link-results" hidden><p id="private-link-result-label"></p><label class="field">Private viewing link<input id="private-view-link" readonly></label><label class="field">Private revocation link<input id="private-revoke-link" readonly></label><p class="hint">Anyone with the viewing link can receive and keep a copy. Keep the revocation link separately; it cannot view the artwork. Revocation prevents future reads, not copies already received.</p><button id="private-link-clear">Close private links</button></div>`;
  const node = <T extends HTMLElement>(id: string) => host.querySelector<T>(`#${id}`)!;
  const status = node<HTMLParagraphElement>('private-link-status'), setup = node<HTMLInputElement>('private-link-setup');
  const publish = node<HTMLButtonElement>('publish-snapshot'), cancel = node<HTMLButtonElement>('cancel-publication'), retry = node<HTMLButtonElement>('private-link-retry');
  let service: PrivateStatus | null = null, statusEpoch = 0, statusController: AbortController | null = null;
  let request: { controller: AbortController; epoch: number; title: string; generation: number; intent: number; origin: string } | null = null;
  let epoch = 0, suspended = false;
  function update() {
    const state = hooks.state(); publish.disabled = !service || !!request || suspended || state.locked;
    // Raw-field refusal happens before default focus/blur as well as before dispatch.
    if (!request && !state.locked) node('private-link-capture').textContent = state.drafts ? 'Apply or discard editor values and in-between scratch before publishing.' : 'The next publication captures committed artwork only.';
    cancel.hidden = !request;
  }
  function clearLinks() { for (const id of ['private-view-link', 'private-revoke-link']) node<HTMLInputElement>(id).value = ''; node('private-link-results').hidden = true; }
  function cancelRequest() {
    if (request) { request.controller.abort(); request = null; epoch++; status.textContent = 'Publication request interrupted. It may have arrived; no request is replayed. Keep your project and use operator recovery if no link was received.'; }
    update();
  }
  async function checkService() {
    const owner = ++statusEpoch; statusController?.abort(); const controller = new AbortController(); statusController = controller;
    service = null; retry.disabled = true; retry.hidden = true; status.textContent = 'Checking the optional sharing service…'; update();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const result = await getPrivateStatus(controller.signal);
      if (owner !== statusEpoch || suspended || controller.signal.aborted) return;
      service = result; node('private-link-controls').hidden = false;
      status.textContent = result.transport.mode === 'https-lan' ? `Sharing service: ${result.transport.origin}. Recipients must reach this address and trust its certificate. The operator setup key authorizes publishing only.` : `Sharing service: ${result.transport.origin}. This loopback address is reachable on this computer only. Publishing requires the operator setup key.`;
    } catch {
      if (owner !== statusEpoch || suspended) return;
      node('private-link-controls').hidden = true; status.textContent = 'Private sharing is unavailable. Local drawing, saving and exports still work. Start the optional service and check again.'; retry.hidden = false;
    } finally { clearTimeout(timeout); if (owner === statusEpoch) { statusController = null; retry.disabled = false; update(); } }
  }
  publish.addEventListener('pointerdown', event => { if (hooks.state().drafts) { event.preventDefault(); status.textContent = 'Apply or discard editor values and in-between scratch before publishing. Your exact draft is kept.'; } });
  publish.addEventListener('click', () => { void publishCaptured(); });
  async function publishCaptured() {
    if (!service || request || suspended || hooks.state().locked || hooks.state().drafts) { update(); return; }
    const captured = hooks.capture(); if (!captured) return;
    let safe: Project; try { safe = validateProject(captured.project); } catch { status.textContent = 'The committed project could not be admitted. No publication was sent.'; return; }
    const bytes = new TextEncoder().encode(JSON.stringify(safe)).length;
    if (bytes > MAX_JSON_BYTES) { status.textContent = 'The committed project exceeds the project-file limit. No publication was sent.'; return; }
    const key = setup.value;
    if (!/^[0-9a-f]{64}$/.test(key)) { status.textContent = 'Enter the operator’s 64-character lowercase hexadecimal setup key. It authorizes publishing only.'; return; }
    const owner = { controller: new AbortController(), epoch: ++epoch, title: safe.title, generation: captured.generation, intent: captured.intent, origin: service.transport.origin };
    request = owner; setup.value = ''; update();
    node('private-link-capture').textContent = `Captured “${safe.title}” · ${bytes.toLocaleString('en-US')} UTF-8 bytes. Drafts and history are excluded.`;
    status.textContent = 'Publishing the captured committed snapshot…';
    try {
      const result = await publishSnapshot(safe, key, owner.controller.signal);
      if (request !== owner || owner.epoch !== epoch || suspended || owner.controller.signal.aborted) return;
      node<HTMLInputElement>('private-view-link').value = `${owner.origin}/view#snapshot=${result.id}&read=${result.readToken}`;
      node<HTMLInputElement>('private-revoke-link').value = `${owner.origin}/view#snapshot=${result.id}&revoke=${result.revokeToken}`;
      node('private-link-result-label').textContent = `Published captured snapshot “${owner.title}” · ${result.projectBytes.toLocaleString('en-US')} bytes. Keep both links somewhere private.`;
      node('private-link-results').hidden = false;
      const current = hooks.state(); status.textContent = `Private links are ready for “${owner.title}”.${current.generation !== owner.generation || current.intent !== owner.intent ? ' Newer editor work is unchanged; these links belong to the earlier captured snapshot.' : ' Later editor edits will not change this snapshot.'}`;
    } catch (error) {
      if (request === owner && owner.epoch === epoch && !suspended && !owner.controller.signal.aborted) status.textContent = `${error instanceof Error ? error.message : 'Publication was not confirmed.'} It may exist if the reply was lost; no request is replayed. Re-enter the operator key for another deliberate attempt.`;
    } finally { if (request === owner) { request = null; update(); } }
  }
  retry.addEventListener('click', () => { void checkService(); }); cancel.addEventListener('click', cancelRequest);
  node('private-link-clear').addEventListener('click', () => { clearLinks(); setup.value = ''; });
  window.addEventListener('pagehide', () => { suspended = true; setup.value = ''; statusEpoch++; statusController?.abort(); statusController = null; cancelRequest(); clearLinks(); });
  window.addEventListener('pageshow', () => { if (suspended) { suspended = false; void checkService(); } });
  void checkService(); return { update, clearSetup: () => { setup.value = ''; } };
}
