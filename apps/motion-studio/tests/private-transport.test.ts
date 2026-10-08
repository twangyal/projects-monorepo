import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import https from 'node:https';
import { prepareTransport } from '../server/transport.ts';
import { bindNetwork } from '../server/connections.ts';
async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), 'motion-transport-'));
    await chmod(dir, 0o700);
    const run = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'ignore', timeout: 10000 });
    for (const name of ['ca.key', 'leaf.key']) {
        await writeFile(join(dir, name), '', { mode: 0o600 });
        run('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-out', name);
    }
    run('req', '-new', '-x509', '-key', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=Motion Original Transport CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
    run('req', '-new', '-key', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=Motion Original Leaf');
    await writeFile(join(dir, 'ext'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n');
    run('x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '1', '-extfile', 'ext', '-out', 'leaf.pem');
    await writeFile(join(dir, 'setup'), '3'.repeat(64) + '\n', { mode: 0o600 });
    const listener = createServer();
    await new Promise<void>(r => listener.listen(0, '127.0.0.1', r));
    const addr = listener.address();
    assert.ok(addr && typeof addr === 'object');
    const port = addr.port;
    await new Promise<void>(r => listener.close(() => r()));
    return { dir, port, options: { port, setupTokenFile: join(dir, 'setup'), bind: '127.0.0.1', origin: `https://127.0.0.1:${port}`, tlsCert: join(dir, 'leaf.pem'), tlsKey: join(dir, 'leaf.key') }, ca: await readFile(join(dir, 'ca.pem')) };
}
test('raw accepted socket reaches strict native TLS then isolated HTTP and restarts same port', async () => {
    const f = await fixture();
    let network: Awaited<ReturnType<typeof bindNetwork>> | undefined;
    try {
        const config = await prepareTransport(f.options);
        for (let attempt = 0; attempt < 2; attempt++) {
            network = await bindNetwork(config, (_req, res) => { res.writeHead(200, { 'Content-Length': 2, 'Connection': 'close' }); res.end('ok'); });
            const result = await new Promise<string>((resolve, reject) => { https.get(network!.origin, { ca: f.ca, agent: false }, res => { let text = ''; res.on('data', c => text += c); res.on('end', () => resolve(text)); }).on('error', reject); });
            assert.equal(result, 'ok');
            await network.close();
            network = undefined;
        }
    }
    finally {
        await network?.close();
        await rm(f.dir, { recursive: true, force: true });
    }
});
test('configuration rejects aliases, symlink and public bind; setup is still required on loopback', async () => {
    const f = await fixture();
    try {
        for (const origin of [`https://0x7f.0x1:${f.port}`, `https://0x:${f.port}`, `https://127.0.0x:${f.port}`, `https://127.1:${f.port}`, `${f.options.origin}/`, `https://example.test\n:${f.port}`, `https://EXAMPLE.test:${f.port}`])
            await assert.rejects(prepareTransport({ ...f.options, origin }));
        await assert.rejects(prepareTransport({ ...f.options, bind: '8.8.8.8' }));
        await assert.rejects(prepareTransport({...f.options,bind:'127.0.0.1\n'}));
        await symlink(f.options.setupTokenFile, join(f.dir, 'linked-setup'));
        await assert.rejects(prepareTransport({port:0,setupTokenFile:join(f.dir,'linked-setup')}));
        await chmod(f.options.setupTokenFile, 0o644);
        await assert.rejects(prepareTransport({ port: 0, setupTokenFile: f.options.setupTokenFile }));
        await chmod(f.options.setupTokenFile, 0o600);
        const config = await prepareTransport({ port: 0, setupTokenFile: f.options.setupTokenFile });
        assert.equal(config.mode, 'http-loopback');
    }
    finally {
        await rm(f.dir, { recursive: true, force: true });
    }
});
test('actual service has exact authority/status, setup-only publish and isolated read/revoke roles', async () => {
    const { createService } = await import('../server/http.ts');
    const { createDemo } = await import('../src/model.ts');
    const f = await fixture();
    let service: Awaited<ReturnType<typeof createService>> | undefined;
    try {
        service = await createService({ config: await prepareTransport(f.options), dataDir: join(f.dir, 'library'), distDir: join(f.dir, 'dist') });
        const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => new Promise<{
            status: number;
            body: Record<string, unknown>;
            headers: import('node:http').IncomingHttpHeaders;
        }>((resolve, reject) => {
            const raw = body === undefined ? '' : JSON.stringify(body);
            const req = https.request(service!.origin + path, { method, ca: f.ca, agent: false, headers: { Origin: service!.origin, 'Content-Length': Buffer.byteLength(raw), 'Content-Type': 'application/json', ...extra } }, res => { let text = ''; res.on('data', c => text += c); res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(text), headers: res.headers })); });
            req.on('error', reject);
            req.end(raw);
        });
        assert.deepEqual((await call('GET', '/api/status')).body, { schemaVersion: 1, transport: { mode: 'https-lan', origin: service.origin, setupRequired: true }, maxPublications: 8, maxProjectBytes: 6291624 });
        assert.equal((await call('POST', '/api/snapshots', createDemo())).status, 403);
        const created = await call('POST', '/api/snapshots', createDemo(), { 'X-Motion-Setup-Key': '3'.repeat(64) });
        assert.equal(created.status, 201);
        const path = '/api/snapshots/' + created.body.id;
        assert.equal((await call('GET', path, undefined, { Cookie: 'read=' + created.body.readToken })).status, 404);
        assert.equal((await call('GET', path, undefined, { Authorization: 'Bearer ' + created.body.revokeToken })).status, 404);
        const read = await call('GET', path, undefined, { Authorization: 'Bearer ' + created.body.readToken });
        assert.equal(read.status, 200);
        assert.equal(read.headers['x-project-sha256'], created.body.projectSha256);
        assert.equal((await call('POST', path + '/revoke', undefined, { Authorization: 'Bearer ' + created.body.readToken })).status, 404);
        assert.deepEqual((await call('POST', path + '/revoke', undefined, { Authorization: 'Bearer ' + created.body.revokeToken })).body, { revoked: true });
        assert.equal((await call('GET', path, undefined, { Authorization: 'Bearer ' + created.body.readToken })).status, 404);
    }
    finally {
        await service?.close();
        await rm(f.dir, { recursive: true, force: true });
    }
});

test('actual five-second TLS deadline releases an undecided raw socket', async () => {
 const {connect}=await import('node:net');const f=await fixture();const network=await bindNetwork(await prepareTransport(f.options),(_req,res)=>res.end());
 try{const before=performance.now();const socket=connect(f.port,'127.0.0.1');socket.on('error',()=>{});await new Promise<void>(resolve=>socket.once('close',()=>resolve()));const elapsed=performance.now()-before;assert.ok(elapsed>=4500&&elapsed<6500,String(elapsed));}finally{await network.close();await rm(f.dir,{recursive:true,force:true});}
});
test('actual ten-second header deadline defeats continuous native TLS trickle',async()=>{
 const {connect}=await import('node:tls');const f=await fixture();const network=await bindNetwork(await prepareTransport(f.options),(_req,res)=>res.end());
 try{const socket=connect({host:'127.0.0.1',port:f.port,ca:f.ca});socket.on('error',()=>{});await new Promise<void>((resolve,reject)=>{socket.once('secureConnect',resolve);socket.once('error',reject);});const before=performance.now();socket.write('GET / HTTP/1.1\r\nX-Long: ');const tick=setInterval(()=>socket.write('x'),100);try{await new Promise<void>(resolve=>socket.once('close',()=>resolve()));}finally{clearInterval(tick);}const elapsed=performance.now()-before;assert.ok(elapsed>=9500&&elapsed<12000,String(elapsed));}finally{await network.close();await rm(f.dir,{recursive:true,force:true});}
});
test('processing owns its separate deadline and is not killed by network idle time',async()=>{
 const f=await fixture();const network=await bindNetwork(await prepareTransport(f.options),(_req,res,ctx)=>{ctx.processing();setTimeout(()=>{ctx.response();res.writeHead(200,{'Content-Length':2,'Connection':'close'});res.end('ok');},5500);});
 try{const received=await new Promise<string>((resolve,reject)=>{https.get(network.origin,{ca:f.ca,agent:false},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve(body));}).on('error',reject);});assert.equal(received,'ok');}finally{await network.close();await rm(f.dir,{recursive:true,force:true});}
});

