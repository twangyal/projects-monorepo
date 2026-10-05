import { deflateSync } from 'node:zlib';

// Original literals, deliberately independent of producer model/transform/render helpers.
export interface OracleStroke { color: string; width: number; points: { x: number; y: number }[] }
interface Pose { frame: number; x: number; y: number; scale: number; rotation: number; opacity: number; easing: 'linear' }
interface Drawing { id: string; name: string; kind: 'drawing'; keys: Pose[]; cels: { frame: number; strokes: OracleStroke[] }[] }
interface ImageLayer { id: string; name: string; kind: 'image'; keys: Pose[]; image: { dataUrl: string; width: number; height: number } }
export interface OracleProject { schemaVersion: 2; title: string; background: string; frameCount: number; layers: [Drawing, Drawing, ImageLayer] }
const pose = (frame: number, x: number, y: number, scale = 1, rotation = 0): Pose => ({ x, y, scale, rotation, opacity: 1, frame, easing: 'linear' });
function crc(bytes: Buffer) { let n = 0xffffffff; for (const byte of bytes) { n ^= byte; for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); } return (n ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) { const name = Buffer.from(type), result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); name.copy(result, 4); data.copy(result, 8); result.writeUInt32BE(crc(Buffer.concat([name, data])), data.length + 8); return result; }
export function strokeOraclePng() {
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 6;
  // Two independent filter-zero RGBA rows: opaque magenta, four pixels total.
  const row = [0, 255, 0, 255, 255, 255, 0, 255, 255];
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([...row, ...row]))), chunk('IEND', Buffer.alloc(0))]);
}
export function originalStrokeProject(media = false): OracleProject {
  const strokes: OracleStroke[] = media ? [
    { color: '#ff0000', width: 12, points: [{ x: -60, y: 0 }, { x: 60, y: 0 }] },
    { color: '#0000ff', width: 8, points: [{ x: -20, y: 0 }, { x: 20, y: 0 }] },
    { color: '#00ff00', width: 10, points: [{ x: -100, y: -60 }] },
    { color: '#ffff00', width: 8, points: [{ x: -80, y: 60 }, { x: -80, y: 60 }] },
  ] : [
    { color: '#ff0000', width: 6, points: [{ x: 0, y: 5 }, { x: 20, y: 5 }] },
    { color: '#0000ff', width: 4, points: [{ x: 5, y: 5 }, { x: 15, y: 5 }] },
    { color: '#00ff00', width: 10, points: [{ x: 35, y: 10 }] },
    { color: '#ffff00', width: 8, points: [{ x: 45, y: 20 }, { x: 45, y: 20 }] },
  ];
  return { schemaVersion: 2, title: media ? 'Original exported stroke exposure' : 'Original retained stroke study', background: '#ffffff', frameCount: 12, layers: [
    { id: 'paint', name: 'Paint', kind: 'drawing', keys: [media ? pose(0, 320, 180) : pose(0, 200, 100, 2, 90)], cels: [{ frame: 0, strokes }, { frame: 6, strokes: structuredClone(strokes) }] },
    { id: 'control', name: 'Moving cyan control', kind: 'drawing', keys: [pose(0, 450, 280), pose(11, 494, 280)], cels: [{ frame: 0, strokes: [{ color: '#00ffff', width: 12, points: [{ x: 0, y: 0 }] }] }] },
    { id: 'image', name: 'Original magenta image', kind: 'image', keys: [pose(0, 550, 40, 4)], image: { dataUrl: `data:image/png;base64,${strokeOraclePng().toString('base64')}`, width: 2, height: 2 } },
  ] };
}
export function literalMovedProject() { const result = originalStrokeProject(); result.layers[0].cels[0].strokes[1].points = [{ x: 0, y: -5 }, { x: 10, y: -5 }]; return result; }
export function literalMediaEdit() { const result = originalStrokeProject(true); result.layers[0].cels[0].strokes[1].points = [{ x: -20, y: 40 }, { x: 20, y: 40 }]; return result; }
export const gifDelays = [80, 90, 80, 80, 90, 80, 80, 90, 80, 80, 90, 80];
