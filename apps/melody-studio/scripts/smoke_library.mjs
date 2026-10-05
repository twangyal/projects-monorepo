/** Independent #126 capacity acceptance. No production imports, service control or audio-budget reset.
 * Prepare: node scripts/smoke_library.mjs --prepare-only NEW_FIXTURE_DIRECTORY
 * Run: MELODY_LIBRARY_BASE_URL=http://127.0.0.1:PORT MELODY_LIBRARY_FIXTURE_DIR=DIR
 *      MELODY_LIBRARY_OUTPUT_DIR=NEW_DIR node scripts/smoke_library.mjs
 */
/* global process, Buffer, URL, Blob, FileReader, IDBObjectStore, indexedDB,
   console, setTimeout, clearTimeout */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { chromium, expect } from '@playwright/test';

const RATE = 22050, FRAMES = 441000, PCM_BYTES = 882000, PARSER_BYTES = 12582912;
const RUNTIME_MS = 240000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const button = (page, name) => page.getByRole('button', { name, exact: true });
const FROZEN = {
  "fixtures": [
    {
      "index": 1,
      "title": "Original library composition 1",
      "bytes": 9587572,
      "sha256": "01e96b6f2c5fb8b71d56e8722ddee2083af47697a583ac63f9315bdef3937088",
      "pcmSha256": [
        "73a7fa75042504912703a074223bda69aec35e5cce9c010319be8241c6ad87c8",
        "57adff2b3c38119ea32842eb66bd07d09c76770bc760cb9cf6deb5cc1a8ae04b",
        "c2f3b3efbbe7c68ff5dd0c01de99337de730859ef2e33357b44efc7701cc5d67",
        "8730c3636a3ae607525c8a26730ecc0b6e87a33f6fee544653bd0fb3649c6aea",
        "e70631abdb59e27251a03d1c5670052de2469a94af0a31db828880ae277666c4",
        "081b736c84661744255b013c69d4187672eed755db1866464fdd29ec99f7ad9d",
        "fbedbde8efc98804c0dd698b8ae4d5277a684886b9fa6ebef5b96d2488fd677a",
        "c8ca9235f9b66958ab362cccf9603c22da7fe46745d458924548c960eadcd019"
      ]
    },
    {
      "index": 2,
      "title": "Original library composition 2",
      "bytes": 9587572,
      "sha256": "b9b68284997b483196a2474d11431842cbc2b24304a59480f87918c1562cfd2e",
      "pcmSha256": [
        "13dc19587b6a872d2de1b4d8597dbf3fa08f1583f1c587a531e0c4d9a9cba2bc",
        "541690eb47e3dd9c897021e1ce7ba74a1e6604e8994cf7d67190f77d8e7cde81",
        "01c12220a03af1ce80a04a253c5557dad82c095928dda82f3f33d6031a8f07c8",
        "da91aec03823bb1cc23794235ad94cd574c157a2066239686c4e7e4a26d19c26",
        "e58a7756610fc2edffc5ed061933cad2a1c280eec933c1ffbb4bc22b6a6b1e55",
        "3a6add9a4688dd1a91e8ffed59b0646bec7d1801631185271823ec76e9b4c19b",
        "dcb29bd2c3845ac90cc11a4dd9aa909498dcd1fb8e7f37ad6d4eaf7bb7973cdd",
        "cadc11ed2bff9f6e24bd6793dcc471b8a3c54936f7d2ece1bb80be3b7fa40183"
      ]
    },
    {
      "index": 3,
      "title": "Original library composition 3",
      "bytes": 9587572,
      "sha256": "b95646bb52480a53d4b31e484d09623ae4ef50dc9cbc3fccd7b5a68d2da00737",
      "pcmSha256": [
        "857a776334e0fa98d4a6c0892313b9013a533262bd6392892ea30f66cef1fb04",
        "5693d39807d6657cb8537c506fb731660aa44cd4f0345095c18901a6f10d6a90",
        "1244c94d38000fc997eae1c245ce493c788a577631637a3b4d22feeb0b14eefa",
        "d8f8deb33e359b5a5f4e1de8eb131060cfe195b8a9f8c19219353a577560fac8",
        "92473594c9e27cbb9778ab4fa1d6a192aed06cf54c668f7708658117e5a0d028",
        "3c747b302d0ca309111c0d1f95d8f01b15f0cddf26c131847709a5cf1db85517",
        "8da33b8b700f8b15151ed593ff0d73e6c7cd098d6a9f2bfed417b7021d5b8241",
        "81ca995152f321bd41184d44494a51516c12a3796445d5f7e949f0631f38da19"
      ]
    },
    {
      "index": 4,
      "title": "Original library composition 4",
      "bytes": 9587572,
      "sha256": "29ef456137ae60dd0b7c7c4429280a44f726dd5899660f97e25baba85e7dfc15",
      "pcmSha256": [
        "ee69932afc2b2a6c1a5980995097b1f9c73e6efe46b455a05adc54444eeb203b",
        "a1f07d24d3dc9614ebd9b2f46c52cf4ca7b8bc853c7131b6991bcabb42238c24",
        "3ac503c90cfcddd57d9fb16628403c3bd2a202f09c80a459ab47a372df4cfd58",
        "0c7c4ac389020353d6866c7d273e4c79f3bb7521d017c12a360f426c65f0c348",
        "2ad79271c2f5eec1de468a55f72bf3bc3957c06c87f7b8e7c2d255f8ccc465ed",
        "c69c2be7f66338238c1e04fd087ba51819d471f645cbf036a2a141bf8ab2fa0c",
        "56e4229f0178416003a61d7dce1a6349eff8267d38238608f8d7dfbe82646ecd",
        "7503ed1059c638555eea8589536516cffa69a7dac9a7a2c29366a1f5df94bade"
      ]
    },
    {
      "index": 5,
      "title": "Original library composition 5",
      "bytes": 9587572,
      "sha256": "531b42b56c91dbc5f1574edfb248e5dd3e2b470d876e87c8d09397ac2503dfca",
      "pcmSha256": [
        "5771d3c574c0accdff230b463a22318e8ec13f42439c4bebbd2837435dd0dad1",
        "4a0b1961d36ccdca4e8d8a436e17a9230837e819d0200fd4858bce0e696b7591",
        "3cff2d0431ce78112e1c69fa8e3080af532bc2d6083222bc033b002a1484e196",
        "daf247c327b9f2444efe318eb31bff165da99a902467d399f908fda1fdff5373",
        "7108622ec0e188bd11db584d6b1384ade41ad0a55a75882f1191338b8c1fb6d6",
        "e7d5fb731d4c424c62fb88e641e655aedf7fcb98a557aa3af9a48312269b0966",
        "dbb09d73ee0db16defc55937c226728225a6c078018f9ef6434ecf8f3a349730",
        "758993722fdaae18b20f14ae9c7c059c2677f976896af76d490a452917939c84"
      ]
    },
    {
      "index": 6,
      "title": "Original library composition 6",
      "bytes": 9587572,
      "sha256": "df25ed78bbf16d7e6af656426a759fcb46c748a8978a00a835d032b8c20cea78",
      "pcmSha256": [
        "60d13f2ee56cf709fecbfa189ea137a2a16a5d22958bc946ffd5ea4dfd06c5cb",
        "a7ee9ef043328b5d4efbee053a7370c2f93445616ca2c7f259a43fd3370d587b",
        "36c603cfc56655501985ad9bf395483c42072f28f838861cae3a68d80bffe45c",
        "719bf1292a090c35d76b7721a5fbafef7b7520e3f0e3b2d1d3c7b4771e475163",
        "ecd5310cbf9cb0580e1ccc68daa3cdc722e444ef8c89c6dec652811ffc166705",
        "74af6fb8754fa0384751055f5ac47edc21e3a6a7efbc2d07c2612a99d95b7908",
        "9835ec692829163b72c81b687294f9307a6d77b02ab3d89e82b9214b1d60ff71",
        "3e9ef06bcc6ee2252587a2ca2e2b357c1c80841ac58d974d5ef9693b2b12d631"
      ]
    },
    {
      "index": 7,
      "title": "Original library composition 7",
      "bytes": 9587572,
      "sha256": "28e08177035506ebb887658ac0d20b047f8841fcf176ee650c0c358f748a285b",
      "pcmSha256": [
        "17fb2939c4d99c07e4cf2dd2f911493c4b162df49224599a21f2e292cbac0b8f",
        "df69a2de59d9202899f0d839c08610bda59a58fe64ea3300d4e38f606c4774e0",
        "3cc7505f3a04bfee7183fc9a7a0ee9f2543f524ee3997b471b56c15cb8eb0fc2",
        "df54f3deb79bdfd7e37fdaa86f4a693ac1903552d5e7663bf3bdec1840b75618",
        "ecc48846eed04029a202ed67668676667f4ef725c9fc28effb16bffad22b1da6",
        "3c87bde9b9c52d519ffda53b021afd43d251043ebd260ca2b332784bca83de62",
        "d74c146fa1a5e4fbe5fea866e7d0c079d25eed9a7e718a8d17960c989300dbc7",
        "fec1abc647edc274eb092d384e622c62c7cfd086f8dbab56ae7b9b1010e7516b"
      ]
    },
    {
      "index": 8,
      "title": "Original library composition 8",
      "bytes": 9587572,
      "sha256": "bea4c0807b02abed9e70481d164b921eb3a81be644031f2e1502eb16a1445655",
      "pcmSha256": [
        "52319b02a551c34d6f3aefb4b52e1669b09c7924f86ef83b2b05ce64d7e1a1fd",
        "eb5931d159e4a4fdbf4644465907699060083fe29d3c407ce8b1f08365121741",
        "f0af97027deb7163e7c824b5445bcda870679bd5fa623ff095bfc354810ef093",
        "574b5008f69c81097b91c671635e57683b992825b229ecceaf88116ed9721c8e",
        "019f852d7cd637e8f6a311a3fe0c44c9bfd3a81b81ea936596063a367817b291",
        "8042d575373ea3c17b0f84c1ee1e2b511de63dc24547c2843988613c2aac581f",
        "a927d7bcb2cd6a0f31e37e61aeeaf530932a46865b9a2d9b77116d58296ac443",
        "36166f39d7e0e09b81e747097af1f52b95db5812089890284eec13f19a3cc411"
      ]
    }
  ],
  "replacement": {
    "bytes": 9587580,
    "sha256": "fd96f85476ba71e432642f03a6cb2bc3ab020f9daab84dfe6fa5606e2b0c0d32"
  },
  "parserBoundary": {
    "bytes": 12582912,
    "sha256": "3d98ab071e7564f28c337eac0e47fc4cf8d6b22d5e6677d1fc4c091855c8b2b0",
    "overflowBytes": 12582913,
    "overflowSha256": "3b63132114cf3e3098e94e97e757bcf05262c99ec268521f5c345505d38059c9"
  }
};

