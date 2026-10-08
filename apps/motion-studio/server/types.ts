import type { Project } from '../src/model.ts';

export const MAX_PUBLICATIONS = 8;
export const MAX_PROJECT_BYTES = 6_291_624;
export const MAX_INDEX_BYTES = 8192;
export const MAX_PNG_CHUNKS = 4096;
export const ADMISSION_TIMEOUT_MS = 30_000;
export const ADMISSION_WORKERS = 1;
export const MAX_CONNECTIONS = 16;
export const LISTEN_BACKLOG = 16;
export const TLS_HANDSHAKE_MS = 5000;
export const HEADER_TIMEOUT_MS = 10_000;
export const MAX_HEADER_BYTES = 16_384;
export const MAX_HEADER_FIELDS = 64;
export const SOCKET_IDLE_MS = 5000;
export const BODY_TIMEOUT_MS = 15_000;
export const RESPONSE_TIMEOUT_MS = 30_000;
export const CONNECTION_TIMEOUT_MS = 75_000;
export const SHUTDOWN_TIMEOUT_MS = 5000;

export type MotionErrorCode = 'invalid' | 'busy' | 'cancelled' | 'timeout' | 'storage' | 'unavailable' | 'forbidden' | 'not-found' | 'capacity' | 'durability';
export class MotionError extends Error {
  readonly code: MotionErrorCode;
  constructor(code: MotionErrorCode, message: string) {
    super(message);
    this.name = 'MotionError';
    this.code = code;
  }
}
export type AdmittedProject = { project: Project; json: Uint8Array; sha256: string };
export type Publication = { id: string; createdAt: string; projectSha256: string; projectBytes: number; readHash: string; revokeHash: string };
export type PublicationIndex = { schemaVersion: 1; revision: number; publications: Publication[] };
export type PublishResult = { id: string; createdAt: string; projectSha256: string; projectBytes: number; readToken: string; revokeToken: string };

export function validatePublicationIndex(value: unknown): PublicationIndex {
  function invalid(): never { throw new MotionError('invalid','The publication index is malformed or exceeds its bounds.'); }
  function object(input: unknown, fields: string[]): Record<string,unknown> {
    if (!input || typeof input !== 'object' || ![Object.prototype,null].includes(Object.getPrototypeOf(input))) invalid();
    const keys = Reflect.ownKeys(input);
    if (keys.length !== fields.length || fields.some(key=>!Object.hasOwn(input,key))) invalid();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input,key)!;
      if (typeof key !== 'string' || !fields.includes(key) || !descriptor.enumerable || !('value' in descriptor)) invalid();
    }
    return input as Record<string,unknown>;
  }
  function hash(input: unknown): string {
    if (typeof input !== 'string' || input.length !== 64 || !/^[0-9a-f]{64}$/.test(input)) invalid();
    return input as string;
  }
  const root = object(value,['schemaVersion','revision','publications']);
  if (root.schemaVersion !== 1 || !Number.isSafeInteger(root.revision) || (root.revision as number) < 0) invalid();
  const array = root.publications;
  if (!Array.isArray(array) || Object.getPrototypeOf(array) !== Array.prototype || array.length > MAX_PUBLICATIONS || Reflect.ownKeys(array).length !== array.length+1) invalid();
  const publications: Publication[] = [];
  for (let index = 0; index < (array as unknown[]).length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(array,index)!;
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) invalid();
    const row = object(descriptor.value,['id','createdAt','projectSha256','projectBytes','readHash','revokeHash']);
    if (typeof row.id !== 'string' || row.id.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.id)) invalid();
    if (typeof row.createdAt !== 'string' || row.createdAt.length !== 24 || !Number.isFinite(Date.parse(row.createdAt)) || new Date(row.createdAt).toISOString() !== row.createdAt) invalid();
    if (!Number.isInteger(row.projectBytes) || (row.projectBytes as number) < 1 || (row.projectBytes as number) > MAX_PROJECT_BYTES) invalid();
    const readHash = hash(row.readHash), revokeHash = hash(row.revokeHash);
    if (readHash === revokeHash) invalid();
    publications.push({id:row.id as string,createdAt:row.createdAt as string,projectSha256:hash(row.projectSha256),projectBytes:row.projectBytes as number,readHash,revokeHash});
  }
  if (new Set(publications.map(row=>row.id)).size !== publications.length) invalid();
  const accepted: PublicationIndex = {schemaVersion:1,revision:root.revision as number,publications};
  if (new TextEncoder().encode(JSON.stringify(accepted)).byteLength > MAX_INDEX_BYTES) invalid();
  return accepted;
}
