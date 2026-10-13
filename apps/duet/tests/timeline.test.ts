import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, validateListening, type Entry } from '../src/timeline.ts';

const track = { id: 'Song1', title: 'Our song', artists: 'The Band', album: 'Album', url: 'https://open.spotify.com/track/Song1' };
const names = { host: 'Ada', guest: 'Ben' } as const;
const base = { configured: true, redirectUri: 'http://127.0.0.1:8766/spotify/callback', authFailures: {}, hiddenCount: 0, truncated: false, memories: [],
  connections: { host: { displayName: 'ada', connectedAt: 1, syncedAt: 2, error: null }, guest: null } };
const both: Entry = { key: 'both-Song1', kind: 'both', at: 5, hidden: false, caption: '', memoryTarget: 'track-Song1', memories: [], track,
  people: { host: { firstAt: 1, lastAt: 2, plays: 3 }, guest: { firstAt: 4, lastAt: 4, plays: 1 } }, withinThirtyMinutes: false };

test('valid listening replies are accepted with every entry kind', () => {
  const entries: Entry[] = [both,
    { key: 'new-host-Song1', kind: 'new', at: 6, hidden: true, caption: 'Road trip', memoryTarget: 'track-Song1', memories: [], track, role: 'host', plays: 2 },
    { key: 'favorite-guest-Song1', kind: 'favorite', at: 7, hidden: false, caption: '', memoryTarget: 'track-Song1', memories: [], track, role: 'guest' },
    { key: `manual-${'a'.repeat(32)}`, kind: 'manual', id: 'a'.repeat(32), at: 8, hidden: false, caption: '', memoryTarget: 'track-Song1', memories: [], role: 'guest', date: '2025-06-01', title: 'Concert', song: '', note: '' }];
  assert.equal(validateListening({ ...base, entries }).entries.length, 4);
  const memory = { id: 'b'.repeat(32), target: 'track-Song1', label: 'Our song — The Band', role: 'guest', date: '2025-07-04', text: 'Windows down', photo: true, createdAt: 1 };
  assert.equal(validateListening({ ...base, entries: [{ ...both, memories: [memory] }], memories: [memory] }).memories.length, 1);
});

test('malformed replies and unsafe links are rejected before rendering', () => {
  const bad = [
    { ...base, entries: [{ ...both, track: { ...track, url: 'javascript:alert(1)' } }] },
    { ...base, entries: [{ ...both, kind: 'mystery' }] },
    { ...base, entries: [{ ...both, people: { host: both.people.host } }] },
    { ...base, connections: { host: { displayName: 'x' }, guest: null }, entries: [] },
    { ...base, entries: [{ key: 'manual-x', kind: 'manual', id: '../x', at: 1, hidden: false, caption: '', memoryTarget: 'track-Song1', memories: [], role: 'host', date: 'today', title: 'T', song: '', note: '' }] },
    { ...base, entries: 'none' },
    { ...base, entries: [], memories: [{ id: 'b'.repeat(32), target: 'track-Song1', label: 'Song', role: 'host', date: '2025-01-01', text: 'x', photo: 'yes', createdAt: 1 }] },
    { ...base, entries: [{ ...both, memories: [{ id: '../x', target: 'track-Song1', label: 'Song', role: 'host', date: '2025-01-01', text: 'x', photo: false, createdAt: 1 }] }] },
  ];
  for (const reply of bad) assert.throws(() => validateListening(reply), /not understood/);
});

test('wording never claims two people listened together', () => {
  const separate = describe(both, names);
  assert.match(separate.title, /^You both played “Our song” by The Band$/);
  assert.match(separate.detail, /Ada: 3 times.*Ben: once/);
  assert.match(separate.detail, /not necessarily together/);
  assert.match(describe({ ...both, withinThirtyMinutes: true }, names).detail, /within 30 minutes of each other/);
  assert.doesNotMatch(describe({ ...both, withinThirtyMinutes: true }, names).detail, /listened together/);
});

test('other kinds name the person involved', () => {
  assert.match(describe({ key: 'k', kind: 'new', at: 1, hidden: false, caption: '', memoryTarget: 'track-Song1', memories: [], track, role: 'guest', plays: 1 }, names).title, /^Ben heard “Our song”/);
  assert.match(describe({ key: 'k', kind: 'favorite', at: 1, hidden: false, caption: '', memoryTarget: 'track-Song1', memories: [], track, role: 'host' }, names).title, /^Ada added “Our song” by The Band to Liked Songs$/);
  const manual = describe({ key: 'k', kind: 'manual', id: 'a'.repeat(32), at: 1, hidden: false, caption: '', memoryTarget: 'track-Song1', memories: [], role: 'host', date: '2025-01-01', title: 'First dance', song: 'Our song', note: 'Kitchen' }, names);
  assert.deepEqual(manual, { title: 'First dance', detail: 'Song: Our song · Kitchen · Written by Ada' });
});
