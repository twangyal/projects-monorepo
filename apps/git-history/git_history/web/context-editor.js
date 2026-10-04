/** Local literal drafting only. Python validates real Git associations on publication. */
export const MAX_CONTEXT_RECORDS = 50;
export const MAX_CONTEXT_BYTES = 256 * 1024;
const FULL_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const RECORD_FIELDS = ['commit', 'url', 'title', 'author', 'excerpt'];
function pythonWhitespace(char) {
  const code = char.codePointAt(0);
  return (code >= 9 && code <= 13) || (code >= 28 && code <= 32)
    || (code >= 0x2000 && code <= 0x200a)
    || [0x85, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000].includes(code);
}
const encoder = new TextEncoder();

export class ContextEditorError extends Error {
  constructor(message, recordIndex = null) {
    super(message);
    this.name = 'ContextEditorError';
    this.recordIndex = recordIndex;
  }
}
function fail(message, index = null) { throw new ContextEditorError(message, index); }
function object(value, label, fields, index = null) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object.`, index);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  if (names.some(name => typeof name !== 'string' || !('value' in descriptors[name]) || !descriptors[name].enumerable)
      || (fields && (names.length !== fields.length || fields.some(name => !Object.hasOwn(descriptors, name))))) {
    fail(`${label} has unsupported or missing fields.`, index);
  }
  return value;
}
function array(value, maximum, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum
      || Reflect.ownKeys(value).length !== value.length + 1) fail(`${label} must be a dense array of at most ${maximum} records.`);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor)) fail(`${label} must be a dense data array.`);
  }
  return value;
}
function fullId(value, label, index = null) {
  if (typeof value !== 'string' || !FULL_ID.test(value)) fail(`${label} must be a full lowercase 40- or 64-character commit ID.`, index);
  return value;
}
function literal(value, maximum, field, index) {
  const invalid = `Context record ${index} ${field} must contain 1–${maximum} valid Unicode characters without unsupported controls.`;
  if (typeof value !== 'string' || !value.length || value.length > maximum * 2) fail(invalid, index);
  let count = 0;
  let nonblank = false;
  for (let offset = 0; offset < value.length; offset++) {
    const code = value.charCodeAt(offset);
    if ((code < 32 && code !== 9 && code !== 10) || code === 127) fail(invalid, index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(++offset);
      if (!(low >= 0xdc00 && low <= 0xdfff)) fail(invalid, index);
      nonblank = true;
    } else {
      if (code >= 0xdc00 && code <= 0xdfff) fail(invalid, index);
      if (!pythonWhitespace(String.fromCharCode(code))) nonblank = true;
    }
    if (++count > maximum) fail(invalid, index);
  }
  if (!nonblank) fail(invalid, index);
  return value;
}
function discussionUrl(value, index) {
  const invalid = `Context record ${index} requires a credential-free HTTPS GitHub/GitLab discussion URL of at most 2,000 characters.`;
  if (typeof value !== 'string' || !value.length || value.length > 2000 || /[?%\\]/u.test(value)
      || Array.from(value).some(char => char.codePointAt(0) < 32 || char.codePointAt(0) === 127 || pythonWhitespace(char))) fail(invalid, index);
  // Inspect the supplied spelling. URL() would normalize hosts, dot segments and ports.
  const parsed = /^https:\/\/([^/#]+)(\/[^#]*)(?:#(.*))?$/i.exec(value);
  if (!parsed || !['github.com', 'gitlab.com'].includes(parsed[1])) fail(invalid, index);
  const host = parsed[1];
  const parts = parsed[2].slice(1).split('/');
  const fragment = parsed[3] ?? '';
  if (parts.some(part => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..')) fail(invalid, index);
  if (host === 'github.com') {
    const fragments = {
      pull: /^(?:issuecomment-[0-9]+|discussion_r[0-9]+|pullrequestreview-[0-9]+)$/,
      issues: /^issuecomment-[0-9]+$/,
      discussions: /^discussioncomment-[0-9]+$/,
    };
    if (parts.length !== 4 || !Object.hasOwn(fragments, parts[2]) || !/^[1-9][0-9]*$/.test(parts[3])
        || (fragment && !fragments[parts[2]].test(fragment))) fail(invalid, index);
  } else if (parts.length < 5 || parts.at(-3) !== '-' || parts.slice(0, -3).includes('-')
      || !['merge_requests', 'issues'].includes(parts.at(-2)) || !/^[1-9][0-9]*$/.test(parts.at(-1))
      || (fragment && !/^note_[0-9]+$/.test(fragment))) fail(invalid, index);
  return value;
}
function admitRecord(value, index) {
  const input = object(value, `Context record ${index}`, RECORD_FIELDS, index);
  return { commit: fullId(input.commit, `Context record ${index} commit`, index),
    url: discussionUrl(input.url, index), title: literal(input.title, 300, 'title', index),
    author: literal(input.author, 200, 'author', index), excerpt: literal(input.excerpt, 4000, 'excerpt', index) };
}
function admitDraft(value) {
  const input = object(value, 'Context draft', ['schema_version', 'revision', 'records']);
  if (input.schema_version !== 1) fail('Context draft requires schema_version 1.');
  const revision = fullId(input.revision, 'Context revision');
  const records = array(input.records, MAX_CONTEXT_RECORDS, 'Context records').map((value, index) => admitRecord(value, index + 1));
  return { schema_version: 1, revision, records };
}
function canonical(input) {
  // Match json.dumps(..., ensure_ascii=False)'s default separators, including the
  // server's reconstructed-record byte check. Uploaded formats are not parsed here.
  const parts = [];
  let bytes = 0;
  const append = value => {
    bytes += encoder.encode(value).length;
    if (bytes > MAX_CONTEXT_BYTES) fail('Context exceeds 256 KiB; supply fewer or shorter excerpts.');
    parts.push(value);
  };
  append(`{"schema_version": 1, "revision": ${JSON.stringify(input.revision)}, "records": [`);
  input.records.forEach((record, index) => {
    if (index) append(', ');
    append('{');
    RECORD_FIELDS.forEach((field, fieldIndex) => {
      if (fieldIndex) append(', ');
      append(`${JSON.stringify(field)}: ${JSON.stringify(record[field])}`);
    });
    append('}');
  });
  append(']}');
  return parts.join('');
}
export function createContextDraft(revision) {
  return validateContextDraft({ schema_version: 1, revision, records: [] });
}
export function validateContextDraft(value) {
  const admitted = admitDraft(value);
  canonical(admitted);
  return admitted;
}
export function addContextRecord(draft, record) {
  const result = validateContextDraft(draft);
  if (result.records.length === MAX_CONTEXT_RECORDS) fail('Context records must contain at most 50 excerpts.');
  result.records.push(admitRecord(record, result.records.length + 1));
  canonical(result);
  return result;
}
function rowIndex(input, index) {
  if (!Number.isInteger(index) || index < 0 || index >= input.records.length) fail('Select an existing context record.');
}
export function updateContextRecord(draft, index, record) {
  const result = validateContextDraft(draft);
  rowIndex(result, index);
  result.records[index] = admitRecord(record, index + 1);
  canonical(result);
  return result;
}
export function removeContextRecord(draft, index) {
  const result = validateContextDraft(draft);
  rowIndex(result, index);
  result.records.splice(index, 1);
  return result;
}
export function rebindContextDraft(draft, revision) {
  const result = validateContextDraft(draft);
  result.revision = fullId(revision, 'Context revision');
  canonical(result);
  return result;
}
export function serializeContextDraft(draft) { return canonical(admitDraft(draft)); }
export function evidenceCommits(report) {
  const input = object(report, 'History report');
  if (input.schema_version !== 1) fail('Picker requires a completed history report.');
  fullId(input.revision, 'Report revision');
  const result = [];
  const seen = new Set();
  for (const [field, kind, label, maximum] of [['blame', 'blame', 'Blame evidence', 200],
    ['changes', 'change', 'Range-change evidence', 50], ['renames', 'rename', 'Rename evidence', 50]]) {
    for (const entry of array(input[field], maximum, 'Displayed evidence')) {
      const data = object(entry, 'Displayed evidence');
      const commit = fullId(data.commit, 'Displayed evidence commit');
      if (!seen.has(commit)) { seen.add(commit); result.push({ commit, kind, label }); }
    }
  }
  return result;
}
