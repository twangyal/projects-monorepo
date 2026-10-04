import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { applyMidiImport, buildMidiReview, type MidiImportChoices } from '../src/midi-review.ts';
import type { MidiLane, MidiPreview, MidiSourceNote } from '../src/midi-import.ts';
import type { Composition } from '../src/types.ts';
const base = (): Composition => ({ version: 1, title: 'Current', tempo: 120, tracks: [{ id: 'base-track', name: 'Part', instrument: 'sine', volume: .8, muted: false, notes: [{ id: 'base-note', pitch: 60, start: 0, duration: 1, velocity: .7 }] }] });
const note = (onTick = 997, offTick = 1994, pitch = 60): MidiSourceNote => ({ onTick, offTick, pitch, velocity: 64 });
function lane(channel = 0, notes: MidiSourceNote[] = [note()]): MidiLane { return { id: `channel-${channel}`, channel, sourceTracks: [0], name: { value: 'Source', status: 'usable', reason: null }, noteOnCount: notes.length, notes, program: 73, programExplicit: true, volume: 100, volumeExplicit: true, issues: [] }; }
function source(lanes: MidiLane[] = [lane()], ppqn = 997, lastTick = 8 * ppqn): MidiPreview { return { format: 0, ppqn, rawTrackCount: 1, eventCount: 5000, noteOnCount: lanes.reduce((n, l) => n + l.noteOnCount, 0), lastTick, tempoMicros: 500001, tempo: 60000000 / 500001, tempoExplicit: true, title: { value: 'Source song', status: 'usable', reason: null }, lanes, ignoredMeta: [], ignoredReleaseVelocityCount: 0 }; }
const choices = (lanes: MidiImportChoices['lanes'] = [{ laneId: 'channel-0', name: 'Mapped', instrument: 'triangle' }]): MidiImportChoices => ({ title: 'Chosen', startBeat: 1, endBeat: 8, lanes });
test('exact integer differences preserve off-grid timing; CC7 and onset velocity stay separate', () => {
    const old = base(), preview = source([lane(0, [note(1031, 1749)])]), choice = choices(), before = structuredClone({ old, preview, choice });
    const review = buildMidiReview(old, preview, choice), n = review.candidate.tracks[0].notes[0];
    assert.equal(n.start, 34 / 997);
    assert.equal(n.duration, 718 / 997);
    assert.equal(n.velocity, 64 / 127);
    assert.equal(review.candidate.tracks[0].volume, 100 / 127);
    assert.equal(review.candidate.tempo, 60000000 / 500001);
    assert(review.warnings.some(x => /480/.test(x)));
    assert(review.warnings.some(x => /trailing.*silence|EOT/i.test(x)));
    assert.deepEqual({ old, preview, choice }, before);
    assert.deepEqual(applyMidiImport(old, review), review.candidate);
});
test('ascending selected channels, outside/unselected attacks, crossing rejection without clipping', () => {
    const preview = source([lane(0, [note(0, 997), note(), note(7976, 8973)]), lane(2), lane(4)], 997, 9970);
    const review = buildMidiReview(base(), preview, choices([{ laneId: 'channel-2', name: 'Two', instrument: 'sine' }, { laneId: 'channel-0', name: 'Zero', instrument: 'triangle' }]));
    assert.deepEqual(review.lanes.map(x => x.channel), [0, 2]);
    assert.equal(review.lanes[0].outsideNotes, 2);
    assert.equal(review.includedNotes, 2);
    assert.equal(review.excludedNoteOnCount, 3);
    assert.throws(() => buildMidiReview(base(), source([lane(0, [note(500, 1500)])]), choices()), /boundary|window/i);
    assert.equal(buildMidiReview(base(), source([lane(0, [note(500, 1500)]), lane(1)]), choices([{ laneId: 'channel-1', name: 'One', instrument: 'sine' }])).includedNotes, 1);
});
test('8 parts and256notes accepted,257 notes rejected, existing exact bounds retained', () => {
    const notes = Array.from({ length: 256 }, (_, i) => note(i * 250, i * 250 + 250)), preview = source(Array.from({ length: 8 }, (_, i) => lane(i, notes)), 1000, 128000);
    const selected = { title: 'Eight', startBeat: 0, endBeat: 128, lanes: preview.lanes.map(l => ({ laneId: l.id, name: 'Part', instrument: 'sine' as const })) };
    const review = buildMidiReview(base(), preview, selected);
    assert.equal(review.includedNotes, 2048);
    assert.equal(new Set(review.candidate.tracks.flatMap(t => [t.id, ...t.notes.map(n => n.id)])).size, 2056);
    assert.throws(() => buildMidiReview(base(), source([lane(0, [...notes, note(64000, 64250)])], 1000, 128000), { ...selected, lanes: selected.lanes.slice(0, 1) }));
    assert.equal(buildMidiReview(base(), source([lane(0, [note(0, 250, 36), note(112000, 128000, 96)])], 1000, 128000), { ...selected, lanes: selected.lanes.slice(0, 1) }).includedNotes, 2);
    for (const n of [note(0, 249), note(0, 16001), note(0, 1000, 35), note(0, 1000, 97)])
        assert.throws(() => buildMidiReview(base(), source([lane(0, [n])], 1000, 128000), { ...selected, lanes: selected.lanes.slice(0, 1) }));
    for (const window of [{ startBeat: .1 }, { startBeat: -1 }, { endBeat: 129 }, { endBeat: 0 }])
        assert.throws(() => buildMidiReview(base(), preview, { ...selected, ...window }));
});
test('explicit text is never trimmed, truncated or interpreted; UTF16 limits apply', () => {
    const selected = { ...choices(), title: '🎵'.repeat(40), lanes: [{ laneId: 'channel-0', name: '<b>literal</b>', instrument: 'sine' as const }] };
    assert.equal(buildMidiReview(base(), source(), selected).candidate.title, selected.title);
    for (const title of [' edge', 'edge ', 'a\0', 'a\u0080', 'a\ufeff', '\ud800', 'a'.repeat(81), '🎵'.repeat(41)])
        assert.throws(() => buildMidiReview(base(), source(), { ...selected, title }));
});
test('mutated preview invariants reject including unselected lanes', () => {
    const mutate: ((p: MidiPreview) => void)[] = [p => p.noteOnCount++, p => { p.tempo = 120; }, p => { p.ppqn = 0; }, p => { p.lanes[0].notes[0].offTick = p.lastTick + 1; }, p => { p.lanes[0].channel = 1; }, p => { p.lanes[0].sourceTracks = [0, 0]; }, p => { p.lanes[0].notes.push(note(1500, 2500)); p.lanes[0].noteOnCount++; p.noteOnCount++; }, p => { p.lanes[0].issues.push({ code: 'percussion', message: 'Unsupported.' }); }, p => { p.lanes[0].volume = 128; }, p => { p.ignoredMeta.push({ type: 33, count: 1, bytes: 1 }); }];
    for (const action of mutate) {
        const p = source();
        action(p);
        assert.throws(() => buildMidiReview(base(), p, choices()));
    }
});
test('private exact object receipt rejects clone, forged, extra and coordinated mutation', () => {
    const review = buildMidiReview(base(), source(), choices());
    for (const forged of [structuredClone(review), { ...review }])
        assert.throws(() => applyMidiImport(base(), forged), /review/i);
    const changed = buildMidiReview(base(), source(), choices());
    changed.choices.title = 'Other';
    changed.candidate.title = 'Other';
    assert.throws(() => applyMidiImport(base(), changed), /review/i);
    const extra = buildMidiReview(base(), source(), choices());
    Object.assign(extra, { added: 'reject' });
    assert.throws(() => applyMidiImport(base(), extra), /review/i);
});
test('stale current base and oversized/cyclic public mutation reject before stringify', () => {
    const review = buildMidiReview(base(), source(), choices());
    assert.throws(() => applyMidiImport({ ...base(), tempo: 121 }, review), /review/i);
    const excessive = buildMidiReview(base(), source(), choices());
    excessive.warnings = Array(65).fill('x');
    const cycle = buildMidiReview(base(), source(), choices());
    Object.assign(cycle.candidate, { cycle });
    const serializer = mock.method(JSON, 'stringify', () => { throw new Error('serialized first'); });
    try {
        for (const bad of [excessive, cycle])
            assert.throws(() => applyMidiImport(base(), bad), e => e instanceof Error && e.message !== 'serialized first');
    }
    finally {
        serializer.mock.restore();
    }
});
test('Apply returns detached private candidate, never reallocates IDs', () => {
    const review = buildMidiReview(base(), source(), choices());
    const uuid = mock.method(crypto, 'randomUUID', () => { throw new Error('unexpected UUID'); });
    try {
        const first = applyMidiImport(base(), review);
        first.tracks[0].notes[0].pitch = 80;
        assert.equal(applyMidiImport(base(), review).tracks[0].notes[0].pitch, 60);
        assert.equal(review.candidate.tracks[0].notes[0].pitch, 60);
    }
    finally {
        uuid.mock.restore();
    }
});
test('UUID collisions against existing base fail after32 attempts', () => {
    let calls = 0;
    const uuid = mock.method(crypto, 'randomUUID', () => { calls++; return 'base-track'; });
    try {
        assert.throws(() => buildMidiReview(base(), source(), choices()), /ID|identif/i);
        assert.equal(calls, 32);
    }
    finally {
        uuid.mock.restore();
    }
});
test('receipt rejects public text mutations even when model trimming would erase the difference', () => {
    for (const field of ['base', 'candidate'] as const) {
        const review = buildMidiReview(base(), source(), choices());
        review[field].title += ' ';
        assert.throws(() => applyMidiImport(base(), review), /review/i);
    }
});
test('default state and selected silent CC7 are explicit without erasing note velocities', () => {
    const part = lane();
    part.program = 0;
    part.programExplicit = false;
    part.volume = 0;
    const preview = source([part]);
    preview.tempoMicros = 500000;
    preview.tempo = 120;
    preview.tempoExplicit = false;
    preview.ignoredMeta = [{ type: 1, count: 1, bytes: 12 }];
    preview.ignoredReleaseVelocityCount = 1;
    const review = buildMidiReview(base(), preview, choices());
    assert.equal(review.candidate.tracks[0].volume, 0);
    assert.equal(review.candidate.tracks[0].notes[0].velocity, 64 / 127);
    for (const category of [/defaults/i, /silent/i, /metadata/i, /release/i]) {
        assert(review.warnings.some(text => category.test(text)));
    }
    assert(review.warnings.length <= 64 && review.warnings.every(text => text.length <= 512));
});
test('unsupported attack counts remain visible and cannot be imported; selected lanes must exist', () => {
    const unsupported = lane(9, []);
    unsupported.noteOnCount = 50;
    unsupported.issues = [{ code: 'percussion', message: 'Percussion is unsupported.' }];
    const preview = source([lane(), unsupported]);
    const review = buildMidiReview(base(), preview, choices());
    assert.equal(review.sourceNoteOnCount, 51);
    assert.equal(review.excludedNoteOnCount, 50);
    assert.throws(() => buildMidiReview(base(), preview, choices([{ laneId: 'channel-9', name: 'Drums', instrument: 'sine' }])));
    assert.throws(() => buildMidiReview(base(), preview, choices([{ laneId: 'channel-1', name: 'Absent', instrument: 'sine' }])));
    assert.throws(() => buildMidiReview(base(), preview, choices([choices().lanes[0], choices().lanes[0]])));
});
test('unsupported destination pitches outside the selected window are excluded, never altered', () => {
    const preview = source([lane(0, [note(0, 997, 0), note(997, 1994, 60)])]);
    const review = buildMidiReview(base(), preview, choices());
    assert.equal(review.includedNotes, 1);
    assert.equal(review.excludedNoteOnCount, 1);
    assert.equal(review.candidate.tracks[0].notes[0].pitch, 60);
});
test('receipt accessor and sparse mutations are rejected without getters or serialization', () => {
    const accessor = buildMidiReview(base(), source(), choices());
    let reads = 0;
    Object.defineProperty(accessor.candidate, 'title', { enumerable: true, get() { reads++; return 'Chosen'; } });
    assert.throws(() => applyMidiImport(base(), accessor));
    assert.equal(reads, 0);
    const sparse = buildMidiReview(base(), source(), choices());
    delete sparse.candidate.tracks[0].notes[0];
    assert.throws(() => applyMidiImport(base(), sparse));
});
test('UUID collision retries also avoid already assigned candidate IDs', () => {
    const answers = ['base-note', 'note-new', 'note-new', 'track-new'];
    const uuid = mock.method(crypto, 'randomUUID', () => answers.shift()!);
    try {
        const review = buildMidiReview(base(), source(), choices());
        assert.equal(review.candidate.tracks[0].notes[0].id, 'note-new');
        assert.equal(review.candidate.tracks[0].id, 'track-new');
        assert.equal(uuid.mock.callCount(), 4);
    }
    finally {
        uuid.mock.restore();
    }
});
test('ninth selected lane and end-boundary crossings fail; fractional EOT may round the window up', () => {
    const parts = Array.from({ length: 9 }, (_, channel) => lane(channel));
    const mapping = parts.map(part => ({ laneId: part.id, name: 'Part', instrument: 'sine' as const }));
    assert.throws(() => buildMidiReview(base(), source(parts), choices(mapping)));
    assert.throws(() => buildMidiReview(base(), source([lane(0, [note(7000, 8973)])], 997, 9970), choices()), /boundary|window/i);
    const fractional = buildMidiReview(base(), source([lane(0, [note(0, 600)])], 997, 600), { ...choices(), startBeat: 0, endBeat: 1 });
    assert.equal(fractional.candidate.tracks[0].notes[0].duration, 600 / 997);
});
