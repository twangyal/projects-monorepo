export interface SavedMixEntry { trackId: string; title: string; artist: string }
export interface SavedMix { id: string; name: string; entries: SavedMixEntry[] }
export interface SavedMixFields { savedMixes: SavedMix[]; savedMixesRevision: number }
export interface MixSnapshot extends SavedMixFields { playlist: string[]; playlistRevision: number; playback: { revision: number }; tracks: { id: string }[] }
export interface MixCommand { suffix: string; method: 'POST' | 'PUT' | 'DELETE'; body: Record<string, string | number | boolean> }
const idPattern = /^[a-f0-9]{32}$/;
function fail(): never { throw new Error('The saved mix data is invalid. Refresh the room before trying again.'); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail();
  return value as Record<string, unknown>;
}
function id(value: unknown): string { if (typeof value !== 'string' || !idPattern.test(value)) fail(); return value; }
function revision(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(); return value; }
function pythonWhitespace(code: number): boolean {
  return (code >= 9 && code <= 13) || (code >= 28 && code <= 32) || [133, 160, 5760, 8232, 8233, 8239, 8287, 12288].includes(code) || (code >= 8192 && code <= 8202);
}
function text(value: unknown, empty = false): string {
  if (typeof value !== 'string' || [...value].length > 80 || value.includes('\0') || (!empty && [...value].every(point => pythonWhitespace(point.codePointAt(0)!)))) fail();
  for (const point of value) if (point.length === 1 && point.charCodeAt(0) >= 0xd800 && point.charCodeAt(0) <= 0xdfff) fail();
  return value;
}
export function validateSavedMixFields(value: unknown): SavedMixFields {
  const fields = object(value, ['savedMixes', 'savedMixesRevision']);
  if (!Array.isArray(fields.savedMixes) || fields.savedMixes.length > 8) fail();
  const ids = new Set<string>();
  const savedMixes = fields.savedMixes.map(item => {
    const mix = object(item, ['id', 'name', 'entries']), mixId = id(mix.id);
    if (ids.has(mixId) || !Array.isArray(mix.entries) || mix.entries.length < 1 || mix.entries.length > 12) fail();
    ids.add(mixId); const tracks = new Set<string>();
    const entries = mix.entries.map(item => {
      const entry = object(item, ['trackId', 'title', 'artist']), trackId = id(entry.trackId);
      if (tracks.has(trackId)) fail(); tracks.add(trackId);
      return { trackId, title: text(entry.title), artist: text(entry.artist, true) };
    });
    return { id: mixId, name: text(mix.name), entries };
  });
  return { savedMixes, savedMixesRevision: revision(fields.savedMixesRevision) };
}
export function mixCommand(snapshot: MixSnapshot, kind: 'save' | 'update' | 'rename' | 'delete' | 'load', mixId?: string, name?: string, availableOnly = false): MixCommand {
  const fields = validateSavedMixFields({ savedMixes: snapshot.savedMixes, savedMixesRevision: snapshot.savedMixesRevision });
  const savedMixesRevision = fields.savedMixesRevision;
  if (kind === 'save') {
    if (!snapshot.playlist.length) throw new Error('Add a song to the current mix before saving it.');
    if (fields.savedMixes.length >= 8) throw new Error('Eight mixes are already saved. Delete a saved mix before adding another.');
    return { suffix: '/mixes', method: 'POST', body: { name: text(name), playlistRevision: revision(snapshot.playlistRevision), savedMixesRevision } };
  }
  const selected = fields.savedMixes.find(mix => mix.id === id(mixId));
  if (!selected) throw new Error('The selected saved mix is no longer available. Select another saved mix.');
  if (kind === 'rename') return { suffix: `/mixes/${selected.id}/name`, method: 'PUT', body: { name: text(name), savedMixesRevision } };
  if (kind === 'delete') return { suffix: `/mixes/${selected.id}`, method: 'DELETE', body: { savedMixesRevision } };
  if (kind === 'update') {
    if (!snapshot.playlist.length) throw new Error('Add a song to the current mix before updating a saved mix.');
    return { suffix: `/mixes/${selected.id}/playlist`, method: 'PUT', body: { playlistRevision: revision(snapshot.playlistRevision), savedMixesRevision } };
  }
  const available = selected.entries.filter(entry => snapshot.tracks.some(track => track.id === entry.trackId));
  if (!available.length) throw new Error('No songs in this saved mix are available. Its captured song names are kept.');
  if (available.length !== selected.entries.length && !availableOnly) throw new Error('Some songs are unavailable. Review them and choose Load available songs only.');
  return { suffix: `/mixes/${selected.id}/load`, method: 'POST', body: { savedMixesRevision, playlistRevision: revision(snapshot.playlistRevision), playbackRevision: revision(snapshot.playback.revision), availableOnly } };
}
export function playlistChange(playlist: readonly string[], expectedRevision: number, trackId: string, kind: 'add' | 'remove' | 'up' | 'down'): { trackIds: string[]; revision: number } | null {
  const trackIds = [...playlist], index = trackIds.indexOf(trackId);
  if (kind === 'add') { if (index >= 0 || trackIds.length >= 12) return null; trackIds.push(trackId); }
  else if (kind === 'remove') { if (index < 0) return null; trackIds.splice(index, 1); }
  else { const target = index + (kind === 'up' ? -1 : 1); if (index < 0 || target < 0 || target >= trackIds.length) return null; [trackIds[index], trackIds[target]] = [trackIds[target], trackIds[index]]; }
  return { trackIds, revision: revision(expectedRevision) };
}
