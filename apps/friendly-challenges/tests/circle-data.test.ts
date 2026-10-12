import assert from 'node:assert/strict';
import test from 'node:test';
import { describeItem, loadCircles, parseCircleView, readCircleLink, removeCircle, saveCircle, shareState } from '../src/circle-data.ts';

const ID = 'a'.repeat(32), OTHER = 'b'.repeat(32), ME = 'c'.repeat(32), TOKEN = 'd'.repeat(64);

function view(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID, name: 'Running club', me: ME, members: [{ id: ME, name: 'Sam' }, { id: OTHER, name: 'Joe' }],
    challenges: [], pending: [], feed: [], ...extra,
  };
}
const date = (time: number): string => `t${time}`;

test('circle links are exact and never confused with challenge links', () => {
  assert.deepEqual(readCircleLink({ search: `?circle=${ID}`, hash: `#join=${TOKEN}` }), { circleId: ID, kind: 'join', token: TOKEN });
  assert.deepEqual(readCircleLink({ search: `?circle=${ID}`, hash: `#member=${TOKEN}` }), { circleId: ID, kind: 'member', token: TOKEN });
  for (const [search, hash] of [[`?challenge=${ID}`, `#join=${TOKEN}`], [`?circle=${ID}`, `#access=${TOKEN}`], [`?circle=${ID}x`, `#join=${TOKEN}`],
    [`?circle=${ID}`, `#join=${TOKEN}\n`], [`?circle=${ID}`, `#join=${TOKEN.toUpperCase()}`]]) {
    assert.equal(readCircleLink({ search: search!, hash: hash! }), null, `${search}${hash}`);
  }
});

test('memberships are remembered, bounded and never silently rewritten when damaged', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  try {
    assert.deepEqual(loadCircles(), {});
    saveCircle(ID, TOKEN); assert.deepEqual(loadCircles(), { [ID]: TOKEN });
    for (let i = 1; i < 10; i++) saveCircle(i.toString(16).padStart(32, '0'), TOKEN);
    assert.throws(() => saveCircle(OTHER, TOKEN), /ten circles/);
    removeCircle(ID); saveCircle(OTHER, TOKEN);
    values.set('friendly-challenges.circles.v1', '{"x":1}');
    assert.throws(loadCircles, /damaged/); assert.equal(values.get('friendly-challenges.circles.v1'), '{"x":1}');
  } finally { Reflect.deleteProperty(globalThis, 'localStorage'); }
});

test('replies are validated before anything renders', () => {
  const feed = [
    { key: `${OTHER}-final`, challengeId: OTHER, at: 9, title: '10K', kind: 'settled', winner: 'Terry', method: 'mutual', reason: 'Under the hour', cheers: ['Sam'], cheeredByMe: true },
    { key: `${OTHER}-4`, challengeId: OTHER, at: 5, title: '10K', kind: 'progress', by: 'Terry', text: 'Crossed at 58:12', photo: true, late: false, cheers: [], cheeredByMe: false },
    { key: `${OTHER}-3`, challengeId: OTHER, at: 3, title: '10K', kind: 'agreed', proposer: 'Joe', opponent: 'Terry', stake: 'doing the dishes', deadline: 7, successCriteria: 'Under an hour', cheers: [], cheeredByMe: false },
  ];
  const parsed = parseCircleView(view({ feed, challenges: [{ id: OTHER, title: '10K', status: 'resolved', proposer: 'Joe', opponent: 'Terry', comments: [{ id: ME, by: 'Sam', mine: true, text: 'Go!', at: 4 }] }] }));
  assert.equal(parsed.feed.length, 3); assert.equal(parsed.challenges[0]!.comments[0]!.mine, true);
  assert.equal(describeItem(parsed.feed[0]!, date), 'Terry won “10K”, and both agreed. Under the hour');
  assert.equal(describeItem(parsed.feed[1]!, date), 'Terry shared progress on “10K”: Crossed at 58:12 (A photo was added; photos stay private to the participants.)');
  assert.equal(describeItem(parsed.feed[2]!, date), 'Joe and Terry agreed to “10K”. Stake: doing the dishes. Deadline t7. Success means: Under an hour');

  for (const broken of [view({ feed: [{ ...feed[0], kind: 'gossip' }] }), view({ feed: [{ ...feed[0], key: 'x' }] }), view({ pending: [{ id: OTHER, consented: ['arbiter'] }] }),
    view({ members: 'everyone' }), view({ challenges: [{ id: OTHER, title: '10K', status: 'active', proposer: 'Joe', opponent: null }] }), view({ me: 'me' }), view({ feed: [{ ...feed[1], at: -1 }] })]) {
    assert.throws(() => parseCircleView(broken), /not understood/);
  }
});

test('sharing state explains dual consent from the current seat', () => {
  const none = parseCircleView(view());
  assert.deepEqual(shareState(none, OTHER, 'proposer', 'Terry'), { text: 'Not shared with this circle.', action: 'share' });
  const mine = parseCircleView(view({ pending: [{ id: OTHER, consented: ['proposer'] }] }));
  assert.equal(shareState(mine, OTHER, 'proposer', 'Terry').action, 'unshare');
  assert.match(shareState(mine, OTHER, 'proposer', 'Terry').text, /after Terry also shares/);
  assert.deepEqual(shareState(mine, OTHER, 'opponent', 'Joe'), { text: 'Joe wants to share it with this circle. It appears once you share it too.', action: 'share' });
  const shared = parseCircleView(view({ challenges: [{ id: OTHER, title: '10K', status: 'active', proposer: 'Joe', opponent: 'Terry', comments: [] }] }));
  assert.deepEqual(shareState(shared, OTHER, 'opponent', 'Joe'), { text: 'Shared. All 2 members can follow its progress and results.', action: 'unshare' });
});
