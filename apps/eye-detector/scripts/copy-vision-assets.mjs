import { cp, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

const source = fileURLToPath(new URL('../node_modules/@mediapipe/face_mesh/', import.meta.url));
const destination = fileURLToPath(new URL('../public/vision/', import.meta.url));
await mkdir(destination, { recursive: true });
for (const name of await readdir(source)) {
  if (/\.(js|wasm|data|binarypb)$/.test(name)) await cp(`${source}/${name}`, `${destination}/${name}`);
}
console.log('Local MediaPipe assets ready.');
