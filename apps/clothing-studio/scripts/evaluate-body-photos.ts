// Scores (and refits) the body-from-photos estimates on BodyM (Amazon, CC BY-NC 4.0): front and side outlines of people
// in the photo pose, with tape measurements. The data is not committed; --download fetches what is used (the first
// photo pair of each person, about 15 KB each) from the public bucket into DIR.
//
//   node --experimental-strip-types scripts/evaluate-body-photos.ts DIR [--download] [--train 400]
//
// It fits girth = a·width + b·depth + c (and a·width + c without a side photo) on `train`, prints the coefficients for
// FIT in src/body-photo.ts, and reports mean absolute errors on `testA` for those fits and for the ones in FIT now.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { FIT, measureFront, measureSide, type FrontMeasure, type Mask, type SideMeasure } from '../src/body-photo.ts';

const BUCKET = 'https://amazon-bodym.s3.amazonaws.com';
const args = process.argv.slice(2), dir = args[0];
if (!dir) throw new Error('Usage: evaluate-body-photos.ts DIR [--download] [--train N]');
const trainLimit = Number(args[args.indexOf('--train') + 1] ?? 400) || 400;
type Level = 'chest' | 'waist' | 'hip';
const LEVELS: Level[] = ['chest', 'waist', 'hip'];

/** 8-bit, non-interlaced PNG to a person mask (grey above half). */
function decodePng(bytes: Buffer): Mask {
  let width = 0, height = 0, channels = 1;
  const parts: Buffer[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at), type = bytes.toString('latin1', at + 4, at + 8), body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0) throw new Error('Only 8-bit, non-interlaced PNG masks are read.');
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[body[9]!]!;
    }
    if (type === 'IDAT') parts.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts)), stride = width * channels, data = new Uint8Array(width * height);
  let line = new Uint8Array(stride), previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!, row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels]! : 0, b = previous[x]!, c = x >= channels ? previous[x - channels]! : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predicted = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      line[x] = (row[x]! + predicted) & 255;
    }
    for (let x = 0; x < width; x++) data[y * width + x] = line[x * channels]! > 127 ? 1 : 0;
    [line, previous] = [previous, line];
  }
  return { width, height, data };
}

function table(path: string): Record<string, string>[] {
  const [head, ...rows] = readFileSync(path, 'utf8').trim().split('\n');
  const keys = head!.split(',');
  return rows.map(row => Object.fromEntries(row.split(',').map((value, i) => [keys[i]!, value])));
}

async function fetched(url: string, path: string): Promise<void> {
  if (existsSync(path)) return;
  const reply = await fetch(url);
  if (!reply.ok) throw new Error(`${url}: ${reply.status}`);
  writeFileSync(path, Buffer.from(await reply.arrayBuffer()));
}

interface Person { height: number; truth: Record<Level | 'bicep', number>; front: FrontMeasure; side: SideMeasure }

async function load(split: string, limit: number): Promise<Person[]> {
  const base = join(dir!, split);
  for (const folder of ['mask', 'mask_left']) mkdirSync(join(base, folder), { recursive: true });
  for (const name of ['hwg_metadata.csv', 'measurements.csv', 'subject_to_photo_map.csv']) if (args.includes('--download')) await fetched(`${BUCKET}/${split}/${name}`, join(base, name));
  const heights = new Map(table(join(base, 'hwg_metadata.csv')).map(row => [row.subject_id!, Number(row.height_cm)]));
  const truth = new Map(table(join(base, 'measurements.csv')).map(row => [row.subject_id!, row]));
  const photos = new Map<string, string>();
  for (const row of table(join(base, 'subject_to_photo_map.csv'))) if (!photos.has(row.subject_id!)) photos.set(row.subject_id!, row.photo_id!);
  const people: Person[] = [];
  let refused = 0;
  for (const [subject, photo] of [...photos].slice(0, limit)) {
    const paths = ['mask', 'mask_left'].map(folder => join(base, folder, `${photo}.png`));
    if (args.includes('--download')) for (const [i, folder] of ['mask', 'mask_left'].entries()) await fetched(`${BUCKET}/${split}/${folder}/${photo}.png`, paths[i]!);
    const row = truth.get(subject), height = heights.get(subject);
    if (!row || !height || !paths.every(existsSync)) continue;
    try {
      const front = measureFront(decodePng(readFileSync(paths[0]!)), height), side = measureSide(decodePng(readFileSync(paths[1]!)), height, front.levels);
      people.push({ height, truth: { chest: +row.chest!, waist: +row.waist!, hip: +row.hip!, bicep: +row.bicep! }, front, side });
    } catch { refused++; }
  }
  console.log(`${split}: ${people.length} measured, ${refused} refused (arms touching the body, or the body not wholly in the photo)`);
  return people;
}

/** Least squares for coefficients x in rows·x ≈ y (normal equations; a few unknowns). */
function leastSquares(rows: number[][], y: number[]): number[] {
  const n = rows[0]!.length, a = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0));
  rows.forEach((row, k) => { for (let i = 0; i < n; i++) { a[i]![n]! += row[i]! * y[k]!; for (let j = 0; j < n; j++) a[i]![j]! += row[i]! * row[j]!; } });
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) { const f = a[j]![i]! / a[i]![i]!; for (let k = i; k <= n; k++) a[j]![k]! -= f * a[i]![k]!; }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = a[i]![n]!; for (let k = i + 1; k < n; k++) s -= a[i]![k]! * x[k]!; x[i] = s / a[i]![i]!; }
  return x;
}
const median = (values: number[]) => [...values].sort((p, q) => p - q)[values.length >> 1]!;
const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
const summary = (errors: number[]) => ({ meanAbsoluteError: round(errors.reduce((s, e) => s + e, 0) / errors.length, 1), within3cm: round(errors.filter(e => e <= 3).length / errors.length, 2), within5cm: round(errors.filter(e => e <= 5).length / errors.length, 2) });

const train = await load('train', trainLimit), test = await load('testA', Infinity);
const fitted: Record<string, unknown> = {};
const score: Record<string, unknown> = {};
for (const level of LEVELS) {
  const side = leastSquares(train.map(p => [p.front.widths[level], p.side.depths[level], 1]), train.map(p => p.truth[level]));
  const front = leastSquares(train.map(p => [p.front.widths[level], 1]), train.map(p => p.truth[level]));
  const depth = median(train.map(p => p.side.depths[level] / p.front.widths[level]));
  fitted[level] = { side: side.map(c => round(c)), front: front.map(c => round(c)), depth: round(depth) };
  const now = FIT.girth[level];
  score[level] = {
    withSide: summary(test.map(p => Math.abs(now.side[0] * p.front.widths[level] + now.side[1] * p.side.depths[level] + now.side[2] - p.truth[level]))),
    frontOnly: summary(test.map(p => Math.abs(now.front[0] * p.front.widths[level] + now.front[1] - p.truth[level]))),
  };
}
const arms = train.filter(p => p.front.widths.arm);
fitted.armGirth = round(median(arms.map(p => p.truth.bicep / (Math.PI * p.front.widths.arm!))));
score.upperArm = summary(test.filter(p => p.front.widths.arm).map(p => Math.abs(Math.PI * p.front.widths.arm! * FIT.armGirth - p.truth.bicep)));
console.log(JSON.stringify({ refit: fitted }, null, 1));
console.log(JSON.stringify({ testA: { people: test.length, ...score } }, null, 1));