test('shutdown refuses a held real store read before releasing the lifetime library lock',async()=>{
 const {createService}=await import('../server/http.ts');const {SnapshotStore}=await import('../server/snapshot-store.ts');const {createDemo}=await import('../src/model.ts');const {admitPortableProject}=await import('../server/project-admission.ts');
 const f=await fixture();const path=join(f.dir,'held-library');let service:Awaited<ReturnType<typeof createService>>|undefined;
 const initial=await SnapshotStore.open(path);const published=await initial.publish(await admitPortableProject(Buffer.from(JSON.stringify(createDemo()))));await initial.close();
 const original=SnapshotStore.prototype.read;let release!:()=>void;let entered!:()=>void;const held=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 SnapshotStore.prototype.read=async function(id,token){entered();await held;return original.call(this,id,token);};
 try{service=await createService({config:await prepareTransport(f.options),dataDir:path,distDir:join(f.dir,'dist')});const request=https.get(service.origin+'/api/snapshots/'+published.id,{ca:f.ca,agent:false,headers:{Authorization:'Bearer '+published.readToken}},res=>res.resume());request.on('error',()=>{});await started;
 const before=performance.now();await assert.rejects(service.close(),/lock is retained/);assert.ok(performance.now()-before>=4500&&performance.now()-before<6500);await assert.rejects(SnapshotStore.open(path));
 release();await new Promise(resolve=>setImmediate(resolve));await service.close();service=undefined;const reopened=await SnapshotStore.open(path);await reopened.close();
 }finally{release();SnapshotStore.prototype.read=original;await service?.close();await rm(f.dir,{recursive:true,force:true});}
});

