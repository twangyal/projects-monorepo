import type { IncomingMessage, ServerResponse } from 'node:http';
import { constants } from 'node:fs';
import { open, readdir, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { matchesSetup, type TransportConfig } from './transport.ts';
import { bindNetwork, type RequestContext } from './connections.ts';
import { SnapshotStore } from './snapshot-store.ts';
import { admitPortableProject } from './project-admission.ts';
import { MAX_PROJECT_BYTES, MAX_PUBLICATIONS, SHUTDOWN_TIMEOUT_MS, MotionError, type MotionErrorCode } from './types.ts';
export type ServiceOptions = {
    config: TransportConfig;
    dataDir: string;
    distDir: string;
};
export type MotionService = {
    origin: string;
    port: number;
    close(): Promise<void>;
};
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const TOKEN = /^[0-9a-f]{64}$/;
const STATUS: Record<MotionErrorCode, number> = { invalid: 400, busy: 503, cancelled: 408, timeout: 408, storage: 503, unavailable: 503, forbidden: 403, 'not-found': 404, capacity: 409, durability: 503 };
const MESSAGES: Record<MotionErrorCode, string> = { invalid: 'The request is invalid.', busy: 'A publication is already in progress. Try again deliberately.', cancelled: 'The request was cancelled; a publication may already exist.', timeout: 'The request deadline expired; a publication may already exist.', storage: 'The library is unavailable.', unavailable: 'The service is unavailable.', forbidden: 'The request is not authorized for this origin or operation.', 'not-found': 'The private snapshot is unavailable.', capacity: 'The publication library is full.', durability: 'The operation may have committed but durability could not be confirmed. Do not retry automatically.' };
const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Connection': 'close', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" };
function fail(code: MotionErrorCode): never { throw new MotionError(code, MESSAGES[code]); }
function headers(req: IncomingMessage, origin: string, authority: string): Map<string, string[]> {
    const values = new Map<string, string[]>();
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const key = req.rawHeaders[i]!.toLowerCase();
        values.set(key, [...(values.get(key) ?? []), req.rawHeaders[i + 1]!]);
    }
    const one = (key: string) => values.get(key);
    for (const key of ['host', 'origin', 'authorization', 'content-length', 'content-type', 'sec-fetch-site', 'x-motion-setup-key'])
        if ((one(key)?.length ?? 0) > 1)
            fail('invalid');
    if (one('host')?.[0] !== authority || one('origin') && one('origin')![0] !== origin || req.method === 'POST' && !one('origin') || one('sec-fetch-site')?.[0] === 'cross-site')
        fail('forbidden');
    if ([...values.keys()].some(k => k === 'forwarded' || k.startsWith('x-forwarded-') || ['transfer-encoding', 'expect', 'upgrade'].includes(k)) || one('connection')?.some(v => v.toLowerCase().split(',').some(p => p.trim() === 'upgrade')))
        fail('invalid');
    if (!['GET', 'HEAD', 'POST'].includes(req.method ?? '') || !req.url || req.url.length > 2048 || !/^\/[A-Za-z0-9_./-]*$/.test(req.url) || req.url.includes('..') || req.url.includes('//'))
        fail('invalid');
    const length = one('content-length')?.[0];
    if (length !== undefined && (!/^(0|[1-9][0-9]{0,7})$/.test(length)))
        fail('invalid');
    if (req.method !== 'POST' && length !== undefined && length !== '0')
        fail('invalid');
    return values;
}
function bearer(values: Map<string, string[]>): string { const value = values.get('authorization')?.[0]; if (!value?.startsWith('Bearer ') || !TOKEN.test(value.slice(7)) || value.length !== 71)
    fail('not-found'); return value.slice(7); }
async function write(res: ServerResponse, ctx: RequestContext, data: Uint8Array): Promise<void> { ctx.check(); await new Promise<void>((resolve, reject) => res.write(data, error => error ? reject(error) : resolve())); ctx.check(); }
async function finish(res: ServerResponse, ctx: RequestContext): Promise<void> {
    ctx.check();
    await new Promise<void>((resolve, reject) => {
        const cleanup = () => { res.removeListener('finish', done); res.removeListener('error', failed); res.removeListener('close', closed); };
        const done = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new MotionError('cancelled', 'The response was interrupted.')); };
        const closed = () => { if (res.writableFinished) done(); else failed(); };
        res.once('finish', done); res.once('error', failed); res.once('close', closed);
        res.end();
    });
}
function start(res: ServerResponse, ctx: RequestContext, status: number, type: string, bytes: number, extra: Record<string, string> = {}): void { ctx.response(); res.writeHead(status, { ...HEADERS, 'Content-Type': type, 'Content-Length': String(bytes), ...extra }); }
async function json(req: IncomingMessage, res: ServerResponse, ctx: RequestContext, status: number, value: unknown): Promise<void> { const data = Buffer.from(JSON.stringify(value)); start(res, ctx, status, 'application/json; charset=utf-8', data.length); if (req.method !== 'HEAD')
    await write(res, ctx, data); await finish(res, ctx); }
async function fileResponse(req: IncomingMessage, res: ServerResponse, ctx: RequestContext, file: FileHandle, bytes: number, type: string, extra: Record<string, string> = {}): Promise<void> {
    start(res, ctx, 200, type, bytes, extra);
    if (req.method !== 'HEAD') {
        const buffer = Buffer.alloc(Math.min(65536, bytes));
        let position = 0;
        while (position < bytes) {
            ctx.check();
            const read = await file.read(buffer, 0, Math.min(buffer.length, bytes - position), position);
            if (!read.bytesRead)
                fail('storage');
            await write(res, ctx, buffer.subarray(0, read.bytesRead));
            position += read.bytesRead;
        }
    }
    await finish(res, ctx);
}
async function body(req: IncomingMessage, ctx: RequestContext, size: number): Promise<Uint8Array> { ctx.body(); const buffer = Buffer.alloc(size); let offset = 0; for await (const chunk of req) {
    ctx.check();
    if (offset + chunk.length > size)
        fail('invalid');
    buffer.set(chunk, offset);
    offset += chunk.length;
} ctx.check(); if (offset !== size)
    fail('invalid'); return buffer; }
