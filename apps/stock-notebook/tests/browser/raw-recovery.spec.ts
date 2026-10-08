import { expect, test } from '@playwright/test';
import type {} from '../storage-harness.ts';
import { LIMITS } from '../../src/types.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/storage-harness.html');
  await page.waitForFunction(() => Boolean(window.stockStorage));
});

test('unsafe native records reject raw backup without rewriting the saved values', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.stockStorage, name = 'unsafe-raw-recovery';
    const store = new h.NotebookStore(name);
    const sparse = new Array(2); sparse[1] = 'present';
    const extended = ['present']; Object.assign(extended, { extra: 'retained' });
    const fixtures: { value: unknown; retained: (value: unknown) => boolean }[] = [
      { value: { missing: undefined }, retained: value => Object.hasOwn(value as object, 'missing') && (value as { missing: unknown }).missing === undefined },
      { value: [undefined], retained: value => (value as unknown[])[0] === undefined },
      { value: { number: Infinity }, retained: value => (value as { number: number }).number === Infinity },
      { value: { number: NaN }, retained: value => Number.isNaN((value as { number: number }).number) },
      { value: { number: -0 }, retained: value => Object.is((value as { number: number }).number, -0) },
      { value: new Date('2026-10-04T00:00:00Z'), retained: value => value instanceof Date && value.getTime() === 1791072000000 },
      { value: new Map([['key', 'value']]), retained: value => value instanceof Map && value.get('key') === 'value' },
      { value: new Set(['value']), retained: value => value instanceof Set && value.has('value') },
      { value: new Uint8Array([1, 2, 255]), retained: value => value instanceof Uint8Array && value[2] === 255 },
      { value: sparse, retained: value => (value as unknown[]).length === 2 && !Object.hasOwn(value as object, '0') },
      { value: extended, retained: value => (value as { extra: string }).extra === 'retained' },
    ];
    const outcomes = [];
    for (const fixture of fixtures) {
      await h.rawRecord(name, fixture.value, true);
      let error = '';
      try { await store.exportRaw(); } catch (value) { error = (value as Error).message; }
      outcomes.push({ rejected: /lossless|unsafe|serializ/i.test(error), retained: fixture.retained(await h.rawRecord(name)) });
    }
    await h.rawRecord(name, { unicode: 'é🐟', literals: [null, true, false, 1.25] }, true);
    const retry = await store.exportRaw();
    store.close();
    return { outcomes, retry };
  });
  expect(result.outcomes).toEqual(Array.from({ length: 11 }, () => ({ rejected: true, retained: true })));
  expect(result.retry).toBe('{"unicode":"é🐟","literals":[null,true,false,1.25]}');
});

test('shared native graphs are rejected before JSON expansion and remain recoverable', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.stockStorage, name = 'shared-raw-recovery';
    let graph: unknown = 'x';
    for (let level = 0; level < 40; level++) graph = [graph, graph];
    await h.rawRecord(name, graph, true);
    const store = new h.NotebookStore(name), stringify = JSON.stringify;
    let expanded = false, error = '';
    // Prevent an unfixed serializer from allocating terabytes. All native read,
    // clone and production preflight behavior remains real.
    JSON.stringify = ((value: unknown) => {
      if (Array.isArray(value)) { expanded = true; return '[]'; }
      return stringify(value);
    }) as typeof stringify;
    try { await store.exportRaw(); } catch (value) { error = (value as Error).message; }
    finally { JSON.stringify = stringify; }
    const raw = await h.rawRecord(name) as unknown[];
    const retainedSharing = raw[0] === raw[1];
    await h.rawRecord(name, { a: ['x'], b: ['x'] }, true);
    const retry = await store.exportRaw(); store.close();
    return { expanded, error, retainedSharing, retry };
  });
  expect(result.expanded).toBe(false);
  expect(result.error).toMatch(/too large|exceeds/i);
  expect(result.retainedSharing).toBe(true);
  expect(result.retry).toBe('{"a":["x"],"b":["x"]}');
});

test('raw object backups honor escaped UTF-8 boundaries without changing native data', async ({ page }) => {
  const result = await page.evaluate(async limit => {
    const h = window.stockStorage, name = 'object-raw-boundary';
    const store = new h.NotebookStore(name);
    // {"x":"..."} costs eight bytes, independent of the serializer.
    const exact = { x: 'é'.repeat((limit - 8) / 2) };
    await h.rawRecord(name, exact, true);
    const json = (await store.exportRaw())!;
    const accepted = new TextEncoder().encode(json).length === limit && (JSON.parse(json) as { x: string }).x === exact.x;
    const oversized = { x: exact.x + 'a' };
    await h.rawRecord(name, oversized, true);
    let error = '';
    try { await store.exportRaw(); } catch (value) { error = (value as Error).message; }
    const preserved = (await h.rawRecord(name) as { x: string }).x === oversized.x;
    await h.rawRecord(name, { x: '\u0000\n"\\🐟' }, true);
    const escaped = await store.exportRaw(); store.close();
    return { accepted, error, preserved, escaped };
  }, LIMITS.notebookBytes);
  expect(result.accepted).toBe(true);
  expect(result.error).toMatch(/too large|exceeds/i);
  expect(result.preserved).toBe(true);
  expect(result.escaped).toBe('{"x":"\\u0000\\n\\"\\\\🐟"}');
});

test('schema creation failure rolls back without uncaught errors and the same store retries', async ({ page }) => {
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message));
  const result = await page.evaluate(async () => {
    const h = window.stockStorage, name = 'schema-retry-raw';
    const store = new h.NotebookStore(name), create = IDBDatabase.prototype.createObjectStore;
    let error = '';
    IDBDatabase.prototype.createObjectStore = function (...args: Parameters<typeof create>) {
      create.apply(this, args);
      throw new DOMException('Sensitive schema fixture', 'QuotaExceededError');
    };
    try { await store.load('2026-10-04'); } catch (value) { error = (value as Error).message; }
    finally { IDBDatabase.prototype.createObjectStore = create; }
    const missing = await store.load('2026-10-04');
    await store.save(h.fixture('Retried schema'), '2026-10-04');
    const title = (await store.load('2026-10-04'))!.title; store.close();
    return { error, missing, title };
  });
  expect(pageErrors).toEqual([]);
  expect(result.error).toMatch(/storage.*backup.*retry/i);
  expect(result.error).not.toContain('Sensitive schema fixture');
  expect(result.missing).toBeNull();
  expect(result.title).toBe('Retried schema');
});
