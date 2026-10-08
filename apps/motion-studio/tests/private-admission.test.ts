import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { test } from 'node:test';
import { admitPortableProject } from '../server/project-admission.ts';
import { MAX_PROJECT_BYTES, MotionError, validatePublicationIndex } from '../server/types.ts';

function crc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(name: string, bytes: Uint8Array): Buffer {
  const header = Buffer.alloc(8); header.writeUInt32BE(bytes.length); header.write(name, 4);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(name), bytes])));
  return Buffer.concat([header, bytes, tail]);
}
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
function png(depth = 8, type = 6, interlace = false, override?: Uint8Array, extras: Buffer[] = []): Buffer {
  const header = Buffer.alloc(13); header.writeUInt32BE(interlace ? 5 : 1); header.writeUInt32BE(interlace ? 5 : 1, 4); header[8] = depth; header[9] = type; header[12] = +interlace;
  const channels = ({0:1,2:3,3:1,4:2,6:4} as Record<number, number>)[type];
  // Literal 5×5 Adam7 pass dimensions, separately derived from the PNG standard.
  const passes = interlace ? [[1,1],[1,1],[2,1],[1,2],[3,1],[2,3],[5,2]] : [[1,1]];
  const raw = Buffer.concat(passes.map(([w,h]) => Buffer.alloc(h * (1 + Math.ceil(w * depth * channels / 8)))));
  return Buffer.concat([signature, chunk('IHDR', header), ...(type === 3 ? [chunk('PLTE', Buffer.from([255,0,0]))] : []), ...extras,
    chunk('IDAT', override ?? deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function project(image?: Uint8Array, size = 1): object {
  return { schemaVersion:2, title:'Original — private drawing', background:'#123456', frameCount:12,
    layers: image ? [{id:'image',name:'Original PNG',kind:'image',image:{dataUrl:`data:image/png;base64,${Buffer.from(image).toString('base64')}`,width:size,height:size},
      keys:[{x:0,y:0,scale:1,rotation:0,opacity:1,frame:0,easing:'linear'}]}] : [] };
}
function input(value: unknown): Uint8Array { return Buffer.from(JSON.stringify(value)); }
async function rejects(bytes: Uint8Array): Promise<void> {
  await assert.rejects(admitPortableProject(bytes), error => error instanceof MotionError && error.code === 'invalid');
}

test('admits exact canonical source bytes and literal SHA while detaching caller input', async () => {
  const original = input(project());
  const result = await admitPortableProject(original);
  assert.equal(Buffer.from(result.json).toString(), JSON.stringify(project()));
  assert.equal(result.sha256, createHash('sha256').update(original).digest('hex'));
  original.fill(0); assert.equal(result.project.title, 'Original — private drawing');
});
test('preserves legal negative-zero geometry through model admission and ordinary JSON canonicalization', async () => {
  const raw = input(project(png())).toString().replace('"x":0', '"x":-0');
  const result = await admitPortableProject(Buffer.from(raw));
  assert.ok(Object.is(result.project.layers[0].keys[0].x, -0));
  assert.match(Buffer.from(result.json).toString(), /"x":0/);
});
test('fully decodes all legal depth/type dialects and actual 5×5 Adam7 images without rewriting their bytes', async () => {
  const dialects = [[0,1],[0,2],[0,4],[0,8],[0,16],[2,8],[2,16],[3,1],[3,2],[3,4],[3,8],[4,8],[4,16],[6,8],[6,16]];
  for (const [type,depth] of dialects) for (const interlace of [false,true]) {
    const source = png(depth,type,interlace), result = await admitPortableProject(input(project(source,interlace ? 5 : 1)));
    const layer = result.project.layers[0]; assert.equal(layer.kind,'image');
    if (layer.kind === 'image') assert.equal(layer.image.dataUrl, `data:image/png;base64,${source.toString('base64')}`);
  }
});
test('admits valid transparency and unknown ancillary bytes literally', async () => {
  for (const [type,depth,transparency] of [[0,16,Buffer.from([0,0])],[2,8,Buffer.alloc(6)],[3,4,Buffer.from([123])]] as const) {
    const source = png(depth,type,false,undefined,[chunk('tRNS',transparency),chunk('teSt',Buffer.from('original padding'))]);
    assert.deepEqual((await admitPortableProject(input(project(source)))).project, project(source));
  }
});
test('rejects actual compressed corruption, overinflation, truncation and trailing zlib data', async () => {
  for (const compressed of [Buffer.from('not zlib'),deflateSync(Buffer.alloc(6)),deflateSync(Buffer.alloc(4)),Buffer.concat([deflateSync(Buffer.alloc(5)),Buffer.from([1])]),Buffer.concat([deflateSync(Buffer.alloc(5)),deflateSync(Buffer.alloc(5))])]) {
    await rejects(input(project(png(8,6,false,compressed))));
  }
});
test('checks ancillary CRC as well as critical CRC and exact PNG EOF', async () => {
  const source = png(8,6,false,undefined,[chunk('teSt',Buffer.from('crc'))]);
  const wrong = Buffer.from(source); wrong[49] ^= 1;
  for (const invalid of [wrong,Buffer.concat([source,Buffer.from([0])]),source.subarray(0,-1)]) await rejects(input(project(invalid)));
});
test('CRC-valid high-bit chunk names cannot masquerade as ASCII ancillary chunks', async () => {
  const source = png(8,6,false,undefined,[chunk('teSt',Buffer.alloc(0))]);
  source[37] |= 128; source.writeUInt32BE(crc(source.subarray(37,41)),41);
  await rejects(input(project(source)));
});
test('rejects APNG, unknown critical and noncontiguous IDAT before bitmap admission', async () => {
  const source = png(); const header = source.subarray(0,33), data = deflateSync(Buffer.alloc(5));
  const broken = Buffer.concat([header,chunk('IDAT',data.subarray(0,4)),chunk('teSt',Buffer.from('break')),chunk('IDAT',data.subarray(4)),chunk('IEND',Buffer.alloc(0))]);
  for (const invalid of [png(8,6,false,undefined,[chunk('acTL',Buffer.alloc(8))]),png(8,6,false,undefined,[chunk('ABCD',Buffer.alloc(0))]),broken]) await rejects(input(project(invalid)));
});
test('duplicate escaped keys, nonfinite/overflow numbers, fatal UTF8 and deep ignored input fail closed', async () => {
  for (const invalid of [Buffer.from('{"title":"a","\\u0074itle":"b"}'),Buffer.from('{"schemaVersion":2,"frameCount":1e999}'),Buffer.from([0xff]),Buffer.from('{"x":'+ '['.repeat(33)+'0'+']'.repeat(33)+'}')]) await rejects(invalid);
});
test('rejects raw byte maximum plus one before allocating an admission worker', async () => {
  await rejects(new Uint8Array(MAX_PROJECT_BYTES+1));
});
test('one real worker owns admission; cancellation retires it before a new worker is admitted', async () => {
  const controller = new AbortController();
  const pending = admitPortableProject(input(project()), {signal:controller.signal});
  const rejection = assert.rejects(pending,error => error instanceof MotionError && error.code === 'cancelled');
  await assert.rejects(admitPortableProject(input(project())),error => error instanceof MotionError && error.code === 'busy');
  controller.abort(); await rejection;
  assert.equal((await admitPortableProject(input(project()))).project.frameCount,12);
});
test('pre-aborted requests do not occupy the singleton or start work', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(admitPortableProject(input(project()),{signal:controller.signal}),error => error instanceof MotionError && error.code === 'cancelled');
  assert.equal((await admitPortableProject(input(project()))).project.layers.length,0);
});
test('the shared index validator detaches exact metadata and refuses forged counts, hashes and accessor data', () => {
  const value = {schemaVersion:1,revision:0,publications:[{id:'12345678-1234-4123-8123-123456789abc',createdAt:'2026-10-04T00:00:00.000Z',projectSha256:'a'.repeat(64),projectBytes:1,readHash:'b'.repeat(64),revokeHash:'c'.repeat(64)}]};
  const accepted = validatePublicationIndex(value); assert.deepEqual(accepted,value); assert.notEqual(accepted.publications[0],value.publications[0]);
  for (const invalid of [{...value,revision:Number.MAX_SAFE_INTEGER+1},{...value,unknown:0},{...value,publications:[value.publications[0],value.publications[0]]},
    {...value,publications:[{...value.publications[0],readHash:'b'.repeat(64)+'\n'}]}]) assert.throws(()=>validatePublicationIndex(invalid));
  assert.throws(()=>validatePublicationIndex(Object.defineProperty({...value},'revision',{get(){throw new Error('Getter must not execute.');},enumerable:true})),error=>error instanceof MotionError);
});
