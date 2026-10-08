import { constants } from 'node:fs';
import { open, opendir, lstat, link, rename, type FileHandle } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { validateProject } from '../src/model.ts';
import { admitPortableProject } from './project-admission.ts';
import { parseStrictJson } from './strict-json.ts';
import { MotionError, MAX_PUBLICATIONS, MAX_PROJECT_BYTES, MAX_INDEX_BYTES,
  SHUTDOWN_TIMEOUT_MS, validatePublicationIndex, type AdmittedProject, type PublishResult,
  type PublicationIndex, type Publication } from './types.ts';
import { LibraryFiles, readBounded, regular, stable, sameInode } from './store-files.ts';

export type PublicPublication = { id: string; createdAt: string; projectSha256: string; projectBytes: number };
export type SnapshotRead = { publication: PublicPublication; file: FileHandle };
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const idPattern = new RegExp(`^${ID}$`);
const payloadPattern = new RegExp(`^(${ID})\\.motion\\.json$`);
const payloadTemp = new RegExp(`^\\.(${ID})\\.motion\\.tmp$`);
const indexTemp = new RegExp(`^\\.index\\.(${ID})\\.tmp$`);
const hash = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const publicEntry = (p: Publication): PublicPublication => ({ id: p.id, createdAt: p.createdAt,
  projectSha256: p.projectSha256, projectBytes: p.projectBytes });
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw new MotionError('cancelled', 'The publication operation was cancelled.');
}
function matches(token: unknown, digest: string): boolean {
  return typeof token === 'string' && /^[0-9a-f]{64}$/.test(token)
    && timingSafeEqual(Buffer.from(hash(token), 'hex'), Buffer.from(digest, 'hex'));
}

export class SnapshotStore {
  private files: LibraryFiles;
  private index: PublicationIndex = { schemaVersion: 1, revision: 0, publications: [] };
  private indexInfo: BigIntStats | null = null;
  private entries = new Map<string, { info: BigIntStats; title: string }>();
  private pending: Promise<unknown> | null = null;
  private closing = false;
  private closed = false;
  private protected = false;
  private constructor(files: LibraryFiles) { this.files = files; }