// Literal format/schema order, original note placements and independent signed-16 PCM.
function original(index) {
  const tracks = [], assets = [], references = [];
  for (let track = 0; track < 8; track++) {
    const number = index * 8 + track + 1;
    const id = `12600000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
    const pcm = Buffer.alloc(PCM_BYTES);
    for (let frame = 0; frame < FRAMES; frame++) pcm.writeInt16LE((frame * 97 + number * 503) % 65536 - 32768, frame * 2);
    assets.push({ id, kind: 'audio-file', captureTempo: 120, decodedSampleRate: RATE,
      decodedChannels: 1, decodedFrames: FRAMES, analyzedFrames: FRAMES,
      frameCount: FRAMES, sha256: hash(pcm), pcmBase64: pcm.toString('base64') });
    tracks.push({ id: `library-${index + 1}-track-${track + 1}`, name: `Library voice ${track + 1}`,
      instrument: 'sine', volume: .5, muted: track !== 0,
      notes: Array.from({ length: 256 }, (_, note) => ({ id: `library-${index + 1}-${track + 1}-note-${note + 1}`,
        pitch: 69 + index % 4 + track + note % 2 * 3, start: .25 + note * .5,
        duration: .25, velocity: .8 })) });
    references.push({ trackId: tracks.at(-1).id, assetId: id });
  }
  return { format: 'melody-studio-project', version: 1, document: { schemaVersion: 1,
    composition: { version: 1, title: `Original library composition ${index + 1}`, tempo: 120, tracks }, references }, assets };
}
function assertOriginal(bytes, index, revised = false) {
  const frozen = revised ? FROZEN.replacement : FROZEN.fixtures[index];
  assert.equal(bytes.length, frozen.bytes); assert.equal(hash(bytes), frozen.sha256);
  const value = JSON.parse(bytes);
  assert.equal(value.format, 'melody-studio-project'); assert.equal(value.version, 1);
  assert.equal(value.document.schemaVersion, 1); assert.equal(value.document.composition.tempo, 120);
  assert.equal(value.document.composition.title, FROZEN.fixtures[index].title + (revised ? ' revised' : ''));
  assert.equal(value.document.composition.tracks.length, 8);
  assert.equal(value.document.composition.tracks.reduce((sum, track) => sum + track.notes.length, 0), 2048);
  assert.equal(value.document.references.length, 8); assert.equal(value.assets.length, 8);
  for (let track = 0; track < 8; track++) {
    const asset = value.assets[track], pcm = Buffer.from(asset.pcmBase64, 'base64');
    assert.ok(UUID.test(asset.id)); assert.equal(asset.frameCount, FRAMES);
    assert.equal(asset.decodedSampleRate, RATE); assert.equal(pcm.length, PCM_BYTES);
    assert.equal(asset.sha256, FROZEN.fixtures[index].pcmSha256[track]); assert.equal(hash(pcm), asset.sha256);
    assert.deepEqual(value.document.references[track], { trackId: value.document.composition.tracks[track].id, assetId: asset.id });
    assert.equal(value.document.composition.tracks[track].notes.length, 256);
  }
  return value;
}
async function prepare(directory) {
  await mkdir(directory, { recursive: false, mode: 0o700 });
  const assetIds = new Set(), pcmHashes = new Set();
  for (let index = 0; index < 8; index++) {
    const value = original(index), bytes = Buffer.from(JSON.stringify(value)); assertOriginal(bytes, index);
    for (const asset of value.assets) { assert.ok(!assetIds.has(asset.id)); assetIds.add(asset.id);
      assert.ok(!pcmHashes.has(asset.sha256)); pcmHashes.add(asset.sha256); }
    await writeFile(join(directory, `original-${index + 1}.melody.json`), bytes, { flag: 'wx', mode: 0o600 });
    if (index === 0) {
      value.document.composition.title += ' revised';
      const revised = Buffer.from(JSON.stringify(value)); assertOriginal(revised, 0, true);
      await writeFile(join(directory, 'replacement.melody.json'), revised, { flag: 'wx', mode: 0o600 });
      const padded = Buffer.concat([bytes, Buffer.alloc(PARSER_BYTES - bytes.length, 32)]);
      assert.equal(hash(padded), FROZEN.parserBoundary.sha256);
      await writeFile(join(directory, 'parser-at-12MiB.melody.json'), padded, { flag: 'wx', mode: 0o600 });
      const excess = Buffer.concat([padded, Buffer.from(' ')]);
      assert.equal(hash(excess), FROZEN.parserBoundary.overflowSha256);
      await writeFile(join(directory, 'parser-over-12MiB.melody.json'), excess, { flag: 'wx', mode: 0o600 });
    }
  }
  assert.equal(assetIds.size, 64); assert.equal(pcmHashes.size, 64);
  await writeFile(join(directory, 'frozen.json'), JSON.stringify(FROZEN, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
function wavDecode(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);
  let at = 12, format, pcm;
  while (at + 8 <= bytes.length) {
    const name = bytes.toString('ascii', at, at + 4), size = bytes.readUInt32LE(at + 4);
    assert.ok(at + 8 + size <= bytes.length);
    if (name === 'fmt ') format = { encoding: bytes.readUInt16LE(at + 8), channels: bytes.readUInt16LE(at + 10),
      rate: bytes.readUInt32LE(at + 12), bits: bytes.readUInt16LE(at + 22) };
    if (name === 'data') { assert.equal(pcm, undefined); pcm = bytes.subarray(at + 8, at + 8 + size); }
    at += 8 + size + (size & 1);
  }
  assert.equal(at, bytes.length); assert.deepEqual(format, { encoding: 1, channels: 1, rate: RATE, bits: 16 });
  assert.ok(pcm && pcm.length % 2 === 0); return pcm;
}
function midiDecode(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'MThd'); assert.equal(bytes.readUInt32BE(4), 6);
  const result = { format: bytes.readUInt16BE(8), division: bytes.readUInt16BE(12), tracks: [] };
  const count = bytes.readUInt16BE(10); let at = 14;
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.toString('ascii', at, at + 4), 'MTrk');
    const end = at + 8 + bytes.readUInt32BE(at + 4); assert.ok(end <= bytes.length); at += 8;
    const track = { names: [], tempos: [], controls: [], notes: [], noteOffs: [], endTick: null };
    let tick = 0, running;
    const vlq = () => { let value = 0, byte, size = 0;
      do { assert.ok(at < end && size++ < 4); byte = bytes[at++]; value = value * 128 + (byte & 127); } while (byte & 128);
      return value; };
    while (at < end) {
      tick += vlq(); let status = bytes[at];
      if (status & 128) { at++; if (status < 240) running = status; }
      else { assert.ok(running); status = running; }
      if (status === 255) {
        const type = bytes[at++], length = vlq(); assert.ok(at + length <= end);
        if (type === 3) track.names.push(bytes.toString('utf8', at, at + length));
        if (type === 81) { assert.equal(length, 3); track.tempos.push(bytes.readUIntBE(at, 3)); }
        if (type === 47) { assert.equal(length, 0); track.endTick = tick; }
        at += length; running = undefined; continue;
      }
      assert.ok(status < 240); const kind = status >> 4, channel = status & 15;
      assert.ok(kind >= 8 && kind <= 14); const first = bytes[at++], second = kind === 12 || kind === 13 ? 0 : bytes[at++];
      assert.ok(first < 128 && second < 128 && at <= end);
      if (kind === 9 && second) track.notes.push({ tick, pitch: first, velocity: second, channel });
      if (kind === 8 || (kind === 9 && !second)) track.noteOffs.push({ tick, pitch: first, channel });
      if (kind === 11) track.controls.push({ controller: first, value: second, channel });
    }
    assert.equal(at, end); assert.equal(track.endTick, 61440); result.tracks.push(track);
  }
  assert.equal(at, bytes.length); return result;
}
function inspectMusic(midiBytes, wavBytes) {
  const midi = midiDecode(midiBytes); assert.equal(midi.format, 1); assert.equal(midi.division, 480); assert.equal(midi.tracks.length, 9);
  assert.deepEqual(midi.tracks[0].tempos, [500000]); assert.deepEqual(midi.tracks[0].names, ['Original library composition 1 revised']);
  assert.deepEqual(midi.tracks[1].notes, Array.from({ length: 256 }, (_, index) => ({
    tick: 120 + index * 240, pitch: 69 + index % 2 * 3, velocity: 102, channel: 0 })));
  assert.deepEqual(midi.tracks[1].noteOffs, Array.from({ length: 256 }, (_, index) => ({
    tick: 240 + index * 240, pitch: 69 + index % 2 * 3, channel: 0 })));
  for (let index = 1; index <= 8; index++) {
    assert.deepEqual(midi.tracks[index].names, [`Library voice ${index}`]);
    assert.deepEqual(midi.tracks[index].controls, [{ controller: 7, value: 64, channel: index - 1 }]);
    if (index > 1) { assert.deepEqual(midi.tracks[index].notes, []); assert.deepEqual(midi.tracks[index].noteOffs, []); }
  }
  const pcm = wavDecode(wavBytes), frames = pcm.length / 2; assert.equal(frames, 1412964);
  const expected = new Float64Array(frames);
  for (let note = 0; note < 256; note++) {
    const first = Math.round((.125 + .25 * note) * RATE), hz = 440 * 2 ** ((note % 2 * 3) / 12);
    for (let index = 0; index < Math.ceil(.205 * RATE) && first + index < frames; index++) {
      const seconds = index / RATE;
      const envelope = seconds < .01 ? seconds / .01 : seconds <= .125 ? 1 : Math.max(0, 1 - (seconds - .125) / .08);
      expected[first + index] += .16 * envelope * Math.sin(2 * Math.PI * hz * seconds);
    }
  }
  let maximumLsbError = 0;
  for (let index = 0; index < frames; index++) maximumLsbError = Math.max(maximumLsbError,
    Math.abs(pcm.readInt16LE(index * 2) - Math.round(expected[index] * (expected[index] < 0 ? 32768 : 32767))));
  assert.ok(maximumLsbError <= 2, `Independent sine/envelope WAV error ${maximumLsbError} exceeds two signed16 units.`);
  const interval = (start, end) => Float64Array.from({ length: Math.floor(end * RATE) - Math.ceil(start * RATE) },
    (_, index) => pcm.readInt16LE((Math.ceil(start * RATE) + index) * 2) / 32768);
  for (const [start, end] of [[0,.124],[.332,.374],[.582,.624]]) assert.ok(interval(start,end).every(sample => sample === 0));
  const frequencies = [[.15,.24,440],[.4,.49,523.2511306011972]].map(([start,end,hz]) => {
    const samples = interval(start,end), crossings = [];
    for (let index = 1; index < samples.length; index++) if (samples[index - 1] <= 0 && samples[index] > 0)
      crossings.push(index - 1 - samples[index - 1] / (samples[index] - samples[index - 1]));
    assert.ok(crossings.length > 20); const measured = (crossings.length - 1) * RATE / (crossings.at(-1) - crossings[0]);
    assert.ok(Math.abs(measured - hz) <= 1); return measured;
  });
  return { midi: { tracks: 9, ppqn: 480, audibleNotes: 256, tempoMicroseconds: 500000, endTick: 61440 },
    wav: { frames, rate: RATE, maximumLsbError, frequencies, leadingAndInternalSilenceExact: true, referencesNotMixed: true } };
}
async function browserPids(context) {
  const session = await context.browser().newBrowserCDPSession();
  try { return (await session.send('SystemInfo.getProcessInfo')).processInfo.filter(item => item.type === 'browser').map(item => item.id); }
  finally { await session.detach(); }
}
function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function run() {
  if (process.argv[2] === '--prepare-only') {
    assert.equal(process.argv.length, 4); const directory = resolve(process.argv[3]); await prepare(directory);
    console.log(JSON.stringify({ status: 'prepared', directory, compositions: 8, uniquePcmBytes: 56448000 })); return;
  }
  assert.equal(process.argv.length, 2, 'Use --prepare-only NEW_DIR, or explicit environment for the browser run.');
  assert.ok(process.env.MELODY_LIBRARY_BASE_URL, 'Supply the root-owned production preview origin.');
  const url = new URL(process.env.MELODY_LIBRARY_BASE_URL);
  assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.equal(url.pathname, '/'); assert.equal(url.search, ''); assert.equal(url.hash, '');
  assert.ok(process.env.MELODY_LIBRARY_FIXTURE_DIR, 'Prepare frozen originals first and supply their directory.');
  const fixtures = resolve(process.env.MELODY_LIBRARY_FIXTURE_DIR);
  const out = process.env.MELODY_LIBRARY_OUTPUT_DIR ? resolve(process.env.MELODY_LIBRARY_OUTPUT_DIR)
    : await mkdtemp(join(tmpdir(), 'melody-library-maximum-'));
  if (process.env.MELODY_LIBRARY_OUTPUT_DIR) await mkdir(out, { recursive: false, mode: 0o700 });
  const evidence = { schemaVersion: 1, issue: 126, status: 'running', origin: url.origin, output: out,
    startedAtUtc: new Date().toISOString(), frozen: FROZEN, artifacts: [], checks: [], processes: [], measured: {},
    bounds: { compositions: 8, tracksEach: 8, notesEach: 2048, referencesEach: 8,
      referenceFramesEach: FRAMES, uniquePcmBytes: 56448000, historyCapBytes: 67108864,
      originalBackupBytes: 76700576, finalBackupBytes: 76700584, maxRuntimeMilliseconds: RUNTIME_MS },
    limitations: ['Synthetic original reference PCM; no physical microphone claim.',
      'Parser whitespace boundaries are separate non-musical inputs, never advertised as musical capacity.',
      'This runner owns only two Chromium processes/profile and a new artifact directory; root owns preview/build.',
      'Browser quota and performance are observations on the selected Chromium machine, not cross-browser guarantees.'] };
  const save = () => writeFile(join(out, 'verification.json'), JSON.stringify(evidence, null, 2) + '\n');
  const begun = performance.now(); let context, page, timeout, cleanupError;
  const errors = [], external = [];
  await save();
  const artifact = async (name, bytes) => { await writeFile(join(out,name),bytes);
    evidence.artifacts.push({ name, bytes: bytes.length, sha256: hash(bytes) }); await save(); return bytes; };
  const download = async (control, name) => {
    const ready = page.waitForEvent('download', { timeout: 15000 }); await control.click();
    const item = await ready; await item.saveAs(join(out,name)); const bytes = await readFile(join(out,name));
    evidence.artifacts.push({ name, bytes: bytes.length, sha256: hash(bytes), suggestedFilename: item.suggestedFilename() }); await save(); return bytes;
  };
  const launch = async () => {
    context = await chromium.launchPersistentContext(join(out, 'profile'), {
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      headless: true, acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(15000); context.setDefaultNavigationTimeout(30000);
    evidence.processes.push({ phase: evidence.processes.length ? 'fresh-process' : 'initial', pids: await browserPids(context) });
    await context.addInitScript(() => {
      const observation = { armed: false, blobReads: [], lists: [] };
      Object.defineProperty(globalThis, '__libraryMaximumObservation', { value: observation });
      const record = (method, blob) => { if (observation.armed && observation.blobReads.length < 100)
        observation.blobReads.push({ method, bytes: blob?.size ?? null }); };
      for (const method of ['arrayBuffer','text','stream','bytes']) {
        const native = Blob.prototype[method]; if (!native) continue;
        Blob.prototype[method] = function (...args) { record('Blob.' + method, this); return native.apply(this,args); };
      }
      for (const method of ['readAsArrayBuffer','readAsText','readAsBinaryString','readAsDataURL']) {
        const native = FileReader.prototype[method]; if (!native) continue;
        FileReader.prototype[method] = function (...args) { record('FileReader.' + method, args[0]); return native.apply(this,args); };
      }
      const native = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.getAll = function (...args) {
        if (observation.armed && this.transaction.db.name === 'melody-studio.library' && observation.lists.length < 20)
          observation.lists.push({ store: this.name, mode: this.transaction.mode, count: args[1] ?? null });
        return native.apply(this,args);
      };
    });
    page = context.pages()[0]; page.on('pageerror', error => { if (errors.length < 100) errors.push(error.message.slice(0,1000)); });
    page.on('request', request => { const target = new URL(request.url());
      if (/^https?:$/.test(target.protocol) && target.origin !== url.origin && external.length < 100) external.push(target.origin); });
    page.on('dialog', dialog => dialog.accept());
    await page.goto(url.origin); await expect(button(page,'Save project file')).toBeEnabled({ timeout: 30000 });
    await expect(page.locator('#library-refresh')).toBeEnabled({ timeout: 15000 });
    evidence.chromium = context.browser().version(); await save();
  };
  const close = async () => {
    if (!context) return; const closing = context; context = null;
    const pids = await browserPids(closing); await closing.close();
    const afterClose = pids.map(pid => ({ pid, exists: processExists(pid) })); evidence.processes.at(-1).afterClose = afterClose;
    assert.ok(afterClose.every(item => !item.exists), 'The original Chromium browser process must terminate.'); await save();
  };
  const metadata = () => page.evaluate(async () => {
    const database = await new Promise((resolveOpen,reject) => {
      const request = indexedDB.open('melody-studio.library',1);
      request.onsuccess = () => resolveOpen(request.result); request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Library database did not already exist.')); };
    });
    try { return await new Promise((resolveRows,reject) => {
      const transaction = database.transaction('copies','readonly'); const request = transaction.objectStore('copies').getAll(undefined,9);
      let rows; request.onsuccess = () => { rows = request.result.map(row => ({ ...row, backup: undefined,
        keys: Object.keys(row).sort(), blobSize: row.backup.size, blobType: row.backup.type })); };
      transaction.oncomplete = () => resolveRows(rows.sort((a,b) => a.id.localeCompare(b.id)));
      transaction.onabort = () => reject(transaction.error); transaction.onerror = () => reject(transaction.error);
    }); } finally { database.close(); }
  });
  const rowsExpected = (rows, labels) => {
    assert.equal(rows.length, labels.length); assert.ok(rows.length <= 8);
    for (const row of rows) {
      assert.deepEqual(row.keys, ['backup','bytes','id','label','references','revision','schemaVersion','sha256','title','tracks']);
      assert.ok(UUID.test(row.id)); assert.ok(UUID.test(row.revision)); assert.equal(row.schemaVersion,1);
      assert.equal(row.tracks,8); assert.equal(row.references,8); assert.equal(row.blobType,'application/json');
      assert.equal(row.blobSize,row.bytes); assert.ok(labels.includes(row.label));
      const revised = row.label === 'Saved original 1 revised';
      const index = Number(row.label.match(/original (\d+)/)[1]) - 1;
      const frozen = revised ? FROZEN.replacement : FROZEN.fixtures[index];
      assert.equal(row.bytes,frozen.bytes); assert.equal(row.sha256,frozen.sha256);
      assert.equal(row.title,FROZEN.fixtures[index].title + (revised ? ' revised' : ''));
    }
    assert.equal(new Set(rows.map(row => row.id)).size,rows.length);
    assert.equal(new Set(rows.map(row => row.revision)).size,rows.length);
    const metadataBytes = Buffer.byteLength(JSON.stringify(rows.map(row => Object.fromEntries(
      Object.entries(row).filter(([key]) => !['backup','keys','blobSize','blobType'].includes(key))))));
    assert.ok(metadataBytes <= 16384, 'Stored canonical metadata must remain within the 16 KiB aggregate bound.');
  };
  const unchangedExcept = (before,after,excluded) => {
    for (const row of before.filter(item => item.id !== excluded)) assert.deepEqual(after.find(item => item.id === row.id),row);
  };
  const refresh = async () => { await page.locator('#library-refresh').click();
    await expect(page.locator('#library-refresh')).toBeEnabled(); };
  const importFile = async (path,title) => {
    await page.getByLabel('Open project file',{ exact: true }).setInputFiles(path);
    await expect(page.getByLabel('Project title')).toHaveValue(title,{ timeout: 30000 });
    await expect(page.locator('#save-status')).toHaveText('Saved in this browser',{ timeout: 30000 });
  };
  const select = async id => { await page.locator('#library-select').selectOption(id);
    await expect(page.locator('#library-select')).toHaveValue(id); };
  const open = async (id,title) => { await select(id); await page.locator('#library-open').click();
    await expect(page.getByLabel('Project title')).toHaveValue(title,{ timeout: 15000 });
    await expect(page.locator('#library-open')).toBeEnabled();
    await expect(page.locator('#save-status')).toHaveText('Saved in this browser',{ timeout: 30000 }); };
  const copyLabel = index => `Saved original ${index + 1}`;
  const labels = Array.from({ length: 8 },(_,index) => copyLabel(index));
  const workflow = async () => {
    const bytes = [];
    for (let index = 0; index < 8; index++) {
      const raw = await readFile(join(fixtures,`original-${index + 1}.melody.json`)); assertOriginal(raw,index); bytes.push(raw);
    }
    assert.deepEqual(JSON.parse(await readFile(join(fixtures,'frozen.json'))),FROZEN);
    const revisedBytes = await readFile(join(fixtures,'replacement.melody.json')); assertOriginal(revisedBytes,0,true);
    for (const [name,size,digest] of [['parser-at-12MiB.melody.json',PARSER_BYTES,FROZEN.parserBoundary.sha256],
      ['parser-over-12MiB.melody.json',PARSER_BYTES + 1,FROZEN.parserBoundary.overflowSha256]]) {
      const raw = await readFile(join(fixtures,name)); assert.equal(raw.length,size); assert.equal(hash(raw),digest);
    }
    await launch(); await refresh(); assert.deepEqual(await metadata(),[]);
    // Parser admission is explicitly independent from musical library capacity.
    await importFile(join(fixtures,'parser-at-12MiB.melody.json'),FROZEN.fixtures[0].title);
    await page.getByLabel('Open project file',{ exact: true }).setInputFiles(join(fixtures,'parser-over-12MiB.melody.json'));
    await expect(page.locator('[role="status"]').filter({ hasText: /12 MiB|at most|too large|size limit/i })).toHaveCount(1);
    const parserResult = await download(button(page,'Save project file'),'parser-refusal-current.melody.json');
    assert.deepEqual(parserResult,bytes[0]); evidence.checks.push('Exactly 12 MiB parser input admitted; 12 MiB + 1 refused with canonical workspace bytes unchanged.');
    for (let index = 0; index < 8; index++) {
      await importFile(join(fixtures,`original-${index + 1}.melody.json`),FROZEN.fixtures[index].title);
      const before = await metadata(); await page.locator('#library-label').fill(copyLabel(index));
      await page.locator('#library-create').click();
      await expect.poll(async () => (await metadata()).length,{ timeout: 15000 }).toBe(index + 1);
      await expect(page.locator('#library-refresh')).toBeEnabled();
      if (index !== 7) await expect(page.locator('#library-create')).toBeEnabled();
      const after = await metadata(); rowsExpected(after,labels.slice(0,index + 1)); unchangedExcept(before,after,null);
      assert.equal(await page.getByLabel('Project title').inputValue(),FROZEN.fixtures[index].title);
      evidence.measured[`created${index + 1}`] = { count: after.length, bytes: after.reduce((sum,row) => sum + row.bytes,0) }; await save();
    }
    const full = await metadata(); rowsExpected(full,labels); evidence.measured.originalRows = full;
    await page.locator('#library-label').fill('Ninth must refuse');
    if (await page.locator('#library-create').isEnabled()) {
      await page.locator('#library-create').click();
      await expect(page.locator('#library-status')).toContainText(/eight|8|full|limit|capacity/i);
      await expect(page.locator('#library-cancel')).toBeDisabled(); evidence.measured.ninthRefusal = 'Operation refused';
    } else evidence.measured.ninthRefusal = 'UI capacity admission disabled';
    assert.deepEqual(await metadata(),full); evidence.checks.push('Eight complete independent originals retained; ninth admission refused without changing any row.');
    // Arming observes genuine Blob/FileReader reads and the list cursor, while forwarding native calls unchanged.
    await expect(page.locator('#save-status')).toHaveText('Saved in this browser',{ timeout: 30000 });
    await page.evaluate(() => { const observation = globalThis.__libraryMaximumObservation;
      observation.blobReads = []; observation.lists = []; observation.armed = true; });
    await refresh();
    const observation = await page.evaluate(() => { const value = globalThis.__libraryMaximumObservation;
      value.armed = false; return { blobReads: value.blobReads, lists: value.lists }; });
    await artifact('refresh-observation.json',Buffer.from(JSON.stringify(observation,null,2)));
    assert.deepEqual(observation.blobReads,[]); assert.ok(observation.lists.length > 0);
    assert.ok(observation.lists.every(item => item.store === 'copies' && item.mode === 'readonly' && item.count === 9));
    assert.equal(await page.getByLabel('Project title').inputValue(),FROZEN.fixtures[7].title);
    assert.deepEqual(await metadata(),full); evidence.checks.push('Refresh inspected bounded native metadata/Blob handles only, with zero observed Blob or FileReader content reads.');
    const first = full.find(row => row.label === labels[0]); await open(first.id,FROZEN.fixtures[0].title);
    const field = page.getByLabel('Project title'); await field.fill(FROZEN.fixtures[0].title + ' revised'); await field.blur();
    await expect(page.locator('#save-status')).toHaveText('Saved in this browser',{ timeout: 30000 });
    await page.locator('#library-label').fill('Saved original 1 revised');
    await page.locator('#library-update').click();
    await expect.poll(async () => (await metadata()).find(row => row.id === first.id)?.revision).not.toBe(first.revision);
    await expect(page.locator('#library-refresh')).toBeEnabled();
    const updated = await metadata(); labels[0] = 'Saved original 1 revised'; rowsExpected(updated,labels); unchangedExcept(full,updated,first.id);
    evidence.checks.push('One explicitly confirmed replacement changes only selected bytes/revision/label; seven originals retain exact metadata.');
    const eighth = updated.find(row => row.label === labels[7]); await select(eighth.id);
    // Exercise deliberate cancellation of destructive confirmation, then the actual delete.
    page.removeAllListeners('dialog'); const dismissed = page.waitForEvent('dialog');
    const clicking = page.locator('#library-delete').click(); const dialog = await dismissed;
    assert.ok(dialog.message().includes(eighth.label)); await dialog.dismiss(); await clicking;
    page.on('dialog', item => item.accept()); assert.deepEqual(await metadata(),updated);
    await page.locator('#library-delete').click(); await expect.poll(async () => (await metadata()).length).toBe(7);
    const deleted = await metadata(); unchangedExcept(updated,deleted,eighth.id); assert.ok(!deleted.some(row => row.id === eighth.id));
    await importFile(join(fixtures,'original-8.melody.json'),FROZEN.fixtures[7].title);
    labels[7] = 'Saved original 8 recreated'; await page.locator('#library-label').fill(labels[7]);
    await page.locator('#library-create').click(); await expect.poll(async () => (await metadata()).length).toBe(8);
    await expect(page.locator('#library-refresh')).toBeEnabled();
    const final = await metadata(); rowsExpected(final,labels); unchangedExcept(deleted,final,null);
    assert.notEqual(final.find(row => row.label === labels[7]).id,eighth.id); evidence.measured.finalRows = final;
    evidence.checks.push('Canceled deletion retains eight rows; confirmed deletion removes one; recreation uses a distinct entry UUID and original audio graph.');
    for (let index = 0; index < 8; index++) {
      const row = final.find(item => item.label === labels[index]); await select(row.id);
      const saved = await download(page.locator('#library-download'),`selected-${index + 1}.melody.json`);
      assert.deepEqual(saved,index === 0 ? revisedBytes : bytes[index]); assertOriginal(saved,index,index === 0);
      assert.equal(await page.getByLabel('Project title').inputValue(),FROZEN.fixtures[7].title);
    }
    evidence.checks.push('All eight selected library downloads are byte exact; selection/download never opens or renames the current editor.');
    await close(); await launch();
    assert.notDeepEqual(evidence.processes[0].pids,evidence.processes[1].pids);
    await refresh(); assert.deepEqual(await metadata(),final);
    for (let index = 0; index < 8; index++) {
      const row = final.find(item => item.label === labels[index]); await open(row.id,row.title);
      const saved = await download(button(page,'Save project file'),`fresh-open-${index + 1}.melody.json`);
      assert.deepEqual(saved,index === 0 ? revisedBytes : bytes[index]); assertOriginal(saved,index,index === 0);
      if (index === 0) {
        const midi = await download(button(page,'Export MIDI'),'fresh-selected.mid');
        const wav = await download(button(page,'Export WAV'),'fresh-selected.wav');
        evidence.measured.music = inspectMusic(midi,wav);
      }
    }
    assert.deepEqual(await metadata(),final);
    evidence.checks.push('Original browser process terminated; a distinct fresh Chromium process reopened all eight exact complete copies and every original PCM digest.');
    evidence.checks.push('Selected reopened MIDI independently matches all note pitches/ticks; WAV matches scalar synthesis within two signed16 units, pitch and exact silence.');
    await page.screenshot({ path: join(out,'final-desktop.png') });
    assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
    for (let index = 0; index < 8; index++) assert.deepEqual(await readFile(join(fixtures,`original-${index + 1}.melody.json`)),bytes[index]);
    evidence.status = 'passed';
  };
  try {
    await Promise.race([workflow(),new Promise((_,reject) => { timeout = setTimeout(() => reject(new Error('Maximum acceptance exceeded 240-second runtime bound.')),RUNTIME_MS); })]);
  } catch (error) {
    evidence.status = 'failed'; evidence.failure = { message: String(error.message).slice(0,3000), stack: String(error.stack).slice(0,6000) };
    if (page && !page.isClosed()) { try { await page.screenshot({ path: join(out,'first-failure.png'),timeout: 5000 }); } catch { /* Keep primary failure. */ } }
    throw error;
  } finally {
    clearTimeout(timeout);
    try { await close(); } catch (error) {
      evidence.status = 'failed'; evidence.failure ??= { message: String(error.message).slice(0,3000), stack: String(error.stack).slice(0,6000) };
      cleanupError = error;
    } finally { evidence.milliseconds = performance.now() - begun;
      evidence.errors = errors; evidence.externalRequests = external; await save(); }
  }
  if (cleanupError) throw cleanupError;
  console.log(JSON.stringify({ status: evidence.status, output: out, milliseconds: evidence.milliseconds, chromium: evidence.chromium }));
}
run().catch(error => { console.error(String(error.message).slice(0,3000)); process.exitCode = 1; });
