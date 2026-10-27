// Assembles the unpacked Chrome extension in dist/extension from the app's own modules.
// WebGazer is fetched with npm (registry integrity) and pinned again by SHA-256. WebGazer's face models are bundled
// too (pinned by SHA-256), so the camera never downloads them at run time.
//   node scripts/build-extension.js            -> dist/extension
//   node scripts/build-extension.js --test     -> dist/extension-test (fake estimator, host access pre-granted)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vendorWaterSheep } from './vendor-watersheep.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const testBuild = process.argv.includes('--test');
const out = join(root, 'dist', testBuild ? 'extension-test' : 'extension');
const WEBGAZER = { version: '3.3.0', sha256: 'fdf7ed078859bec747623982baa84fc690326e27c33c4d64aaa4d59b534d89e3' };
const SHARED = ['gaze-filter.js', 'camera-loader.js', 'camera-calibration.js', 'camera-cleanup.js', 'camera-retirement.js'];

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// The TensorFlow.js models WebGazer would otherwise fetch from tfhub.dev on every camera start.
export const FACE_MODELS = [
  { name: 'blazeface', path: 'tensorflow/tfjs-model/blazeface/1/default/1', files: {
    'model.json': '7b6bb6f35e5a7899232de51dda8bf514ef9664ca7ec58388c9fecc088c883b58',
    'group1-shard1of1.bin': '60b481ab6c19352673cdb21e02e639f90883db1393ac52d07c7ea4e1e11cb2cd' } },
  { name: 'facemesh', path: 'mediapipe/tfjs-model/facemesh/1/default/1', files: {
    'model.json': 'c922985d95e101e7fe56576a9a00366c72d3fab3604ce371cc9d85394abda99c',
    'group1-shard1of1.bin': 'f4a7075c1fff12ceafd2cd6fc000a464da90b1e0c35236971ed5bb3b343366cb' } },
  { name: 'iris', path: 'mediapipe/tfjs-model/iris/1/default/2', files: {
    'model.json': '934baa53c85d37c4e22ef46e63183b99a641710411ca3af0a362331174e71e38',
    'group1-shard1of1.bin': 'd7f296d184274213d4642681ae186112cbbec77fd2ab066257d3c56a1940bc71' } },
];

function faceModels(target) {
  for (const model of FACE_MODELS) {
    const cache = join(root, 'dist', '.cache', 'face-models', model.name);
    mkdirSync(cache, { recursive: true });
    for (const [file, expected] of Object.entries(model.files)) {
      const local = join(cache, file);
      if (!existsSync(local) || sha256(local) !== expected) {
        execFileSync('curl', ['-fsSL', '--retry', '3', '-o', local, `https://tfhub.dev/${model.path}/${file}?tfjs-format=file`]);
      }
      const actual = sha256(local);
      if (actual !== expected) {
        rmSync(local, { force: true });
        throw new Error(`Face model ${model.name}/${file} checksum mismatch: ${actual}`);
      }
      mkdirSync(join(target, model.name), { recursive: true });
      cpSync(local, join(target, model.name, file));
    }
  }
}

function webgazer() {
  const cache = join(root, 'dist', '.cache', `webgazer-${WEBGAZER.version}`);
  const bundle = join(cache, 'package', 'dist', 'webgazer.js');
  if (!existsSync(bundle)) {
    mkdirSync(cache, { recursive: true });
    const download = mkdtempSync(join(cache, 'pack-'));
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const [file] = JSON.parse(execFileSync(npm, ['pack', `webgazer@${WEBGAZER.version}`, '--json', '--pack-destination', download], { encoding: 'utf8' }));
    execFileSync('tar', ['-xzf', join(download, file.filename), '-C', cache, 'package/dist/webgazer.js', 'package/LICENSE.md']);
    rmSync(download, { recursive: true, force: true });
  }
  const actual = sha256(bundle);
  if (actual !== WEBGAZER.sha256) {
    rmSync(cache, { recursive: true, force: true });
    throw new Error(`WebGazer ${WEBGAZER.version} checksum mismatch: ${actual}`);
  }
  return { bundle, license: join(cache, 'package', 'LICENSE.md') };
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'src', 'web'), { recursive: true });
mkdirSync(join(out, 'vendor'), { recursive: true });
for (const file of readdirSync(join(root, 'extension'))) cpSync(join(root, 'extension', file), join(out, file));
for (const file of readdirSync(join(root, 'src', 'web')).filter(name => name.endsWith('.js') && name !== 'boot.js')) {
  cpSync(join(root, 'src', 'web', file), join(out, 'src', 'web', file));
}
for (const file of SHARED) cpSync(join(root, 'src', file), join(out, 'src', file));

const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
if (testBuild) {
  cpSync(join(root, 'test-support', 'fake-webgazer.js'), join(out, 'vendor', 'webgazer.js'));
  // Automated browsers cannot click a permission prompt, so the test build is granted host access.
  manifest.host_permissions = manifest.optional_host_permissions;
  delete manifest.optional_host_permissions;
  manifest.name += ' (test build)';
} else {
  const { bundle, license } = webgazer();
  cpSync(bundle, join(out, 'vendor', 'webgazer.js'));
  cpSync(license, join(out, 'vendor', 'WEBGAZER-LICENSE.md'));
  faceModels(join(out, 'vendor', 'face-models'));
  // Smarter matching: the pinned runtime is bundled; the model downloads on request in the offscreen page.
  vendorWaterSheep(join(out, 'vendor', 'watersheep'));
  writeFileSync(join(out, 'vendor', 'assistant.js'), `import { loadWaterSheepInBrowser } from '../src/web/watersheep-browser.js';
export const loadAssistantModel = progress => loadWaterSheepInBrowser({ runtimeBase: chrome.runtime.getURL('vendor/watersheep/'), progress });
`);
}
if (testBuild) {
  cpSync(join(root, 'test-support', 'fake-assistant.js'), join(out, 'vendor', 'assistant.js'));
  cpSync(join(root, 'test-support', 'fake-speech.js'), join(out, 'vendor', 'speech.js'));
  // Only the test capture page installs a controlled recognizer; production always uses Chrome's API.
  const capture = join(out, 'capture.html');
  writeFileSync(capture, readFileSync(capture, 'utf8').replace('<body>', '<body><script src="vendor/speech.js"></script>'));
}
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built ${out}`);
