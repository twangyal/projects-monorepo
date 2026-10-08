import { test as base, expect, type Browser, type Page } from '@playwright/test';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, chmod, rm, access } from 'node:fs/promises';
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { createServer } from 'node:net';
import { request } from 'node:https';
import { deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { parseGIF, decompressFrames } from 'gifuct-js';

const execute = promisify(execFile);
export interface PrivateLan { origin: string; setup: string; browser: Browser; restart(): Promise<void> }
export const test = base.extend<{ lan: PrivateLan }>({
  lan: async ({ playwright }, use, info) => {
    const directory = await mkdtemp(join(tmpdir(), 'motion110-native-')), cert = join(directory, 'certificate.pem'), key = join(directory, 'key.pem'), setupPath = join(directory, 'setup');
    let child: ChildProcess | null = null, browser: Browser | null = null;
    const servicePids: number[] = [], browserPids: number[] = [];
    const stop = async () => {
      const old = child; child = null; if (!old || old.exitCode !== null) return;
      const ended = new Promise<void>((done, reject) => { const timer = setTimeout(() => { old.kill('SIGKILL'); reject(new Error('Owned snapshot service did not stop within ten seconds.')); }, 10000); old.once('exit', () => { clearTimeout(timer); done(); }); });
      old.kill('SIGTERM'); await ended;
    };
    try {
      await execute('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost']); await chmod(key, 0o600);
      const setup = randomBytes(32).toString('hex'); await writeFile(setupPath, setup + '\n', { mode: 0o600 });
      const certificate = await readFile(cert), spki = createHash('sha256').update(new X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
      const port = await new Promise<number>(done => { const listener = createServer(); listener.listen(0, '127.0.0.1', () => { const address = listener.address(); if (!address || typeof address === 'string') throw new Error('No fixture port'); listener.close(() => done(address.port)); }); });
      const origin = `https://127.0.0.1:${port}`;
      const ready = () => new Promise<boolean>(done => { const req = request(origin + '/api/status', { ca: certificate, timeout: 1000 }, response => { response.resume(); done(response.statusCode === 200); }); req.on('error', () => done(false)); req.on('timeout', () => req.destroy()); req.end(); });
      const start = async () => {
        child = spawn(process.execPath, ['--experimental-strip-types', 'server/main.ts', '--data-dir', join(directory, 'library'), '--port', String(port), '--bind', '127.0.0.1', '--origin', origin, '--tls-cert', cert, '--tls-key', key, '--setup-token-file', setupPath], { cwd: resolve(import.meta.dirname, '..'), stdio: 'ignore' });
        if (child.pid) servicePids.push(child.pid);
        await expect.poll(ready, { timeout: 15000, message: 'Actual snapshot HTTPS server accepts strict fixture CA verification.' }).toBe(true);
      };
      await start();
      browser = await playwright.chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: [`--ignore-certificate-errors-spki-list=${spki}`] });
      const session = await browser.newBrowserCDPSession(), processes = await session.send('SystemInfo.getProcessInfo'); browserPids.push(...processes.processInfo.filter(item => item.type === 'browser').map(item => item.id)); await session.detach();
      await writeFile(info.outputPath('public-certificate-receipt.json'), JSON.stringify({ certificateSha256: sha(certificate), spki, browserVersion: browser.version(), trust: 'Strict Node CA readiness; Chromium exact fixture SPKI only', physicalDevices: false }, null, 2));
      await use({ origin, setup, browser, restart: async () => { await stop(); await start(); } });
    } finally {
      await browser?.close(); await stop(); await rm(directory, { recursive: true, force: true });
      const exited = await Promise.all([...servicePids, ...browserPids].map(async pid => { try { await access(`/proc/${pid}`); return false; } catch { return true; } }));
      await writeFile(info.outputPath('owned-process-closure.json'), JSON.stringify({ servicePids, browserPids, allObservedPidsExited: exited.every(Boolean), noSecretMaterial: true }, null, 2));
    }
  },
});
export { expect };
export function sha(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
interface Pose { frame: number; x: number; y: number; scale: number; rotation: number; opacity: number; easing: 'linear' }
interface Stroke { color: string; width: number; points: { x: number; y: number }[] }
interface Layer { id: string; name: string; kind: 'drawing' | 'image'; keys: Pose[]; cels?: { frame: number; strokes: Stroke[] }[]; image?: { dataUrl: string; width: number; height: number } }
export interface LiteralProject { schemaVersion: 2; title: string; background: string; frameCount: number; layers: Layer[] }
export function crc(bytes: Uint8Array): number { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
export function chunk(name: string, payload: Uint8Array): Buffer { const data = Buffer.from(payload), type = Buffer.from(name), result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); type.copy(result, 4); data.copy(result, 8); result.writeUInt32BE(crc(Buffer.concat([type, data])), result.length - 4); return result; }
export function originalPng(): Buffer { const header = Buffer.alloc(13); header.writeUInt32BE(8); header.writeUInt32BE(8, 4); header[8] = 8; header[9] = 6; const pixels = Buffer.alloc(8 * 33); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) pixels.set([255, 255, 0, 255], y * 33 + 1 + x * 4); return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]); }
const pose = (frame: number, x: number, y: number, scale = 1): Pose => ({ frame, x, y, scale, rotation: 0, opacity: 1, easing: 'linear' });
export function originalProject(title = 'Original private cel study <literal> Ω'): LiteralProject { return { schemaVersion: 2, title, background: '#ffffff', frameCount: 12, layers: [
  { id: 'moving', name: 'Original held line', kind: 'drawing', keys: [pose(0,200,180), pose(11,310,180)], cels: [
    { frame: 0, strokes: [{ color: '#ff0000', width: 20, points: [{ x:-40,y:0 },{ x:40,y:0 }] }] },
    { frame: 6, strokes: [{ color: '#0000ff', width: 20, points: [{ x:-40,y:0 },{ x:40,y:0 }] }] },
  ] },
  { id: 'dot', name: 'Original green dot', kind: 'drawing', keys: [pose(0,500,80)], cels: [{ frame:0,strokes:[{color:'#00ff00',width:20,points:[{x:0,y:0}]}] }] },
  { id: 'image', name: 'Original embedded yellow', kind: 'image', keys: [pose(0,60,60,4)], image:{ dataUrl:'data:image/png;base64,'+originalPng().toString('base64'), width:8,height:8 } },
] }; }
export const expectedPoints = (frame: number) => [ { x:200+10*frame,y:180,rgba:frame<6?[255,0,0,255]:[0,0,255,255] }, {x:500,y:80,rgba:[0,255,0,255]}, {x:60,y:60,rgba:[255,255,0,255]}, {x:600,y:330,rgba:[255,255,255,255]} ];
export function assertPixels(rgba: Uint8Array | Uint8ClampedArray, frame: number) { for (const point of expectedPoints(frame)) expect([...rgba.subarray((point.y*640+point.x)*4,(point.y*640+point.x)*4+4)], `frame ${frame}, point ${point.x},${point.y}`).toEqual(point.rgba); }
export function assertPng(bytes: Buffer, frame: number) { const image = PNG.sync.read(bytes); expect([image.width,image.height]).toEqual([640,360]); assertPixels(image.data,frame); }
export function assertGif(bytes: Buffer) { const frames = decompressFrames(parseGIF(Uint8Array.from(bytes).buffer),true); expect(frames).toHaveLength(12); expect(frames.map(frame=>frame.delay)).toEqual([80,90,80,80,90,80,80,90,80,80,90,80]); frames.forEach((frame,i)=>{expect(frame.dims).toEqual({left:0,top:0,width:640,height:360}); assertPixels(frame.patch!,i);}); }
export async function download(page: Page, selector: string): Promise<Buffer> { const pending = page.waitForEvent('download'); await page.locator(selector).click(); const file = await pending; const path = await file.path(); if (!path) throw new Error('Native download unavailable'); return readFile(path); }
export async function openOriginal(page: Page, lan: PrivateLan, project = originalProject()) { await page.goto(lan.origin); await expect(page.locator('#project-file')).toBeEnabled(); await page.locator('#project-file-action').selectOption('new'); await page.locator('#project-file').setInputFiles({name:'original-private.motion.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))}); await expect(page.locator('#project-title')).toHaveValue(project.title); await expect(page.locator('#save-status')).toHaveText('Saved in this browser'); }
export interface Links { read: string; revoke: string; id: string; readToken: string; revokeToken: string }
export async function publish(page: Page, lan: PrivateLan): Promise<Links> { await page.locator('#private-link-setup').fill(lan.setup); await expect(page.locator('#publish-snapshot')).toBeEnabled(); await page.locator('#publish-snapshot').click(); await expect.poll(async()=>/\/view#snapshot=[a-f0-9-]+&read=[a-f0-9]{64}$/.test(await page.locator('#private-view-link').inputValue())).toBe(true); await expect(page.locator('#private-link-setup')).toHaveValue(''); const read=await page.locator('#private-view-link').inputValue(),revoke=await page.locator('#private-revoke-link').inputValue(), r=new URLSearchParams(new URL(read).hash.slice(1)),d=new URLSearchParams(new URL(revoke).hash.slice(1)); expect(new URL(read).origin===lan.origin&&new URL(revoke).origin===lan.origin).toBe(true); expect(r.get('snapshot')===d.get('snapshot')).toBe(true); expect(r.get('read')!==d.get('revoke')).toBe(true); return{read,revoke,id:r.get('snapshot')!,readToken:r.get('read')!,revokeToken:d.get('revoke')!}; }
export async function view(page: Page, link: string, title = originalProject().title) { await page.goto(link); await expect.poll(()=>new URL(page.url()).hash).toBe(''); await expect(page.locator('#snapshot-title')).toHaveText(title); await expect(page.locator('#snapshot-project')).toBeEnabled(); }
export async function frame(page: Page, value: number) { await page.locator('#snapshot-frame').evaluate((node,value)=>{const input=node as HTMLInputElement;input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},value); await expect(page.locator('#snapshot-frame')).toHaveValue(String(value)); }
export async function inspectLibrary(page: Page) { return page.evaluate(async()=>{if(!(await indexedDB.databases()).some(db=>db.name==='motion-studio'))return {activeId:null,rows:[]};return new Promise<{activeId:string|null;rows:{id:string;project:unknown}[]}>((resolve,reject)=>{const req=indexedDB.open('motion-studio'); req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result;if(!db.objectStoreNames.contains('library')){db.close();resolve({activeId:null,rows:[]});return;}const tx=db.transaction(['library','projects'],'readonly'),head=tx.objectStore('library').get('current'),rows=tx.objectStore('projects').getAll();tx.oncomplete=()=>{db.close();resolve({activeId:head.result?.activeId??null,rows:rows.result});};tx.onabort=()=>{db.close();reject(tx.error);};};});}); }
export async function authorized(page: Page, id: string, token: string, revoke = false) { return page.evaluate(async({id,token,revoke})=>{const response=await fetch(`/api/snapshots/${id}${revoke?'/revoke':''}`,{method:revoke?'POST':'GET',headers:{Authorization:`Bearer ${token}`},credentials:'omit',redirect:'error'});return {status:response.status,bytes:[...new Uint8Array(await response.arrayBuffer())]};},{id,token,revoke}); }
