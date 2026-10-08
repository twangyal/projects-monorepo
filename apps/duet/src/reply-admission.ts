import { validateSavedMixFields } from './saved-mixes.ts';
export class UnconfirmedReplyError extends TypeError {
    constructor() { super('The request result is unconfirmed. Your input is kept. Check the latest room and memories before repeating it; nothing was repeated automatically.'); this.name = 'UnconfirmedReplyError'; }
}
export async function readReply(response: Response): Promise<unknown> { try {
    return await response.json();
}
catch {
    if (response.ok)
        throw new UnconfirmedReplyError();
    return {};
} }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new UnconfirmedReplyError(); return value as Record<string, unknown>; }
function require(condition: unknown): asserts condition { if (!condition)
    throw new UnconfirmedReplyError(); }
function id(value: unknown): string { require(typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)); return value; }
function pythonWhitespace(code: number): boolean { return (code >= 9 && code <= 13) || (code >= 28 && code <= 32) || [133, 160, 5760, 8232, 8233, 8239, 8287, 12288].includes(code) || (code >= 8192 && code <= 8202); }
function text(value: unknown, max: number, empty = false): void { require(typeof value === 'string' && [...value].length <= max && !value.includes('\0') && (empty || ![...value].every(point => pythonWhitespace(point.codePointAt(0)!)))); for (const point of value)
    require(point.length !== 1 || point.charCodeAt(0) < 0xd800 || point.charCodeAt(0) > 0xdfff); }
function number(value: unknown, max = 1e15): void { require(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max); }
function revision(value: unknown): void { require(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0); }
function role(value: unknown): void { require(value === 'host' || value === 'guest'); }
export function validateRoomReply(value: unknown, expectedId: string, expectedRole?: string): void {
    try {
        const r = object(value);
        require(id(r.id) === expectedId);
        text(r.title, 80);
        number(r.createdAt);
        number(r.serverTime);
        role(r.myRole);
        require(expectedRole === undefined || r.myRole === expectedRole);
        const profiles = object(r.profiles);
        text(object(profiles.host).name, 40);
        if (profiles.guest !== null)
            text(object(profiles.guest).name, 40);
        require(r.myRole !== 'guest' || profiles.guest !== null);
        require(Array.isArray(r.tracks) && r.tracks.length <= 12);
        const tracks = new Map<string, number>();
        for (const raw of r.tracks) {
            const t = object(raw), key = id(t.id);
            require(!tracks.has(key));
            text(t.title, 80);
            text(t.artist, 80, true);
            number(t.duration, 300);
            require(Number(t.duration) >= 1);
            role(t.uploadedBy);
            require(profiles[t.uploadedBy as string] !== null);
            number(t.createdAt);
            tracks.set(key, t.duration as number);
        }
        const ratings = object(r.ratings);
        require(Object.keys(ratings).length === tracks.size);
        for (const [key, raw] of Object.entries(ratings)) {
            require(tracks.has(key));
            const votes = object(raw);
            for (const key of ['host', 'guest'])
                require([-1, 0, 1].includes(votes[key] as number));
            require(profiles.guest !== null || votes.guest === 0);
        }
        require(Array.isArray(r.playlist) && r.playlist.length <= 12 && new Set(r.playlist).size === r.playlist.length);
        for (const key of r.playlist)
            require(typeof key === 'string' && tracks.has(key));
        revision(r.playlistRevision);
        const p = object(r.playback);
        revision(p.revision);
        require(typeof p.playing === 'boolean');
        if (p.updatedAt !== undefined)
            number(p.updatedAt);
        if (p.trackId === null) {
            require(p.playing === false && p.position === 0);
        }
        else {
            require(typeof p.trackId === 'string' && tracks.has(p.trackId));
            number(p.position, tracks.get(p.trackId));
        }
        require(Array.isArray(r.memories) && r.memories.length <= 100);
        const memories = new Set<string>();
        for (const raw of r.memories) {
            const m = object(raw), key = id(m.id);
            require(!memories.has(key));
            memories.add(key);
            id(m.trackId);
            text(m.trackTitle, 80);
            text(m.text, 500);
            role(m.author);
            require(profiles[m.author as string] !== null);
            number(m.createdAt);
            require(typeof m.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.date));
            const date = new Date(`${m.date}T00:00:00Z`);
            require(Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === m.date && m.date >= '1900-01-01' && m.date <= '2100-12-31');
        }
        require(Array.isArray(r.blend) && r.blend.length <= 12);
        const blended = new Set<string>();
        for (const raw of r.blend) {
            const b = object(raw), key = id(b.trackId);
            require(tracks.has(key) && !blended.has(key));
            blended.add(key);
            text(b.category, 80);
            text(b.reason, 1000);
        }
        validateSavedMixFields({ savedMixes: r.savedMixes, savedMixesRevision: r.savedMixesRevision });
        if (r.activeJob !== undefined && r.activeJob !== null) {
            const j = object(r.activeJob);
            id(j.id);
            require(j.roomId === r.id);
            id(j.trackId);
            role(j.uploadedBy);
            require(['running', 'complete', 'failed', 'cancelled'].includes(j.status as string));
            text(j.stage, 2000, true);
            if (j.error !== undefined)
                text(j.error, 2000, true);
        }
    }
    catch {
        throw new UnconfirmedReplyError();
    }
}
export function validateRoomExport(value: unknown, expectedId: string): void {
    const r = object(value);
    require(r.schemaVersion === 2);
    const keys = ['schemaVersion', 'id', 'title', 'createdAt', 'profiles', 'tracks', 'ratings', 'playlist', 'playlistRevision', 'playback', 'memories', 'blend', 'savedMixes', 'savedMixesRevision'];
    require(Object.keys(r).sort().join(',') === keys.sort().join(','));
    validateRoomReply({ ...r, myRole: 'host', serverTime: 0 }, expectedId);
    const exact = (value: unknown, keys: string[]) => {
        require(Object.keys(object(value)).sort().join(',') === keys.sort().join(','));
    };
    const profiles = object(r.profiles);
    exact(profiles, ['host', 'guest']);
    exact(profiles.host, ['name']);
    if (profiles.guest !== null) exact(profiles.guest, ['name']);
    for (const track of r.tracks as unknown[]) exact(track, ['id', 'title', 'artist', 'duration', 'uploadedBy', 'createdAt']);
    for (const votes of Object.values(object(r.ratings))) exact(votes, ['host', 'guest']);
    const playback = object(r.playback);
    exact(playback, ['trackId', 'playing', 'position', 'revision', ...(playback.updatedAt === undefined ? [] : ['updatedAt'])]);
    for (const memory of r.memories as unknown[]) exact(memory, ['id', 'trackId', 'trackTitle', 'date', 'text', 'author', 'createdAt']);
    for (const blend of r.blend as unknown[]) exact(blend, ['trackId', 'category', 'reason']);
}
