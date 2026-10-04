import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtemp, writeFile, readFile, readdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import tls from 'node:tls';
import { prepareTransport } from '../server/transport.ts';
import { createService } from '../server/http.ts';
import { admitPortableProject } from '../server/project-admission.ts';
import { SnapshotStore } from '../server/snapshot-store.ts';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
// Literal PNG construction, independent of the production preflight and decoder.
function crc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type: string, bytes: Uint8Array): Buffer {
  const name = Buffer.from(type), data = Buffer.from(bytes), head = Buffer.alloc(4), tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length); tail.writeUInt32BE(crc(Buffer.concat([name, data])));
  return Buffer.concat([head, name, data, tail]);
}
type Dialect = { type: number; depth: number; interlace?: number };
const dialects: Dialect[] = [
  ...[1,2,4,8,16].map(depth => ({type:0,depth})),
  ...[8,16].map(depth => ({type:2,depth})),
  ...[1,2,4,8].map(depth => ({type:3,depth})),
  ...[8,16].map(depth => ({type:4,depth})),
  ...[8,16].map(depth => ({type:6,depth})),
];
function pngParts({type,depth,interlace=0}: Dialect, width=9, height=7) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height,4);
  header[8]=depth; header[9]=type; header[12]=interlace;
  const channels = ({0:1,2:3,3:1,4:2,6:4} as Record<number,number>)[type];
  const passes = interlace ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
  const rows: Buffer[] = [];
  for (const [x0,y0,dx,dy] of passes) {
    const cols = Math.max(0,Math.ceil((width-x0)/dx));
    if (!cols) continue;
    for(let y=y0;y<height;y+=dy) {
      const row = Buffer.alloc(1+Math.ceil(cols*channels*depth/8));
      for(let x=0;x<cols;x++) for(let c=0;c<channels;c++) {
        const sample = type===3 ? ((x0+x*dx+y)&1) : ((x0+x*dx+y+c) % (depth===16 ? 65536 : 2**depth));
        const sampleIndex=x*channels+c;
        if(depth===16) row.writeUInt16BE(sample,1+sampleIndex*2);
        else if(depth===8) row[1+sampleIndex]=sample;
        else row[1+Math.floor(sampleIndex*depth/8)] |= sample << (8-depth-(sampleIndex*depth%8));
      }
      rows.push(row);
    }
  }
  const ancillary = chunk('tEXt', Buffer.from('Original fixture\0literal <panel> Ω'));
  const palette = type===3 ? [chunk('PLTE',Buffer.from([0,0,0,255,128,64])),chunk('tRNS',Buffer.from([0,128]))] : [];
  return { header, raw:Buffer.concat(rows), prefix:[chunk('IHDR',header),...palette,ancillary] };
}
function png(d:Dialect): Buffer {
  const p=pngParts(d); return Buffer.concat([signature,...p.prefix,chunk('IDAT',deflateSync(p.raw)),chunk('IEND',Buffer.alloc(0))]);
}
function project(image?:Buffer,width=9,height=7) {
  return {schemaVersion:2,title:'Original literal panel <Ω>',background:'#102030',frameCount:12,layers:image?[{id:'original-image',name:'Original panel',kind:'image',image:{dataUrl:'data:image/png;base64,'+image.toString('base64'),width,height},keys:[{frame:0,x:0,y:0,scale:1,rotation:0,opacity:1,easing:'linear'}]}]:[]};
}
const input=(image?:Buffer)=>Buffer.from(JSON.stringify(project(image)));
async function invalid(image:Buffer) { await assert.rejects(admitPortableProject(input(image))); }

