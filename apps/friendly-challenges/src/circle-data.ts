import { ID_PATTERN, TOKEN_PATTERN, type Party } from './types.ts';

/** `?circle=ID#join=…` invites a friend; `#member=…` reopens an existing membership elsewhere. */
export interface CircleLink { circleId: string; kind: 'join' | 'member'; token: string }
export interface Member { id: string; name: string }
export interface Comment { id: string; by: string; mine: boolean; text: string; at: number }
export interface CircleChallenge { id: string; title: string; status: string; proposer: string; opponent: string | null; comments: Comment[] }
/** A challenge only one participant has shared so far: the circle sees nothing but its ID. */
export interface PendingShare { id: string; consented: Party[] }
interface ItemBase { key: string; challengeId: string; at: number; title: string; cheers: string[]; cheeredByMe: boolean }
export type FeedItem = ItemBase & (
  | { kind: 'agreed'; proposer: string; opponent: string; stake: string; deadline: number; successCriteria: string }
  | { kind: 'progress'; by: string; text: string; photo: boolean; late: boolean }
  | { kind: 'disputed' | 'declined' | 'withdrawn'; by: string }
  | { kind: 'settled' | 'voided'; winner: string | null; method: 'mutual' | 'arbiter'; reason: string });
export interface CircleView { id: string; name: string; me: string; members: Member[]; challenges: CircleChallenge[]; pending: PendingShare[]; feed: FeedItem[] }

const KEY = 'friendly-challenges.circles.v1';
const MAX_CIRCLES = 10;
const MAX_MAP_BYTES = 4 * 1024;

export function isCircleLocation(search: string): boolean { return typeof search === 'string' && search.startsWith('?circle='); }

export function readCircleLink(location: { search: string; hash: string }): CircleLink | null {
  if (!location || !isCircleLocation(location.search) || typeof location.hash !== 'string') return null;
  const circleId = location.search.slice('?circle='.length);
  if (!ID_PATTERN.test(circleId)) return null;
  const match = /^#(join|member)=([0-9a-f]{64})$(?![\s\S])/.exec(location.hash);
  return match ? { circleId, kind: match[1] as CircleLink['kind'], token: match[2]! } : null;
}

function storage(): Storage {
  try { const value = globalThis.localStorage; if (value) return value; } catch { /* reported below */ }
  throw new Error('Browser storage is unavailable, so circle memberships cannot be remembered. Keep your circle access link.');
}

