import { MAX_JSON_BYTES, validateProject, type Project } from './model.ts';
import { createProjectRow, projectEntry, validateLibraryHead, validateLibraryId, validateLibraryKeys, validateProjectRow, MAX_LIBRARY_HEAD_BYTES, MAX_PROJECT_ROW_BYTES, type ProjectRow } from './library-model.ts';
import type { LibraryEntry, LibraryHead } from './library-model.ts';
import type { RawRecord } from './storage.ts';
export type { LibraryEntry, LibraryHead, ProjectRow } from './library-model.ts';
export interface LibraryReceipt { readonly kind: 'motion-library-receipt' }
export interface ProjectReceipt { readonly kind: 'motion-project-receipt' }
export interface ReplacementReceipt { readonly kind: 'motion-replacement-receipt' }
export interface DeletionReceipt { readonly kind: 'motion-deletion-receipt' }
export class SavedProjectConflict extends Error {
  constructor() { super('The saved project or library changed. Current memory was kept; reload or save a new project copy.'); this.name = 'SavedProjectConflict'; }
}
export class LibraryReadFailure extends Error {
  readonly target: 'head' | 'legacy';
  readonly raw: RawRecord;
  constructor(target: 'head' | 'legacy', raw: RawRecord) {
    super(target === 'legacy'
      ? 'The saved legacy project is invalid or unsafe and was preserved. Keep a project file; raw recovery may be available.'
      : 'The saved library header or project membership is invalid and was preserved. Keep a project file and repair or retry the library.');
    this.name = 'LibraryReadFailure'; this.target = target; this.raw = structuredClone(raw);
  }
}
export type LibraryView = { mode: 'library' | 'legacy' | 'empty'; head: LibraryHead | null; receipt: LibraryReceipt; legacy: { project: Project; receipt: ProjectReceipt } | null };
export type LoadedProject = { entry: LibraryEntry; project: Project; receipt: ProjectReceipt; libraryReceipt: LibraryReceipt };
export type LibraryCommit = { head: LibraryHead; entry: LibraryEntry | null };
const TIMEOUT_MS = 10000;
type Snapshot = { head: RawRecord; legacy: RawRecord; keys: unknown[]; row: RawRecord };
type Catalog = { head: LibraryHead | null; identity: string; legacy: RawRecord };
type Proof = { owner: ProjectLibrary; epoch: number; used: boolean; catalog: Catalog; row?: ProjectRow; identity?: string; legacy?: Project; id?: string; nextId?: string | null };
const libraryProofs = new WeakMap<LibraryReceipt, Proof>();
const projectProofs = new WeakMap<ProjectReceipt, Proof>();
const replacementProofs = new WeakMap<ReplacementReceipt, Proof>();
const deletionProofs = new WeakMap<DeletionReceipt, Proof>();
type Operation = { epoch: number; deadline: number; retired: boolean; stop?: (error: Error) => void; fail: (error: Error) => void };
const absent: RawRecord = { present: false };
function clone<T>(value: T): T { return structuredClone(value); }
function failure(message = 'Local library storage is unavailable. Keep a project file and retry.'): Error { return new Error(message); }