test('independent PNG fixture admits all fifteen legal color/depth dialects and preserves every byte',async()=>{
  for(const d of dialects) {
    const bytes=input(png(d));const got=await admitPortableProject(bytes);
    assert.deepEqual(got.project,project(png(d)));
    assert.deepEqual(JSON.parse(Buffer.from(got.json).toString()),project(png(d)));
    assert.equal(got.sha256,sha(got.json));
  }
});
test('independent seven-pass Adam7 fixture admits every legal dialect, including narrow empty passes',async()=>{
  for(const d of dialects) {
    const image=png({...d,interlace:1});const got=await admitPortableProject(input(image));assert.deepEqual(got.project,project(image));
  }
  const one=pngParts({type:6,depth:16,interlace:1},1,1);
  const image=Buffer.concat([signature,...one.prefix,chunk('IDAT',deflateSync(one.raw)),chunk('IEND',Buffer.alloc(0))]);
  const bytes=Buffer.from(JSON.stringify(project(image,1,1)));assert.deepEqual((await admitPortableProject(bytes)).project,project(image,1,1));
});
test('complete zlib is required: extra scanline, second stream, compressed suffix and missing trailer reject',async()=>{
  const p=pngParts({type:6,depth:8});const packed=deflateSync(p.raw);
  for(const data of [deflateSync(Buffer.concat([p.raw,Buffer.from([0])])),Buffer.concat([packed,deflateSync(Buffer.from('second stream'))]),Buffer.concat([packed,Buffer.from([0])]),packed.subarray(0,packed.length-1)]) {
    await invalid(Buffer.concat([signature,...p.prefix,chunk('IDAT',data),chunk('IEND',Buffer.alloc(0))]));
  }
  await admitPortableProject(input(png({type:6,depth:8})));
});
test('literal colored scanlines use every nonzero PNG filter and preserve original encoded artwork',async()=>{
  const p=pngParts({type:6,depth:8}),stride=36,encoded:Buffer[]=[];
  const paeth=(a:number,b:number,c:number)=>{const q=a+b-c,da=Math.abs(q-a),db=Math.abs(q-b),dc=Math.abs(q-c);return da<=db&&da<=dc?a:db<=dc?b:c;};
  for(let y=0;y<7;y++) {
    const raw=p.raw.subarray(y*(stride+1)+1,(y+1)*(stride+1)),previous=y?p.raw.subarray((y-1)*(stride+1)+1,y*(stride+1)):Buffer.alloc(stride);
    const filter=1+(y%4),row=Buffer.alloc(stride+1);row[0]=filter;
    for(let x=0;x<stride;x++) {const a=x>=4?raw[x-4]:0,b=previous[x],c=x>=4?previous[x-4]:0;const predictor=filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);row[x+1]=(raw[x]-predictor)&255;}
    encoded.push(row);
  }
  const image=Buffer.concat([signature,...p.prefix,chunk('IDAT',deflateSync(Buffer.concat(encoded))),chunk('IEND',Buffer.alloc(0))]);
  assert.deepEqual((await admitPortableProject(input(image))).project,project(image));
});
test('exact 800-square 16-bit PNG and 4096 physical chunks are admitted without truncating inflated bytes',async()=>{
  const p=pngParts({type:6,depth:16},800,800),image=Buffer.concat([signature,...p.prefix,chunk('IDAT',deflateSync(p.raw)),chunk('IEND',Buffer.alloc(0))]);
  assert.equal(p.raw.length,5_120_800);
  const bytes=Buffer.from(JSON.stringify(project(image,800,800)));assert.deepEqual((await admitPortableProject(bytes)).project,project(image,800,800));
  const small=pngParts({type:6,depth:8}),empty=chunk('npTa',Buffer.alloc(0));
  const bounded=Buffer.concat([signature,...small.prefix,...Array.from({length:4092},()=>empty),chunk('IDAT',deflateSync(small.raw)),chunk('IEND',Buffer.alloc(0))]);
  await admitPortableProject(input(bounded));
  await invalid(Buffer.concat([signature,...small.prefix,...Array.from({length:4093},()=>empty),chunk('IDAT',deflateSync(small.raw)),chunk('IEND',Buffer.alloc(0))]));
});
test('physical PNG CRC, ordering, APNG, unknown critical chunks and exact EOF are independently refused',async()=>{
  await admitPortableProject(input(png({type:6,depth:8})));
  const p=pngParts({type:6,depth:8}), packed=deflateSync(p.raw), idat=chunk('IDAT',packed), end=chunk('IEND',Buffer.alloc(0));
  const badCrc=Buffer.from(png({type:6,depth:8}));badCrc[29]^=1;
  const cases=[badCrc,Buffer.concat([signature,...p.prefix,idat,end,Buffer.from([0])]),
    Buffer.concat([signature,...p.prefix,chunk('acTL',Buffer.alloc(8)),idat,end]),
    Buffer.concat([signature,...p.prefix,chunk('ABCD',Buffer.alloc(0)),idat,end]),
    Buffer.concat([signature,...p.prefix,idat,chunk('tEXt',Buffer.from('x\0y')),chunk('IDAT',Buffer.alloc(0)),end]),
    Buffer.concat([signature,...p.prefix,chunk('IHDR',p.header),idat,end]),
    Buffer.concat([signature,chunk('IHDR',p.header),chunk('IDAT',packed),chunk('PLTE',Buffer.from([0,0,0])),end])];
  for(const bytes of cases) await invalid(bytes);
  const palette=pngParts({type:3,depth:1});
  await invalid(Buffer.concat([signature,chunk('IHDR',palette.header),chunk('IDAT',deflateSync(palette.raw)),end]));
});
test('duplicate JSON keys, fatal UTF8 and excessive nested input reject before a canonical publication',async()=>{
  const base=input().toString();
  for(const bytes of [Buffer.from(base.replace('"title":','"title":"first","title":')),Buffer.from([0xff]),Buffer.from('['.repeat(20000)+'0'+']'.repeat(20000))]) await assert.rejects(admitPortableProject(bytes));
  const got=await admitPortableProject(input());assert.deepEqual(Buffer.from(got.json),input());
});

