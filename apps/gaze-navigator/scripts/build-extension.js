// Assembles the unpacked Chrome extension in dist/extension from the app's own modules.
// WebGazer is fetched with npm (registry integrity) and pinned again by SHA-256.
//   node scripts/build-extension.js            -> dist/extension
//   node scripts/build-extension.js --test     -> dist/extension-test (fake estimator, host access pre-granted)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const testBuild = process.argv.includes('--test');
const out = join(root, 'dist', testBuild ? 'extension-test' : 'extension');
const WEBGAZER = { version: '3.3.0', sha256: 'fdf7ed078859bec747623982baa84fc690326e27c33c4d64aaa4d59b534d89e3' };
const SHARED = ['gaze-filter.js', 'camera-loader.js', 'camera-calibration.js', 'camera-cleanup.js', 'camera-retirement.js'];

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
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
}
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built ${out}`);