// A bounded exact data fingerprint is distinct from portable JSON: legal -0 is
// distinguished from +0. Exotic/non-JSON records cannot acquire write authority.
function fingerprint(raw: RawRecord, maximum: number): string {
  if (!raw.present) return 'absent';
  type Part = { text: string; bytes: number };
  const active = new Set<object>(), cache = new Map<object, Part>(), encoder = new TextEncoder();
  function scalar(text: string, jsonText = text): Part {
    const bytes = encoder.encode(jsonText).byteLength;
    if (bytes > maximum) throw failure('Saved data is too large to compare safely. It remains protected.');
    return { text, bytes };
  }
  function visit(value: unknown, depth: number): Part {
    if (depth > 512) throw failure('Saved data nesting cannot be compared safely.');
    if (value === null) return scalar('null');
    if (typeof value === 'string') { if (value.length > maximum) throw failure('Saved text is too large.'); return scalar(JSON.stringify(value)); }
    if (typeof value === 'boolean') return scalar(String(value));
    if (typeof value === 'number' && Number.isFinite(value)) return scalar(Object.is(value, -0) ? '~negative-zero' : String(value), Object.is(value, -0) ? '0' : String(value));
    if (!value || typeof value !== 'object') throw failure('Saved data is not safely comparable; it remains protected.');
    if (active.has(value)) throw failure('Cyclic saved data remains protected.');
    const known = cache.get(value); if (known) return known;
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw failure('Unsupported saved data remains protected.');
    const keys = Reflect.ownKeys(value);
    if (array && keys.length !== value.length + 1) throw failure('Sparse saved arrays remain protected.');
    active.add(value);
    const parts = [array ? '[' : '{']; let bytes = 2, count = 0;
    for (const key of keys) {
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (typeof key !== 'string' || !descriptor.enumerable || !('value' in descriptor)
          || (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) throw failure('Computed or extended saved data remains protected.');
      const prefix = (count++ ? ',' : '') + (array ? '' : JSON.stringify(key) + ':');
      const part = visit(descriptor.value, depth + 1);
      bytes += encoder.encode(prefix).byteLength + part.bytes;
      if (bytes > maximum) throw failure('Saved data is too large to compare safely. It remains protected.');
      parts.push(prefix, part.text);
    }
    parts.push(array ? ']' : '}'); const result = { text: parts.join(''), bytes };
    active.delete(value); cache.set(value, result); return result;
  }
  return 'present:' + visit(raw.value, 0).text;
}
function catalog(snapshot: Snapshot): Catalog {
  const head = snapshot.head.present ? validateLibraryHead(snapshot.head.value) : null;
  validateLibraryKeys(head, snapshot.keys);
  return { head, identity: fingerprint(snapshot.head, MAX_LIBRARY_HEAD_BYTES), legacy: snapshot.legacy };
}
function matches(left: Catalog, right: Catalog): void {
  if (left.identity !== right.identity) throw new SavedProjectConflict();
  if (!left.head && fingerprint(left.legacy, MAX_JSON_BYTES) !== fingerprint(right.legacy, MAX_JSON_BYTES)) throw new SavedProjectConflict();
}
function entry(catalog: Catalog, id: string): LibraryEntry {
  const result = catalog.head?.entries.find(item => item.id === id);
  if (!result) throw new SavedProjectConflict();
  return result;
}
function uuid(): string { return validateLibraryId(crypto.randomUUID()); }
function token<K extends string>(kind: K): Readonly<{ kind: K }> { return Object.freeze({ kind }); }

export class ProjectLibrary {
  private closed = false;
  private uncertain = false;
  private epoch = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private operations = new Set<Operation>();
  private accepted: Catalog | null = null;
  private rows = new Map<string, { row: ProjectRow; identity: string }>();
  private legacy: { project: Project; identity: string } | null = null;

  private check(operation?: Operation): void {
    if (this.closed) throw failure('The local project library is closed.');
    if (operation && operation.epoch !== this.epoch) throw failure('Storage authority changed. Reread before saving.');
    if (operation && (operation.retired || performance.now() >= operation.deadline)) {
      const error = failure('Local library operation timed out. Completion may be unconfirmed; reread before saving.');
      if (!operation.retired) operation.fail(error);
      throw error;
    }
  }
  private protect(): void { this.epoch++; this.uncertain = true; this.accepted = null; this.rows.clear(); this.legacy = null; }
  private authority(): Catalog {
    this.check();
    if (this.uncertain || !this.accepted) throw failure('Read and accept the saved library before writing; existing data is protected.');
    return this.accepted;
  }
  private proof<T extends object>(map: WeakMap<T, Proof>, receipt: T): Proof {
    this.check();
    const proof = map.get(receipt);
    if (!proof || proof.owner !== this || proof.epoch !== this.epoch || proof.used) throw new SavedProjectConflict();
    return proof;
  }
  private run<T>(mutating: boolean, work: (operation: Operation) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(failure('The local project library is closed.'));
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const operation: Operation = { epoch: this.epoch, deadline: performance.now() + TIMEOUT_MS, retired: false, fail: () => {} };
      const finish = (error?: Error, result?: T) => {
        if (settled) return;
        settled = true; clearTimeout(timer); this.operations.delete(operation);
        if (error) reject(error); else resolve(result as T);
      };
      operation.fail = (error: Error) => {
        if (settled) return;
        operation.retired = true; this.protect(); operation.stop?.(error); finish(error);
      };
      const timer = setTimeout(() => operation.fail(failure('Local library operation timed out. Completion may be unconfirmed; retry reading before saving.')), TIMEOUT_MS);
      this.operations.add(operation);
      const execute = async () => {
        try { this.check(operation); const result = await work(operation); this.check(operation); finish(undefined, result); }
        catch (error) { finish(error instanceof Error ? error : failure()); }
      };
      if (mutating) this.queue = this.queue.catch(() => {}).then(execute);
      else void execute();
    });
  }

  private transact<T>(operation: Operation, mutating: boolean, id: string | null,
                      action: (snapshot: Snapshot, transaction: IDBTransaction) => T, forceLegacy = false): Promise<T> {
    this.check(operation);
    return new Promise<T>((resolve, reject) => {
      let database: IDBDatabase | null = null, transaction: IDBTransaction | null = null, settled = false;
      let output: T, nativeComplete = false, outputReady = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true; operation.stop = undefined;
        if (error && transaction) { try { transaction.abort(); } catch { /* Already terminal: do not claim rollback. */ } }
        database?.close();
        if (error) reject(error); else resolve(output);
      };
      operation.stop = error => finish(error);
      try {
        if (!globalThis.indexedDB) throw failure();
        const request = indexedDB.open('motion-studio', 2);
        request.onupgradeneeded = () => {
          if (settled || operation.retired || this.closed) { request.transaction?.abort(); return; }
          try {
            for (const name of ['project', 'library', 'projects']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
          } catch {
            request.transaction?.abort();
            finish(failure('Could not create local library schema. Check browser quota and storage permissions; current work was kept.'));
          }
        };
        request.onblocked = () => finish(failure('Library upgrade is blocked by another Motion Studio tab. Close older tabs and retry; current memory was kept.'));
        request.onerror = () => finish(failure());
        request.onsuccess = () => {
          if (settled || operation.retired || this.closed) { request.result.close(); return; }
          database = request.result;
          database.onversionchange = () => { this.protect(); finish(failure('Library storage changed version. Reload before saving.')); };
          try {
            this.check(operation);
            transaction = database.transaction(['project', 'library', 'projects'], mutating ? 'readwrite' : 'readonly');
            const tx = transaction;
            tx.onabort = () => finish(failure('Local transaction failed or aborted. Current work was kept.'));
            tx.onerror = () => finish(failure('Local transaction failed. Keep a project file.'));
            tx.oncomplete = () => { nativeComplete = true; if (outputReady) finish(); };
            const headStore = tx.objectStore('library'), legacyStore = tx.objectStore('project'), rows = tx.objectStore('projects');
            const reads: IDBRequest[] = [headStore.getKey('current'), headStore.get('current'), rows.count(), rows.getAllKeys(undefined, 9)];
            if (id) reads.push(rows.getKey(id), rows.get(id));
            const values: unknown[] = [];
            let remaining = reads.length;
            const publish = (legacy: RawRecord) => {
              if (settled) return;
              try {
                this.check(operation);
                if (nativeComplete && mutating) throw failure('The native transaction ended before comparison and writing. Retry reading before saving.');
                const snapshot: Snapshot = { head: values[0] === undefined ? absent : { present: true, value: values[1] }, keys: values[3] as unknown[], legacy,
                  row: !id || values[4] === undefined ? absent : { present: true, value: values[5] } };
                output = action(snapshot, tx); outputReady = true;
                if (nativeComplete) finish();
              } catch (error) { finish(error instanceof Error ? error : failure()); }
            };
            reads.forEach((read, index) => {
              read.onerror = () => finish(failure());
              read.onsuccess = () => {
                if (settled) return;
                try {
                  this.check(operation);
                  values[index] = read.result;
                  if (--remaining) return;
                  if (values[0] !== undefined && !forceLegacy) { publish(absent); return; }
                  if (nativeComplete) throw failure('The native read ended before legacy admission. Saved data was preserved; retry reading.');
                  const presence = legacyStore.getKey('current'), value = legacyStore.get('current');
                  let left = 2;
                  const complete = () => {
                    if (settled) return;
                    try { if (!--left) publish(presence.result === undefined ? absent : { present: true, value: value.result }); }
                    catch { finish(failure('Legacy saved data could not be read safely. Retry without replacing it.')); }
                  };
                  presence.onerror = value.onerror = () => finish(failure());
                  presence.onsuccess = value.onsuccess = complete;
                } catch (error) { finish(error instanceof Error ? error : failure()); }
              };
            });
          } catch (error) { finish(error instanceof Error ? error : failure()); }
        };
      } catch (error) { finish(error instanceof Error ? error : failure()); }
    });
  }
  private adopt(head: LibraryHead, rows: ProjectRow[], operation: Operation): LibraryCommit {
    this.check(operation);
    this.accepted = { head: clone(head), identity: fingerprint({ present: true, value: head }, MAX_LIBRARY_HEAD_BYTES), legacy: absent };
    this.uncertain = false; this.legacy = null;
    for (const row of rows) this.rows.set(row.id, { row: clone(row), identity: fingerprint({ present: true, value: row }, MAX_PROJECT_ROW_BYTES) });
    for (const id of this.rows.keys()) if (!head.entries.some(item => item.id === id)) this.rows.delete(id);
    return { head: clone(head), entry: clone(head.entries.find(item => item.id === head.activeId) ?? null) };
  }
  async read(): Promise<LibraryView> {
    return this.run(false, operation => this.transact(operation, false, null, snapshot => {
      let current: Catalog;
      try { current = catalog(snapshot); }
      catch { throw new LibraryReadFailure('head', snapshot.head); }
      let admittedLegacy: { project: Project; identity: string } | null = null;
      if (!current.head && current.legacy.present) {
        try { admittedLegacy = { project: validateProject(current.legacy.value), identity: fingerprint(current.legacy, MAX_JSON_BYTES) }; }
        catch { throw new LibraryReadFailure('legacy', current.legacy); }
      }
      const receipt = token('motion-library-receipt');
      const proof: Proof = { owner: this, epoch: operation.epoch, used: false, catalog: current };
      libraryProofs.set(receipt, proof);
      if (current.head) return { mode: 'library', head: clone(current.head), receipt, legacy: null };
      if (!admittedLegacy) return { mode: 'empty', head: null, receipt, legacy: null };
      const projectReceipt = token('motion-project-receipt');
      projectProofs.set(projectReceipt, { ...proof, legacy: admittedLegacy.project, identity: admittedLegacy.identity });
      return { mode: 'legacy', head: null, receipt, legacy: { project: clone(admittedLegacy.project), receipt: projectReceipt } };
    }));
  }
  acceptRead(receipt: LibraryReceipt): void {
    const proof = this.proof(libraryProofs, receipt); proof.used = true;
    this.accepted = clone(proof.catalog); this.uncertain = false;
    for (const [id, accepted] of this.rows) {
      const current = proof.catalog.head?.entries.find(item => item.id === id);
      if (!current || JSON.stringify(current) !== JSON.stringify(projectEntry(accepted.row))) this.rows.delete(id);
    }
    if (proof.catalog.head || (this.legacy && fingerprint(proof.catalog.legacy, MAX_JSON_BYTES) !== this.legacy.identity)) this.legacy = null;
  }
  async readProject(id: string): Promise<LoadedProject> {
    validateLibraryId(id);
    return this.run(false, operation => this.transact(operation, false, id, snapshot => {
      const current = catalog(snapshot), metadata = entry(current, id);
      if (!snapshot.row.present) throw new SavedProjectConflict();
      const row = validateProjectRow(snapshot.row.value, metadata);
      const receipt = token('motion-project-receipt'), libraryReceipt = token('motion-library-receipt');
      const proof: Proof = { owner: this, epoch: operation.epoch, used: false, catalog: current, row, identity: fingerprint(snapshot.row, MAX_PROJECT_ROW_BYTES) };
      projectProofs.set(receipt, proof); libraryProofs.set(libraryReceipt, { owner: this, epoch: operation.epoch, used: false, catalog: current });
      return { entry: clone(metadata), project: clone(row.project), receipt, libraryReceipt };
    }));
  }
  acceptProject(receipt: ProjectReceipt): void {
    const proof = this.proof(projectProofs, receipt);
    matches(this.authority(), proof.catalog);
    if (proof.row) {
      if (proof.catalog.head?.activeId !== proof.row.id) throw new SavedProjectConflict();
      this.rows.set(proof.row.id, { row: clone(proof.row), identity: proof.identity! });
    } else if (proof.legacy && !proof.catalog.head) this.legacy = { project: clone(proof.legacy), identity: proof.identity! };
    else throw new SavedProjectConflict();
    proof.used = true;
  }
  async activate(receipt: ProjectReceipt): Promise<LibraryCommit> {
    const proof = this.proof(projectProofs, receipt);
    if (!proof.row) throw new SavedProjectConflict();
    proof.used = true;
    return this.run(true, async operation => {
      const row = proof.row!;
      const head = await this.transact(operation, true, row.id, (snapshot, tx) => {
        const current = catalog(snapshot); matches(proof.catalog, current);
        if (fingerprint(snapshot.row, MAX_PROJECT_ROW_BYTES) !== proof.identity) throw new SavedProjectConflict();
        const head = validateLibraryHead({ ...current.head, revision: uuid(), activeId: row.id });
        this.check(operation); tx.objectStore('library').put(head, 'current'); return head;
      });
      return this.adopt(head, [row], operation);
    });
  }
  async save(id: string, project: Project): Promise<LibraryCommit> {
    validateLibraryId(id); const candidate = validateProject(project);
    return this.run(true, async operation => {
      this.authority(); const expected = this.rows.get(id); if (!expected) throw new SavedProjectConflict();
      const row = createProjectRow(candidate, id, uuid());
      const head = await this.transact(operation, true, id, (snapshot, tx) => {
        const current = catalog(snapshot); entry(current, id);
        if (fingerprint(snapshot.row, MAX_PROJECT_ROW_BYTES) !== expected.identity) throw new SavedProjectConflict();
        const head = validateLibraryHead({ ...current.head, revision: uuid(), entries: current.head!.entries.map(item => item.id === id ? projectEntry(row) : item) });
        this.check(operation); tx.objectStore('projects').put(row, id); tx.objectStore('library').put(head, 'current'); return head;
      });
      this.adopt(head, [row], operation); return { head: clone(head), entry: projectEntry(row) };
    });
  }
  private async createCandidate(candidate: Project, promote: boolean, duplicateId?: string): Promise<LibraryCommit> {
    return this.run(true, async operation => {
      const expected = clone(this.authority());
      let source = candidate;
      if (duplicateId) {
        const accepted = this.rows.get(duplicateId);
        if (!accepted || !expected.head?.entries.some(item => item.id === duplicateId)) throw new SavedProjectConflict();
        source = accepted.row.project;
      }
      if (!expected.head && expected.legacy.present && !this.legacy) throw failure('Admit the preserved legacy project and its images before writing.');
      if (promote && (expected.head || !this.legacy)) throw new SavedProjectConflict();
      const added: ProjectRow[] = [];
      if (!expected.head && this.legacy && !promote) added.push(createProjectRow(this.legacy.project, uuid(), uuid()));
      const newRow = createProjectRow(source, uuid(), uuid()); added.push(newRow);
      if ((expected.head?.entries.length ?? 0) + added.length > 8) throw failure('The library is full. Export or explicitly delete a project before adding another.');
      const head = await this.transact(operation, true, duplicateId ?? null, (snapshot, tx) => {
        const current = catalog(snapshot); matches(expected, current);
        if (duplicateId && fingerprint(snapshot.row, MAX_PROJECT_ROW_BYTES) !== this.rows.get(duplicateId)?.identity) throw new SavedProjectConflict();
        const head = validateLibraryHead({ schemaVersion: 1, revision: uuid(), activeId: newRow.id,
          entries: [...(current.head?.entries ?? []), ...added.map(projectEntry)] });
        this.check(operation);
        for (const row of added) tx.objectStore('projects').put(row, row.id);
        this.check(operation); tx.objectStore('library').put(head, 'current'); return head;
      });
      return this.adopt(head, added, operation);
    });
  }
  async promoteLegacy(project: Project): Promise<LibraryCommit> { return this.createCandidate(validateProject(project), true); }
  async create(project: Project): Promise<LibraryCommit> { return this.createCandidate(validateProject(project), false); }
  async duplicate(id: string): Promise<LibraryCommit> { validateLibraryId(id); return this.createCandidate({} as Project, false, id); }
  async reviewDelete(id: string): Promise<{ receipt: DeletionReceipt; entry: LibraryEntry; nextId: string | null }> {
    validateLibraryId(id);
    return this.run(false, operation => this.transact(operation, false, id, snapshot => {
      const current = catalog(snapshot), metadata = entry(current, id);
      matches(this.authority(), current);
      const identity = fingerprint(snapshot.row, MAX_PROJECT_ROW_BYTES);
      if (!snapshot.row.present) throw new SavedProjectConflict();
      const remaining = current.head!.entries.filter(item => item.id !== id);
      const index = current.head!.entries.findIndex(item => item.id === id);
      const nextId = current.head!.activeId === id ? remaining[Math.min(index, remaining.length - 1)]?.id ?? null : null;
      const receipt = token('motion-deletion-receipt');
      deletionProofs.set(receipt, { owner: this, epoch: operation.epoch, used: false, catalog: current, id, identity, nextId });
      return { receipt, entry: clone(metadata), nextId };
    }));
  }
  async delete(receipt: DeletionReceipt, next: ProjectReceipt | null): Promise<LibraryCommit> {
    const proof = this.proof(deletionProofs, receipt); proof.used = true;
    const active = proof.catalog.head?.activeId === proof.id;
    let nextProof: Proof | null = null;
    if (active && proof.nextId) {
      if (!next) throw new SavedProjectConflict();
      nextProof = this.proof(projectProofs, next);
      if (!nextProof.row || nextProof.row.id !== proof.nextId) throw new SavedProjectConflict();
      matches(proof.catalog, nextProof.catalog);
      nextProof.used = true;
    } else if (next !== null) throw new SavedProjectConflict();
    return this.run(true, async operation => {
      matches(this.authority(), proof.catalog);
      const result = await this.transact(operation, true, proof.id!, (snapshot, tx) => {
        const current = catalog(snapshot); matches(proof.catalog, current);
        if (fingerprint(snapshot.row, MAX_PROJECT_ROW_BYTES) !== proof.identity) throw new SavedProjectConflict();
        const head = validateLibraryHead({ ...current.head, revision: uuid(), activeId: active ? proof.nextId : current.head!.activeId,
          entries: current.head!.entries.filter(item => item.id !== proof.id) });
        if (!nextProof) {
          this.check(operation); tx.objectStore('projects').delete(proof.id!); tx.objectStore('library').put(head, 'current');
          return head;
        }
        // Add one bounded next-row request in this same native transaction.
        const request = tx.objectStore('projects').get(nextProof.row!.id);
        request.onsuccess = () => {
          try {
            this.check(operation);
            if (fingerprint({ present: true, value: request.result }, MAX_PROJECT_ROW_BYTES) !== nextProof!.identity) throw new SavedProjectConflict();
            this.check(operation); tx.objectStore('projects').delete(proof.id!); tx.objectStore('library').put(head, 'current');
          } catch (error) { operation.stop?.(error instanceof Error ? error : failure()); }
        };
        return head;
      });
      return this.adopt(result, nextProof?.row ? [nextProof.row] : [], operation);
    });
  }
  async reviewReplacement(id: string | 'legacy'): Promise<{ receipt: ReplacementReceipt; title: string | null }> {
    if (id !== 'legacy') validateLibraryId(id);
    return this.run(false, operation => this.transact(operation, false, id === 'legacy' ? null : id, snapshot => {
      const current = catalog(snapshot);
      let raw: RawRecord, title: string | null;
      if (id === 'legacy') {
        if (current.head || !current.legacy.present) throw new SavedProjectConflict();
        raw = current.legacy; title = null;
      } else { title = entry(current, id).title; raw = snapshot.row; if (!raw.present) throw new SavedProjectConflict(); }
      const identity = fingerprint(raw, id === 'legacy' ? MAX_JSON_BYTES : MAX_PROJECT_ROW_BYTES);
      const receipt = token('motion-replacement-receipt');
      replacementProofs.set(receipt, { owner: this, epoch: operation.epoch, used: false, catalog: current, id, identity });
      return { receipt, title };
    }));
  }
  async replace(project: Project, receipt: ReplacementReceipt): Promise<LibraryCommit> {
    const candidate = validateProject(project), proof = this.proof(replacementProofs, receipt); proof.used = true;
    return this.run(true, async operation => {
      const legacy = proof.id === 'legacy', row = createProjectRow(candidate, legacy ? uuid() : proof.id!, uuid());
      const head = await this.transact(operation, true, legacy ? null : row.id, (snapshot, tx) => {
        const current = catalog(snapshot); matches(proof.catalog, current);
        if (fingerprint(legacy ? snapshot.legacy : snapshot.row, legacy ? MAX_JSON_BYTES : MAX_PROJECT_ROW_BYTES) !== proof.identity) throw new SavedProjectConflict();
        const entries = legacy ? [projectEntry(row)] : current.head!.entries.map(item => item.id === row.id ? projectEntry(row) : item);
        const head = validateLibraryHead({ schemaVersion: 1, revision: uuid(), activeId: legacy ? row.id : current.head!.activeId, entries });
        this.check(operation); tx.objectStore('projects').put(row, row.id); tx.objectStore('library').put(head, 'current'); return head;
      });
      this.adopt(head, [row], operation); return { head: clone(head), entry: projectEntry(row) };
    });
  }
  async readRaw(id: string | 'legacy' | 'head'): Promise<RawRecord> {
    if (id !== 'legacy' && id !== 'head') validateLibraryId(id);
    return this.run(false, operation => this.transact(operation, false, id === 'legacy' || id === 'head' ? null : id,
      snapshot => clone(id === 'legacy' ? snapshot.legacy : id === 'head' ? snapshot.head : snapshot.row), id === 'legacy'));
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; this.protect();
    for (const operation of [...this.operations]) operation.fail(failure('The local project library was closed. Pending work was retired.'));
  }
}