export async function createService({ config, dataDir, distDir }: ServiceOptions): Promise<MotionService> {
    let store: SnapshotStore | undefined;
    let stopping = false, publishing = false;
    const operations = new Set<Promise<void>>();
    const assets = new Map<string, string>([['/', 'index.html'], ['/index.html', 'index.html'], ['/view', 'view.html'], ['/view.html', 'view.html']]);
    const network = await bindNetwork(config, (req, res, ctx) => {
        res.on('error', () => { });
        const operation = (async () => {
            try {
                if (stopping || !store)
                    fail('unavailable');
                const values = headers(req, network.origin, network.authority), path = req.url!, method = req.method!;
                if (path === '/api/status' && (method === 'GET' || method === 'HEAD')) {
                    await json(req, res, ctx, 200, { schemaVersion: 1, transport: { mode: config.mode, origin: network.origin, setupRequired: true }, maxPublications: MAX_PUBLICATIONS, maxProjectBytes: MAX_PROJECT_BYTES });
                    return;
                }
                if (path === '/api/snapshots' && method === 'POST') {
                    if (!matchesSetup(config, values.get('x-motion-setup-key')?.[0]))
                        fail('forbidden');
                    const length = values.get('content-length')?.[0];
                    if (length === undefined || Number(length) > MAX_PROJECT_BYTES || Number(length) === 0 || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(values.get('content-type')?.[0] ?? ''))
                        fail('invalid');
                    if (publishing)
                        fail('busy');
                    publishing = true;
                    try {
                        const input = await body(req, ctx, Number(length));
                        ctx.processing();
                        const admitted = await admitPortableProject(input, { signal: ctx.signal });
                        ctx.check();
                        const published = await store.publish(admitted, { signal: ctx.signal });
                        await json(req, res, ctx, 201, published);
                    }
                    finally {
                        publishing = false;
                    }
                    return;
                }
                const match = new RegExp(`^/api/snapshots/(${UUID})(/revoke)?$`).exec(path);
                if (match) {
                    if (match[2] && method === 'POST') {
                        if (values.get('content-length')?.[0] !== '0')
                            fail('invalid');
                        await store.revoke(match[1]!, bearer(values), { signal: ctx.signal });
                        await json(req, res, ctx, 200, { revoked: true });
                        return;
                    }
                    if (!match[2] && (method === 'GET' || method === 'HEAD')) {
                        const receipt = await store.read(match[1]!, bearer(values));
                        try {
                            await fileResponse(req, res, ctx, receipt.file, receipt.publication.projectBytes, 'application/json; charset=utf-8', { 'X-Project-SHA256': receipt.publication.projectSha256 });
                        }
                        finally {
                            await receipt.file.close();
                        }
                        return;
                    }
                    fail('invalid');
                }
                if ((method === 'GET' || method === 'HEAD') && assets.has(path)) {
                    let file: FileHandle;
                    try {
                        file = await open(join(distDir, assets.get(path)!), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                    }
                    catch {
                        fail('not-found');
                    }
                    try {
                        const stat = await file.stat();
                        if (!stat.isFile() || stat.size > 8 * 1024 * 1024)
                            fail('unavailable');
                        const extension = path.split('.').at(-1);
                        const type = extension === 'js' ? 'text/javascript; charset=utf-8' : extension === 'css' ? 'text/css; charset=utf-8' : extension === 'png' ? 'image/png' : extension === 'svg' ? 'image/svg+xml' : extension === 'woff2' ? 'font/woff2' : 'text/html; charset=utf-8';
                        await fileResponse(req, res, ctx, file, stat.size, type);
                    }
                    finally {
                        await file.close();
                    }
                    return;
                }
                fail('not-found');
            }
            catch (error) {
                if (res.headersSent || ctx.signal.aborted) {
                    ctx.destroy();
                    return;
                }
                const code = error instanceof MotionError ? error.code : 'unavailable';
                try {
                    await json(req, res, ctx, STATUS[code], { error: MESSAGES[code], code });
                }
                catch {
                    ctx.destroy();
                }
            }
        })();
        operations.add(operation);
        void operation.finally(() => operations.delete(operation));
    });
    try {
        try {
            const names = await readdir(join(distDir, 'assets'));
            if (names.length > 128)
                fail('unavailable');
            for (const name of names)
                if (name.length <= 128 && !name.includes('..')
                    && /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(js|css|png|svg|woff2)$/.test(name))
                    assets.set('/assets/' + name, 'assets/' + name);
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                throw error;
        }
        store = await SnapshotStore.open(dataDir);
    }
    catch (error) {
        await network.close();
        throw error;
    }
    let closed = false;
    return { origin: network.origin, port: network.port, close: async () => {
            if (closed)
                return;
            stopping = true;
            const started = performance.now();
            const wait = async (promise: Promise<unknown>) => { let timer: ReturnType<typeof setTimeout> | undefined; try {
                await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new MotionError('busy', 'Owned work is still stopping; the library lock is retained.')), Math.max(0, SHUTDOWN_TIMEOUT_MS - (performance.now() - started))); })]);
            }
            finally {
                clearTimeout(timer);
            } };
            await wait(network.close());
            await wait(Promise.all([...operations]));
            await wait(store!.close());
            closed = true;
        } };
}
