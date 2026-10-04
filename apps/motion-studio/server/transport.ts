import { constants } from 'node:fs';
import { open, access } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createSecureContext, type SecureContext } from 'node:tls';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MotionError } from './types.ts';
export type TransportOptions = {
    port: number;
    setupTokenFile: string;
    bind?: string;
    origin?: string;
    tlsCert?: string;
    tlsKey?: string;
};
export type TransportConfig = Readonly<{
    mode: 'http-loopback' | 'https-lan';
    bind: string;
    port: number;
    origin: string;
    authority: string;
    secureContext?: SecureContext;
    setupDigest: Uint8Array;
}>;
const admitted = new WeakSet<object>();
const invalid = () => new MotionError('invalid', 'Check the canonical bind, origin, port and readable TLS/setup configuration.');
async function file(path: string, maximum: number, privateFile: boolean): Promise<Buffer> {
    const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const before = await fd.stat({ bigint: true });
        if (!before.isFile() || before.size > BigInt(maximum) || (privateFile && (before.uid !== BigInt(process.geteuid!()) || (before.mode & 4095n) !== 384n)))
            throw invalid();
        const output = Buffer.alloc(maximum + 1);
        let length = 0;
        while (length < output.length) {
            const { bytesRead } = await fd.read(output, length, output.length - length, null);
            if (!bytesRead)
                break;
            length += bytesRead;
        }
        const after = await fd.stat({ bigint: true });
        if (length > maximum || BigInt(length) !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
            throw invalid();
        return output.subarray(0, length);
    }
    finally {
        await fd.close();
    }
}
function privateIPv4(value: string): boolean { const parts = value.split('.'); if (parts.length !== 4 || parts.some(p => !/^(0|[1-9][0-9]{0,2})$/.test(p) || Number(p) > 255))
    return false; const n = parts.map(Number); return n[0] === 127 || n[0] === 10 || n[0] === 172 && n[1]! >= 16 && n[1]! <= 31 || n[0] === 192 && n[1] === 168; }
export async function prepareTransport(options: TransportOptions): Promise<TransportConfig> {
    try {
        if (process.platform !== 'linux' || typeof process.geteuid !== 'function')
            throw invalid();
        await access('/proc/self/fd');
        await promisify(execFile)('flock', ['--version'], { timeout: 3000, maxBuffer: 4096 });
        const { port } = options;
        if (!Number.isInteger(port) || port < 0 || port > 65535)
            throw invalid();
        const fields = [options.bind, options.origin, options.tlsCert, options.tlsKey];
        const secure = fields.some(v => v !== undefined);
        if (secure && (fields.some(v => typeof v !== 'string' || !v) || port === 0))
            throw invalid();
        let bind = '127.0.0.1', origin = '', authority = '';
        let secureContext: SecureContext | undefined;
        if (secure) {
            bind = options.bind!;
            origin = options.origin!;
            if (!privateIPv4(bind) || origin.length > 267 || !origin.startsWith('https://'))
                throw invalid();
            authority = origin.slice(8);
            const suffix = port === 443 ? '' : `:${port}`;
            if (suffix && !authority.endsWith(suffix))
                throw invalid();
            const host = suffix ? authority.slice(0, -suffix.length) : authority;
            if (host.length > 253 || !host || host.includes(':') || host.split('.').some(label => !/^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$/.test(label)))
                throw invalid();
            const numeric = /^(?:[0-9]+|0x[0-9a-f]*)$/.test(host.split('.').at(-1)!);
            if (numeric && host !== bind)
                throw invalid();
            if (origin !== `https://${host}${suffix}`)
                throw invalid();
            const cert = await file(options.tlsCert!, 128 * 1024, false), key = await file(options.tlsKey!, 32 * 1024, true);
            secureContext = createSecureContext({ cert, key, minVersion: 'TLSv1.2', passphrase: '' });
        }
        const setup = await file(options.setupTokenFile, 65, true);
        if (!/^[0-9a-f]{64}\n?$/.test(setup.toString('ascii')) || setup.some(b => b > 127))
            throw invalid();
        const digest = createHash('sha256').update(setup.subarray(0, 64)).digest();
        const config = Object.freeze({ mode: secure ? 'https-lan' as const : 'http-loopback' as const, bind, port, origin, authority, secureContext, setupDigest: digest });
        admitted.add(config);
        return config;
    }
    catch {
        throw invalid();
    }
}
export function validateTransport(config: TransportConfig): void { if (!admitted.has(config))
    throw invalid(); }
export function matchesSetup(config: TransportConfig, value: unknown): boolean { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) && value.length === 64 && timingSafeEqual(createHash('sha256').update(value).digest(), config.setupDigest); }

/** Browser-canonical loopback authority, including the default HTTP port. */
export function httpAuthority(port: number): string {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalid();
    return port === 80 ? '127.0.0.1' : `127.0.0.1:${port}`;
}
