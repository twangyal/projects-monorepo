import { MotionError } from './types.ts';

/** Bounded lexical admission before JSON.parse; keys are compared after unescaping. */
export function parseStrictJson(bytes: Uint8Array, maximum: number): unknown {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.byteLength > maximum) throw new MotionError('invalid', 'JSON exceeds its byte limit.');
  let text: string;
  try { text = new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
  catch { throw new MotionError('invalid', 'JSON must contain valid UTF-8.'); }
  let at = 0, nodes = 0;
  function invalid(): never { throw new MotionError('invalid', 'JSON is malformed, duplicated or too deeply nested.'); }
  const whitespace = () => { while (at < text.length && /[\x20\t\r\n]/.test(text[at])) at++; };
  function string(): string {
    const begin = at++;
    while (at < text.length) {
      const character = text[at++];
      if (character === '"') return text.slice(begin, at);
      if (character.charCodeAt(0) < 32) invalid();
      if (character === '\\') {
        const escape = text[at++];
        if (escape === 'u') { if (!/^[0-9a-fA-F]{4}$/.test(text.slice(at,at+4))) invalid(); at += 4; }
        else if (!escape || !'"\\/bfnrt'.includes(escape)) invalid();
      }
    }
    return invalid();
  }
  function value(depth: number): void {
    if (depth > 32 || ++nodes > 100_000) invalid();
    whitespace(); const c = text[at];
    if (c === '"') { string(); return; }
    if (c === '{') {
      at++; whitespace(); const keys = new Set<string>();
      if (text[at] === '}') { at++; return; }
      for (;;) {
        if (text[at] !== '"') invalid();
        const key = JSON.parse(string()) as string;
        if (keys.has(key)) invalid(); keys.add(key); whitespace();
        if (text[at++] !== ':') invalid(); value(depth+1); whitespace();
        if (text[at] === '}') { at++; return; }
        if (text[at++] !== ',') invalid(); whitespace();
      }
    }
    if (c === '[') {
      at++; whitespace(); if (text[at] === ']') { at++; return; }
      for (;;) { value(depth+1); whitespace(); if (text[at] === ']') { at++; return; } if (text[at++] !== ',') invalid(); }
    }
    for (const literal of ['true','false','null']) if (text.startsWith(literal,at)) { at += literal.length; return; }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at));
    if (!number || !Number.isFinite(Number(number[0]))) invalid(); at += number[0].length;
  }
  value(0); whitespace(); if (at !== text.length) invalid();
  try { return JSON.parse(text); } catch { return invalid(); }
}