test('HTTP default-port authority matches native browser origin spelling', async () => {
 const {httpAuthority}=await import('../server/transport.ts');
 assert.equal(httpAuthority(80),'127.0.0.1');assert.equal(httpAuthority(8770),'127.0.0.1:8770');assert.throws(()=>httpAuthority(0));
});

test('packaged dotted worker assets are served exactly without opening traversal or library paths', async () => {
    const { createService } = await import('../server/http.ts');
    const f = await fixture();
    const dist = join(f.dir, 'dist');
    const worker = Buffer.from('self.onmessage = () => self.postMessage("original worker fixture");\n');
    let service: Awaited<ReturnType<typeof createService>> | undefined;
    try {
        await mkdir(join(dist, 'assets'), { recursive: true });
        await writeFile(join(dist, 'assets', 'gif.worker-Diq5wjQj.js'), worker);
        await writeFile(join(dist, 'assets', 'denied..worker.js'), 'not served');
        await writeFile(join(dist, 'assets', 'private.motion.json'), '{"private":true}');
        await writeFile(join(dist, 'unlisted.js'), 'not allowlisted');
        service = await createService({ config: await prepareTransport(f.options), dataDir: join(f.dir, 'library'), distDir: dist });
        const request = (path: string) => new Promise<{ status: number; bytes: Buffer; type: string | undefined }>((resolve, reject) => {
            https.get({ hostname: '127.0.0.1', port: service!.port, path, ca: f.ca, agent: false }, response => {
                const chunks: Buffer[] = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('end', () => resolve({ status: response.statusCode!, bytes: Buffer.concat(chunks), type: response.headers['content-type'] }));
            }).on('error', reject);
        });
        const received = await request('/assets/gif.worker-Diq5wjQj.js');
        assert.equal(received.status, 200);
        assert.equal(received.type, 'text/javascript; charset=utf-8');
        assert.deepEqual(received.bytes, worker);
        for (const path of ['/assets/../unlisted.js', '/assets/denied..worker.js']) {
            assert.equal((await request(path)).status, 400);
        }
        for (const path of ['/unlisted.js', '/assets/private.motion.json', '/index.json', '/.server.lock']) {
            assert.equal((await request(path)).status, 404);
        }
    } finally {
        await service?.close();
        await rm(f.dir, { recursive: true, force: true });
    }
});