export function loadCircles(): Record<string, string> {
  const raw = storage().getItem(KEY);
  if (raw === null) return {};
  let parsed: unknown;
  try { parsed = raw.length <= MAX_MAP_BYTES ? JSON.parse(raw) : null; } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Saved circle memberships are damaged. They were left unchanged.');
  const entries = Object.entries(parsed);
  if (entries.length > MAX_CIRCLES || entries.some(([id, token]) => !ID_PATTERN.test(id) || typeof token !== 'string' || !TOKEN_PATTERN.test(token))) {
    throw new Error('Saved circle memberships are damaged. They were left unchanged.');
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

export function saveCircle(id: string, token: string): void {
  if (!ID_PATTERN.test(id) || !TOKEN_PATTERN.test(token)) throw new Error('A valid circle membership is required.');
  const circles = loadCircles();
  if (!Object.hasOwn(circles, id) && Object.keys(circles).length >= MAX_CIRCLES) throw new Error('This browser already remembers ten circles.');
  circles[id] = token;
  storage().setItem(KEY, JSON.stringify(circles));
}

export function removeCircle(id: string): void {
  const circles = loadCircles();
  if (!Object.hasOwn(circles, id)) return;
  delete circles[id];
  if (Object.keys(circles).length) storage().setItem(KEY, JSON.stringify(circles)); else storage().removeItem(KEY);
}

// Replies are checked before rendering so a damaged or unexpected reply never half-renders.
function invalid(): never { throw new Error('The circle reply was not understood.'); }
function obj(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid(); }
function str(value: unknown, max = 2000): string { return typeof value === 'string' && value.length <= max ? value : invalid(); }
function num(value: unknown): number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid(); }
function bool(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid(); }
function list(value: unknown, max: number): unknown[] { return Array.isArray(value) && value.length <= max ? value : invalid(); }
function id(value: unknown): string { return typeof value === 'string' && ID_PATTERN.test(value) ? value : invalid(); }
function name(value: unknown): string { return str(value, 60); }

function feedItem(value: unknown): FeedItem {
  const v = obj(value);
  const base: ItemBase = {
    key: /^[0-9a-f]{32}-(?:[0-9]{1,6}|final)$/.test(str(v.key, 40)) ? v.key as string : invalid(), challengeId: id(v.challengeId),
    at: num(v.at), title: str(v.title, 200), cheers: list(v.cheers, 12).map(name), cheeredByMe: bool(v.cheeredByMe),
  };
  switch (v.kind) {
    case 'agreed': return { ...base, kind: 'agreed', proposer: name(v.proposer), opponent: name(v.opponent), stake: str(v.stake, 40), deadline: num(v.deadline), successCriteria: str(v.successCriteria, 400) };
    case 'progress': return { ...base, kind: 'progress', by: name(v.by), text: str(v.text, 400), photo: bool(v.photo), late: bool(v.late) };
    case 'disputed': case 'declined': case 'withdrawn': return { ...base, kind: v.kind, by: name(v.by) };
    case 'settled': case 'voided':
      if (v.method !== 'mutual' && v.method !== 'arbiter') invalid();
      return { ...base, kind: v.kind, winner: v.winner === null ? null : name(v.winner), method: v.method, reason: str(v.reason, 400) };
    default: return invalid();
  }
}

export function parseCircleView(value: unknown): CircleView {
  const v = obj(value);
  const challenges = list(v.challenges, 200).map((entry): CircleChallenge => {
    const c = obj(entry);
    const comments = list(c.comments, 500).map((raw): Comment => {
      const m = obj(raw); return { id: id(m.id), by: name(m.by), mine: bool(m.mine), text: str(m.text, 1000), at: num(m.at) };
    });
    return { id: id(c.id), title: str(c.title, 200), status: str(c.status, 20), proposer: name(c.proposer), opponent: c.opponent === null ? null : name(c.opponent), comments };
  });
  const pending = list(v.pending, 200).map((entry): PendingShare => {
    const p = obj(entry);
    return { id: id(p.id), consented: list(p.consented, 1).map((role) => role === 'proposer' || role === 'opponent' ? role : invalid()) };
  });
  return {
    id: id(v.id), name: name(v.name), me: id(v.me),
    members: list(v.members, 12).map((raw) => { const m = obj(raw); return { id: id(m.id), name: name(m.name) }; }),
    challenges, pending, feed: list(v.feed, 200).map(feedItem),
  };
}

/** One plain sentence per feed item; dates are formatted by the caller's locale. */
export function describeItem(item: FeedItem, date: (time: number) => string): string {
  const quoted = `“${item.title}”`;
  switch (item.kind) {
    case 'agreed': return `${item.proposer} and ${item.opponent} agreed to ${quoted}. Stake: ${item.stake}. Deadline ${date(item.deadline)}. Success means: ${item.successCriteria}`;
    case 'progress': return `${item.by} shared ${item.late ? 'late ' : ''}progress on ${quoted}: ${item.text}${item.photo ? ' (A photo was added; photos stay private to the participants.)' : ''}`;
    case 'disputed': return `${item.by} disputed the proposed result of ${quoted}. They can still agree, void it, or ask a mutually chosen arbiter.`;
    case 'declined': return `${item.by} declined ${quoted}.`;
    case 'withdrawn': return `${item.by} withdrew ${quoted}.`;
    case 'settled': return `${item.winner} won ${quoted}${item.method === 'arbiter' ? ' by their arbiter’s decision' : ', and both agreed'}.${item.reason ? ` ${item.reason}` : ''}`;
    case 'voided': return `${quoted} ended with no winner${item.method === 'arbiter' ? ' by their arbiter’s decision' : ' by mutual agreement'}.${item.reason ? ` ${item.reason}` : ''}`;
  }
}

/** What the current participant sees about sharing one challenge with one circle. */
export function shareState(view: CircleView, challengeId: string, role: Party, otherName: string): { text: string; action: 'share' | 'unshare' } {
  if (view.challenges.some((c) => c.id === challengeId)) return { text: `Shared. All ${view.members.length} members can follow its progress and results.`, action: 'unshare' };
  const entry = view.pending.find((c) => c.id === challengeId);
  if (!entry) return { text: 'Not shared with this circle.', action: 'share' };
  if (entry.consented.includes(role)) return { text: `You agreed to share it. It appears only after ${otherName} also shares it from their seat in this circle.`, action: 'unshare' };
  return { text: `${otherName} wants to share it with this circle. It appears once you share it too.`, action: 'share' };
}
