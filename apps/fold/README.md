# Fold

A calm origami folding puzzle. You see a flat sheet of paper and dashed
crease lines; pick a crease, choose which side folds over, and the paper
flips. Repeat until the silhouette matches the target shape. 30 hand-authored
puzzles grow from single folds to four-fold sequences, with undo, hints,
1–3 star ratings and progressive level unlocks.

## How folding works (engine notes)

All gameplay math lives in pure, DOM-free TypeScript under `src/engine/`
(runnable in Node, unit-tested with vitest):

- **Paper state** (`src/engine/engine.ts`) is an ordered list of polygon
  layers — `{ poly, z, flip }`. Higher `z` renders on top; `flip` marks
  layers showing the paper's back side.
- **`fold(state, creaseLine, side)`** splits every layer by the crease line
  and reflects the moving side across it:
  1. Each layer is triangulated with deterministic ear clipping
     (`src/engine/geom.ts`), so **concave** polygons split correctly. Ears
     whose diagonal would graze a reflex vertex are rejected
     (boundary-inclusive blocking) and collinear points are pre-removed.
  2. Every triangle is clipped to both half-planes with
     Sutherland–Hodgman clipping, yielding convex pieces per side.
  3. Moving pieces are point-reflected across the crease line and re-stacked
     on top of everything (origami convention), preserving relative order.
- The engine never mutates input states, so **undo = a snapshot stack** of
  previous states. Identical inputs produce bit-identical outputs.
- **Invalid folds** (no paper on the moving side) return the input state
  unchanged; `canFold` detects them beforehand.
- **`silhouetteMatch(state, target)`** normalizes both the paper union and
  the target polygon independently into a unit square, samples a
  deterministic 128×128 grid with even-odd point-in-polygon tests, and
  counts mismatching cells. ≤ 2% of the shape area = solved. No canvas
  rasterization is involved, so matching is node-testable.

The flip animation is honest: each moving point's perpendicular offset from
the crease is scaled by `cos(πt)`, landing exactly on the reflected position
at `t = 1`. The state is only committed (via the real `fold()`) afterwards.

## Level authoring format (`src/levels.ts`)

```ts
{
  id: 7,
  name: 'Quarter Square',
  paper: [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)],  // simple polygon
  creases: [
    { id: 'c1', a: pt(50, 0), b: pt(50, 100) },              // infinite line through a,b
    { id: 'd1', a: pt(0, 0), b: pt(100, 100) },              // distractors allowed
  ],
  solution: [                                                // one known optimal path
    { creaseId: 'c1', side: 1 },                             // +1 folds the half-plane
    { creaseId: 'c2', side: -1 },                            // cross(b-a, p-a) > 0
  ],
  target: [pt(50, 50), pt(100, 50), pt(100, 100), pt(50, 100)], // solved silhouette
}
```

`side = +1` folds points where `cross(b - a, p - a) > 0` across the line.
Levels may include distractor creases that no optimal solution uses.

**The repo gate**: `src/levels.test.ts` replays every level's authored
solution through the real engine and asserts `silhouetteMatch` passes — so
every puzzle is provably solvable. `src/engine/engine.test.ts` covers
reflection on known points, square-diagonal splitting into two triangles,
stacking order, concave input, invalid folds, undo exactness and
determinism.

## Scoring

Stars (1–3): 3 = par folds with no hints, 2 = at most one extra fold and one
hint, 1 = otherwise. Progress (`{ v: 1, stars: number[], unlocked: number }`)
persists via the platform adapter; total stars are submitted with
`platform.sendScore` on each level completion.

## Commands

```bash
# from apps/fold (dependencies are hoisted to the repo root — never npm install here)
../../node_modules/.bin/vitest run     # tests (incl. all-30-levels replay gate)
../../node_modules/.bin/tsc --noEmit   # typecheck
../../node_modules/.bin/vite build     # production build -> dist/
../../node_modules/.bin/vite           # dev server
```
