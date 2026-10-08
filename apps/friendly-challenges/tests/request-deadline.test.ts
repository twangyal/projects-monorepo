import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as turn } from 'node:timers/promises';
import { request, ApiError } from '../src/api.ts';

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test('a stalled JSON header wait expires once and rejects late success', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0, transport: AbortSignal | null | undefined;
  let release!: (value: Response) => void;
  globalThis.fetch = async (_path, options) => {
    calls++; transport = options?.signal;
    return new Promise<Response>(resolve => { release = resolve; });
  };
  let outcome: unknown;
  void request('POST', '/api/challenges', { name: 'Kept draft' }).then(() => { outcome = 'success'; }, error => { outcome = error; });
  await turn(); context.mock.timers.tick(15001); await turn();
  assert.ok(outcome instanceof ApiError, 'the deadline must release the pending caller');
  assert.equal(outcome.name, 'RequestTimeoutError');
  assert.equal(outcome.status, 0); assert.equal(calls, 1); assert.equal(transport?.aborted, true);
  let canceled = false;
  release(new Response(new ReadableStream<Uint8Array>({ cancel() { canceled = true; } }), { headers: { 'Content-Type': 'application/json' } }));
  await turn(); assert.equal(canceled, true); assert.ok(outcome instanceof ApiError); assert.equal(calls, 1);
});

test('the same deadline covers partial JSON body consumption and cancels its reader', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let canceled = 0;
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"revision":')); },
    cancel() { canceled++; },
  }), { headers: { 'Content-Type': 'application/json' } });
  let outcome: unknown;
  void request('GET', '/api/status').catch(error => { outcome = error; });
  await turn(); context.mock.timers.tick(15001); await turn();
  assert.ok(outcome instanceof ApiError, 'partial body must not hold the caller indefinitely');
  assert.equal(outcome.name, 'RequestTimeoutError'); assert.equal(canceled, 1);
});

test('caller cancellation releases a stalled body and remains distinct from timeout', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let canceled = 0;
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({ cancel() { canceled++; } }), { headers: { 'Content-Type': 'application/json' } });
  const controller = new AbortController();
  const pending = request('GET', '/api/status', undefined, undefined, controller.signal);
  const rejected = assert.rejects(pending, error => !!error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
  await turn(); controller.abort(); await rejected; await turn();
  assert.equal(canceled, 1); context.mock.timers.tick(15001);
});

test('already canceled callers never dispatch and completed requests clear their deadline', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0, transport: AbortSignal | null | undefined;
  globalThis.fetch = async (_path, options) => { calls++; transport = options?.signal; return new Response('{}', { headers: { 'Content-Type': 'application/json' } }); };
  const controller = new AbortController(); controller.abort();
  await assert.rejects(request('GET', '/api/status', undefined, undefined, controller.signal), error => !!error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
  assert.equal(calls, 0);
  assert.deepEqual(await request('GET', '/api/status'), {});
  context.mock.timers.tick(15001); await turn();
  assert.equal(calls, 1); assert.equal(transport?.aborted, false);
});
