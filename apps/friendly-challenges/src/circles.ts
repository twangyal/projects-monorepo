import { ApiError, request } from './api.ts';
import { describeItem, loadCircles, parseCircleView, readCircleLink, removeCircle, saveCircle, shareState } from './circle-data.ts';
import type { CircleLink, CircleView, CircleChallenge, FeedItem } from './circle-data.ts';
import type { Party, Role } from './types.ts';

export interface CircleHost {
  main: HTMLElement; dashboard: HTMLElement; grid: HTMLElement;
  /** The challenge panel the sharing controls are placed before. */
  shareBefore: HTMLElement;
  announce(text: string, error?: boolean): void;
  leaveDrafts(): boolean;
  /** Close any open challenge and hide the dashboard so the circle view can take over. */
  enterCircle(): void;
  showDashboard(): void;
}
/** The open challenge, as seen by its current seat. */
export interface ShareTarget { id: string; token: string; role: Role; otherName: string }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag); n.textContent = text; if (className) n.className = className; return n;
}
function button(label: string, action: () => void, cls = ''): HTMLButtonElement {
  const n = el('button', label, cls); n.type = 'button'; n.addEventListener('click', action); return n;
}
function section(title: string, hint = ''): HTMLElement {
  const n = el('section', '', 'panel'); n.append(el('h2', title)); if (hint) n.append(el('p', hint, 'hint')); return n;
}
/** Forms follow the page convention: `data-dirty` marks an unsent draft that navigation must not drop silently. */
function form(id: string): HTMLFormElement {
  const n = el('form'); n.id = id; n.addEventListener('input', () => { n.dataset.dirty = 'true'; n.dataset.intent = String(Number(n.dataset.intent ?? 0) + 1); }); return n;
}
function field(f: HTMLFormElement, name: string, caption: string, max: number, multiline = false): HTMLInputElement | HTMLTextAreaElement {
  const label = el('label', caption, 'field'); const n = multiline ? el('textarea') : el('input');
  n.name = name; n.id = `${f.id}-${name}`; n.maxLength = max; n.required = true; if (n instanceof HTMLTextAreaElement) n.rows = 2;
  label.append(n); f.append(label); return n;
}
function onSubmit(f: HTMLFormElement, caption: string, action: () => void): HTMLButtonElement {
  const b = el('button', caption, 'primary'); b.type = 'submit'; f.append(b);
  f.addEventListener('submit', (event) => { event.preventDefault(); if (f.reportValidity()) action(); }); return b;
}
function input(f: HTMLFormElement, name: string): string { return String(new FormData(f).get(name) ?? '').trim(); }
function clear(f: HTMLFormElement): void { f.reset(); f.dataset.dirty = 'false'; }
function when(time: number): string { return new Date(time).toLocaleString(); }
/** Service error messages are written for people; anything else is an unreadable reply. */
function failure(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'The circle reply was not understood. Nothing was changed in this browser; refresh and try again.';
}

