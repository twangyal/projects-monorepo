// Fetches the browser runtime WaterSheep needs (ONNX Runtime Web's self-contained wasm build and the
// Hugging Face tokenizer) with npm, pins every file by SHA-256, and copies them to dist/vendor/watersheep.
// The model itself is not vendored: the navigator downloads it on request (see watersheep-browser.js).
//   node scripts/vendor-watersheep.js
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RUNTIME_DIR = join(root, 'dist', 'vendor', 'watersheep');
const PACKAGES = [
  { name: 'onnxruntime-web', version: '1.23.0', license: 'MIT', files: {
    'dist/ort.wasm.bundle.min.mjs': '9bfe69fdc86a6ce7aacaccfada8d3124237328efd61eac0e594832488ef3457d',
    'dist/ort-wasm-simd-threaded.wasm': '3260fcdb33b4fc4ec33e89caf392e13625823e01049d3bf32c38464f9dbfe14c',
  } },
  { name: '@huggingface/tokenizers', version: '0.2.0', license: 'Apache-2.0', files: {
    'dist/tokenizers.min.mjs': '258e46332101335ce8d95aed7745b19ac3b46d37f3e159a89cf894c2ea9b1d3a',
    LICENSE: 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4',
  } },
];

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');

function unpack({ name, version, files }) {
  const cache = join(root, 'dist', '.cache', `${name.replace('/', '__')}-${version}`);
  if (!Object.keys(files).every(file => existsSync(join(cache, 'package', file)))) {
    rmSync(cache, { recursive: true, force: true });
    mkdirSync(cache, { recursive: true });
    const download = mkdtempSync(join(cache, 'pack-'));
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const [packed] = JSON.parse(execFileSync(npm, ['pack', `${name}@${version}`, '--json', '--pack-destination', download], { encoding: 'utf8' }));
    execFileSync('tar', ['-xzf', join(download, packed.filename), '-C', cache, ...Object.keys(files).map(file => `package/${file}`)]);
    rmSync(download, { recursive: true, force: true });
  }
  for (const [file, expected] of Object.entries(files)) {
    const actual = sha256(join(cache, 'package', file));
    if (actual !== expected) {
      rmSync(cache, { recursive: true, force: true });
      throw new Error(`${name}@${version} ${file} checksum mismatch: ${actual}`);
    }
  }
  return join(cache, 'package');
}

export function vendorWaterSheep(out = RUNTIME_DIR) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const notices = [];
  for (const pkg of PACKAGES) {
    const dir = unpack(pkg);
    for (const file of Object.keys(pkg.files)) {
      const target = file === 'LICENSE' ? `${pkg.name.split('/').pop().toUpperCase()}-LICENSE` : file.split('/').pop();
      cpSync(join(dir, file), join(out, target));
    }
    notices.push(`${pkg.name}@${pkg.version} (${pkg.license})`);
  }
  writeFileSync(join(out, 'NOTICE.txt'), `Browser runtime for WaterSheep target choice, fetched with npm and pinned by SHA-256:\n${notices.join('\n')}\n` +
    'ONNX Runtime is MIT-licensed by Microsoft Corporation. The WaterSheep model (Apache-2.0) is downloaded on request, not bundled.\n');
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log(`Vendored ${vendorWaterSheep()}`);
