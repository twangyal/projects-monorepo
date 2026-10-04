import { LIMITS } from './types.ts';

export function serializeRawRecord(value: unknown): string {
  const oversized = () => new Error(`Raw saved record is too large for the ${LIMITS.notebookBytes / (1024 * 1024)} MiB backup limit. Stored data was kept.`);
  const unsafe = () => new Error('Raw saved record cannot be serialized as a lossless JSON backup. Stored data was kept; do not reset until you have recovered it.');
  function bounded(bytes: number): number {
    if (bytes > LIMITS.notebookBytes) throw oversized();
    return bytes;
  }

  // Count before allocating encoded/escaped strings. Lone code units are legal
  // only inside JSON strings, where stringify escapes them losslessly.
  function stringBytes(text: string, quoted: boolean): number {
    bounded(text.length);
    let bytes = quoted ? 2 : 0;
    for (let index = 0; index < text.length; index++) {
      const point = text.charCodeAt(index);
      if (point >= 0xd800 && point <= 0xdfff) {
        const next = text.charCodeAt(index + 1);
        if (point <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) { bytes += 4; index++; }
        else if (quoted) bytes += 6;
        else throw new Error('Raw saved record has invalid Unicode and cannot become a UTF-8 backup. Stored data was kept.');
      } else if (quoted && (point === 34 || point === 92)) bytes += 2;
      else if (quoted && point < 32) bytes += [8, 9, 10, 12, 13].includes(point) ? 2 : 6;
      else bytes += point < 128 ? 1 : point < 2048 ? 2 : 3;
      bounded(bytes);
    }
    return bytes;
  }
  if (typeof value === 'string') { stringBytes(value, false); return value; }

  const active = new Set<object>();
  const measured = new Map<object, { bytes: number; height: number }>();
  const maxDepth = 512;
  function inspect(item: unknown, depth: number): { bytes: number; height: number } {
    if (depth > maxDepth) throw new Error('Raw saved record is too deep for a safe JSON backup. Stored data was kept.');
    if (item === null) return { bytes: 4, height: 0 };
    if (typeof item === 'string') return { bytes: stringBytes(item, true), height: 0 };
    if (typeof item === 'boolean') return { bytes: item ? 4 : 5, height: 0 };
    if (typeof item === 'number' && Number.isFinite(item) && !Object.is(item, -0)) return { bytes: String(item).length, height: 0 };
    if (typeof item !== 'object') throw unsafe();
    if (active.has(item)) throw new Error('Raw saved record is cyclic and cannot become a JSON backup. Stored data was kept.');
    // Reuse measurements of shared subtrees, charging their full JSON size at
    // each occurrence. Track height too, so reuse cannot bypass the depth cap.
    const known = measured.get(item);
    if (known) {
      if (depth + known.height > maxDepth) throw new Error('Raw saved record is too deep for a safe JSON backup. Stored data was kept.');
      return known;
    }
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw unsafe();
    const keys = Reflect.ownKeys(item);
    if (array && keys.length !== item.length + 1) throw unsafe();
    active.add(item);
    let bytes = 2, height = 0, count = 0;
    for (const key of keys) {
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (typeof key !== 'string' || !descriptor.enumerable || !('value' in descriptor)) throw unsafe();
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length)) throw unsafe();
      bytes = bounded(bytes + (count++ ? 1 : 0) + (array ? 0 : stringBytes(key, true) + 1));
      const child = inspect(descriptor.value, depth + 1);
      bytes = bounded(bytes + child.bytes);
      height = Math.max(height, child.height + 1);
    }
    active.delete(item);
    const result = { bytes, height }; measured.set(item, result); return result;
  }
  inspect(value, 0);
  // Native IDB returns detached data. No accessors, exotic values or custom
  // serializers remain, and the complete expansion has already been bounded.
  return JSON.stringify(value);
}
