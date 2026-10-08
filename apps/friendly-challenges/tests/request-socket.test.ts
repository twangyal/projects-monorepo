import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { request, ApiError } from '../src/api.ts';

test('real HTTP partial JSON releases the caller and closes the stalled socket without replay', { timeout: 20000 }, async () => {
  const nativeFetch = globalThis.fetch;
  let calls = 0, closed = false;
  const server = createServer((_req, response) => {
    calls++;
    response.on('close', () => { closed = true; });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.write('{"revision":'); // genuine headers/body, deliberately no EOF
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  globalThis.fetch = (path, options) => nativeFetch(new URL(String(path), `http://127.0.0.1:${address.port}`), options);
  try {
    const started = Date.now();
    await assert.rejects(request('POST', '/api/challenges', { name: 'Synthetic fixture' }), error => error instanceof ApiError && error.name === 'RequestTimeoutError');
    assert.ok(Date.now() - started >= 14000);
    assert.equal(calls, 1);
    await new Promise<void>(resolve => setTimeout(resolve, 30));
    assert.equal(closed, true);
  } finally {
    globalThis.fetch = nativeFetch;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
