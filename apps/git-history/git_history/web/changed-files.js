export const CHANGES_PAGE_SIZE = 100;
const utf8 = new TextEncoder(), maximumBytes = 8 * 1024 * 1024;
const modes = { '100644': 'regular', '100755': 'regular', '120000': 'symlink', '160000': 'gitlink' };
function fail() { throw new Error('The changed-file catalog is invalid or too large. Narrow the directory and discover again.'); }
function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) fail();
  return value;
}
function text(value, maximum, empty = false) {
  if (typeof value !== 'string' || (!empty && !value) || value.includes('\0') || utf8.encode(value).length > maximum) fail();
  for (const point of value) if (point.length === 1 && point.charCodeAt(0) >= 0xd800 && point.charCodeAt(0) <= 0xdfff) fail();
  return value;
}
function hash(value, width) { if (typeof value !== 'string' || !/^[a-f0-9]+$/.test(value) || /^0+$/.test(value) || value.length !== width) fail(); return value; }
function addressable(path) { return !path.startsWith('/') && !path.startsWith('\\') && !/^[a-z]:[\\/]/i.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..'); }
function endpoint(value, width) {
  if (value === null) return null;
  const source = exact(value, ['kind', 'mode', 'object_id']);
  if (typeof source.mode !== 'string' || !Object.hasOwn(modes, source.mode) || source.kind !== modes[source.mode]) fail();
  const object_id = hash(source.object_id, width); if (/^0+$/.test(object_id)) fail();
  return Object.freeze({ kind: source.kind, mode: source.mode, object_id });
}
function compareBytes(left, right) {
  const a = utf8.encode(left), b = utf8.encode(right);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  return value;
}
function serialize(value) { return JSON.stringify(sorted(value), null, 2) + '\n'; }
export function validateChangedCatalog(value) {
  const source = exact(value, ['schema_version', 'kind', 'repo_name', 'left_requested_ref', 'left_revision', 'right_requested_ref', 'right_revision', 'directory', 'entries', 'omitted_non_utf8_paths']);
  if (source.schema_version !== 1 || source.kind !== 'changed-file-catalog' || !Array.isArray(source.entries) || source.entries.length > 10000 || !Number.isSafeInteger(source.omitted_non_utf8_paths) || source.omitted_non_utf8_paths < 0 || source.omitted_non_utf8_paths + source.entries.length > 10000) fail();
  const width = source.left_revision?.length; if (![40, 64].includes(width)) fail();
  const directory = text(source.directory, 4096, true); if (directory && !addressable(directory)) fail();
  let previous = null;
  const entries = source.entries.map(item => {
    const entry = exact(item, ['path', 'change', 'left', 'right', 'addressable']), path = text(entry.path, 4096);
    if (path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) fail();
    if (previous !== null && compareBytes(previous, path) >= 0 || directory && !path.startsWith(directory + '/')) fail(); previous = path;
    const left = endpoint(entry.left, width), right = endpoint(entry.right, width);
    if (!left && !right || typeof entry.addressable !== 'boolean' || entry.addressable !== addressable(path)) fail();
    const category = !left ? 'added' : !right ? 'deleted' : left.kind !== right.kind ? 'type-changed' : left.object_id === right.object_id && left.kind === 'regular' && left.mode !== right.mode ? 'mode-changed' : 'modified';
    if (left && right && left.object_id === right.object_id && left.mode === right.mode || entry.change !== category) fail();
    return Object.freeze({ path, change: category, left, right, addressable: entry.addressable });
  });
  const catalog = { schema_version: 1, kind: 'changed-file-catalog', repo_name: text(source.repo_name, 4096), left_requested_ref: text(source.left_requested_ref, 1024), left_revision: hash(source.left_revision, width), right_requested_ref: text(source.right_requested_ref, 1024), right_revision: hash(source.right_revision, width), directory, entries: Object.freeze(entries), omitted_non_utf8_paths: source.omitted_non_utf8_paths };
  if (catalog.left_revision === catalog.right_revision && (entries.length || catalog.omitted_non_utf8_paths)) fail();
  if (utf8.encode(serialize(catalog)).length > maximumBytes) fail();
  return Object.freeze(catalog);
}
export function changedPage(catalog, query = '', category = 'all', page = 0) {
  const needle = query.toLocaleLowerCase();
  const matches = catalog.entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => (entry.path.toLocaleLowerCase().includes(needle) || entry.change.includes(needle)) && (category === 'all' || entry.change === category));
  const finalPage = Math.max(0, Math.min(Number.isSafeInteger(page) ? page : 0, Math.max(0, Math.ceil(matches.length / CHANGES_PAGE_SIZE) - 1)));
  return { rows: matches.slice(finalPage * CHANGES_PAGE_SIZE, (finalPage + 1) * CHANGES_PAGE_SIZE), total: matches.length, page: finalPage };
}
export function changedHandoff(catalog, index) {
  const row = Number.isSafeInteger(index) && index >= 0 ? catalog.entries[index] : null;
  if (!row?.addressable || [row.left, row.right].some(endpoint => endpoint && endpoint.kind !== 'regular')) return null;
  return { path: row.path, left: { revision: catalog.left_revision, requested_ref: catalog.left_requested_ref, selection: row.left ? 'whole' : 'missing' }, right: { revision: catalog.right_revision, requested_ref: catalog.right_requested_ref, selection: row.right ? 'whole' : 'missing' } };
}
export function changedJson(catalog) { return serialize(validateChangedCatalog(catalog)); }
