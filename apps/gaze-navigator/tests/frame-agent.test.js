import assert from 'node:assert/strict';
import test from 'node:test';

// Run the frame agent with a fake extension relay and two captures that both label their first control 1.
async function frameAgent(t, agent = 'first') {
  let listener, now = 0;
  t.mock.method(globalThis.performance, 'now', () => now);
  const events = new EventTarget();
  globalThis.window = { top: {}, addEventListener: events.addEventListener.bind(events), setTimeout: () => 1, clearTimeout: () => {} };
  globalThis.document = {};
  const capture = `export const captureContext = (_, { x }) => ({ elements: [{ id: 1, name: 'Control ' + x, rect: {} }] });`;
  const controller = `export const createController = () => ({ run: (_, context) => ({ tone: 'success', message: context.elements[0].name }) });`;
  globalThis.chrome = { runtime: {
    id: 'test', onMessage: { addListener: fn => { listener = fn; } },
    getURL: path => 'data:text/javascript,' + encodeURIComponent(path.endsWith('controller.js') ? controller : capture),
  } };
  t.after(() => {
    for (const key of ['window', 'document', 'chrome', '__gazeFrameAgent']) delete globalThis[key];
  });
  await import(`../extension/frame-agent.js?${agent}`);
  const send = request => new Promise(resolve => listener(request, { id: 'test' }, resolve));
  return { capture: x => send({ type: 'gaze:frame-capture', x }), act: captureId => send({ type: 'gaze:frame-act', captureId, action: { type: 'activate', targetId: 1 } }),
    now: time => { now = time; }, navigate: () => events.dispatchEvent(new Event('pagehide')) };
}

test('a newer embedded capture reusing a control ID cannot redirect an action', async t => {
  const frame = await frameAgent(t);
  const first = await frame.capture(10);
  const second = await frame.capture(20);
  assert.deepEqual([first.elements[0].id, second.elements[0].id], [1, 1]);
  assert.deepEqual(await frame.act(first.captureId), { ok: true, message: 'Control 10' });
  assert.deepEqual(await frame.act(second.captureId), { ok: true, message: 'Control 20' });
  assert.notEqual(first.captureId, second.captureId);
});

test('embedded actions require a live capture from the current document', async t => {
  const frame = await frameAgent(t, 'second');
  const first = await frame.capture(10);
  assert.equal((await frame.act()).ok, false);
  assert.equal((await frame.act('another-document')).ok, false);
  frame.now(61000);
  assert.equal((await frame.act(first.captureId)).ok, false);
  const second = await frame.capture(20);
  frame.navigate();
  await frame.capture(30);
  assert.equal((await frame.act(second.captureId)).ok, false);
});

test('the top navigator sends the original capture ID even after seeing a newer embedded target', async t => {
  const { createEmbeddedFrames } = await import('../src/web/embedded-frames.js');
  const agent = await frameAgent(t, 'top-relay');
  const window = { crypto, performance, setTimeout: fn => setTimeout(fn, 0), getComputedStyle: () => ({}) };
  const runtime = { sendMessage: async message => {
    if (message.type === 'gaze:frame-resolve') return { frameId: 1 };
    if (message.type === 'gaze:frame-capture') return agent.capture(message.x);
    if (message.type === 'gaze:frame-act') return agent.act(message.captureId);
    return { ok: true };
  } };
  const embedded = createEmbeddedFrames({ window, runtime });
  const frame = { isConnected: true, clientLeft: 0, clientTop: 0, ownerDocument: { defaultView: window },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500 }) };
  const look = async x => {
    const context = { x, y: 0, radius: 50, elements: [], unreachable: [{ frame, frames: [], name: 'widget' }] };
    await new Promise(resolve => embedded.extend(context, { changed: resolve }));
    return context.elements[0];
  };
  const original = await look(10);
  const latest = await look(80);
  assert.equal(original.element.remote.id, latest.element.remote.id);
  const action = { type: 'activate', targetId: original.element.remote.id };
  assert.equal((await original.element.remote.run(action)).message, 'Control 10');
});

test('the embedded controller refuses activation if the captured link changes', async () => {
  const { createController } = await import('../src/web/controller.js');
  const { captureActivationSnapshot } = await import('../src/web/page-context.js');
  const document = { defaultView: {}, baseURI: 'https://widget.test/', querySelector: () => null };
  let clicks = 0;
  const attrs = new Map([['href', '/original'], ['aria-label', 'Buy tickets']]);
  const element = { tagName: 'A', ownerDocument: document, isConnected: true, matches: () => false,
    getRootNode: () => document, hasAttribute: key => attrs.has(key), getAttribute: key => attrs.get(key) ?? null,
    get href() { return new URL(attrs.get('href'), document.baseURI).href; },
    focus() {}, click() { clicks++; },
  };
  const context = { elements: [{ id: 1, element, name: 'Buy tickets', activationSnapshot: captureActivationSnapshot(element) }] };
  const controller = createController({ window: {} });
  const action = { type: 'activate', targetId: 1 };
  attrs.set('href', '/replacement');
  assert.match(controller.run(action, context).message, /changed.*Nothing was clicked/);
  assert.match(controller.run({ ...action, type: 'double-click' }, context, { confirmed: true }).message, /changed.*Nothing was clicked/);
  attrs.set('href', '/original');
  attrs.set('aria-label', 'Buy something else');
  assert.match(controller.run(action, context).message, /changed.*Nothing was clicked/);
  assert.equal(clicks, 0);
  attrs.set('aria-label', 'Buy tickets');
  assert.equal(controller.run(action, context).tone, 'success');
  assert.equal(clicks, 1);
});
