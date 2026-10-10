// Actual Chromium/WASM test; no network model downloads or product edits.
import {createServer} from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const here = '/workspace/scratch/dea0b0842cca/projects-monorepo/docs/research/lens-depth-baseline/browser-2026-10-10';
const scratch = process.env.LENS_PROBE_DATA ?? '/tmp/lens-depth-web';
const dist = resolve(scratch, 'node_modules/onnxruntime-web/dist');
const {chromium} = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE ?? resolve(here, '../../../../apps/lens-studio/node_modules/playwright/index.mjs')));
const sha = data => createHash('sha256').update(data).digest('hex');
const metadata = JSON.parse(await readFile(resolve(scratch, 'tensor-provenance.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(here, '../extension-2026-10-10/frozen-portrait.json'), 'utf8'));
const paths = new Map([
  ['/', resolve(here, 'probe.html')], ['/worker.js', resolve(here, 'worker.js')],
  ['/model', process.env.LENS_PROBE_MODEL ?? '/tmp/lens-depth-model.onnx'],
  ['/input', resolve(scratch, 'input.bin')], ['/cpu', resolve(scratch, 'cpu.bin')],
  ...['ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'].map(name => ['/ort/' + name, resolve(dist, name)])
]);
const files = new Map();
for (const [route, path] of paths) files.set(route, await readFile(path));
assert.equal(sha(files.get('/model')), manifest.model.sha256);
assert.equal(sha(files.get('/input')), metadata.capture.input.sha256);
assert.equal(sha(files.get('/cpu')), '0ca318bb7b95922a5eb0a6c7aa9ed5e0ea8da5cacc639a1a050dd762626c4f70');
assert.equal(metadata.capture.cpu.sha256, sha(files.get('/cpu')));
const packageInfo = JSON.parse(await readFile(resolve(dist, '../package.json'), 'utf8'));
assert.equal(packageInfo.version, '1.23.2');
const requests = [], consoleMessages = [];
const server = createServer((request, response) => {
  const route = request.url;
  requests.push(route);
  if (!files.has(route)) {response.writeHead(404); response.end(); return;}
  const type = route.endsWith('.wasm') ? 'application/wasm' : route.endsWith('.js') || route.endsWith('.mjs') ? 'text/javascript' : route === '/' ? 'text/html' : 'application/octet-stream';
  response.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store'}); response.end(files.get(route));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-zygote', '--in-process-gpu', '--disable-gpu', '--disable-software-rasterizer']});
  const diagnostic = await browser.newBrowserCDPSession();
  await diagnostic.send('Target.setDiscoverTargets', {discover:true});
  const targetEvents=[];
  for(const kind of ['targetCreated','targetDestroyed','targetInfoChanged']) diagnostic.on('Target.'+kind, value=>{targetEvents.push({kind,epochMs:Date.now(),value});console.log('TARGET_EVENT',JSON.stringify(targetEvents.at(-1)));});
  const snapshot=async label=>{const info=(await diagnostic.send('Target.getTargets')).targetInfos.filter(x=>x.type==='worker');console.log('TARGET_SNAPSHOT',JSON.stringify({label,epochMs:Date.now(),info}));return info;};
  const context = await browser.newContext();
  const unexpectedNetwork = [];
  await context.route('**/*', route => {if (route.request().url().startsWith(origin + '/')) return route.continue(); unexpectedNetwork.push(route.request().url()); return route.abort();});
  const page = await context.newPage();
  page.on('console', message => consoleMessages.push({type: message.type(), text: message.text()}));
  page.on('pageerror', error => consoleMessages.push({type: 'pageerror', text: String(error)}));
  let runningResolve;
  const running = new Promise(resolve => {runningResolve = resolve;});
  await page.exposeFunction('notifyStage', stage => {if (!stage.cancel && stage.stage === 'running' && stage.round === 0) runningResolve(stage);});
  await page.goto(origin);
  const config = {modelSha: manifest.model.sha256, inputSha: metadata.capture.input.sha256, cpuSha: metadata.capture.cpu.sha256, pairs: manifest.pairs};
  await assert.rejects(page.evaluate(config => window.startProbe({...config, inputSha: '0'.repeat(64)}, false), config), /Checksum mismatch: \/input/);
  const normalPromise = page.evaluate(config => window.startProbe(config, false), config);
  await Promise.race([running, normalPromise.then(() => {throw new Error("Inference completed before its running-stage observation");})]);
  const clickStart = performance.now();
  await page.locator('#response').click({timeout: 10000});
  const nativeClickMs = performance.now() - clickStart;
  assert.equal(await page.locator('#clicks').textContent(), '1');
  const normal = await normalPromise;
  assert.equal(normal.runs.length, 2);
  const nativeClickEpochMs = await page.evaluate(() => window.clickEpochMs);
  const nativeClickInsideSessionRun = normal.runs.some(run => run.startedEpochMs <= nativeClickEpochMs && nativeClickEpochMs <= run.finishedEpochMs);
  assert.equal(nativeClickInsideSessionRun, true, 'Native click must occur inside an actual session.run interval');
  assert.equal(normal.runs[0].rawSha256, normal.runs[1].rawSha256);
  await snapshot('after-normal');
  const cancel = await page.evaluate(config => window.startProbe(config, true), config);
  assert.equal(cancel.cancelled, true);
  await snapshot('immediately-after-cancel');
  const stagesAtCancel = await page.evaluate(() => window.stages.length);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.stages.length), stagesAtCancel);
  assert.equal(await page.evaluate(() => window.lateMessages), 0);
  const cdp = await browser.newBrowserCDPSession();
  const remainingWorkers = (await cdp.send('Target.getTargets')).targetInfos.filter(info => info.type === 'worker');

  await cdp.detach();
  assert.deepEqual(unexpectedNetwork, []);
  const receipt = {scope: 'Actual worker WASM runtime probe on the frozen portrait tensor, not product end-to-end inference or quality acceptance', createdUtc: new Date().toISOString(), browser: await browser.version(), userAgent: await page.evaluate(() => navigator.userAgent), runtimeVersion: packageInfo.version, tensorProvenance: metadata, modelSha256: manifest.model.sha256, servedFileSha256: Object.fromEntries([...files].map(([route, bytes]) => [route, sha(bytes)])), normal, nativeClickDuringInferenceMs: nativeClickMs, nativeClickEpochMs, nativeClickInsideSessionRun, nativeClicks: 1, cancel, postCancelObservationMs: 500, postCancelLateMessages: 0, mismatchedInputHashRefused: true, remainingNativeWorkerTargets: remainingWorkers.length, remainingWorkerTargets: remainingWorkers, lifecycleRetirementPassed: remainingWorkers.length === 0, unexpectedNetworkRequests: unexpectedNetwork.length, requests, consoleMessages, limitations: ['Pillow-prepared fixed tensor; browser photo preprocessing and product ownership are not evaluated', 'Single-thread CPU WASM only; WebGPU, multithreading, mobile and physical devices unrun', 'Native worker target retirement does not measure full memory reclamation', 'No total browser/WASM memory measurement or resource guarantee', 'Numeric differences from CPU are measured without a post-hoc tolerance acceptance gate', 'Cancellation is research-worker termination, not product cancellation/stale-result integration']};
  await writeFile(resolve(scratch, 'browser-result.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
  assert.equal(remainingWorkers.length, 0, "Worker targets must retire; inspect retained browser-result.json for actual observations");
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
