// JSON.parse alone accepts duplicate keys. Walk the bounded grammar first so
// escaped duplicates and nesting are rejected before building the object graph.
export function strictJson(text: string, byteLimit: number, depthLimit: number): unknown {
  if (typeof text !== 'string' || text.length > byteLimit || !text.isWellFormed()
      || new TextEncoder().encode(text).length > byteLimit) throw new Error('Project JSON exceeds bounds or contains invalid Unicode');
  let at = 0;
  const whitespace = () => { while (at < text.length && /[\x20\t\r\n]/.test(text[at])) at++; };
  const string = (): string => {
    const start = at++;
    while (at < text.length) {
      const c = text[at++];
      if (c === '"') {
        const result: string = JSON.parse(text.slice(start, at));
        if (!result.isWellFormed()) throw new Error('Invalid Unicode');
        return result;
      }
      if (c === '\\') at++;
    }
    throw new Error('Unterminated JSON string');
  };
  const value = (depth: number): void => {
    whitespace(); const c = text[at];
    if (c === '"') { string(); return; }
    if (c === '{' || c === '[') {
      if (depth >= depthLimit) throw new Error('JSON nesting exceeds bounds');
      const object = c === '{'; const end = object ? '}' : ']'; at++; whitespace();
      const keys = new Set<string>();
      if (text[at] === end) { at++; return; }
      for (;;) {
        if (object) {
          if (text[at] !== '"') throw new Error('Expected JSON key');
          const key = string();
          if (keys.has(key)) throw new Error('Duplicate JSON key');
          keys.add(key); whitespace();
          if (text[at++] !== ':') throw new Error('Expected colon');
        }
        value(depth + 1); whitespace();
        if (text[at] === end) { at++; return; }
        if (text[at++] !== ',') throw new Error('Expected comma');
        whitespace();
      }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at));
    if (!match) throw new Error('Invalid JSON value');
    if (!/^(true|false|null)$/.test(match[0]) && !Number.isFinite(Number(match[0]))) throw new Error('Nonfinite JSON number');
    at += match[0].length;
  };
  value(0); whitespace();
  if (at !== text.length) throw new Error('Trailing JSON content');
  return JSON.parse(text);
}
