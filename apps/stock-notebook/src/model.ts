import { LIMITS, NOTEBOOK_SCHEMA_VERSION, type Dataset, type EditState, type Notebook, type ResearchNote, type Screen } from './types.ts';
import { boundedArray, dataObject, requireValue, validateDataset, validateScreen, validateText, validateToday, validateUuid } from './validation.ts';
import { parseQuery } from './query.ts';
import { screenDataset } from './research.ts';
import { validateBriefs } from './brief.ts';

const encoder = new TextEncoder();
const NOTEBOOK_KEYS = ['schemaVersion', 'id', 'dataset', 'title', 'query', 'screen', 'watchlist', 'comparison', 'notes'];
function references(value: unknown, maximum: number, known: Set<string>): string[] {
  const result = boundedArray(value, maximum).map(ticker => {
    requireValue(typeof ticker === 'string' && known.has(ticker), 'Annotation ticker must exist in this dataset.');
    return ticker;
  });
  requireValue(new Set(result).size === result.length, 'Annotation tickers must be distinct.');
  return result;
}
function extract(notebook: Notebook): EditState {
  const { title, query, screen, watchlist, comparison, notes, briefs } = notebook;
  return { title, query, screen, watchlist, comparison, notes, briefs };
}
export function createNotebook(dataset: Dataset, today: string): Notebook {
  const screen: Screen = { sector: null, currency: null, filters: [], includeStale: false, sortBy: 'ticker', direction: 'asc' };
  return validateNotebook({ schemaVersion: NOTEBOOK_SCHEMA_VERSION, id: crypto.randomUUID(), dataset, title: 'Stock notebook', query: '', screen, watchlist: [], comparison: [], notes: [], briefs: [] }, today);
}
export function validateNotebook(value: unknown, today: string): Notebook {
  validateToday(today);
  requireValue(value !== null && typeof value === 'object', 'Expected a notebook data object.');
  const versionField = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
  requireValue(versionField && 'value' in versionField, 'Use an ordinary notebook schema version.');
  const version: unknown = versionField.value;
  requireValue(version === 1 || version === 2 || version === NOTEBOOK_SCHEMA_VERSION, 'Unsupported notebook schema version.');
  const fields = dataObject(value, version === NOTEBOOK_SCHEMA_VERSION ? [...NOTEBOOK_KEYS, 'briefs'] : NOTEBOOK_KEYS);
  const id = validateUuid(fields.id), dataset = validateDataset(fields.dataset, today);
  // V1 had unique-ticker semantics. Never reinterpret malformed legacy data as
  // newly valid history simply because the canonical format is more expressive.
  if (fields.schemaVersion === 1) requireValue(new Set(dataset.companies.map(row => row.ticker)).size === dataset.companies.length, 'Legacy notebook contains duplicate normalized tickers.');
  const title = validateText(fields.title, LIMITS.titleCharacters), query = validateText(fields.query, LIMITS.queryCharacters, 'query', true);
  const screen = validateScreen(fields.screen, dataset), known = new Set(dataset.companies.map(row => row.ticker));
  const watchlist = references(fields.watchlist, LIMITS.watchlist, known), comparison = references(fields.comparison, LIMITS.comparison, known);
  const seenNotes = new Set<string>();
  const notes: ResearchNote[] = [];
  for (const entry of boundedArray(fields.notes, LIMITS.notes)) {
    const note = dataObject(entry, ['ticker', 'text']);
    requireValue(typeof note.ticker === 'string' && known.has(note.ticker) && !seenNotes.has(note.ticker), 'Notes require distinct known dataset tickers.');
    seenNotes.add(note.ticker);
    const text = validateText(note.text, LIMITS.noteCharacters, 'notes', true);
    if (text) notes.push({ ticker: note.ticker, text });
  }
  notes.sort((a, b) => a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);
  parseQuery(query, dataset);
  screenDataset(dataset, screen, today);
  const legacyFields = { schemaVersion: version, id, dataset, title, query, screen, watchlist, comparison, notes };
  if (version !== NOTEBOOK_SCHEMA_VERSION) requireValue(encoder.encode(JSON.stringify(legacyFields)).length <= LIMITS.legacyNotebookBytes, 'Legacy notebook exceeds the 4 MiB backup limit.');
  const briefs = version === NOTEBOOK_SCHEMA_VERSION ? validateBriefs(fields.briefs, dataset, today) : [];
  const notebook: Notebook = { ...legacyFields, schemaVersion: NOTEBOOK_SCHEMA_VERSION, briefs };
  requireValue(encoder.encode(JSON.stringify(notebook)).length <= LIMITS.notebookBytes, 'Notebook exceeds the 6 MiB backup limit.');
  return notebook;
}
export function serializeNotebook(notebook: Notebook, today: string): string { return JSON.stringify(validateNotebook(notebook, today)); }
export function editState(notebook: Notebook): EditState {
  // Without a supplied clock, validate intrinsic data at the latest supported date;
  // date-relative publication is always validated separately by the caller.
  return extract(validateNotebook(notebook, LIMITS.maxDate));
}
export function parseNotebookJson(text: string, today: string): Notebook {
  validateToday(today);
  requireValue(typeof text === 'string' && text.length <= LIMITS.notebookBytes && encoder.encode(text).length <= LIMITS.notebookBytes, 'Notebook JSON exceeds the 6 MiB limit.');
  let cursor = 0;
  const invalid = () => new Error('Notebook must be valid bounded JSON without duplicate keys.');
  function whitespace() { while (cursor < text.length && /[\x20\t\r\n]/.test(text[cursor])) cursor++; }
  function string(): string {
    const start = cursor++;
    while (cursor < text.length) {
      if (text[cursor] === '\\') { cursor += 2; continue; }
      if (text[cursor++] === '"') {
        let value: string;
        try { value = JSON.parse(text.slice(start, cursor)) as string; } catch { throw invalid(); }
        for (const character of value) {
          const point = character.codePointAt(0)!;
          if (point === 0 || point >= 0xd800 && point <= 0xdfff) throw invalid();
        }
        return value;
      }
    }
    throw invalid();
  }
  function value(depth: number): unknown {
    if (depth > LIMITS.jsonDepth) throw invalid();
    whitespace(); const character = text[cursor];
    if (character === '"') return string();
    if (character === '{') {
      cursor++; whitespace(); const result: Record<string, unknown> = Object.create(null), keys = new Set<string>();
      if (text[cursor] === '}') { cursor++; return result; }
      while (cursor < text.length) {
        whitespace(); if (text[cursor] !== '"') throw invalid();
        const key = string(); if (keys.has(key)) throw invalid(); keys.add(key);
        whitespace(); if (text[cursor++] !== ':') throw invalid();
        result[key] = value(depth + 1); whitespace();
        const end = text[cursor++]; if (end === '}') return result; if (end !== ',') throw invalid();
      }
      throw invalid();
    }
    if (character === '[') {
      cursor++; whitespace(); const result: unknown[] = [];
      if (text[cursor] === ']') { cursor++; return result; }
      while (cursor < text.length) {
        result.push(value(depth + 1)); whitespace();
        const end = text[cursor++]; if (end === ']') return result; if (end !== ',') throw invalid();
      }
      throw invalid();
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(literal, cursor)) { cursor += literal.length; return result; }
    }
    const pattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y; pattern.lastIndex = cursor;
    const token = pattern.exec(text); if (!token) throw invalid(); cursor = pattern.lastIndex;
    const number = Number(token[0]);
    if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) throw invalid();
    return number;
  }
  const parsed = value(1); whitespace(); if (cursor !== text.length) throw invalid();
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const version = (parsed as Record<string, unknown>).schemaVersion;
    if (version === 1 || version === 2) requireValue(encoder.encode(text).length <= LIMITS.legacyNotebookBytes, 'Legacy notebook JSON exceeds the 4 MiB limit.');
  }
  return validateNotebook(parsed, today);
}