const id='12345678-1234-4234-8234-123456789abc', readToken='a'.repeat(64), revokeToken='b'.repeat(64);
const document=input();
function literalIndex(revision=1) {
  return {schemaVersion:1,revision,publications:[{id,createdAt:'2026-10-04T12:00:00.000Z',projectSha256:sha(document),projectBytes:document.length,readHash:sha(readToken),revokeHash:sha(revokeToken)}]};
}
async function directory() { return mkdtemp(join(tmpdir(),'motion-private-independent-')); }
async function install(path:string) {
  await writeFile(join(path,id+'.motion.json'),document,{mode:0o600});
  await writeFile(join(path,'index.json'),JSON.stringify(literalIndex()),{mode:0o600});
}
test('literal durable index survives genuine process ownership and refuses second flock owner',async()=>{
  const path=await directory(),launcher=await directory();await install(path);
  const module=new URL('../server/snapshot-store.ts',import.meta.url).href;
  const code=`import {SnapshotStore} from ${JSON.stringify(module)};const s=await SnapshotStore.open(process.argv[2]);process.stdout.write('READY\\n');process.on('SIGTERM',async()=>{await s.close();process.exit(0)});setInterval(()=>{},1000);`;
  const script=join(launcher,'hold.mjs');await writeFile(script,code);
  const child=spawn(process.execPath,['--experimental-strip-types',script,path],{stdio:['ignore','pipe','pipe']});
  let errors='';child.stderr.on('data',b=>{errors+=b.toString();});
  try {
    await new Promise<void>((ok,no)=>{child.stdout.once('data',b=>{if(b.toString()==='READY\n')ok();else no(new Error('Unexpected child readiness.'));});child.once('exit',()=>no(new Error('Child failed to open store: '+errors)));});
    await assert.rejects(SnapshotStore.open(path));
    child.kill('SIGTERM');await once(child,'exit');
    const store=await SnapshotStore.open(path);try{const opened=await store.read(id,readToken);try{assert.deepEqual(await opened.file.readFile(),document);}finally{await opened.file.close();}}finally{await store.close();}
  }finally{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}await rm(path,{recursive:true,force:true});await rm(launcher,{recursive:true,force:true});}
});
test('startup never resets a corrupt indexed file or follows an outside project symlink',async()=>{
  for(const mode of ['hash','missing','symlink','unknown'] as const) {
    const path=await directory(),outside=await directory();await install(path);
    try{
      const valid = await SnapshotStore.open(path); await valid.close();
      if(mode==='hash')await writeFile(join(path,id+'.motion.json'),'damaged');
      if(mode==='missing')await rm(join(path,id+'.motion.json'));
      if(mode==='symlink'){await rm(join(path,id+'.motion.json'));await writeFile(join(outside,'sentinel'),document);await symlink(join(outside,'sentinel'),join(path,id+'.motion.json'));}
      if(mode==='unknown')await writeFile(join(path,'unrelated-sentinel'),'preserve');
      const before=await readFile(join(path,'index.json'));await assert.rejects(SnapshotStore.open(path));assert.deepEqual(await readFile(join(path,'index.json')),before);
      if(mode==='symlink')assert.deepEqual(await readFile(join(outside,'sentinel')),document);
      if(mode==='unknown')assert.equal(await readFile(join(path,'unrelated-sentinel'),'utf8'),'preserve');
    }finally{await rm(path,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
  }
});
test('unindexed crash file is unservable and cleaned under lock while committed authority remains exact',async()=>{
  const path=await directory();await install(path);const orphan='87654321-4321-4321-8321-cba987654321';
  await writeFile(join(path,orphan+'.motion.json'),document,{mode:0o600});
  const store=await SnapshotStore.open(path);
  try {
    assert.equal((await readdir(path)).includes(orphan+'.motion.json'),false);
    await assert.rejects(store.read(orphan,readToken));
    await assert.rejects(store.read(id,revokeToken));await assert.rejects(store.revoke(id,readToken));
    const held=await store.read(id,readToken);
    await store.revoke(id,revokeToken);
    try{assert.deepEqual(await held.file.readFile(),document);}finally{await held.file.close();}
    await assert.rejects(store.read(id,readToken));
  }finally{await store.close();}
  const reopened=await SnapshotStore.open(path);try{await assert.rejects(reopened.read(id,readToken));assert.deepEqual(await reopened.inspect(),[]);}finally{await reopened.close();await rm(path,{recursive:true,force:true});}
});

function response(socket:net.Socket,request:string):Promise<string> {
  return new Promise((ok,no)=>{
    let output='';socket.setTimeout(3000,()=>{socket.destroy();no(new Error('Bounded independent response did not complete.'));});
    socket.on('data',b=>{output+=b.toString('latin1');if(output.length>200000){socket.destroy();no(new Error('Unexpected unbounded response.'));}});
    socket.on('error',no);socket.on('end',()=>ok(output));socket.on('close',()=>ok(output));socket.write(request);
  });
}
test('HTTP authority refuses wrong setup before consuming an incomplete maximum body and never accepts cookie authority',async()=>{
  const path=await directory(),key=join(path,'setup'),data=join(path,'data');await writeFile(key,'c'.repeat(64),{mode:0o600});
  const config=await prepareTransport({port:0,setupTokenFile:key}),service=await createService({config,dataDir:data,distDir:fileURLToPath(new URL('../dist',import.meta.url))});
  try{
    const host=new URL(service.origin).host;
    const rejected=await response(net.connect(service.port,'127.0.0.1'),`POST /api/snapshots HTTP/1.1\r\nHost: ${host}\r\nOrigin: ${service.origin}\r\nX-Motion-Setup-Key: ${'d'.repeat(64)}\r\nContent-Type: application/json\r\nContent-Length: 6291624\r\n\r\n`);
    assert.match(rejected,/^HTTP\/1\.1 403 /);
    for(const headers of [`Cookie: capability=${readToken}\r\n`,`X-Motion-Setup-Key: ${'c'.repeat(64)}\r\n`,`Authorization: Bearer ${revokeToken}\r\n`]) {
      const denied=await response(net.connect(service.port,'127.0.0.1'),`GET /api/snapshots/${id} HTTP/1.1\r\nHost: ${host}\r\n${headers}\r\n`);assert.match(denied,/^HTTP\/1\.1 404 /);
    }
    for(const request of [
      `GET /api/status?token=literal HTTP/1.1\r\nHost: ${host}\r\n\r\n`,
      `GET /api/status HTTP/1.1\r\nHost: ${host}\r\nHost: ${host}\r\n\r\n`,
      `GET /api/status HTTP/1.1\r\nHost: ${host}\r\nOrigin: https://example.invalid\r\n\r\n`,
      `GET /api/status HTTP/1.1\r\nHost: ${host}\r\nContent-Length: 1\r\n\r\nx`,
      `GET /api/status HTTP/1.1\r\nHost: ${host}\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n`,
      `GET /api/status HTTP/1.1\r\nHost: ${host}\r\nForwarded: for=127.0.0.1\r\n\r\n`,
    ]) {const got=await response(net.connect(service.port,'127.0.0.1'),request);assert.doesNotMatch(got,/^HTTP\/1\.1 200 /);}
    const pipelined=await response(net.connect(service.port,'127.0.0.1'),`GET /api/status HTTP/1.1\r\nHost: ${host}\r\n\r\nGET /api/status HTTP/1.1\r\nHost: ${host}\r\n\r\n`);
    // Unsupported pipelining may refuse both commands or serve only the first.
    assert.ok((pipelined.match(/HTTP\/1\.1 \d{3} /g)||[]).length<=1);
    if(pipelined) assert.match(pipelined,/Connection: close/i);
  }finally{await service.close();await rm(path,{recursive:true,force:true});}
});
test('true TLS validates fixture trust/name and caps sixteen undecided raw handshakes before TLS work',async()=>{
  const path=await directory(),key=join(path,'setup'),cert=join(path,'cert.pem'),tlsKey=join(path,'key.pem');await writeFile(key,'c'.repeat(64),{mode:0o600});
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',tlsKey,'-out',cert,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
  // Select a free test-only HTTPS port; production port-zero policy remains intact.
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=(probe.address() as net.AddressInfo).port;await new Promise<void>((ok,no)=>probe.close(e=>e?no(e):ok()));
  const config=await prepareTransport({port,setupTokenFile:key,bind:'127.0.0.1',origin:'https://127.0.0.1:'+port,tlsCert:cert,tlsKey});
  const service=await createService({config,dataDir:join(path,'data'),distDir:fileURLToPath(new URL('../dist',import.meta.url))}),ca=await readFile(cert);const held:net.Socket[]=[];
  try{
    async function handshake(options:tls.ConnectionOptions) {const s=tls.connect({port,host:'127.0.0.1',...options});try{await Promise.race([once(s,'secureConnect'),once(s,'error').then(([e])=>Promise.reject(e))]);return s;}catch(e){s.destroy();throw e;}}
    await assert.rejects(handshake({}));await assert.rejects(handshake({ca,servername:'wrong.example.invalid'}));
    const trusted=await handshake({ca});const status=await response(trusted,`GET /api/status HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);assert.match(status,/^HTTP\/1\.1 200 /);assert.match(status,/"https-lan"/);
    for(let i=0;i<16;i++){const s=net.connect(port,'127.0.0.1');held.push(s);await once(s,'connect');}
    const excess=net.connect(port,'127.0.0.1');excess.on('error',()=>{});await new Promise<void>((ok,no)=>{const timeout=setTimeout(()=>{excess.destroy();no(new Error('Seventeenth raw socket was admitted.'));},2000);excess.once('close',()=>{clearTimeout(timeout);ok();});});
    assert.equal(held.filter(s=>!s.destroyed).length,16);
  }finally{held.forEach(s=>s.destroy());await service.close();await rm(path,{recursive:true,force:true});}
});