export function createCircles(host: CircleHost) {
  let memberships: Record<string, string> = {};
  let storageError = '';
  try { memberships = loadCircles(); } catch (error) { storageError = (error as Error).message; }
  const views = new Map<string, CircleView>();
  const unsaved = new Set<string>();
  let openId: string | null = null; let pending: CircleLink | null = null; let busy = false;
  let poll: ReturnType<typeof setTimeout> | undefined; let epoch = 0; let rendered = '';
  let target: ShareTarget | null = null; let shareRendered = '';

  async function call(method: 'GET' | 'POST', path: string, body?: unknown, token?: string): Promise<unknown> {
    return request<unknown>(method, path, body, token);
  }
  function remember(id: string, token: string): void {
    memberships[id] = token;
    try { saveCircle(id, token); unsaved.delete(id); } catch { unsaved.add(id); host.announce('You joined, but this browser could not remember the circle. Copy “My circle access link” before closing this page.', true); }
  }
  function forget(id: string): void {
    delete memberships[id]; views.delete(id); unsaved.delete(id);
    try { removeCircle(id); } catch { /* Nothing more can be done; the membership is gone from this page. */ }
  }

  // Dashboard ------------------------------------------------------------------------------
  const panel = section('Your circles', 'Friends who follow the challenges you choose to share. A challenge appears only after both of its participants share it; evidence photos never leave the challenge.');
  panel.id = 'circles-panel';
  const circleList = el('div'); circleList.id = 'circle-list';
  const createForm = form('circle-create-form'); field(createForm, 'circleName', 'Circle name', 60); field(createForm, 'name', 'Your name in this circle', 40);
  const createButton = onSubmit(createForm, 'Create circle', () => { void createCircle(); });
  panel.append(circleList, createForm); host.grid.append(panel);

  const joinPanel = section('A circle invitation', 'Circle links are private. Anyone holding one can join or act as its owner.'); joinPanel.id = 'circle-join'; joinPanel.hidden = true;
  const joinText = el('p'); const joinForm = form('circle-join-form'); field(joinForm, 'name', 'Your name in this circle', 40);
  const joinButton = onSubmit(joinForm, 'Join circle', () => { void joinCircle(); });
  const useAccess = button('Use this circle access link', () => { void useMemberLink(); }, 'primary');
  joinPanel.append(joinText, joinForm, useAccess, button('Not now', () => { pending = null; joinPanel.hidden = true; clear(joinForm); }));
  host.dashboard.before(joinPanel);

  function renderList(): void {
    circleList.replaceChildren();
    if (storageError) circleList.append(el('p', storageError, 'warning'));
    const ids = Object.keys(memberships);
    if (!ids.length) circleList.append(el('p', 'No circles yet. Create one and invite friends, or open a friend’s invitation link.', 'empty'));
    for (const id of ids) {
      const view = views.get(id); const card = el('article', '', 'record-card'); card.dataset.circleId = id;
      card.append(el('h3', view?.name ?? 'Private circle'),
        el('p', view ? `${view.members.length} ${view.members.length === 1 ? 'member' : 'members'} · ${view.challenges.length} shared ${view.challenges.length === 1 ? 'challenge' : 'challenges'}` : 'A circle remembered in this browser', 'hint'),
        button('Open circle', () => { openCircle(id); }));
      circleList.append(card);
    }
    createButton.disabled = busy;
  }
  async function refreshAll(): Promise<void> {
    const started = epoch;
    for (const [id, token] of Object.entries(memberships)) {
      try { const view = parseCircleView(await call('GET', `/api/circles/${id}`, undefined, token)); if (started !== epoch) return; views.set(id, view); }
      catch (error) { if (error instanceof ApiError && error.status === 401) views.delete(id); }
    }
    if (started === epoch) { renderList(); renderShare(); }
  }

  async function createCircle(): Promise<void> {
    if (busy) return; busy = true; renderList();
    try {
      const reply = await call('POST', '/api/circles', { circleName: input(createForm, 'circleName'), name: input(createForm, 'name') }) as Record<string, unknown>;
      const view = parseCircleView(reply.circle);
      if (typeof reply.token !== 'string' || typeof reply.inviteToken !== 'string') throw new Error();
      clear(createForm); remember(view.id, reply.token); views.set(view.id, view); busy = false;
      if (openCircle(view.id)) revealLink('join', reply.inviteToken);
      host.announce('Circle created. Send the invitation link to the friends you want in it.');
    } catch (error) { host.announce(failure(error), true); }
    finally { busy = false; renderList(); }
  }

  // Incoming links ---------------------------------------------------------------------------
  /** Handles `?circle=` locations. Returns false for anything that is not a circle link. */
  function incoming(source: { search: string; hash: string }): boolean {
    if (!source.search.startsWith('?circle=')) return false;
    const link = readCircleLink(source);
    if (!link) {
      const id = source.search.slice('?circle='.length);
      if (!source.hash && memberships[id]) { openCircle(id); return true; }
      host.announce(source.hash ? 'This circle link is invalid. Its private part has been removed. Ask for a fresh invitation.' : 'This circle is not remembered in this browser. Open your circle access link or a fresh invitation.', true);
      return true;
    }
    if (link.kind === 'member' && memberships[link.circleId] === link.token) { openCircle(link.circleId); return true; }
    pending = link; joinPanel.hidden = false;
    const member = !!memberships[link.circleId];
    joinText.textContent = link.kind === 'join'
      ? `Join this circle with the name your friends know you by.${member ? ' This browser is already a member; joining again adds a second member.' : ''}`
      : `This opens a circle membership${member ? ' different from the one this browser remembers' : ''}. Anyone holding this link can act as that member.`;
    joinForm.hidden = link.kind !== 'join'; useAccess.hidden = link.kind !== 'member';
    joinPanel.scrollIntoView?.({ block: 'nearest' });
    return true;
  }
  async function joinCircle(): Promise<void> {
    const link = pending; if (!link || link.kind !== 'join' || busy) return; busy = true; joinButton.disabled = true;
    try {
      const reply = await call('POST', `/api/circles/${link.circleId}/join`, { inviteToken: link.token, name: input(joinForm, 'name') }) as Record<string, unknown>;
      const view = parseCircleView(reply.circle); if (typeof reply.token !== 'string') throw new Error();
      remember(view.id, reply.token); views.set(view.id, view); pending = null; joinPanel.hidden = true; clear(joinForm); busy = false;
      openCircle(view.id); host.announce(`You joined ${view.name}.`);
    } catch (error) { host.announce(failure(error), true); }
    finally { busy = false; joinButton.disabled = false; }
  }
  async function useMemberLink(): Promise<void> {
    const link = pending; if (!link || link.kind !== 'member' || busy) return;
    if (memberships[link.circleId] && !confirm('Replace the circle membership this browser remembers with this access link?')) return;
    busy = true; useAccess.disabled = true;
    try {
      const view = parseCircleView(await call('GET', `/api/circles/${link.circleId}`, undefined, link.token));
      remember(view.id, link.token); views.set(view.id, view); pending = null; joinPanel.hidden = true; busy = false; openCircle(view.id);
    } catch (error) { host.announce(failure(error), true); }
    finally { busy = false; useAccess.disabled = false; }
  }

  // Circle view ------------------------------------------------------------------------------
  const page = el('div', '', 'circle-view'); page.id = 'circle-view'; page.hidden = true; host.main.append(page);
  const toolbar = el('div', '', 'toolbar');
  const leaveButton = button('Leave circle', () => { void leaveCircle(); }, 'danger');
  toolbar.append(button('Back to challenges', () => { if (host.leaveDrafts()) host.showDashboard(); }), button('Invite friends', () => { void invite(); }),
    button('My circle access link', () => { if (openId) revealLink('member', memberships[openId]!); }), button('Refresh circle', () => { void refreshOpen(true); }), leaveButton);
  const linkBox = el('section', '', 'panel circle-link'); linkBox.id = 'circle-link-panel'; linkBox.hidden = true;
  const linkText = el('p'); const linkLabel = el('label', 'Private link', 'field'); const linkInput = el('input'); linkInput.id = 'circle-link'; linkInput.readOnly = true; linkLabel.append(linkInput);
  linkBox.append(linkText, linkLabel, button('Copy link', () => { void copy(); }), button('Close link', () => { linkBox.hidden = true; linkInput.value = ''; }));
  const heading = el('div', '', 'challenge-header'); const circleName = el('h1'); circleName.id = 'circle-name'; const memberText = el('p'); memberText.id = 'circle-members'; heading.append(el('p', 'FRIEND CIRCLE', 'eyebrow'), circleName, memberText);
  const columns = el('div', '', 'workspace-grid');
  const feedPanel = section('Feed', 'Progress and results from challenges both participants shared. Newest first.'); const feedList = el('ol', '', 'activity-list circle-feed'); feedList.id = 'circle-feed'; feedPanel.append(feedList);
  const sharedPanel = section('Shared challenges', 'Cheer people on and talk about the challenges here. Comments are seen by everyone in the circle.'); const sharedList = el('div'); sharedList.id = 'circle-challenges'; sharedPanel.append(sharedList);
  columns.append(feedPanel, sharedPanel); page.append(toolbar, linkBox, heading, columns);
  const commentForms = new Map<string, HTMLFormElement>();

  function revealLink(kind: 'join' | 'member', token: string): void {
    if (!openId) return;
    linkInput.value = `${location.origin}/?circle=${openId}#${kind}=${token}`;
    linkText.textContent = kind === 'join'
      ? 'Invitation link for friends. Anyone with it can join until someone makes a new one, which stops this link working.'
      : 'Your circle access link. Anyone holding it can act as you in this circle. Keep it private; use it to open this circle in another browser.';
    linkBox.hidden = false;
  }
  async function copy(): Promise<void> {
    try { await navigator.clipboard.writeText(linkInput.value); host.announce('Circle link copied.'); }
    catch { linkInput.focus(); linkInput.select(); host.announce('Select and copy the link. Clipboard access is unavailable.'); }
  }
  function openCircle(id: string): boolean {
    if (busy) { host.announce('Wait for your current circle action to finish before opening a circle.', true); return false; }
    if (!host.leaveDrafts()) return false;
    host.enterCircle(); host.announce(''); epoch++; openId = id; rendered = ''; linkBox.hidden = true; linkInput.value = ''; commentForms.clear();
    page.hidden = false; history.replaceState(null, '', `/?circle=${id}`);
    const cached = views.get(id); if (cached) render(cached); else { circleName.textContent = 'Loading circle…'; memberText.textContent = ''; feedList.replaceChildren(); sharedList.replaceChildren(); }
    void refreshOpen(); return true;
  }
  function hide(): void { epoch++; openId = null; clearTimeout(poll); page.hidden = true; linkBox.hidden = true; linkInput.value = ''; }
  async function refreshOpen(manual = false): Promise<void> {
    clearTimeout(poll); const id = openId; if (!id) return; const started = epoch;
    if (!busy) {
      try {
        const view = parseCircleView(await call('GET', `/api/circles/${id}`, undefined, memberships[id]));
        if (started !== epoch) return; views.set(id, view); render(view); if (manual) host.announce('Circle refreshed.');
      } catch (error) {
        if (started !== epoch) return;
        if (error instanceof ApiError && error.status === 401) { forget(id); host.showDashboard(); host.announce('That circle membership is no longer valid, so this browser forgot it. Ask a member for a fresh invitation.', true); return; }
        if (manual) host.announce(failure(error), true);
      }
    }
    if (started === epoch) poll = setTimeout(() => { void refreshOpen(); }, 4000);
  }
  async function act(path: string, body: unknown, success = ''): Promise<boolean> {
    const id = openId; if (!id || busy) return false; busy = true; renderControls(); const started = epoch;
    try {
      const view = parseCircleView(await call('POST', `/api/circles/${id}/${path}`, body, memberships[id]));
      if (started === epoch) { views.set(id, view); render(view); } if (success) host.announce(success); return true;
    } catch (error) { host.announce(failure(error), true); return false; }
    finally { busy = false; renderControls(); }
  }
  async function invite(): Promise<void> {
    const id = openId; if (!id || busy) return; busy = true; renderControls();
    try {
      const reply = await call('POST', `/api/circles/${id}/invite`, {}, memberships[id]) as Record<string, unknown>;
      if (typeof reply.inviteToken !== 'string' || openId !== id) return;
      revealLink('join', reply.inviteToken); host.announce('New invitation ready. Earlier invitation links no longer work.');
    } catch (error) { host.announce(failure(error), true); }
    finally { busy = false; renderControls(); }
  }
  async function leaveCircle(): Promise<void> {
    const id = openId; if (!id || busy || !confirm('Leave this circle? Your cheers and comments are removed, and challenges you shared from this circle are withdrawn. You need a new invitation to come back.')) return;
    busy = true; renderControls();
    try { await call('POST', `/api/circles/${id}/leave`, {}, memberships[id]); forget(id); busy = false; host.showDashboard(); host.announce('You left the circle.'); }
    catch (error) { host.announce(failure(error), true); }
    finally { busy = false; renderControls(); }
  }

  function renderControls(): void {
    for (const b of page.querySelectorAll<HTMLButtonElement>('button')) if (!b.closest('.toolbar') || b === leaveButton) b.disabled = busy;
  }
  function feedEntry(item: FeedItem): HTMLLIElement {
    const li = el('li'); li.dataset.item = item.key; li.dataset.kind = item.kind;
    const cheer = button(item.cheeredByMe ? `Cheered · ${item.cheers.length}` : `Cheer${item.cheers.length ? ` · ${item.cheers.length}` : ''}`, () => { void act('cheer', { item: item.key }); }, 'cheer');
    cheer.setAttribute('aria-pressed', String(item.cheeredByMe)); cheer.setAttribute('aria-label', `${item.cheeredByMe ? 'Remove your cheer for' : 'Cheer'}: ${item.title}`);
    const who = item.cheers.length ? ` · Cheered by ${item.cheers.join(', ')}` : '';
    li.append(el('p', describeItem(item, when)), el('p', `${when(item.at)}${who}`, 'hint'), cheer);
    return li;
  }
  function challengeEntry(challenge: CircleChallenge): HTMLElement {
    const card = el('article', '', 'record-card'); card.dataset.challengeId = challenge.id;
    card.append(el('h3', challenge.title), el('p', `${challenge.status} · ${challenge.proposer} vs ${challenge.opponent ?? 'an opponent'}`, 'hint'));
    const comments = el('ul', '', 'circle-comments');
    for (const comment of challenge.comments) {
      const li = el('li'); li.append(el('p', comment.text), el('p', `${comment.by} · ${when(comment.at)}`, 'hint'));
      if (comment.mine) li.append(button('Delete comment', () => { if (confirm('Delete your comment?')) void act('comment/delete', { commentId: comment.id }, 'Comment deleted.'); }));
      comments.append(li);
    }
    let f = commentForms.get(challenge.id);
    if (!f) {
      const made = form(`comment-${challenge.id}`); field(made, 'text', `Comment on “${challenge.title}”`, 500, true);
      onSubmit(made, 'Post comment', () => {
        const submittedEpoch = epoch, submittedIntent = made.dataset.intent;
        void act('comment', { challengeId: challenge.id, text: input(made, 'text') }).then((ok) => {
          if (ok && epoch === submittedEpoch && commentForms.get(challenge.id) === made && made.dataset.intent === submittedIntent) clear(made);
        });
      });
      commentForms.set(challenge.id, made); f = made;
    }
    card.append(comments, f); return card;
  }
  function render(view: CircleView): void {
    if (view.id !== openId) return;
    const signature = JSON.stringify(view); if (signature === rendered) return; rendered = signature;
    const focused = document.activeElement instanceof HTMLTextAreaElement && sharedList.contains(document.activeElement) ? document.activeElement : null;
    const selection = focused ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] as const : null;
    circleName.textContent = view.name;
    memberText.textContent = `${view.members.length} of 12 members: ${view.members.map((m) => m.id === view.me ? `${m.name} (you)` : m.name).join(', ')}`;
    feedList.replaceChildren(...view.feed.map(feedEntry));
    if (!view.feed.length) feedList.append(el('li', 'Nothing here yet. When both participants share a challenge, its agreement, progress and result appear here.', 'empty'));
    sharedList.replaceChildren(...view.challenges.map(challengeEntry));
    if (!view.challenges.length) sharedList.append(el('p', 'No shared challenges yet. Open one of your challenges and choose “Share” for this circle; your opponent shares it from their seat too.', 'empty'));
    renderControls();
    if (focused?.isConnected && selection) { focused.focus({ preventScroll: true }); focused.setSelectionRange(...selection); }
  }

  // Sharing from a challenge ------------------------------------------------------------------
  const shareBox = section('Share with a circle', 'Both participants must share a challenge with the same circle before its members see anything. Either of you can withdraw it later, which also removes its comments.');
  shareBox.id = 'circle-share'; const shareList = el('div'); shareBox.append(shareList); host.shareBefore.before(shareBox);
  function renderShare(): void {
    const t = target; const ids = Object.keys(memberships);
    const signature = JSON.stringify([t?.id, t?.role, t?.otherName, busy, ids.map((id) => [id, views.get(id)?.name, views.get(id)?.challenges.map((c) => c.id), views.get(id)?.pending, views.get(id)?.members.length])]);
    if (signature === shareRendered) return; shareRendered = signature;
    shareList.replaceChildren();
    if (!t) return;
    if (t.role === 'arbiter') { shareList.append(el('p', 'Only the two participants can share this challenge.', 'hint')); return; }
    if (!ids.length) { shareList.append(el('p', 'You are not in any circles yet. Create or join one from Back to challenges.', 'empty')); return; }
    for (const id of ids) {
      const view = views.get(id); const row = el('div', '', 'record-card'); row.dataset.circleId = id;
      if (!view) { row.append(el('h3', 'Private circle'), el('p', 'Loading this circle…', 'hint')); shareList.append(row); continue; }
      const state = shareState(view, t.id, t.role as Party, t.otherName);
      row.append(el('h3', view.name), el('p', state.text, 'hint'), state.action === 'share'
        ? button(`Share with ${view.name}`, () => { void share(id, 'share'); }, 'primary')
        : button(`Withdraw from ${view.name}`, () => { if (confirm('Withdraw this challenge from the circle? Its comments and cheers there are deleted.')) void share(id, 'unshare'); }));
      shareList.append(row);
    }
    for (const b of shareList.querySelectorAll('button')) b.disabled = busy;
  }
  async function share(id: string, action: 'share' | 'unshare'): Promise<void> {
    const t = target; if (!t || busy) return; busy = true; renderShare();
    try {
      const view = parseCircleView(await call('POST', `/api/circles/${id}/${action}`, { challengeId: t.id, seatToken: t.token }, memberships[id]));
      views.set(id, view);
      const shared = view.challenges.some((c) => c.id === t.id);
      host.announce(action === 'unshare' ? `Withdrawn from ${view.name}.` : shared ? `Shared with ${view.name}. Its members can now follow this challenge.` : `You shared it with ${view.name}. It appears there once ${t.otherName} shares it too.`);
    } catch (error) { host.announce(failure(error), true); }
    finally { busy = false; renderShare(); }
  }
  /** Called on every challenge render; fetches circle states only when the challenge changes. */
  function setTarget(next: ShareTarget | null): void {
    const changed = next?.id !== target?.id || next?.token !== target?.token;
    target = next; renderShare();
    if (changed && next) void refreshAll();
  }

  renderList(); renderShare();
  return {
    incoming, hide, setTarget,
    /** Refresh the dashboard list of circles. */
    showList(): void { hide(); renderList(); void refreshAll(); },
  };
}