  static async open(path: string): Promise<SnapshotStore> {
    let files: LibraryFiles | undefined;
    try {
      files = await LibraryFiles.open(path);
      const store = new SnapshotStore(files);
      await store.initialize();
      return store;
    } catch (error) {
      await files?.close();
      if (error instanceof MotionError) throw error;
      throw new MotionError('storage', 'The publication library could not be admitted. Its files were preserved.');
    }
  }
  private available(): void {
    if (this.closed || this.closing || this.protected) {
      throw new MotionError('unavailable', 'The publication library is closing or requires an operator restart/inspection.');
    }
  }
  private async initializedFile(name: string): Promise<{ bytes: Buffer; info: BigIntStats; title: string }> {
    const file = await open(this.files.child(name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const { bytes, info } = await readBounded(file, MAX_PROJECT_BYTES);
      const admitted = await admitPortableProject(bytes);
      if (!Buffer.from(admitted.json).equals(bytes)) throw new MotionError('storage', 'A retained publication is not canonical.');
      return { bytes, info, title: admitted.project.title };
    } finally { await file.close(); }
  }
  private async initialize(): Promise<void> {
    const names: string[] = [];
    const directory = await opendir(this.files.child('.'));
    for await (const entry of directory) {
      if (names.length >= 32 || !entry.isFile() || !(entry.name === '.server.lock' || entry.name === 'index.json'
          || payloadPattern.test(entry.name) || payloadTemp.test(entry.name) || indexTemp.test(entry.name))) {
        throw new MotionError('storage', 'The publication directory contains unknown or unsupported files.');
      }
      const info = await lstat(this.files.child(entry.name), { bigint: true });
      if (!regular(info)) throw new MotionError('storage', 'Publication children must be owned regular mode-0600 files.');
      names.push(entry.name);
    }
    if (names.includes('index.json')) {
      const file = await open(this.files.child('index.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const { bytes, info } = await readBounded(file, MAX_INDEX_BYTES);
        this.index = validatePublicationIndex(parseStrictJson(bytes, MAX_INDEX_BYTES));
        this.indexInfo = info;
      } finally { await file.close(); }
    } else if (names.some(name => payloadPattern.test(name))) {
      throw new MotionError('storage', 'An absent index cannot adopt existing publication files.');
    }
    for (const publication of this.index.publications) {
      const admitted = await this.initializedFile(`${publication.id}.motion.json`);
      if (admitted.bytes.byteLength !== publication.projectBytes || hash(admitted.bytes) !== publication.projectSha256) {
        throw new MotionError('storage', 'A retained publication does not match its index.');
      }
      this.entries.set(publication.id, { info: admitted.info, title: admitted.title });
    }
    const debris: Array<{ name: string; info: BigIntStats }> = [];
    for (const name of names) {
      if (payloadPattern.test(name) && this.index.publications.some(p => `${p.id}.motion.json` === name)) continue;
      if (payloadPattern.test(name) || payloadTemp.test(name)) {
        debris.push({ name, info: (await this.initializedFile(name)).info });
      } else if (indexTemp.test(name)) {
        const file = await open(this.files.child(name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const read = await readBounded(file, MAX_INDEX_BYTES);
          validatePublicationIndex(parseStrictJson(read.bytes, MAX_INDEX_BYTES));
          debris.push({ name, info: read.info });
        } finally { await file.close(); }
      }
    }
    await this.files.check();
    await this.checkIndex();
    for (const child of debris) await this.files.remove(child.name, child.info);
    if (debris.length) await this.files.root.sync();
  }
  private async checkIndex(): Promise<void> {
    try {
      const current = await lstat(this.files.child('index.json'), { bigint: true });
      if (!this.indexInfo || !regular(current) || !stable(current, this.indexInfo)) {
        throw new MotionError('storage', 'The publication index was replaced or changed.');
      }
    } catch (error) { if (!missing(error) || this.indexInfo !== null) throw error; }
  }
  private async writeIndex(next: PublicationIndex, signal?: AbortSignal): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(validatePublicationIndex(next)), 'utf8');
    if (bytes.byteLength > MAX_INDEX_BYTES) throw new MotionError('capacity', 'The publication index exceeds its byte bound.');
    const name = `.index.${randomUUID()}.tmp`;
    const file = await open(this.files.child(name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const identity = await file.stat({ bigint: true });
    let committed = false;
    try {
      await file.writeFile(bytes); checkSignal(signal);
      await file.sync(); checkSignal(signal);
      await this.files.check(); await this.checkIndex(); checkSignal(signal);
      await rename(this.files.child(name), this.files.child('index.json'));
      committed = true;
      this.index = next;
      try {
        this.indexInfo = await lstat(this.files.child('index.json'), { bigint: true });
        if (!sameInode(this.indexInfo, identity)) throw new Error('Index identity changed.');
        await this.files.root.sync();
      } catch {
        this.protected = true;
        throw new MotionError('durability', 'The index changed, but durability could not be confirmed. Inspect the library; do not retry automatically.');
      }
    } finally {
      await file.close();
      if (!committed) await this.files.remove(name, identity);
    }
  }
  private writer<T>(signal: AbortSignal | undefined, action: () => Promise<T>): Promise<T> {
    try { this.available(); checkSignal(signal); } catch (error) { return Promise.reject(error); }
    if (this.pending) return Promise.reject(new MotionError('busy', 'Another publication change is active. Retry explicitly later.'));
    const operation = (async () => {
      try { await this.files.check(); await this.checkIndex(); checkSignal(signal); return await action(); }
      catch (error) {
        if (error instanceof MotionError) throw error;
        throw new MotionError('storage', 'The publication operation could not finish. Inspect the library before retrying.');
      }
    })();
    const owned = operation.finally(() => { if (this.pending === owned) this.pending = null; });
    this.pending = owned;
    return owned;
  }
  async publish(admitted: AdmittedProject, options: { signal?: AbortSignal } = {}): Promise<PublishResult> {
    // Detach and admit cheap canonical/hash fields before the first filesystem await.
    let captured: Buffer, title: string;
    try {
      if (!(admitted?.json instanceof Uint8Array) || !admitted.json.byteLength || admitted.json.byteLength > MAX_PROJECT_BYTES) throw new Error();
      captured = Buffer.from(admitted.json);
      const project = validateProject(parseStrictJson(captured, MAX_PROJECT_BYTES));
      if (project.schemaVersion !== 2 || !Buffer.from(JSON.stringify(project)).equals(captured)
          || hash(captured) !== admitted.sha256 || JSON.stringify(validateProject(admitted.project)) !== captured.toString('utf8')) throw new Error();
      title = project.title;
    } catch { throw new MotionError('invalid', 'Publish one admitted complete canonical project.'); }
    return this.writer(options.signal, async () => {
      if (this.index.publications.length >= MAX_PUBLICATIONS || this.index.revision >= Number.MAX_SAFE_INTEGER) {
        throw new MotionError('capacity', 'The publication library is full or its revision cannot advance.');
      }
      let id: string | undefined;
      for (let attempt = 0; attempt < 32; attempt++) {
        const candidate = randomUUID();
        if (this.index.publications.some(p => p.id === candidate)) continue;
        try { await lstat(this.files.child(`${candidate}.motion.json`), { bigint: true }); }
        catch (error) { if (missing(error)) { id = candidate; break; } throw error; }
      }
      if (!id) throw new MotionError('storage', 'A fresh publication identity could not be allocated.');
      const readToken = randomBytes(32).toString('hex');
      let revokeToken = randomBytes(32).toString('hex');
      for (let i = 0; revokeToken === readToken && i < 32; i++) revokeToken = randomBytes(32).toString('hex');
      if (readToken === revokeToken) throw new MotionError('storage', 'Independent publication authority could not be allocated.');
      const publication: Publication = { id, createdAt: new Date().toISOString(), projectSha256: hash(captured),
        projectBytes: captured.byteLength, readHash: hash(readToken), revokeHash: hash(revokeToken) };
      const temp = `.${randomUUID()}.motion.tmp`, target = `${id}.motion.json`;
      const file = await open(this.files.child(temp), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const identity = await file.stat({ bigint: true });
      let linked = false;
      try {
        await file.writeFile(captured); checkSignal(options.signal);
        await file.sync(); checkSignal(options.signal);
        await this.files.check(); checkSignal(options.signal);
        await link(this.files.child(temp), this.files.child(target)); linked = true;
        await this.files.remove(temp, identity);
        await this.files.root.sync(); checkSignal(options.signal);
        const info = await lstat(this.files.child(target), { bigint: true });
        if (!sameInode(info, identity) || !regular(info)) throw new MotionError('storage', 'The publication payload was replaced.');
        this.entries.set(id, { info, title });
        await this.writeIndex({ schemaVersion: 1, revision: this.index.revision + 1, publications: [...this.index.publications, publication] }, options.signal);
        return { ...publicEntry(publication), readToken, revokeToken };
      } finally {
        await file.close();
        await this.files.remove(temp, identity);
        if (!this.index.publications.some(p => p.id === id)) {
          this.entries.delete(id);
          if (linked) await this.files.remove(target, identity);
          await this.files.root.sync();
        }
      }
    });
  }
  async read(id: string, readToken: string): Promise<SnapshotRead> {
    this.available();
    const publication = this.index.publications.find(p => p.id === id);
    if (typeof id !== 'string' || !idPattern.test(id) || !publication || !matches(readToken, publication.readHash)) {
      throw new MotionError('not-found', 'The private snapshot is unavailable.');
    }
    await this.files.check(); await this.checkIndex();
    const expected = this.entries.get(id);
    const file = await open(this.files.child(`${id}.motion.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const current = await file.stat({ bigint: true });
      if (!expected || !regular(current) || !stable(current, expected.info)) {
        throw new MotionError('storage', 'A retained publication changed. Stop and inspect the library.');
      }
      if (!this.index.publications.some(p => p.id === id && p.readHash === publication.readHash)) {
        throw new MotionError('not-found', 'The private snapshot is unavailable.');
      }
      return { publication: publicEntry(publication), file };
    } catch (error) { await file.close(); throw error; }
  }
  async revoke(id: string, revokeToken: string, options: { signal?: AbortSignal } = {}): Promise<void> {
    return this.remove(id, revokeToken, false, options.signal);
  }
  async revokeId(id: string, options: { signal?: AbortSignal } = {}): Promise<void> { return this.remove(id, undefined, true, options.signal); }
  private async remove(id: string, token: string | undefined, operator: boolean, signal?: AbortSignal): Promise<void> {
    return this.writer(signal, async () => {
      const publication = this.index.publications.find(p => p.id === id);
      if (typeof id !== 'string' || !idPattern.test(id) || !publication || !operator && !matches(token, publication.revokeHash)) {
        throw new MotionError('not-found', 'The private snapshot is unavailable.');
      }
      if (this.index.revision >= Number.MAX_SAFE_INTEGER) throw new MotionError('capacity', 'The publication revision cannot advance.');
      const identity = this.entries.get(id)!.info;
      await this.writeIndex({ schemaVersion: 1, revision: this.index.revision + 1, publications: this.index.publications.filter(p => p.id !== id) }, signal);
      this.entries.delete(id);
      try { await this.files.remove(`${id}.motion.json`, identity); await this.files.root.sync(); }
      catch { throw new MotionError('durability', 'Revocation is committed; removed bytes could not be confirmed. Inspect the library.'); }
    });
  }
  async inspect(): Promise<Array<PublicPublication & { title: string }>> {
    this.available(); await this.files.check(); await this.checkIndex();
    return this.index.publications.map(p => ({ ...publicEntry(p), title: this.entries.get(p.id)!.title }));
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closing = true;
    if (this.pending) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([this.pending.catch(() => {}), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new MotionError('timeout', 'A publication write has not stopped; the library remains locked.')), SHUTDOWN_TIMEOUT_MS);
        })]);
      } finally { clearTimeout(timer); }
    }
    await this.files.close(); this.closed = true;
  }
}
