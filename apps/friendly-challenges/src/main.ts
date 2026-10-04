import './style.css';
import { ApiError, request, postImageEvidence, fetchEvidenceImage, fetchImageExport } from './api.ts';
import { normalizeEvidenceImage } from './evidence-image.ts';
import { loadSessions, readLink, removeSession, saveSession } from './session.ts';
import type { PrivateLink } from './session.ts';
import { ID_PATTERN, STAKES } from './types.ts';
import type { ChallengeEvent, ChallengeExport, Claim, Creation, Invitation, Snapshot, Terms, ImageDescriptor } from './types.ts';

const originalLocation = { search: location.search, hash: location.hash };
let editorInputIntent = 0;
history.replaceState(null, '', `${location.pathname}${location.search}`);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag); n.textContent = text; if (className) n.className = className; return n;
}
function button(label: string, action?: () => void, cls = ''): HTMLButtonElement {
  const n = el('button', label, cls); n.type = 'button'; if (action) n.addEventListener('click', action); return n;
}
function section(title: string, hint = ''): HTMLElement {
  const n = el('section', '', 'panel'); n.append(el('h2', title)); if (hint) n.append(el('p', hint, 'hint')); return n;
}
function form(id: string): HTMLFormElement {
  const n = el('form'); n.id = id; n.addEventListener('input', (event) => { if (event.target instanceof HTMLInputElement && event.target.id === 'setup-key') return; n.dataset.dirty = 'true'; editorInputIntent++; }); return n;
}
function field(f: HTMLFormElement, name: string, caption: string, max: number, multiline = false, required = true, type = 'text'): HTMLInputElement | HTMLTextAreaElement {
  const label = el('label', caption, 'field'); const n = multiline ? el('textarea') : el('input'); n.name = name; n.id = `${f.id}-${name}`; n.maxLength = max; n.required = required;
  if (n instanceof HTMLInputElement) n.type = type; else n.rows = 3; label.append(n); f.append(label); return n;
}
function select(f: HTMLFormElement, name: string, caption: string, choices: readonly (readonly [string, string])[]): HTMLSelectElement {
  const label = el('label', caption, 'field'); const n = el('select'); n.name = name;
  for (const [value, text] of choices) { const option = el('option', text); option.value = value; n.append(option); } label.append(n); f.append(label); return n;
}
function submit(f: HTMLFormElement, caption: string, action: () => void): HTMLButtonElement {
  const b = button(caption, undefined, 'primary'); b.type = 'submit'; f.append(b); f.addEventListener('submit', (e) => { e.preventDefault(); if (f.reportValidity()) action(); }); return b;
}
function value(f: HTMLFormElement, name: string): string { return String(new FormData(f).get(name) ?? '').trim(); }
function set(f: HTMLFormElement, name: string, text: string): void { const n = f.elements.namedItem(name); if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement || n instanceof HTMLSelectElement) n.value = text; }
function draft(f: HTMLFormElement): string { return JSON.stringify([...new FormData(f).entries()]); }
function reset(f: HTMLFormElement): void { f.reset(); f.dataset.dirty = 'false'; }
const stakes: Record<string, string> = { 'bragging-rights': 'Bragging rights', 'make-a-drink': 'Make a drink', 'pick-a-movie': 'Pick a movie', 'do-the-dishes': 'Do the dishes' };
function localDate(time: number): string { const d = new Date(time); return new Date(time - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function when(time: number): string { return new Date(time).toLocaleString(); }
function termsFields(f: HTMLFormElement): void {
  field(f, 'title', 'Challenge title', 100); field(f, 'description', 'Challenge description', 500, true); field(f, 'successCriteria', 'Success criteria', 500, true); field(f, 'evidenceRule', 'Evidence rule', 300, true);
  select(f, 'stake', 'Friendly stake', STAKES.map((s) => [s, stakes[s]!])); const deadline = field(f, 'deadline', 'Deadline (your local time)', 40, false, true, 'datetime-local'); deadline.defaultValue = localDate(Date.now() + 86400000);
}
function readTerms(f: HTMLFormElement): Terms { return { title: value(f, 'title'), description: value(f, 'description'), successCriteria: value(f, 'successCriteria'), evidenceRule: value(f, 'evidenceRule'), stake: value(f, 'stake') as Terms['stake'], deadline: new Date(value(f, 'deadline')).getTime() }; }
function fillTerms(f: HTMLFormElement, t: Terms): void { for (const k of ['title', 'description', 'successCriteria', 'evidenceRule', 'stake'] as const) set(f, k, t[k]); set(f, 'deadline', localDate(t.deadline)); f.dataset.dirty = 'false'; }

const app = document.querySelector<HTMLDivElement>('#app'); if (!app) throw new Error('Missing app root.');
const header = el('header', '', 'site-header'); header.append(el('a', 'Friendly Challenges', 'brand'), el('span', 'A little competition. A clear agreement.', 'brand-note'));
const main = el('main'); const message = el('p', '', 'message'); message.id = 'message'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); message.hidden = true;
const connection = el('p', 'Connecting…', 'connection'); connection.id = 'connection-status'; connection.setAttribute('role', 'status'); main.append(message, connection); app.append(header, main);
const accessRecovery = el('div', '', 'warning access-recovery'); accessRecovery.id = 'access-recovery'; accessRecovery.hidden = true; accessRecovery.setAttribute('role', 'status');
const accessRecoveryText = el('p'); const retryAccess = button('Retry saving access', retrySavingAccess); accessRecovery.append(accessRecoveryText, retryAccess); main.append(accessRecovery);
function announce(text: string, error = false): void { message.textContent = text; message.hidden = !text; message.classList.toggle('error', error); }
const dashboard = el('div', '', 'dashboard'); main.append(dashboard);
const hero = el('div', '', 'hero'); hero.append(el('p', 'MAKE IT FRIENDLY', 'eyebrow'), el('h1', 'Small stakes. Clear agreements.'), el('p', 'Choose a challenge, agree on the rules, and decide the result together. Private links give each person their own seat.')); dashboard.append(hero);
const grid = el('div', '', 'dashboard-grid'); dashboard.append(grid);
const createPanel = section('Propose a challenge', 'Your opponent joins first, then chooses whether to accept the agreement.'); const createForm = form('create-form'); field(createForm, 'name', 'Your name', 40); termsFields(createForm);
const transportInfo = el('div', '', 'transport-info');
const transportStatus = el('p', 'Checking this service’s connection mode…', 'hint'); transportStatus.id = 'transport-status'; transportStatus.setAttribute('aria-live', 'polite');
const retryTransport = button('Check connection mode', () => { void loadTransportStatus(); }); retryTransport.id = 'retry-transport-status'; retryTransport.hidden = true;
transportInfo.append(transportStatus, retryTransport); createPanel.append(transportInfo);
const setupField = el('label', 'Operator setup key', 'field'); setupField.id = 'setup-key-field'; setupField.hidden = true;
const setupKeyInput = el('input'); setupKeyInput.id = 'setup-key'; setupKeyInput.type = 'password'; setupKeyInput.maxLength = 64; setupKeyInput.autocomplete = 'off'; setupKeyInput.spellcheck = false;
setupField.append(setupKeyInput, el('span', 'Only the operator can authorize a new challenge here. This key does not join a seat or accept an agreement.', 'hint')); createForm.append(setupField);
const createButton = submit(createForm, 'Propose challenge', () => { void createChallenge(); }); createPanel.append(createForm); grid.append(createPanel);
const notebook = section('Your challenges', 'Seats remembered in this browser. Keep a private access link if you need to return elsewhere.'); const recordList = el('div'); recordList.id = 'challenge-list'; notebook.append(recordList, el('p', 'The shared notebook holds 20 lifetime challenges, including finished ones. Records are never silently removed.', 'hint')); grid.append(notebook);
const intent = section('A private link', 'Keep this link private. Names are labels, not verified identities.'); intent.id = 'link-intent'; intent.hidden = true; main.append(intent);
const intentText = el('p'); const useAccess = button('Use this private access link', () => { void useIncomingAccess(); }, 'primary'); const keepSeat = button('Keep my current seat', () => { if (busy) return; pendingLink = null; intent.hidden = true; announce('Kept your current seat.'); });
const claimForm = form('claim-form'); field(claimForm, 'name', 'Your name', 40); const claimButton = submit(claimForm, 'Claim opponent seat', () => { void claimSeat(); }); intent.append(intentText, useAccess, claimForm, keepSeat);
const linkPanel = section('Private link'); linkPanel.id = 'link-panel'; linkPanel.hidden = true; main.append(linkPanel);
const linkExplanation = el('p'); const linkLabel = el('label', 'Private link', 'field'); const sharedLink = el('input'); sharedLink.id = 'shared-link'; sharedLink.readOnly = true; linkLabel.append(sharedLink);
linkPanel.append(linkExplanation, linkLabel, button('Copy link', () => { void copyLink(); }), button('Close link', closeLink));
let revealed: { id: string; kind: PrivateLink['kind']; nominationId?: string } | null = null;
function closeLink(): void { linkPanel.hidden = true; sharedLink.value = ''; revealed = null; }
function reveal(id: string, kind: PrivateLink['kind'], token: string, nominationId?: string): void {
  revealed = { id, kind, nominationId }; sharedLink.value = `${location.origin}/?challenge=${id}#${kind}=${token}`;
  linkExplanation.textContent = kind === 'access' ? 'Your reusable private access link. Anyone holding it can act as you. Save it somewhere private; record exports do not include it.' : 'One-use invitation: give this to the intended person. Claiming an opponent seat does not accept the challenge. Issuing another invitation invalidates the previous one.'; linkPanel.hidden = false;
}
async function copyLink(): Promise<void> { try { await navigator.clipboard.writeText(sharedLink.value); announce('Private link copied.'); } catch { sharedLink.focus(); sharedLink.select(); announce('Select and copy the private link. Clipboard access is unavailable.'); } }
const workspace = el('div', '', 'workspace'); workspace.hidden = true; main.append(workspace);
const toolbar = el('div', '', 'toolbar'); toolbar.append(button('Back to challenges', () => { if (leaveDrafts()) showDashboard(); }), button('My private access link', () => { if (selected) reveal(selected.id, 'access', selected.token); }), button('Refresh challenge', () => { void refreshSelected(true); }));
const exportButton = button('Export record', () => { void exportRecord(); });
const exportImagesButton = button('Export record with images', () => { void exportImages(); }); exportImagesButton.id = 'export-images'; toolbar.append(exportButton, exportImagesButton); workspace.append(toolbar);
const challengeHeader = el('div', '', 'challenge-header'); const status = el('span', '', 'badge'); status.id = 'challenge-status'; const revision = el('span', '', 'hint'); revision.id = 'challenge-revision'; const title = el('h1'); const people = el('p'); const deadlineText = el('p', '', 'hint'); challengeHeader.append(status, revision, title, people, deadlineText); workspace.append(challengeHeader);
const finalPanel = section('Final record'); const finalText = el('p'); finalPanel.append(finalText); finalPanel.hidden = true; workspace.append(finalPanel);
const columns = el('div', '', 'workspace-grid'); const left = el('div', '', 'column'); const right = el('div', '', 'column'); columns.append(left, right); workspace.append(columns);
const agreement = section('The agreement'); const termsDisplay = el('div', '', 'terms'); termsDisplay.id = 'terms-display'; const reviewWarning = el('p', '', 'warning'); reviewWarning.id = 'terms-warning';
const reviewButton = button('Review updated terms', () => { if (snapshot) { reviewed = { version: snapshot.termsVersion, revision: snapshot.revision, terms: { ...snapshot.terms } }; render(); announce('Showing updated terms. Read them before accepting.'); } });
const acceptButton = button('Accept these terms', () => { void acceptTerms(); }, 'primary'); const inviteOpponent = button('Invite opponent', () => { void issueInvite('opponent'); }); agreement.append(termsDisplay, reviewWarning, reviewButton, acceptButton, inviteOpponent); left.append(agreement);
const editPanel = section('Edit proposed terms', 'Changes need a fresh review. Accepted terms are fixed.'); const termsForm = form('terms-form'); termsFields(termsForm); submit(termsForm, 'Save terms', () => { void command('/terms', { terms: readTerms(termsForm) }, termsForm, 'Terms updated.'); }); editPanel.append(termsForm); left.append(editPanel);
const evidencePanel = section('Shared evidence', 'Supplied captions, optional HTTPS links and normalized images. These claims are not verified proof; links are not fetched.');
const evidenceList = el('div'); evidenceList.id = 'evidence-list'; const evidenceForm = form('evidence-form');
field(evidenceForm, 'text', 'Evidence', 1000, true); field(evidenceForm, 'url', 'Source link (optional)', 1024, false, false, 'url');
const imageChoice = el('label', 'Choose evidence image', 'field'); const imageFile = el('input'); imageFile.type = 'file'; imageFile.id = 'evidence-image'; imageFile.name = 'image'; imageFile.accept = '.png,.jpg,.jpeg,image/png,image/jpeg'; imageChoice.append(imageFile);
const imageStatus = el('p', 'No image selected.', 'hint'); imageStatus.id = 'evidence-image-status'; imageStatus.setAttribute('role', 'status'); imageStatus.setAttribute('aria-live', 'polite');
const imagePreview = el('img', '', 'evidence-image'); imagePreview.id = 'evidence-image-preview'; imagePreview.alt = 'Normalized evidence image preview'; imagePreview.hidden = true;
const imageDisclaimer = el('p', 'The reviewed copy is resized to fit 1024 × 1024 without upscaling, reencoded as JPEG and flattened onto white. The original and its filename/location/device metadata are not retained. Browser color conversion may change pixels. A photo is an unverified claim, not proof of capture time, identity or a winner.', 'hint image-disclaimer');
const removeImageButton = button('Remove selected image', removeSelectedImage); removeImageButton.id = 'remove-evidence-image';
const imageAddButton = button('Add evidence with image', () => { if (evidenceForm.reportValidity()) void addImageEvidence(); }, 'primary'); imageAddButton.id = 'add-image-evidence'; imageAddButton.hidden = true;
const textEvidenceButton = submit(evidenceForm, 'Add evidence', () => { if (imageDraft || imageNormalizing) return; void command('/evidence', { text: value(evidenceForm, 'text'), url: value(evidenceForm, 'url') || null }, evidenceForm, 'Evidence added.'); });
evidenceForm.append(imageChoice, imageStatus, imagePreview, imageDisclaimer, removeImageButton, imageAddButton);
const imageQuota = el('p', 'Image evidence 0/8 · Total evidence 0/40', 'hint'); imageQuota.id = 'evidence-image-quota';
evidencePanel.append(evidenceList, imageQuota, evidenceForm); left.append(evidencePanel);
const resultPanel = section('Agree on a result', 'A winner becomes final only when the other party agrees. Disagreement opens a dispute.'); const resultSummary = el('p'); resultSummary.id = 'result-proposal'; const resultForm = form('result-form'); const resultOutcome = select(resultForm, 'outcome', 'Proposed winner', [['proposer', 'Proposer'], ['opponent', 'Opponent']]); field(resultForm, 'reason', 'Why this result?', 500, true); submit(resultForm, 'Propose result', () => { void command('/result', { outcome: value(resultForm, 'outcome'), reason: value(resultForm, 'reason') }, resultForm, 'Result proposed.'); });
const resultResponse = form('result-response-form'); field(resultResponse, 'reason', 'Response reason (required to dispute)', 500, true, false); resultResponse.append(button('Agree with result', () => { void respondResult(true); }, 'primary'), button('Dispute result', () => { void respondResult(false); })); resultPanel.append(resultSummary, resultForm, resultResponse); right.append(resultPanel);
const voidPanel = section('Void by mutual agreement', 'An offer to void stays open until the challenge ends. It cannot be withdrawn. Both parties must agree; there is no winner.'); const voidSummary = el('p'); voidSummary.id = 'void-proposal'; const voidForm = form('void-form'); field(voidForm, 'reason', 'Reason to void', 500, true);
submit(voidForm, 'Offer to void', () => { const s = snapshot; if (s && confirm('Offer to void this challenge? This offer cannot be withdrawn or replaced and stays open until the challenge ends. The other party can accept it any time before a final result.')) void command('/void', { reason: value(voidForm, 'reason') }, voidForm, 'Offer to void recorded. It stays open until the challenge ends.', s); });
const voidConfirm = button('Agree and void', () => { const s = snapshot; if (s?.voidProposal && confirm('Agree to void this challenge? This ends the challenge with no winner and cannot be undone.')) void command('/void/confirm', { proposalId: s.voidProposal.id }, undefined, 'Challenge voided.', s); }, 'danger'); voidConfirm.id = 'void-confirm'; voidPanel.append(voidSummary, voidForm, voidConfirm); right.append(voidPanel);
const arbiterPanel = section('A mutually chosen arbiter', 'Both parties approve the same person. Once claimed, the arbiter seat cannot be replaced.'); const arbiterSummary = el('p'); arbiterSummary.id = 'arbiter-nomination'; const arbiterForm = form('arbiter-form'); field(arbiterForm, 'name', 'Arbiter name', 40); field(arbiterForm, 'reason', 'Why this arbiter?', 500, true); submit(arbiterForm, 'Nominate arbiter', () => { void command('/arbiter/nominate', { name: value(arbiterForm, 'name'), reason: value(arbiterForm, 'reason') }, arbiterForm, 'Arbiter nominated. The other party must approve.'); });
const arbiterResponse = form('arbiter-response-form'); field(arbiterResponse, 'reason', 'Response reason (required to reject)', 500, true, false); arbiterResponse.append(button('Approve arbiter', () => { void respondArbiter(true); }, 'primary'), button('Reject arbiter', () => { void respondArbiter(false); }));
const arbiterWithdraw = form('arbiter-withdraw-form'); field(arbiterWithdraw, 'reason', 'Why withdraw this nomination?', 500, true); submit(arbiterWithdraw, 'Withdraw nomination', () => { const s = snapshot; if (s?.arbiterNomination && confirm('Withdraw this nomination? Unclaimed arbiter invitations will stop working.')) void command('/arbiter/withdraw', { nominationId: s.arbiterNomination.id, reason: value(arbiterWithdraw, 'reason') }, arbiterWithdraw, 'Nomination withdrawn.', s); });
const inviteArbiter = button('Invite arbiter', () => { void issueInvite('arbiter'); }); const decisionForm = form('decision-form'); const decisionOutcome = select(decisionForm, 'outcome', 'Final outcome', [['proposer', 'Proposer'], ['opponent', 'Opponent'], ['void', 'Void — no winner']]); field(decisionForm, 'reason', 'Decision reason', 500, true); submit(decisionForm, 'Record decision', () => { const s = snapshot; const outcome = value(decisionForm, 'outcome'); if (s && confirm(`Record the final decision: ${outcomeLabel(outcome, s)}? This ends the challenge and cannot be undone.`)) void command('/arbiter/decide', { outcome, reason: value(decisionForm, 'reason') }, decisionForm, 'Final decision recorded.', s); }); arbiterPanel.append(arbiterSummary, arbiterForm, arbiterResponse, arbiterWithdraw, inviteArbiter, decisionForm); right.append(arbiterPanel);
const exitPanel = section('Before acceptance'); const declineForm = form('decline-form'); field(declineForm, 'reason', 'Reason to decline', 500, true); submit(declineForm, 'Decline challenge', () => { const s = snapshot; if (s && confirm('Decline this proposal? This closes the challenge permanently.')) void command('/decline', { reason: value(declineForm, 'reason') }, declineForm, 'Challenge declined.', s); }); const withdrawForm = form('withdraw-form'); field(withdrawForm, 'reason', 'Reason to withdraw', 500, true); submit(withdrawForm, 'Withdraw challenge', () => { const s = snapshot; if (s && confirm('Withdraw this proposal? This closes the challenge permanently.')) void command('/withdraw', { reason: value(withdrawForm, 'reason') }, withdrawForm, 'Challenge withdrawn.', s); }); exitPanel.append(declineForm, withdrawForm); right.append(exitPanel);
const quotaPanel = section('Notebook limits'); const quotaText = el('p', '', 'hint'); quotaPanel.append(quotaText); right.append(quotaPanel);
const activityPanel = section('Activity', 'The permanent record of agreements and actions.'); const activityList = el('ol', '', 'activity-list'); activityList.id = 'activity-list'; activityPanel.append(activityList); left.append(activityPanel);
main.append(el('footer', 'Private links are credentials. Share invitations only with the intended person, and keep your own access link private.'));

type Transport = { mode: 'https-lan' | 'http-loopback'; origin: string; setupRequired: boolean };
let transport: Transport | null = null, transportEpoch = 0, transportLoading = false;
let transportController: AbortController | null = null;
let pendingCreation: { controller: AbortController; generation: number; intent: number } | null = null;
function creationControls(): void {
  createButton.disabled = busy || pageSuspended || !transport;
  retryTransport.disabled = transportLoading;
  setupField.hidden = dashboard.hidden || transport?.setupRequired !== true;
  setupKeyInput.required = !setupField.hidden;
}
async function loadTransportStatus(): Promise<void> {
  const epoch = ++transportEpoch; transportController?.abort();
  const controller = new AbortController(); transportController = controller;
  transport = null; transportLoading = true; creationControls();
  transportStatus.textContent = 'Checking this service’s connection mode…'; retryTransport.hidden = true;
  try {
    const result = await request<{ transport?: unknown }>('GET', '/api/status', undefined, undefined, controller.signal);
    if (epoch !== transportEpoch || controller.signal.aborted || pageSuspended) return;
    const value = result.transport;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const candidate = value as Record<string, unknown>;
    if (Object.keys(candidate).sort().join(',') !== 'mode,origin,setupRequired' || typeof candidate.origin !== 'string' || candidate.origin.length > 267) throw new Error();
    const origin = new URL(candidate.origin);
    if (candidate.mode === 'https-lan'
      ? candidate.setupRequired !== true || origin.protocol !== 'https:' || origin.origin !== candidate.origin || candidate.origin !== location.origin
      : candidate.mode !== 'http-loopback' || candidate.setupRequired !== false || !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(candidate.origin)
        || !origin.port && !candidate.origin.endsWith(':80') || Number(origin.port || 80) > 65535) throw new Error();
    transport = { mode: candidate.mode as Transport['mode'], origin: candidate.origin, setupRequired: candidate.setupRequired as boolean };
    if (!selected) connection.textContent = 'Connected · your private notebook';
    transportStatus.textContent = transport.mode === 'https-lan'
      ? `HTTPS challenge service: ${transport.origin}. Other devices must reach this address and trust its certificate. Creation requires the operator setup key; invitations and saved seats use their own private links.`
      : `HTTP loopback service: ${transport.origin}. This address is for this computer. No operator setup key is needed to propose a challenge.`;
  } catch {
    if (epoch !== transportEpoch || controller.signal.aborted || pageSuspended) return;
    transportStatus.textContent = 'Could not check this service’s connection mode. Check that the service is running and the browser trusts its certificate, then check again. Challenge creation is paused; invitations and saved access links remain available.';
    retryTransport.hidden = false;
    if (!selected) connection.textContent = 'Service unavailable · reconnect when the notebook is running';
  } finally { if (epoch === transportEpoch && transportController === controller) { transportController = null; transportLoading = false; creationControls(); } }
}
function retireCreation(): void { pendingCreation?.controller.abort(); pendingCreation = null; setupKeyInput.value = ''; }
let sessions: Record<string, string> = {};
let selected: { id: string; token: string } | null = null;
let snapshot: Snapshot | null = null;
let reviewed: { version: number; revision: number; terms: Terms } | null = null;
let pendingLink: PrivateLink | null = null;
let deferredLink: PrivateLink | null = null;
let generation = 0; let readController: AbortController | null = null; let mutationController: AbortController | null = null; let pollTimer: ReturnType<typeof setTimeout> | undefined; let busy = false;
const unsavedSeats = new Set<string>();
type ImageDraft = { blob: Blob; width: number; height: number; url: string | null };
type RetainedImageView = { card: HTMLElement; image: HTMLImageElement; status: HTMLParagraphElement; view: HTMLButtonElement; close: HTMLButtonElement; controller: AbortController | null; url: string | null; epoch: number };
let imageDraft: ImageDraft | null = null; let imageEpoch = 0; let evidenceInputIntent = 0; let imageNormalizing = false;
let imageNormalizeController: AbortController | null = null; let imageReviewRequired = false; let imageUploading = false; let pageSuspended = false;
let imageExportEpoch = 0; let imageExportController: AbortController | null = null;
const retainedImageViews = new Map<string, RetainedImageView>(); const imageDownloadUrls = new Set<string>();
const records = new Map<string, Snapshot>(); const evidenceNodes = new Map<string, HTMLElement>(); const eventNodes = new Map<number, HTMLLIElement>();
function hasDrafts(exclude?: HTMLFormElement): boolean { return !!imageDraft || imageNormalizing || [...main.querySelectorAll<HTMLFormElement>('form')].some((f) => f !== exclude && !f.closest('[hidden]') && f.dataset.dirty === 'true'); }
function leaveDrafts(exclude?: HTMLFormElement): boolean { if (busy) { announce('Wait for your current action to finish before changing seats or challenges.', true); return false; } return !hasDrafts(exclude) || confirm('Leave your unsent draft? It will not be saved in the shared record.'); }
window.addEventListener('beforeunload', (e) => { if (hasDrafts() || busy || unsavedSeats.size > 0) { e.preventDefault(); e.returnValue = ''; } });
function clearEditors(): void { clearImageDraft(); closeRetainedImages(); imageReviewRequired = false; for (const f of workspace.querySelectorAll<HTMLFormElement>('form')) reset(f); evidenceNodes.clear(); eventNodes.clear(); evidenceList.replaceChildren(); activityList.replaceChildren(); reviewed = null; }
function updateAccessRecovery(): void {
  accessRecovery.hidden = unsavedSeats.size === 0;
  accessRecoveryText.textContent = `${unsavedSeats.size} ${unsavedSeats.size === 1 ? 'seat has' : 'seats have'} access held only in this page. Keep My private access link before closing or refreshing. You can retry saving access; if the browser has twenty saved seats, forget an obsolete saved seat first. Forgetting does not delete a shared challenge.`;
  retryAccess.hidden = !selected || !unsavedSeats.has(selected.id); retryAccess.disabled = busy;
}
function retrySavingAccess(): void {
  if (!selected || busy || !unsavedSeats.has(selected.id)) return;
  try { saveSession(selected.id, selected.token); unsavedSeats.delete(selected.id); updateAccessRecovery(); announce('This seat’s access is now saved in this browser. Keep a private access link for recovery elsewhere.'); }
  catch { updateAccessRecovery(); announce('Browser access still could not be saved. Your seat remains usable in this page. Keep My private access link before closing.', true); }
}
function remember(id: string, token: string): void {
  sessions[id] = token; try { saveSession(id, token); unsavedSeats.delete(id); } catch { unsavedSeats.add(id); announce('Your seat works in this page, but browser access could not be saved. Keep My private access link before closing or refreshing.', true); } updateAccessRecovery();
}
function stopSelection(): void { retireCreation(); generation += 1; retireImageWork(); readController?.abort(); mutationController?.abort(); clearTimeout(pollTimer); selected = null; snapshot = null; busy = false; closeLink(); updateAccessRecovery(); }
function showDashboard(): void { stopSelection(); workspace.hidden = true; dashboard.hidden = false; clearEditors(); connection.textContent = 'Your private notebook'; history.replaceState(null, '', '/'); renderRecords(); creationControls(); void refreshRecords(); }
function flushIncoming(): void { if (!busy && deferredLink) { const link = deferredLink; deferredLink = null; incoming(link); } }
function captureIncoming(): void {
  if (!location.hash) return;
  const source = { search: location.search, hash: location.hash };
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  let link: PrivateLink | null = null; try { link = readLink(source); } catch { /* Invalid fragments are removed too. */ }
  if (!link) { announce('This private link is invalid. Its fragment has been removed. Ask for a fresh link.', true); return; }
  if (busy) { deferredLink = link; announce('Private link received. Finish the current action before choosing a seat.'); } else incoming(link);
}
window.addEventListener('hashchange', captureIncoming);
window.addEventListener('popstate', captureIncoming);
function current(epoch: number, credential: { id: string; token: string }): boolean { return !pageSuspended && epoch === generation && selected?.id === credential.id && selected?.token === credential.token; }
async function selectChallenge(id: string, token: string, initial?: Snapshot): Promise<void> {
  stopSelection(); clearEditors(); selected = { id, token }; updateAccessRecovery(); dashboard.hidden = true; creationControls(); workspace.hidden = false; title.textContent = 'Loading challenge…'; status.textContent = 'Loading'; people.textContent = ''; deadlineText.textContent = ''; revision.textContent = ''; columns.hidden = true; finalPanel.hidden = true; history.replaceState(null, '', `/?challenge=${id}`); if (initial) apply(initial); await refreshSelected();
}
function apply(next: Snapshot): void {
  if (!selected || next.id !== selected.id || snapshot && next.revision < snapshot.revision) return;
  snapshot = next; columns.hidden = false; records.set(next.id, next);
  if (!reviewed && next.myRole === 'opponent' && next.status === 'proposed') reviewed = { version: next.termsVersion, revision: next.revision, terms: { ...next.terms } };
  if (termsForm.dataset.dirty !== 'true') fillTerms(termsForm, next.terms);
  if (revealed?.id === next.id && ((revealed.kind === 'invite' && (next.profiles.opponent || next.status !== 'proposed')) || (revealed.kind === 'arbiter' && (next.profiles.arbiter || next.status !== 'disputed' || next.arbiterNomination?.status !== 'approved' || next.arbiterNomination.id !== revealed.nominationId)))) closeLink(); render();
}
function schedule(): void { clearTimeout(pollTimer); if (selected) pollTimer = setTimeout(() => { void refreshSelected(); }, 1100); }
async function refreshSelected(manual = false): Promise<void> {
  if (!selected || busy) { schedule(); return; } const credential = { ...selected }; const epoch = generation; clearTimeout(pollTimer); readController?.abort(); const controller = new AbortController(); readController = controller;
  try { const next = await request<Snapshot>('GET', `/api/challenges/${credential.id}`, undefined, credential.token, controller.signal); if (!current(epoch, credential)) return; apply(next); connection.textContent = `Connected · updated ${new Date().toLocaleTimeString()}`; if (manual && imageReviewRequired) { imageReviewRequired = false; imageControls(); announce('Record refreshed. Review the evidence feed before explicitly trying another append. No image upload was replayed.'); } }
  catch (error) { if (!current(epoch, credential) || controller.signal.aborted) return; connection.textContent = 'Connection interrupted · drafts kept · reconnecting'; if (error instanceof ApiError && (error.status === 401 || error.status === 404)) announce('This seat could not open the challenge. Check your private link or connect to the correct notebook.', true); }
  finally { if (current(epoch, credential) && readController === controller) schedule(); }
}
function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'conflict') return 'The record changed before your action arrived. Your draft is kept. Review the updated record and choose your action again.';
    if (error.code === 'limit') return 'This notebook or action has reached its limit. Existing records are kept. You can still agree to a result or void an accepted challenge.';
    if (error.code === 'invalid_request') return 'Check required text, the deadline, and any supplied public HTTPS source link.';
    if (error.code === 'forbidden') return 'Your seat cannot perform this action in the current state. Review the updated record.';
    if (error.code === 'not_found') return 'This invitation or record is unavailable. Ask for a new invitation if yours was used or replaced.';
    if (error.code === 'unauthorized') return 'The private access link is not valid for this record.';
  } return 'Could not confirm whether the action arrived. Your draft is kept. Refresh the record before trying again.';
}
async function command(suffix: string, fields: Record<string, unknown>, f?: HTMLFormElement, success = 'Record updated.', captured?: Snapshot): Promise<void> {
  const s = captured ?? snapshot; if (!s || !selected || busy) return; const sentDraft = f ? draft(f) : null; const sentEvidenceIntent = evidenceInputIntent; const credential = { ...selected }; const epoch = generation; busy = true; render(); clearTimeout(pollTimer); readController?.abort(); const controller = new AbortController(); mutationController = controller;
  try { const next = await request<Snapshot>('POST', `/api/challenges/${credential.id}${suffix}`, { revision: s.revision, ...fields }, credential.token, controller.signal); if (!current(epoch, credential)) return; if (f && draft(f) === sentDraft && (f !== evidenceForm || evidenceInputIntent === sentEvidenceIntent)) reset(f); apply(next); announce(success); }
  catch (error) { if (current(epoch, credential) && !controller.signal.aborted) announce(errorText(error), true); }
  finally { if (current(epoch, credential)) { busy = false; render(); flushIncoming(); await refreshSelected(); } }
}
function creationPayload(): { name: string; terms: Terms } {
  const payload = { name: value(createForm, 'name'), terms: readTerms(createForm) };
  const valid = (text: string, maximum: number): boolean => {
    if (!text.trim() || [...text].length > maximum) return false;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if ((code < 32 && ![9, 10, 13].includes(code)) || code === 127) return false;
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      } else if (code >= 0xdc00 && code <= 0xdfff) return false;
    }
    return true;
  };
  const now = Date.now(), t = payload.terms;
  if (!valid(payload.name, 40) || !valid(t.title, 100) || !valid(t.description, 500)
    || !valid(t.successCriteria, 500) || !valid(t.evidenceRule, 300) || !STAKES.includes(t.stake)
    || !Number.isSafeInteger(t.deadline) || t.deadline <= now || t.deadline > now + 365 * 86400000
    || new TextEncoder().encode(JSON.stringify(payload)).byteLength > 16 * 1024) throw new Error();
  return payload;
}
async function createChallenge(): Promise<void> {
  if (busy || pageSuspended || !transport) return;
  let payload: { name: string; terms: Terms };
  try { payload = creationPayload(); } catch { announce('Check the required text and choose a future deadline no more than 365 days away. No challenge was sent; your draft and operator key are kept.', true); return; }
  const setupKey = transport.setupRequired ? setupKeyInput.value : undefined;
  if (setupKey !== undefined && !/^[0-9a-f]{64}$/.test(setupKey)) { announce('Enter the operator’s 64-character lowercase hexadecimal setup key. It is only for creating a challenge.', true); return; }
  const owner = { controller: new AbortController(), generation, intent: editorInputIntent };
  pendingCreation = owner; busy = true; creationControls();
  // Complete local payload admission precedes this one actual dispatch. The key
  // never enters FormData, remembered seats, URLs or a retained draft.
  setupKeyInput.value = '';
  try {
    const next = await request<Creation>('POST', '/api/challenges', payload, undefined, owner.controller.signal, setupKey);
    remember(next.challengeId, next.token); records.set(next.challengeId, next.challenge);
    if (pendingCreation !== owner || owner.generation !== generation || pageSuspended || owner.controller.signal.aborted) return;
    if (owner.intent !== editorInputIntent) {
      renderRecords(); reveal(next.challengeId, 'access', next.token);
      announce('Challenge created; its private access link is shown and remembered. Your newer draft is kept. Keep this link, then open it explicitly after handling your draft. No creation was replayed.'); return;
    }
    reset(createForm); pendingCreation = null; busy = false; creationControls();
    void selectChallenge(next.challengeId, next.token, next.challenge); reveal(next.challengeId, 'invite', next.inviteToken);
    flushIncoming();
  } catch (error) {
    if (pendingCreation === owner && owner.generation === generation && !pageSuspended && !owner.controller.signal.aborted) {
      const uncertain = !(error instanceof ApiError) || error.status === 0 || error.code === 'internal_error';
      announce(`${uncertain ? 'Could not confirm whether the challenge was created. It may have been saved; no request will be replayed. Keep your draft and check your private access before another deliberate attempt.' : errorText(error)}${setupKey !== undefined ? ' Re-enter the operator setup key for another deliberate attempt.' : ''}`, true);
    }
  } finally {
    if (pendingCreation === owner) { pendingCreation = null; busy = false; creationControls(); flushIncoming(); }
  }
}
async function acceptTerms(): Promise<void> {
  const s = snapshot; const r = reviewed; if (!s || !r || r.version !== s.termsVersion) return;
  if (!confirm(`Accept these terms (version ${r.version})? The agreement becomes fixed and the challenge begins.`)) return;
  await command('/accept', { termsVersion: r.version }, undefined, 'Challenge accepted. The agreement is now fixed.', { ...s, revision: r.revision });
}
async function issueInvite(seat: 'opponent' | 'arbiter'): Promise<void> {
  const s = snapshot; if (!s || !selected || busy) return; const credential = { ...selected }; const epoch = generation; busy = true; render(); readController?.abort(); clearTimeout(pollTimer); const controller = new AbortController(); mutationController = controller;
  try { const next = await request<Invitation>('POST', `/api/challenges/${credential.id}/invite`, { revision: s.revision, seat }, credential.token, controller.signal); if (!current(epoch, credential)) return; apply(next.challenge); reveal(credential.id, seat === 'opponent' ? 'invite' : 'arbiter', next.inviteToken, next.challenge.arbiterNomination?.id); announce('New invitation created. Previous invitations for this seat no longer work.'); }
  catch (error) { if (current(epoch, credential) && !controller.signal.aborted) announce(errorText(error), true); }
  finally { if (current(epoch, credential)) { busy = false; render(); flushIncoming(); await refreshSelected(); } }
}
function outcomeLabel(outcome: string, s: Snapshot): string { return outcome === 'void' ? 'Void — no winner' : `${s.profiles[outcome as 'proposer' | 'opponent']?.name ?? outcome} (${outcome})`; }
async function respondResult(accept: boolean): Promise<void> {
  const s = snapshot; const p = s?.resultProposal; if (!s || !p) return; const reason = value(resultResponse, 'reason'); if (!accept && !reason) { announce('Give a reason to dispute the result.', true); return; }
  if (accept && !confirm(`Agree that ${outcomeLabel(p.outcome, s)} wins? This final result cannot be undone.`)) return; await command('/result/respond', { proposalId: p.id, accept, reason }, resultResponse, accept ? 'Final result agreed.' : 'Result disputed. Add evidence, propose another result, or choose an arbiter together.', s);
}
async function respondArbiter(accept: boolean): Promise<void> {
  const s = snapshot; const n = s?.arbiterNomination; if (!s || !n) return; const reason = value(arbiterResponse, 'reason'); if (!accept && !reason) { announce('Give a reason to reject the nomination.', true); return; }
  if (accept && !confirm(`Approve ${n.name} as arbiter? After claiming their seat they cannot be replaced and can make a final decision.`)) return; await command('/arbiter/respond', { nominationId: n.id, accept, reason }, arbiterResponse, accept ? 'Arbiter approved. Send them an invitation.' : 'Nomination rejected.', s);
}
function incoming(link: PrivateLink): void {
  pendingLink = link; intent.hidden = false; const existing = sessions[link.challengeId];
  intentText.textContent = link.kind === 'access' ? `This opens a private seat${existing && existing !== link.token ? ' different from the seat remembered in this browser' : ''}. Use it explicitly to continue. Anyone holding this link can act as its owner.` : `Claim the ${link.kind === 'arbiter' ? 'arbiter' : 'opponent'} seat with your name.${link.kind === 'arbiter' ? ' Enter the exact name both parties nominated; ask the inviter if needed.' : ''}${existing ? ' This browser already remembers a seat for this challenge. Use a separate browser profile to keep both seats, or explicitly replace the remembered seat.' : ''} Claiming an opponent seat does not accept the terms.`;
  useAccess.hidden = link.kind !== 'access'; claimForm.hidden = link.kind === 'access'; keepSeat.hidden = !existing; claimButton.textContent = link.kind === 'arbiter' ? 'Claim arbiter seat' : 'Claim opponent seat';
}
async function useIncomingAccess(): Promise<void> {
  const link = pendingLink; if (!link || link.kind !== 'access' || busy || !leaveDrafts()) return;
  if (sessions[link.challengeId] && sessions[link.challengeId] !== link.token && !confirm('Replace the seat remembered for this challenge with this private access link? Keep your current private access link first, or use a separate browser profile.')) return;
  const epoch = generation, consentIntent = editorInputIntent, consentImage = imageEpoch;
  const controller = new AbortController(); mutationController = controller; busy = true; useAccess.disabled = true; readController?.abort(); clearTimeout(pollTimer);
  try {
    const next = await request<Snapshot>('GET', `/api/challenges/${link.challengeId}`, undefined, link.token, controller.signal);
    if (epoch !== generation || pendingLink !== link || mutationController !== controller || controller.signal.aborted) return;
    if (editorInputIntent !== consentIntent || imageEpoch !== consentImage) {
      announce('Your draft changed while opening this seat. The current seat and exact draft are kept. Handle the draft, then explicitly choose Use this private access link again.', true); return;
    }
    remember(link.challengeId, link.token); pendingLink = null; intent.hidden = true; busy = false; useAccess.disabled = false; mutationController = null;
    void selectChallenge(link.challengeId, link.token, next);
  } catch (error) { if (epoch === generation && mutationController === controller && !controller.signal.aborted) announce(errorText(error), true); }
  finally { if (epoch === generation && mutationController === controller) { mutationController = null; busy = false; useAccess.disabled = false; render(); flushIncoming(); schedule(); } }
}
async function claimSeat(): Promise<void> {
  const link = pendingLink; if (!link || link.kind === 'access' || busy || !leaveDrafts(claimForm)) return;
  if (sessions[link.challengeId] && !confirm('Claim a different seat and replace the seat remembered for this challenge? Keep your current private access link first, or use a separate browser profile.')) return;
  const epoch = generation, consentIntent = editorInputIntent, consentImage = imageEpoch;
  const controller = new AbortController(); mutationController = controller; busy = true; claimButton.disabled = true; readController?.abort(); clearTimeout(pollTimer);
  try {
    const next = await request<Claim>('POST', `/api/challenges/${link.challengeId}/${link.kind === 'arbiter' ? 'arbiter/join' : 'join'}`, { inviteToken: link.token, name: value(claimForm, 'name') }, undefined, controller.signal);
    // A successful claim is irreversible: retain its returned access even if new
    // editor intent means it is no longer safe to activate that seat automatically.
    remember(next.challengeId, next.token);
    if (epoch !== generation || pendingLink !== link || mutationController !== controller || controller.signal.aborted) return;
    if (editorInputIntent !== consentIntent || imageEpoch !== consentImage) {
      records.set(next.challengeId, next.challenge); pendingLink = null; intent.hidden = true; reveal(next.challengeId, 'access', next.token);
      announce('Seat claimed; its new private access link is shown and kept in this browser or memory. Your current seat and newer draft are unchanged. Keep this new link, then open it explicitly after handling the draft. No claim was replayed.'); return;
    }
    reset(claimForm); pendingLink = null; intent.hidden = true; busy = false; claimButton.disabled = false; mutationController = null;
    void selectChallenge(next.challengeId, next.token, next.challenge);
    if (!message.classList.contains('error')) announce(link.kind === 'arbiter' ? 'Arbiter seat claimed. Review the whole record before deciding.' : 'Opponent seat claimed. Review the terms before accepting.');
  } catch (error) { if (epoch === generation && mutationController === controller && !controller.signal.aborted) announce(errorText(error), true); }
  finally { if (epoch === generation && mutationController === controller) { mutationController = null; busy = false; claimButton.disabled = false; render(); flushIncoming(); schedule(); } }
}
async function exportRecord(): Promise<void> {
  if (!selected) return; const credential = { ...selected }; const epoch = generation;
  try { const record = await request<ChallengeExport>('GET', `/api/challenges/${credential.id}/export`, undefined, credential.token); if (!current(epoch, credential)) return; const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' })); const a = el('a'); a.href = url; a.download = `friendly-challenge-${credential.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); announce('Record exported. Private access links and invitations are not included.'); }
  catch { if (current(epoch, credential)) announce('Could not export the record. Reconnect and try again.', true); }
}
function renderRecords(): void {
  recordList.replaceChildren(); if (!Object.keys(sessions).length) recordList.append(el('p', 'No challenges yet. Propose one to start.', 'empty'));
  for (const id of Object.keys(sessions)) { const s = records.get(id); const card = el('article', '', 'record-card'); card.dataset.challengeId = id; card.append(el('h3', s?.terms.title ?? 'Private challenge'), el('p', s ? `${s.status} · your seat: ${s.myRole}` : 'A private seat remembered in this browser', 'hint'), button('Open challenge', () => { if (leaveDrafts()) { pendingLink = null; intent.hidden = true; void selectChallenge(id, sessions[id]!); } }), button('Forget saved seat', () => { forgetSeat(id); })); recordList.append(card); }
}
function forgetSeat(id: string): void {
  if (busy || !confirm('Forget this saved seat in this browser? Keep or copy your private access link first if you want to return. This does not delete the challenge or any other saved seat.')) return;
  try { removeSession(id); delete sessions[id]; unsavedSeats.delete(id); records.delete(id); updateAccessRecovery(); renderRecords(); announce('Saved seat forgotten in this browser. The shared challenge record remains unchanged.'); }
  catch { announce('This browser could not remove the saved seat. Access and the shared challenge record were kept.', true); }
}
async function refreshRecords(): Promise<void> { const epoch = generation; for (const [id, token] of Object.entries(sessions)) { if (selected || epoch !== generation) return; try { const next = await request<Snapshot>('GET', `/api/challenges/${id}`, undefined, token); if (epoch !== generation) return; records.set(id, next); renderRecords(); } catch { /* Preserve seats through network failure. */ } } }
function roleName(s: Snapshot, role: string): string { return s.profiles[role as keyof Snapshot['profiles']]?.name ?? role; }
function displayTerms(t: Terms, version: number): void {
  termsDisplay.replaceChildren(el('p', `Terms version ${version}`, 'eyebrow'), el('h3', t.title));
  for (const [caption, text] of [['Challenge', t.description], ['Success criteria', t.successCriteria], ['Evidence rule', t.evidenceRule], ['Friendly stake', stakes[t.stake] ?? t.stake], ['Deadline', `${when(t.deadline)} · ${new Date(t.deadline).toISOString()}`]]) { const item = el('div', '', 'term-item'); item.append(el('h3', caption), el('p', text)); termsDisplay.append(item); }
}
function eventText(e: ChallengeEvent, s: Snapshot): string {
  const actor = roleName(s, e.actor);
  switch (e.kind) {
    case 'created': return `${actor} proposed “${e.details.terms.title}”. Terms version ${e.details.termsVersion}. ${e.details.terms.description} · Success: ${e.details.terms.successCriteria} · Evidence: ${e.details.terms.evidenceRule} · Stake: ${stakes[e.details.terms.stake]} · Deadline: ${when(e.details.terms.deadline)}`;
    case 'terms_edited': return `${actor} updated terms to version ${e.details.termsVersion}. ${e.details.terms.title} · ${e.details.terms.description} · Success: ${e.details.terms.successCriteria} · Evidence: ${e.details.terms.evidenceRule} · Stake: ${stakes[e.details.terms.stake]} · Deadline: ${when(e.details.terms.deadline)}`;
    case 'invite_issued': return `${actor} issued a new ${e.details.seat} invitation. Previous invitations for that seat are invalid.`;
    case 'opponent_joined': return `${e.details.name} claimed the opponent seat. Acceptance is separate.`;
    case 'accepted': return `${actor} accepted terms version ${e.details.termsVersion}.`;
    case 'declined': return `${actor} declined: ${e.details.reason}`;
    case 'withdrawn': return `${actor} withdrew: ${e.details.reason}`;
    case 'evidence_image_added': return `${actor} added ${e.details.evidence.late ? 'late ' : ''}image evidence: ${e.details.evidence.text} · normalized JPEG, supplied and unverified (${e.details.evidence.image.width} × ${e.details.evidence.image.height}, ${e.details.evidence.image.bytes} bytes).`;
    case 'evidence_added': return `${actor} added ${e.details.evidence.late ? 'late ' : ''}evidence: ${e.details.evidence.text}`;
    case 'result_proposed': return `${actor} proposed ${outcomeLabel(e.details.proposal.outcome, s)} as winner: ${e.details.proposal.reason}`;
    case 'result_responded': return `${actor} ${e.details.accept ? 'agreed with' : 'disputed'} the result. ${e.details.reason}`;
    case 'void_offered': return `${actor} offered to void: ${e.details.proposal.reason}. This offer cannot be withdrawn.`;
    case 'void_confirmed': return `${actor} agreed to void. No winner.`;
    case 'arbiter_nominated': return `${actor} nominated ${e.details.nomination.name}: ${e.details.nomination.reason}`;
    case 'arbiter_responded': return `${actor} ${e.details.accept ? 'approved' : 'rejected'} the arbiter. ${e.details.reason}`;
    case 'arbiter_withdrawn': return `${actor} withdrew the arbiter nomination: ${e.details.reason}`;
    case 'arbiter_joined': return `${e.details.name} claimed the mutually approved arbiter seat.`;
    case 'arbiter_decided': return `${actor} recorded the final decision: ${outcomeLabel(e.details.outcome, s)}. ${e.details.reason}`;
  }
}
function render(): void {
  const s = snapshot; if (!s) return; updateAccessRecovery(); const party = s.myRole !== 'arbiter'; const proposed = s.status === 'proposed'; const running = s.status === 'active' || s.status === 'disputed'; const disputed = s.status === 'disputed'; const terminal = !proposed && !running; const n = s.arbiterNomination; const p = s.resultProposal;
  title.textContent = s.terms.title; status.textContent = s.status; status.dataset.status = s.status; revision.textContent = `Revision ${s.revision} · ${s.myRole} seat`;
  people.textContent = `${s.profiles.proposer.name} (proposer) · ${s.profiles.opponent ? `${s.profiles.opponent.name} (opponent)` : 'Opponent has not joined'}${s.profiles.arbiter ? ` · ${s.profiles.arbiter.name} (arbiter)` : ''}`;
  deadlineText.textContent = `${s.deadlinePassed ? 'Deadline passed' : 'Deadline'}: ${when(s.terms.deadline)}. ${s.deadlinePassed ? 'Time alone does not decide a winner. New evidence is marked late; settlement remains available.' : 'Passing the deadline does not automatically decide a winner.'}`;
  const pin = s.myRole === 'opponent' && proposed ? reviewed : null; displayTerms(pin?.terms ?? s.terms, pin?.version ?? s.termsVersion); const changed = !!pin && pin.version !== s.termsVersion;
  reviewWarning.hidden = !changed; reviewWarning.textContent = 'The proposer changed the terms. You are still viewing the agreement you reviewed. Review updated terms before accepting.'; reviewButton.hidden = !changed;
  acceptButton.hidden = !(proposed && s.myRole === 'opponent'); acceptButton.disabled = busy || changed || s.deadlinePassed; inviteOpponent.hidden = !(proposed && s.myRole === 'proposer' && !s.profiles.opponent); inviteOpponent.disabled = busy || s.limitsUsed.opponentInvites >= 10; editPanel.hidden = !(proposed && s.myRole === 'proposer');
  evidencePanel.hidden = proposed && s.evidence.length === 0; evidenceForm.hidden = !running || !party; resultPanel.hidden = !running; resultForm.hidden = !party || p?.status === 'pending'; resultResponse.hidden = !party || !p || p.status !== 'pending' || p.proposedBy === s.myRole;
  resultSummary.textContent = p ? `${roleName(s, p.proposedBy)} proposed ${outcomeLabel(p.outcome, s)} as winner. ${p.reason} · ${p.status}` : 'No result is proposed yet.';
  voidPanel.hidden = !running; voidForm.hidden = !party || !!s.voidProposal; voidConfirm.hidden = !party || !s.voidProposal || s.voidProposal.proposedBy === s.myRole; voidSummary.textContent = s.voidProposal ? `${roleName(s, s.voidProposal.proposedBy)} offered to void: ${s.voidProposal.reason}. This offer stays open until the challenge ends and cannot be withdrawn.` : 'No offer to void has been made.';
  arbiterPanel.hidden = !disputed && !s.profiles.arbiter; arbiterSummary.textContent = s.profiles.arbiter ? `${s.profiles.arbiter.name} claimed the arbiter seat. This seat cannot be replaced.` : n ? `${n.name} · ${n.status}. Nominated by ${roleName(s, n.proposedBy)}: ${n.reason}` : 'No arbiter nominated.';
  arbiterForm.hidden = !disputed || !party || !!s.profiles.arbiter || !!n && (n.status === 'pending' || n.status === 'approved'); arbiterResponse.hidden = !disputed || !party || !!s.profiles.arbiter || n?.status !== 'pending' || n.proposedBy === s.myRole; arbiterWithdraw.hidden = !disputed || !party || !!s.profiles.arbiter || !n || n.status !== 'pending' && n.status !== 'approved'; inviteArbiter.hidden = !disputed || !party || !!s.profiles.arbiter || n?.status !== 'approved'; inviteArbiter.disabled = busy || s.limitsUsed.arbiterInvites >= 10; decisionForm.hidden = !disputed || s.myRole !== 'arbiter';
  exitPanel.hidden = !proposed; declineForm.hidden = s.myRole !== 'opponent'; withdrawForm.hidden = s.myRole !== 'proposer'; finalPanel.hidden = !terminal;
  if (s.resolution) finalText.textContent = `${outcomeLabel(s.resolution.outcome, s)} · ${s.resolution.method === 'arbiter' ? 'Arbiter decision' : 'Mutually agreed'}. ${s.resolution.reason} · ${when(s.resolution.decidedAt)}. This record is final.`;
  else if (terminal) { const e = [...s.events].reverse().find((event) => event.kind === 'declined' || event.kind === 'withdrawn'); finalText.textContent = `Challenge ${s.status}. No winner.${e && (e.kind === 'declined' || e.kind === 'withdrawn') ? ` ${e.details.reason}` : ''} This record is final.`; }
  quotaText.textContent = `Terms edits ${s.limitsUsed.termsEdits}/10 · Evidence ${s.evidence.length}/40 · Result proposals ${s.limitsUsed.resultProposals}/10 · Arbiter nominations ${s.limitsUsed.arbiterNominations}/5 · Opponent invitations ${s.limitsUsed.opponentInvites}/10 · Arbiter invitations ${s.limitsUsed.arbiterInvites}/10. A single irrevocable offer to void remains available until used.`;
  for (const f of workspace.querySelectorAll<HTMLFormElement>('form')) for (const b of f.querySelectorAll<HTMLButtonElement>('button')) b.disabled = busy;
  const disable = (f: HTMLFormElement, blocked: boolean): void => { for (const b of f.querySelectorAll<HTMLButtonElement>('button')) b.disabled = busy || blocked; };
  disable(termsForm, s.limitsUsed.termsEdits >= 10); disable(evidenceForm, s.evidence.length >= 40); disable(resultForm, s.limitsUsed.resultProposals >= 10); disable(arbiterForm, s.limitsUsed.arbiterNominations >= 5); voidConfirm.disabled = busy; exportButton.disabled = busy; exportImagesButton.disabled = busy;
  for (const node of [resultOutcome, decisionOutcome]) for (const option of node.options) if (option.value !== 'void') option.textContent = outcomeLabel(option.value, s);
  if (!s.evidence.length && !evidenceList.children.length) evidenceList.append(el('p', 'No evidence yet.', 'empty')); if (s.evidence.length && evidenceNodes.size === 0) evidenceList.replaceChildren();
  for (const evidence of s.evidence) { if (evidenceNodes.has(evidence.id)) continue; const node = el('article', '', 'evidence-card'); node.dataset.evidenceId = evidence.id; node.append(el('p', `${roleName(s, evidence.author)} · ${when(evidence.createdAt)}${evidence.late ? ' · Late evidence' : ''}`, 'hint'), el('p', evidence.text)); if (evidence.url) { const link = el('a', 'Supplied link; not fetched or verified.'); link.href = evidence.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; node.append(link); } if ('image' in evidence) addRetainedImageControls(node, evidence.id, evidence.image); evidenceNodes.set(evidence.id, node); evidenceList.append(node); }
  imageControls();
  for (const event of s.events) { if (eventNodes.has(event.seq)) continue; const node = el('li'); node.dataset.eventSeq = String(event.seq); node.append(el('p', eventText(event, s)), el('time', when(event.at), 'hint')); eventNodes.set(event.seq, node); activityList.append(node); }
}
function imageCount(): number { return snapshot?.evidence.filter((item) => 'image' in item).length ?? 0; }
function mayAppendImage(): boolean { return !!snapshot && snapshot.myRole !== 'arbiter' && ['active', 'disputed'].includes(snapshot.status) && snapshot.evidence.length < 40 && imageCount() < 8; }
function imageControls(): void {
  const canAppend = mayAppendImage();
  imageQuota.textContent = `Image evidence ${imageCount()}/8 · Total evidence ${snapshot?.evidence.length ?? 0}/40`;
  imageFile.disabled = !canAppend; removeImageButton.disabled = !imageDraft && !imageNormalizing;
  textEvidenceButton.hidden = !!imageDraft || imageNormalizing;
  imageAddButton.hidden = !imageDraft || imageNormalizing;
  imageAddButton.disabled = busy || !canAppend || imageReviewRequired;
  if (imageDraft && !pageSuspended) {
    imageDraft.url ??= URL.createObjectURL(imageDraft.blob);
    if (imagePreview.getAttribute('src') !== imageDraft.url) imagePreview.src = imageDraft.url;
    imagePreview.hidden = false;
  } else { imagePreview.hidden = true; imagePreview.removeAttribute('src'); }
}
function clearImageDraft(): void {
  imageEpoch++; imageNormalizeController?.abort(); imageNormalizeController = null; imageNormalizing = false;
  if (imageDraft?.url) URL.revokeObjectURL(imageDraft.url);
  imageDraft = null; imagePreview.removeAttribute('src'); imagePreview.hidden = true; imageFile.value = '';
  imageStatus.textContent = 'No image selected.';
}
function removeSelectedImage(): void {
  if (!imageDraft && !imageNormalizing) return;
  evidenceInputIntent++; evidenceForm.dataset.dirty = 'true'; clearImageDraft(); imageControls();
  imageStatus.textContent = 'Selected image removed from this draft. Caption and link are kept; nothing was posted.';
}
function abortNormalization(): void {
  if (!imageNormalizing) return;
  imageEpoch++; imageNormalizeController?.abort(); imageNormalizeController = null; imageNormalizing = false;
  imageStatus.textContent = imageDraft ? 'The evidence fields changed during image preparation. The previous reviewed image is kept; choose the replacement again.' : 'The evidence fields changed during image preparation. Choose the image again when your draft is ready.';
}
evidenceForm.addEventListener('input', () => { evidenceInputIntent++; abortNormalization(); imageControls(); });
imageFile.addEventListener('change', () => { void chooseEvidenceImage(); });
async function chooseEvidenceImage(): Promise<void> {
  const file = imageFile.files?.[0]; if (!file || !selected || !mayAppendImage()) return;
  // Keep the captured File while allowing an intentional retry of the same path.
  imageFile.value = '';
  const credential = { ...selected }, owner = generation, intent = evidenceInputIntent, token = ++imageEpoch;
  imageNormalizeController?.abort(); const controller = new AbortController(); imageNormalizeController = controller; imageNormalizing = true;
  evidenceForm.dataset.dirty = 'true'; imageStatus.textContent = 'Preparing the normalized JPEG. Nothing is uploaded until you review it and choose Add evidence with image.'; imageControls();
  const owns = (): boolean => current(owner, credential) && token === imageEpoch && imageNormalizeController === controller && !controller.signal.aborted && intent === evidenceInputIntent;
  try {
    const result = await normalizeEvidenceImage(file, controller.signal); if (!owns()) return;
    const url = URL.createObjectURL(result.blob);
    if (imageDraft?.url) URL.revokeObjectURL(imageDraft.url);
    imageDraft = { ...result, url };
    imageStatus.textContent = `Ready to review: normalized JPEG ${result.width} × ${result.height} · ${result.blob.size.toLocaleString()} bytes. These exact bytes will be posted; the original is not retained.`;
  } catch (error) {
    if (owns()) imageStatus.textContent = `${error instanceof Error ? error.message : 'The image could not be prepared.'} ${imageDraft ? 'The previous reviewed image and your caption are kept.' : 'Your caption and link are kept. Nothing was uploaded.'}`;
  } finally { if (token === imageEpoch && imageNormalizeController === controller) { imageNormalizeController = null; imageNormalizing = false; imageControls(); } }
}
async function addImageEvidence(): Promise<void> {
  const s = snapshot, sentImage = imageDraft; if (!s || !sentImage || !selected || busy || imageNormalizing || imageReviewRequired || !mayAppendImage()) return;
  const credential = { ...selected }, owner = generation, sentEpoch = imageEpoch, sentIntent = evidenceInputIntent, sentDraft = draft(evidenceForm);
  const payload = { revision: s.revision, text: value(evidenceForm, 'text'), url: value(evidenceForm, 'url') || null };
  const controller = new AbortController(); mutationController = controller; busy = true; imageUploading = true; readController?.abort(); clearTimeout(pollTimer); render();
  announce('Appending the reviewed image and caption once. Do not repeat this action if its response is interrupted; refresh and inspect the record first.');
  try {
    const next = await postImageEvidence(credential.id, credential.token, payload, sentImage.blob, controller.signal);
    if (!current(owner, credential) || mutationController !== controller || controller.signal.aborted) return;
    const unchanged = imageDraft === sentImage && imageEpoch === sentEpoch && evidenceInputIntent === sentIntent && draft(evidenceForm) === sentDraft;
    if (unchanged) { clearImageDraft(); reset(evidenceForm); }
    imageReviewRequired = false; apply(next); announce(unchanged ? 'Image evidence added. The shared record retains the exact reviewed JPEG.' : 'Image evidence added. Your newer unsent caption or image draft is kept.');
  } catch (error) {
    if (current(owner, credential) && mutationController === controller && !controller.signal.aborted) {
      imageReviewRequired = true;
      const uncertain = !(error instanceof ApiError) || error.status === 0 || error.code === 'internal_error' || error.code === 'timeout';
      announce(`${uncertain ? 'Could not confirm whether the image append arrived.' : errorText(error)} Your raw caption and exact selected JPEG are kept. Use Refresh challenge, inspect the authoritative evidence feed, then explicitly decide whether to append. No upload is automatically replayed.`, true);
    }
  } finally {
    if (current(owner, credential) && mutationController === controller) { mutationController = null; imageUploading = false; busy = false; render(); flushIncoming(); schedule(); }
  }
}
function closeImageView(state: RetainedImageView): void {
  state.epoch++; state.controller?.abort(); state.controller = null;
  state.image.removeAttribute('src'); state.image.hidden = true;
  if (state.url) URL.revokeObjectURL(state.url);
  state.url = null; state.view.disabled = false; state.close.hidden = true;
}
function closeRetainedImages(): void { for (const state of retainedImageViews.values()) closeImageView(state); retainedImageViews.clear(); }
function addRetainedImageControls(card: HTMLElement, evidenceId: string, descriptor: ImageDescriptor): void {
  const image = el('img', '', 'evidence-image'); image.alt = 'Retained normalized evidence image'; image.hidden = true;
  const imageNote = el('p', `Normalized unverified copy · ${descriptor.width} × ${descriptor.height} · ${descriptor.bytes.toLocaleString()} bytes. This is supplied evidence, not verified authenticity or capture time.`, 'hint');
  const viewStatus = el('p', '', 'hint'); viewStatus.setAttribute('role', 'status');
  const state: RetainedImageView = { card, image, status: viewStatus, view: button('View retained image'), close: button('Close retained image'), controller: null, url: null, epoch: 0 };
  state.close.hidden = true;
  state.close.addEventListener('click', () => { closeImageView(state); viewStatus.textContent = 'Retained image closed. The shared record is unchanged.'; });
  state.view.addEventListener('click', () => { void openRetainedImage(evidenceId, descriptor, state); });
  image.addEventListener('error', () => { if (state.url && retainedImageViews.get(evidenceId) === state) { closeImageView(state); viewStatus.textContent = 'The retained JPEG could not be displayed. Its bytes remain in the shared record and complete export.'; } });
  card.append(imageNote, state.view, state.close, viewStatus, image); retainedImageViews.set(evidenceId, state);
}
async function openRetainedImage(evidenceId: string, descriptor: ImageDescriptor, state: RetainedImageView): Promise<void> {
  if (!selected || pageSuspended || retainedImageViews.get(evidenceId) !== state || state.controller || state.url || !state.card.isConnected) return;
  const credential = { ...selected }, owner = generation, token = ++state.epoch, controller = new AbortController();
  state.controller = controller; state.view.disabled = true; state.close.hidden = false; state.status.textContent = 'Fetching and verifying the retained JPEG with your private seat…';
  const owns = (): boolean => current(owner, credential) && state.epoch === token && retainedImageViews.get(evidenceId) === state && state.card.isConnected && !controller.signal.aborted;
  try {
    const blob = await fetchEvidenceImage(credential.id, evidenceId, credential.token, descriptor, controller.signal); if (!owns()) return;
    state.url = URL.createObjectURL(blob); state.image.src = state.url; state.image.hidden = false;
    state.status.textContent = 'Retained JPEG byte count and SHA-256 verified against this authenticated record. Pairing and authenticity remain unverified.';
  } catch (error) { if (owns()) { state.close.hidden = true; state.view.disabled = false; state.status.textContent = `${error instanceof ApiError ? error.message : 'The retained image could not be fetched or verified.'} The record is kept; choose View retained image to try a fresh read.`; } }
  finally { if (owns() && state.controller === controller) state.controller = null; }
}
async function exportImages(): Promise<void> {
  if (!selected || busy) return;
  const credential = { ...selected }, owner = generation, token = ++imageExportEpoch;
  imageExportController?.abort(); const controller = new AbortController(); imageExportController = controller;
  const owns = (): boolean => current(owner, credential) && imageExportEpoch === token && imageExportController === controller && !controller.signal.aborted;
  try {
    const blob = await fetchImageExport(credential.id, credential.token, controller.signal); if (!owns()) return;
    const url = URL.createObjectURL(blob); imageDownloadUrls.add(url);
    const link = el('a'); link.href = url; link.download = `friendly-challenge-${credential.id}-images.html`; link.click();
    setTimeout(() => { URL.revokeObjectURL(url); imageDownloadUrls.delete(url); }, 1000);
    announce('Complete readable record exported with retained JPEGs and audit history. Private credentials and source filenames are not included.');
  } catch (error) { if (owns()) announce(`${error instanceof ApiError ? error.message : 'Could not fetch the complete image export.'} No image export was downloaded; keep your draft and try a fresh read.`, true); }
  finally { if (imageExportController === controller) imageExportController = null; }
}
function retireImageWork(): void {
  imageEpoch++; imageNormalizeController?.abort(); imageNormalizeController = null; imageNormalizing = false;
  imageExportEpoch++; imageExportController?.abort(); imageExportController = null;
  closeRetainedImages();
  if (imageDraft?.url) { URL.revokeObjectURL(imageDraft.url); imageDraft.url = null; }
  imagePreview.removeAttribute('src'); imagePreview.hidden = true;
  for (const url of imageDownloadUrls) URL.revokeObjectURL(url); imageDownloadUrls.clear();
}
window.addEventListener('pagehide', () => {
  if (pendingCreation) announce('Challenge creation was interrupted and may have arrived. Your draft is kept; no request is replayed. Check your private access before another deliberate attempt and re-enter the operator setup key if required.', true);
  pageSuspended = true; retireCreation(); transportEpoch++; transportController?.abort(); transportController = null; transport = null; transportLoading = false; generation++; clearTimeout(pollTimer); readController?.abort(); mutationController?.abort();
  if (imageUploading) { imageReviewRequired = true; announce('The image append was interrupted. Your draft is kept in this page. Refresh and inspect the shared record before explicitly choosing another append; no upload is replayed.', true); }
  imageUploading = false; busy = false; creationControls(); useAccess.disabled = false; claimButton.disabled = false; retireImageWork();
});
window.addEventListener('pageshow', () => {
  if (!pageSuspended) return;
  pageSuspended = false; void loadTransportStatus();
  // Existing cards keep their literal evidence. Recreate only their closed image controls.
  if (snapshot) for (const item of snapshot.evidence) if ('image' in item) {
    const card = evidenceNodes.get(item.id); if (card) {
      for (const node of [...card.children].slice(2 + (item.url ? 1 : 0))) node.remove();
      addRetainedImageControls(card, item.id, item.image);
    }
  }
  imageControls(); render(); schedule();
});

async function start(): Promise<void> {
  creationControls(); void loadTransportStatus();
  const original = originalLocation; let link: PrivateLink | null = null;
  try { link = readLink(original); } catch { /* Never consume invalid private links. */ }
  try { sessions = loadSessions(); } catch { announce('Browser access storage is unavailable or damaged. Existing storage was not changed. Seats can work in memory; keep your private access link before closing.', true); }
  renderRecords(); if (link) incoming(link); else if (original.hash) announce('This private link is invalid. Its fragment has been removed. Ask for a fresh link.', true);
  const id = new URLSearchParams(original.search).get('challenge'); if (id && ID_PATTERN.test(id) && sessions[id]) await selectChallenge(id, sessions[id]!); else { connection.textContent = 'Your private notebook'; void refreshRecords(); }
}
void start();
