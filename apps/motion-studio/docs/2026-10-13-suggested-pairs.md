# Suggested in-between stroke pairs — issue #223

## Intended outcome and gap

Motion Studio's direction includes assistance with generating intermediate frames. Its geometric in-between tool (#88) interpolates paired strokes well, but the animator had to choose a partner and a direction for every stroke by hand. That is slow, and a single wrong pair makes crossing artwork. This milestone proposes the whole correspondence in one click and points out the pairs worth checking. Every choice stays editable, and nothing changes until **Review** and **Apply**.

## Method (`suggestTweenPairs` in `src/tween.ts`)

1. Resample every stroke at the existing 64 arc-length positions. Ending strokes are resampled both forwards and backwards.
2. Estimate the drawing's overall movement as the difference between the mean of the stroke centres of the two drawings, and measure its size (the RMS spread around the starting centre).
3. For every starting stroke, ending stroke and direction, compute the cost as the mean distance after removing the overall movement, plus half the mean shape distance (each stroke about its own centre), divided by the drawing's spread. A different color adds 0.15.
4. Choose the assignment with the least total cost by exact dynamic programming over subsets of ending strokes (at most 8, so at most 2,048 states), and take each pair's cheaper direction.
5. Flag a starting stroke for review in any of these cases:
   - forbidding its partner raises the optimum by no more than 15% (plus 0.02);
   - its two directions cost within 10% of each other (dots excepted, since they have no direction);
   - either stroke is a closed loop, which may start anywhere along the loop.

It is deterministic and has no learned model. It compares geometry and does not recognize what strokes depict.

## Evaluation (`tests/tween-suggest.test.ts`)

Synthetic drawings use a seeded generator:
- each drawing has 2–8 strokes;
- each stroke is a Catmull–Rom curve through 3–5 random control points lying within 30–100 px of a random centre on the 640×360 stage, so strokes may overlap;
- the ending drawing moves the whole drawing up to ±150 px horizontally and ±75 px vertically (or not at all for the *still* set);
- each control point is jittered by up to ±4 px (*light*) or ±18 px (*heavy*);
- stroke order is shuffled, and each stroke is drawn backwards with probability ½.

There are 400 drawings per set.

| Set | Pairs | Partner correct | Partner and direction correct | Drawings fully correct | Wrong pairs flagged | Correct pairs flagged |
|---|---|---|---|---|---|---|
| light, moving | 1,965 | 100% | 99.90% | 99.5% | 100% | 8.4% |
| heavy, moving | 1,985 | 100% | 99.09% | 95.5% | 94.4% | 11.2% |
| light, still | 1,973 | 100% | 99.90% | 99.5% | 100% | 7.0% |

Every residual error was a direction on a nearly symmetric stroke, and nearly all were flagged. The test asserts these results with small margins. Specific cases are also covered:
- identical drawings;
- a moved drawing that plain nearest-position matching would get wrong;
- the browser fixture's hand-authored correspondence (line ↔ reversed line, dot ↔ dot), reproduced by the button and applied with the exact expected pixels and project;
- flagged loops;
- a quarter-turned pair of dots.

## Verification (local)

- `npm run check`: 273 unit tests (3 new), lint, typecheck and build.
- Production Chromium: all 188 cases, including 1 new.

## Limits

- Endpoints still need the same number of strokes (1–8). Strokes that appear or disappear between drawings are not handled.
- Large rotations or scaling of the whole drawing are not compensated; only translation is.
- The synthetic evaluation is not artist evaluation. Real drawings with very similar strokes, such as hatching, will flag more pairs, and those flags should be read.
