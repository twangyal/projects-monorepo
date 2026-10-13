import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestTweenPairs } from '../src/tween.ts';
import type { Point, Stroke } from '../src/model.ts';

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
/** A smooth hand-drawn-looking curve through a few control points (Catmull–Rom, 6 points per span). */
function curve(controls: Point[]): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < controls.length - 1; i++) {
    const p0 = controls[Math.max(0, i - 1)], p1 = controls[i], p2 = controls[i + 1], p3 = controls[Math.min(controls.length - 1, i + 2)];
    for (let s = 0; s < 6; s++) {
      const t = s / 6, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      points.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  points.push(controls.at(-1)!);
  return points;
}
const stroke = (points: Point[], color = '#20242a', width = 4): Stroke => ({ color, width, points });

interface Trial { start: Stroke[]; end: Stroke[]; truth: { endStroke: number; reverseEnd: boolean }[] }
/** Random drawing, then the same drawing moved, deformed, reordered and with some strokes drawn backwards. */
function trial(next: () => number, strokes: number, deform: number, move: number): Trial {
  const controls = Array.from({ length: strokes }, () => {
    const cx = 90 + next() * 460, cy = 70 + next() * 220, size = 30 + next() * 70;
    return Array.from({ length: 3 + Math.floor(next() * 3) }, () => ({ x: cx + (next() - 0.5) * size * 2, y: cy + (next() - 0.5) * size * 2 }));
  });
  const dx = (next() - 0.5) * 2 * move, dy = (next() - 0.5) * move;
  const order = Array.from({ length: strokes }, (_, i) => i).sort(() => next() - 0.5);
  const reversed = order.map(() => next() < 0.5);
  const start = controls.map(c => stroke(curve(c)));
  const moved = controls.map(c => curve(c.map(p => ({ x: p.x + dx + (next() - 0.5) * 2 * deform, y: p.y + dy + (next() - 0.5) * 2 * deform }))));
  // end[k] is start stroke order[k], possibly reversed.
  const end = order.map((source, k) => stroke(reversed[k] ? [...moved[source]].reverse() : moved[source]));
  const truth = Array.from({ length: strokes }, (_, source) => { const k = order.indexOf(source); return { endStroke: k, reverseEnd: reversed[k] }; });
  return { start, end, truth };
}
function evaluate(seed: number, trials: number, deform: number, move: number) {
  const next = random(seed);
  let drawings = 0, correctDrawings = 0, pairs = 0, correctPartners = 0, correctDirections = 0, flaggedWrong = 0, wrong = 0, flaggedRight = 0;
  for (let n = 0; n < trials; n++) {
    const { start, end, truth } = trial(next, 2 + Math.floor(next() * 7), deform, move);
    const suggestion = suggestTweenPairs(start, end);
    let allRight = true;
    suggestion.pairs.forEach((pair, i) => {
      pairs++;
      const partner = pair.endStroke === truth[i].endStroke, direction = partner && pair.reverseEnd === truth[i].reverseEnd;
      correctPartners += Number(partner); correctDirections += Number(direction);
      if (!direction) { allRight = false; wrong++; flaggedWrong += Number(suggestion.uncertain.includes(i)); }
      else flaggedRight += Number(suggestion.uncertain.includes(i));
    });
    drawings++; correctDrawings += Number(allRight);
  }
  return { drawings: correctDrawings / drawings, partners: correctPartners / pairs, directions: correctDirections / pairs,
    flaggedOfWrong: wrong ? flaggedWrong / wrong : 1, flaggedOfRight: flaggedRight / (pairs - wrong), pairs };
}

test('identical, reordered, reversed and moved drawings are paired exactly', () => {
  const a = stroke(curve([{ x: 100, y: 100 }, { x: 160, y: 140 }, { x: 220, y: 100 }]), '#111111');
  const b = stroke(curve([{ x: 400, y: 250 }, { x: 420, y: 180 }, { x: 470, y: 160 }]), '#aa2200', 8);
  const c = stroke(curve([{ x: 300, y: 60 }, { x: 330, y: 90 }]));
  assert.deepEqual(suggestTweenPairs([a, b, c], [a, b, c]).pairs.map(p => [p.endStroke, p.reverseEnd]), [[0, false], [1, false], [2, false]]);
  const shift = (s: Stroke, reverse = false): Stroke => ({ ...s, points: (reverse ? [...s.points].reverse() : s.points).map(p => ({ x: p.x + 180, y: p.y - 40 })) });
  // The whole figure walks 180 px right: plain nearest-position matching would pair by where strokes landed.
  const suggestion = suggestTweenPairs([a, b, c], [shift(c), shift(a, true), shift(b)]);
  assert.deepEqual(suggestion.pairs.map(p => [p.endStroke, p.reverseEnd]), [[1, true], [2, false], [0, false]]);
  assert.ok(Math.abs(suggestion.offset.x - 180) < 1e-9 && Math.abs(suggestion.offset.y + 40) < 1e-9);
  assert.deepEqual(suggestion.uncertain, []);
});

test('ambiguous partners and directionless strokes are flagged for review', () => {
  const ring = (cx: number): Stroke => stroke(Array.from({ length: 33 }, (_, i) => ({ x: cx + 30 * Math.cos(i / 32 * 2 * Math.PI), y: 180 + 30 * Math.sin(i / 32 * 2 * Math.PI) })));
  // A closed loop has no meaningful direction; a dot cannot be told apart by shape.
  assert.deepEqual(suggestTweenPairs([ring(200)], [ring(220)]).uncertain, [0]);
  const dot = (x: number, y = 100): Stroke => stroke([{ x, y }]);
  const together = suggestTweenPairs([dot(100), dot(110)], [dot(300), dot(310)]);
  assert.deepEqual(together.pairs.map(p => p.endStroke), [0, 1]);
  assert.deepEqual(together.uncertain, [], 'dots moving together keep their arrangement; a dot has no direction');
  // A quarter turn makes both pairings equally plausible.
  const turned = suggestTweenPairs([dot(100), dot(110)], [dot(305, 95), dot(305, 105)]);
  assert.deepEqual(turned.uncertain, [0, 1]);
  assert.throws(() => suggestTweenPairs([dot(1)], [dot(1), dot(2)]), /same number/);
  assert.throws(() => suggestTweenPairs([], []), /1 to 8/);
});

test('seeded evaluation: pairing accuracy on moved, deformed, reordered and reversed drawings', () => {
  const light = evaluate(2026, 400, 4, 150), heavy = evaluate(1013, 400, 18, 150), still = evaluate(7, 400, 4, 0);
  // Measured once and recorded in docs/2026-10-13-suggested-pairs.md; asserted with a small margin.
  console.log(JSON.stringify({ light, heavy, still }));
  assert.ok(light.drawings >= 0.97 && light.directions >= 0.99, JSON.stringify(light));
  assert.ok(still.drawings >= 0.97, JSON.stringify(still));
  assert.ok(heavy.drawings >= 0.85 && heavy.directions >= 0.95, JSON.stringify(heavy));
  // Most wrong suggestions are among the flagged ones, so reviewing flags catches them.
  assert.ok(heavy.flaggedOfWrong >= 0.85, JSON.stringify(heavy));
  // Flags stay rare on correct pairs, so they remain worth reading.
  assert.ok(light.flaggedOfRight <= 0.15 && heavy.flaggedOfRight <= 0.2, JSON.stringify({ light, heavy }));
});
