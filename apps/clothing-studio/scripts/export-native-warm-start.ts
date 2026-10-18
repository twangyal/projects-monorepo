/** Fixed research fixture only. No user data or remote compute. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import Delaunator from 'delaunator';
import {template} from '../src/product.ts';
import {captureGarmentWarmStart} from '../src/native-garment-warm-start.ts';
if(process.argv.length!==3||!process.argv[2].endsWith('.json.gz'))throw new Error('Usage: export-native-warm-start.ts /absolute/new-warm-start.json.gz');
const started=performance.now(),packet=captureGarmentWarmStart(template('blank'),94,{},Delaunator);
const paths=['src/product.ts','src/media.ts','src/garment-drape.ts','src/native-garment-snapshot.ts','scripts/export-native-garment.ts','package-lock.json','src/native-garment-warm-start.ts','scripts/export-native-warm-start.ts'];
const source_sha256=Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(fileURLToPath(new URL('../'+path,import.meta.url)))).digest('hex')]));
const data=gzipSync(Buffer.from(JSON.stringify({fixture:'blank-tee-94cm-body-growth45-v1',source_sha256,packet})+'\n'),{level:9});
writeFileSync(process.argv[2],data,{flag:'wx'});
console.log(JSON.stringify({bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),wall_ms:performance.now()-started,metrics:packet.metrics}));
