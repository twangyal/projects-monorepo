import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { prepareTransport } from './transport.ts';
import { createService } from './http.ts';
import { SnapshotStore } from './snapshot-store.ts';
export async function main(argv = process.argv.slice(2)): Promise<void> {
    const options = new Map<string, string>();
    const allowed = new Set(['--data-dir', '--port', '--setup-token-file', '--bind', '--origin', '--tls-cert', '--tls-key', '--inspect', '--revoke-id']);
    try {
        for (let i = 0; i < argv.length; i++) {
            const key = argv[i]!;
            if (!allowed.has(key) || options.has(key))
                throw new Error();
            if (key === '--inspect')
                options.set(key, 'true');
            else {
                const value = argv[++i];
                if (!value || value.startsWith('--'))
                    throw new Error();
                options.set(key, value);
            }
        }
        const dataDir = options.get('--data-dir');
        if (!dataDir)
            throw new Error();
        const inspect = options.has('--inspect'), revoke = options.get('--revoke-id');
        if (inspect || revoke !== undefined) {
            if (inspect && revoke !== undefined || [...options.keys()].some(k => !['--data-dir', '--inspect', '--revoke-id'].includes(k)) || revoke !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(revoke))
                throw new Error();
            const store = await SnapshotStore.open(dataDir);
            try {
                if (inspect)
                    process.stdout.write(JSON.stringify(await store.inspect()) + '\n');
                else {
                    await store.revokeId(revoke!);
                    process.stdout.write('Snapshot revoked.\n');
                }
            }
            finally {
                await store.close();
            }
            return;
        }
        const portText = options.get('--port') ?? '8770';
        if (!/^(0|[1-9][0-9]{0,4})$/.test(portText))
            throw new Error();
        const setupTokenFile = options.get('--setup-token-file');
        if (!setupTokenFile)
            throw new Error();
        const config = await prepareTransport({ port: Number(portText), setupTokenFile, bind: options.get('--bind'), origin: options.get('--origin'), tlsCert: options.get('--tls-cert'), tlsKey: options.get('--tls-key') });
        const service = await createService({ config, dataDir, distDir: resolve(import.meta.dirname, '../dist') });
        process.stdout.write(`Motion Studio: ${service.origin}\n`);
        let closing = false;
        const stop = () => { if (closing)
            return; closing = true; void service.close().then(() => { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }, () => { closing = false; process.stderr.write('Shutdown is waiting for owned work; the library remains locked. Signal again to retry.\n'); }); };
        process.on('SIGTERM', stop);
        process.on('SIGINT', stop);
    }
    catch {
        process.stderr.write('Could not start or complete the Motion service operation. Check the options, TLS/setup files, available address and library permissions.\n');
        process.exitCode = 2;
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
    void main();
