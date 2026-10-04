import { constants } from 'node:fs';
import { access, mkdir, open, lstat, unlink, type FileHandle } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { MotionError } from './types.ts';

export const FLOCK = '/usr/bin/flock';
export const sameInode = (a: BigIntStats, b: BigIntStats): boolean => a.dev === b.dev && a.ino === b.ino;
export function regular(info: BigIntStats): boolean {
  return info.isFile() && info.uid === BigInt(process.geteuid!()) && (Number(info.mode) & 0o7777) === 0o600;
}
export function stable(a: BigIntStats, b: BigIntStats): boolean {
  return sameInode(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
export async function flock(args: string[], fd?: number): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(FLOCK, args, { stdio: fd === undefined ? ['ignore', 'ignore', 'ignore'] : ['ignore', 'ignore', 'ignore', fd] });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 2000);
    child.once('error', () => { clearTimeout(timer); reject(new MotionError('unavailable', 'Linux flock is unavailable.')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new MotionError('timeout', 'Library lock admission timed out.'));
      else if (code !== 0) reject(new MotionError('busy', 'The publication library is already in use.'));
      else resolvePromise();
    });
  });
}

export class LibraryFiles {
  path: string;
  root: FileHandle;
  lock: FileHandle;
  rootInfo: BigIntStats;
  lockInfo: BigIntStats;
  constructor(path: string, root: FileHandle, lock: FileHandle, rootInfo: BigIntStats, lockInfo: BigIntStats) {
    this.path = path; this.root = root; this.lock = lock; this.rootInfo = rootInfo; this.lockInfo = lockInfo;
  }
  static async open(path: string): Promise<LibraryFiles> {
    if (process.platform !== 'linux' || typeof process.geteuid !== 'function') {
      throw new MotionError('unavailable', 'Private snapshot storage requires Linux and procfs/flock.');
    }
    await access('/proc/self/fd', constants.R_OK);
    await access(FLOCK, constants.X_OK);
    await flock(['--version']);
    const location = resolve(path);
    await mkdir(location, { recursive: true, mode: 0o700 });
    let root: FileHandle | undefined, lock: FileHandle | undefined;
    try {
      root = await open(location, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const rootInfo = await root.stat({ bigint: true });
      if (!rootInfo.isDirectory() || rootInfo.uid !== BigInt(process.geteuid()) || (Number(rootInfo.mode) & 0o7777) !== 0o700) {
        throw new MotionError('storage', 'The publication directory must be owned with mode 0700.');
      }
      lock = await open(`/proc/self/fd/${root.fd}/.server.lock`, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
      const lockInfo = await lock.stat({ bigint: true });
      if (!regular(lockInfo)) throw new MotionError('storage', 'The lifetime lock must be an owned regular mode-0600 file.');
      await flock(['-n', '3'], lock.fd);
      const files = new LibraryFiles(location, root, lock, rootInfo, lockInfo);
      await files.check();
      return files;
    } catch (error) {
      await lock?.close(); await root?.close();
      throw error;
    }
  }
  child(name: string): string { return `/proc/self/fd/${this.root.fd}/${name}`; }
  async check(): Promise<void> {
    const directory = await lstat(this.path, { bigint: true });
    const lock = await lstat(this.child('.server.lock'), { bigint: true });
    if (!sameInode(directory, this.rootInfo) || !directory.isDirectory() || directory.uid !== this.rootInfo.uid
        || (Number(directory.mode) & 0o7777) !== 0o700 || !sameInode(lock, this.lockInfo) || !regular(lock)) {
      throw new MotionError('storage', 'The owned publication directory or lock changed. Stop and inspect it.');
    }
  }
  async close(): Promise<void> { await this.lock.close(); await this.root.close(); }
  async remove(name: string, identity: BigIntStats): Promise<void> {
    try {
      const current = await lstat(this.child(name), { bigint: true });
      if (!sameInode(current, identity) || !regular(current)) throw new MotionError('storage', 'An owned publication file was replaced.');
      await unlink(this.child(name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export async function readBounded(file: FileHandle, maximum: number): Promise<{ bytes: Buffer; info: BigIntStats }> {
  const before = await file.stat({ bigint: true });
  if (!regular(before) || before.size <= 0n || before.size > BigInt(maximum)) {
    throw new MotionError('storage', 'A publication file is invalid or exceeds its byte bound.');
  }
  const bytes = Buffer.alloc(Number(before.size) + 1);
  let count = 0;
  while (count < bytes.length) {
    const { bytesRead } = await file.read(bytes, count, bytes.length - count, count);
    if (!bytesRead) break;
    count += bytesRead;
  }
  const after = await file.stat({ bigint: true });
  if (count !== Number(before.size) || !stable(before, after)) {
    throw new MotionError('storage', 'A publication file changed or ended unexpectedly.');
  }
  return { bytes: bytes.subarray(0, count), info: after };
}
