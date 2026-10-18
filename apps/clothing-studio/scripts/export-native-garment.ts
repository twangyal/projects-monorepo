/** Fixed synthetic research garment. No user project or uploaded image is read. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import Delaunator from 'delaunator';
import { template } from '../src/product.ts';
import { captureNativeGarment } from '../src/native-garment-snapshot.ts';

if (process.argv.length !== 3 || !process.argv[2].endsWith('.json.gz')) throw new Error('Usage: node --experimental-strip-types scripts/export-native-garment.ts /absolute/new-packet.json.gz');
const packet = captureNativeGarment(template('blank'),94,{},Delaunator);
const source_sha256 = Object.fromEntries(['src/product.ts','src/media.ts','src/garment-drape.ts','src/native-garment-snapshot.ts','scripts/export-native-garment.ts','package-lock.json'].map(path => [path,createHash('sha256').update(readFileSync(fileURLToPath(new URL('../'+path,import.meta.url)))).digest('hex')]));
const envelope = { fixture:'blank-tee-94cm-body-v1', source_sha256, packet };
const data = gzipSync(Buffer.from(JSON.stringify(envelope)+'\n'),{level:9});
writeFileSync(process.argv[2],data,{flag:'wx'});
console.log(JSON.stringify({bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),particles:packet.positions_m.length/3,triangles:packet.parts.reduce((n,p)=>n+p.triangles.length/3,0)}));
