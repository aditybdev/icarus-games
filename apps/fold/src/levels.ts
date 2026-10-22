/**
 * Hand-authored level data for Fold. Pure data module — no DOM.
 *
 * Authoring format:
 *  - paper:    starting paper polygon (simple polygon, any winding).
 *  - creases:  dashed crease lines; the infinite line through (a, b) is used.
 *  - solution: one known optimal sequence of { creaseId, side }. `side` says
 *              which half-plane folds over: +1 folds points with
 *              cross(b - a, p - a) > 0 across the line.
 *  - target:   the silhouette the paper must match (independent of paper
 *              coordinates — matching normalizes both shapes).
 *
 * Levels may include "distractor" creases that no optimal solution uses.
 * The vitest suite replays every solution through the real engine and
 * asserts the silhouette matches the target.
 */

import { Pt, pt } from './engine/geom';

export interface Crease {
  id: string;
  a: Pt;
  b: Pt;
}

export interface SolutionStep {
  creaseId: string;
  side: 1 | -1;
}

export interface Level {
  id: number;
  name: string;
  paper: Pt[];
  creases: Crease[];
  solution: SolutionStep[];
  target: Pt[];
}

const SQ: Pt[] = [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)];

export const LEVELS: Level[] = [
  {
    id: 1,
    name: 'First Fold',
    paper: SQ,
    creases: [{ id: 'c1', a: pt(50, 0), b: pt(50, 100) }],
    solution: [{ creaseId: 'c1', side: 1 }],
    target: [pt(50, 0), pt(100, 0), pt(100, 100), pt(50, 100)],
  },
  {
    id: 2,
    name: 'Letter Fold',
    paper: SQ,
    // One distractor from level 2 on: crease choice starts immediately.
    creases: [
      { id: 'c1', a: pt(0, 50), b: pt(100, 50) },
      { id: 'd1', a: pt(50, 0), b: pt(50, 100) },
    ],
    solution: [{ creaseId: 'c1', side: -1 }],
    target: [pt(0, 50), pt(100, 50), pt(100, 100), pt(0, 100)],
  },
  {
    id: 3,
    name: 'Diagonal',
    paper: SQ,
    creases: [
      { id: 'c1', a: pt(0, 0), b: pt(100, 100) },
      { id: 'd1', a: pt(0, 100), b: pt(100, 0) },
    ],
    solution: [{ creaseId: 'c1', side: 1 }],
    target: [pt(0, 0), pt(100, 0), pt(100, 100)],
  },
  {
    id: 4,
    name: 'Sail Tuck',
    paper: [pt(0, 0), pt(120, 0), pt(0, 120)],
    creases: [
      { id: 'c1', a: pt(0, 60), b: pt(60, 0) },
      { id: 'd1', a: pt(0, 30), b: pt(30, 0) },
    ],
    solution: [{ creaseId: 'c1', side: -1 }],
    target: [pt(60, 0), pt(120, 0), pt(0, 120), pt(0, 60)],
  },
  {
    id: 5,
    name: 'Diamond Down',
    paper: [pt(50, 0), pt(100, 50), pt(50, 100), pt(0, 50)],
    creases: [
      { id: 'c1', a: pt(0, 50), b: pt(100, 50) },
      { id: 'd1', a: pt(50, 0), b: pt(50, 100) },
    ],
    solution: [{ creaseId: 'c1', side: -1 }],
    target: [pt(0, 50), pt(100, 50), pt(50, 100)],
  },
  {
    id: 6,
    name: 'Diamond Up',
    paper: [pt(50, 0), pt(100, 50), pt(50, 100), pt(0, 50)],
    creases: [
      { id: 'c1', a: pt(0, 50), b: pt(100, 50) },
      { id: 'd1', a: pt(50, 0), b: pt(50, 100) },
    ],
    solution: [{ creaseId: 'c1', side: 1 }],
    target: [pt(0, 50), pt(100, 50), pt(50, 0)],
  },
  {
    id: 7,
    name: 'Quarter Square',
    paper: SQ,
    creases: [
      { id: 'c1', a: pt(50, 0), b: pt(50, 100) },
      { id: 'c2', a: pt(50, 50), b: pt(100, 50) },
      { id: 'd1', a: pt(0, 0), b: pt(100, 100) },
    ],
    solution: [
      { creaseId: 'c1', side: 1 },
      { creaseId: 'c2', side: -1 },
    ],
    target: [pt(50, 50), pt(100, 50), pt(100, 100), pt(50, 100)],
  },
  {
    id: 8,
    name: 'Pennant',
    paper: SQ,
    creases: [
      { id: 'c1', a: pt(0, 0), b: pt(100, 100) },
      { id: 'c2', a: pt(50, 50), b: pt(100, 50) },
    ],
    solution: [
      { creaseId: 'c1', side: 1 },
      { creaseId: 'c2', side: 1 },
    ],
    target: [pt(0, 0), pt(100, 0), pt(100, 50), pt(50, 50)],
  },
  {
    id: 9,
    name: 'Dart',
    paper: SQ,
    creases: [
      { id: 'c1', a: pt(0, 0), b: pt(100, 100) },
      { id: 'c2', a: pt(0, 100), b: pt(100, 0) },
    ],
    solution: [
      { creaseId: 'c1', side: 1 },
      { creaseId: 'c2', side: 1 },
    ],
    target: [pt(0, 0), pt(100, 0), pt(50, 50)],
  },
  {
    id: 10,
    name: 'Boat',
    paper: [pt(0, 0), pt(160, 0), pt(160, 80), pt(0, 80)],
    creases: [
      { id: 'c1', a: pt(80, 0), b: pt(80, 80) },
      { id: 'c2', a: pt(80, 0), b: pt(160, 80) },
      { id: 'd1', a: pt(80, 80), b: pt(160, 0) },
    ],
    solution: [
      { creaseId: 'c1', side: 1 },
      { creaseId: 'c2', side: -1 },
    ],
    target: [pt(80, 0), pt(80, 80), pt(160, 80)],
  },
  {
    // Swapped into the L7–15 2-par plateau (was level 17) to vary its shape
    // mix; Gem moved to 17 as a breather between two 3-par levels.
    id: 11,
    name: 'Kite Fold',
    paper: [pt(60, 0), pt(120, 60), pt(60, 120), pt(0, 60)],
    creases: [
      { id: 'c1', a: pt(60, 0), b: pt(60, 120) },
      { id: 'c2', a: pt(60, 60), b: pt(120, 60) },
    ],
    solution: [
      { creaseId: 'c1', side: 1 },
      { creaseId: 'c2', side: -1 },
    ],
    target: [pt(60, 60), pt(120, 60), pt(60, 120)],
  },
  {
    id: 12,
    name: 'Envelope',
    paper: SQ,
    creases: [
      { id: 'c1', a: pt(0, 50), b: pt(50, 0) },
      { id: 'c2', a: pt(50, 0), b: pt(100, 50) },
      { id: 'd1', a: pt(0, 100), b: pt(50, 50) },
    ],
    solution: [
      { creaseId: 'c1', side: -1 },
      { creaseId: 'c2', side: -1 },
    ],
    target: [pt(0, 50), pt(50, 0), pt(100, 50), pt(100, 100), pt(0, 100)],
  },
  {
    id: 13,
    name: 'House',
    paper: [pt(0, 20), pt(100, 20), pt(100, 120), pt(0, 120)],
    creases: [
      { id: 'c1', a: pt(0, 60), b: pt(50, 20) },
      { id: 'c2', a: pt(50, 20), b: pt(100, 60) },
    ],
    solution: [
      { creaseId: 'c1', side: -1 },
      { creaseId: 'c2', side: -1 },
    ],
    target: [pt(50, 20), pt(100, 60), pt(100, 120), pt(0, 120), pt(0, 60)],
  },
  {
    id: 14,
    name: 'Scroll',
    paper: [pt(0, 0), pt(180, 0), pt(180, 60), pt(0, 60)],
    creases: [
      { id: 'c1', a: pt(120, 0), b: pt(120, 60) },
      { id: 'c2', a: pt(60, 0), b: pt(60, 60) },
      { id: 'd1', a: pt(90, 0), b: pt(90, 60) },
    ],
    solution: [
      { creaseId: 'c1', side: -1 },
      { creaseId: 'c2', side: 1 },
    ],
    target: [pt(60, 0), pt(120, 0), pt(120, 60), pt(60, 60)],
  },
  {
    id: 15,
    name: 'Ribbon',
    paper: [pt(0, 0), pt(60, 0), pt(60, 150), pt(0, 150)],
    creases: [
      { id: 'c1', a: pt(0, 100), b: pt(60, 100) },
      { id: 'c2', a: pt(0, 50), b: pt(60, 50) },
    ],
    solution: [
      { creaseId: 'c1', side: 1 },
      { creaseId: 'c2', side: -1 },
    ],
    target: [pt(0, 50), pt(60, 50), pt(60, 100), pt(0, 100)],
  },
  {
    id: 16,
    name: 'Crane Base',
    paper: SQ,
    creases: [
      { id: 'c1', a: pt(50, 0), b: pt(50, 100) },
      { id: 'c2', a: pt(50, 50), b: pt(100, 50) },
      { id: 'c3', a: pt(50, 50), b: pt(100, 100) },
      { id: 'd1', a: pt(50, 100), b: pt(100, 50) },
    ],
    solution: [
      { creaseId: 'c1', side: 1 },
      { creaseId: 'c2', side: -1 },
      { creaseId: 'c3', side: 1 },
    ],
    target: [pt(50, 50), pt(100, 50), pt(100, 100)],
  },
  {
    // Was level 11; moved here as a 2-par breather between Crane Base and
    // Tower (both 3-par), breaking the old flat L7–15 plateau.
    id: 17,
    name: 'Gem',
    paper: SQ,
    creases: [
      { id: 'c1', a: pt(0, 50), b: pt(50, 0) },
      { id: 'c2', a: pt(50, 100), b: pt(100, 50) },
    ],
    solution: [
      { creaseId: 'c1', side: -1 },
      { creaseId: 'c2', side: 1 },
    ],
    target: [pt(50, 0), pt(100, 0), pt(100, 50), pt(50, 100), pt(0, 100), pt(0, 50)],
  },
  {
    id: 18,
    name: 'Tower',
    paper: SQ,
    creases: [
      { id: 'c1', a: pt(0, 50), b: pt(100, 50) },
      { id: 'c2', a: pt(50, 50), b: pt(50, 100) },
      { id: 'c3', a: pt(50, 100), b: pt(100, 50) },
      { id: 'd1', a: pt(0, 0), b: pt(100, 100) },
    ],
    solution: [
      { creaseId: 'c1', side: -1 },
      { creaseId: 'c2', side: 1 },
      { creaseId: 'c3', side: -1 },
    ],
    target: [pt(50, 100), pt(100, 50), pt(100, 100)],
  },
  {
    id: 19,
    name: 'Slim',
    paper: [pt(0, 0), pt(240, 0), pt(240, 60), pt(0, 60)],
    creases: [
      { id: 'c1', a: pt(180, 0), b: pt(180, 60) },
      { id: 'c2', a: pt(60, 0), b: pt(60, 60) },
      { id: 'c3', a: pt(120, 0), b: pt(120, 60) },
    ],
    solution: [
      { creaseId: 'c1', side: -1 },
      { creaseId: 'c2', side: 1 },
      { creaseId: 'c3', side: 1 },
    ],
    target: [pt(120, 0), pt(180, 0), pt(180, 60), pt(120, 60)],
  },
  {
    id: 20,
    name: 'Cootie Catcher',
    paper: SQ,
    creases: [
      { id: 'c1', a: pt(0, 50), b: pt(50, 0) },
      { id: 'c2', a: pt(50, 0), b: pt(100, 50) },
      { id: 'c3', a: pt(100, 50), b: pt(50, 100) },
      { id: 'c4', a: pt(50, 100), b: pt(0, 50) },
    ],
    solution: [
      { creaseId: 'c1', side: -1 },
      { creaseId: 'c2', side: -1 },
      { creaseId: 'c3', side: -1 },
      { creaseId: 'c4', side: -1 },
    ],
    target: [pt(50, 0), pt(100, 50), pt(50, 100), pt(0, 50)],
  },
  {
    id: 21,
    name: 'L-Trim',
    paper: [pt(0, 0), pt(100, 0), pt(100, 50), pt(50, 50), pt(50, 100), pt(0, 100)],
    creases: [{ id: 'c1', a: pt(0, 50), b: pt(50, 50) }],
    solution: [{ creaseId: 'c1', side: 1 }],
    target: [pt(0, 0), pt(100, 0), pt(100, 50), pt(0, 50)],
  },
  {
    id: 22,
    name: 'T-Collapse',
    paper: [
      pt(25, 0),
      pt(75, 0),
      pt(75, 50),
      pt(100, 50),
      pt(100, 100),
      pt(0, 100),
      pt(0, 50),
      pt(25, 50),
    ],
    creases: [
      { id: 'c1', a: pt(25, 50), b: pt(25, 100) },
      { id: 'c2', a: pt(75, 50), b: pt(75, 100) },
      { id: 'd1', a: pt(25, 0), b: pt(25, 50) },
    ],
    solution: [
      { creaseId: 'c1', side: 1 },
      { creaseId: 'c2', side: -1 },
    ],
    target: [pt(25, 0), pt(75, 0), pt(75, 100), pt(25, 100)],
  },
  {
    id: 23,
    name: 'Cross to Square',
    paper: [
      pt(40, 0),
      pt(80, 0),
      pt(80, 40),
      pt(120, 40),
      pt(120, 80),
      pt(80, 80),
      pt(80, 120),
      pt(40, 120),
      pt(40, 80),
      pt(0, 80),
      pt(0, 40),
      pt(40, 40),
    ],
    creases: [
      { id: 'c1', a: pt(40, 40), b: pt(40, 80) },
      { id: 'c2', a: pt(80, 40), b: pt(80, 80) },
      { id: 'c3', a: pt(40, 40), b: pt(80, 40) },
      { id: 'c4', a: pt(40, 80), b: pt(80, 80) },
    ],
    solution: [
      { creaseId: 'c1', side: 1 },
      { creaseId: 'c2', side: -1 },
      { creaseId: 'c3', side: -1 },
      { creaseId: 'c4', side: 1 },
    ],
    target: [pt(40, 40), pt(80, 40), pt(80, 80), pt(40, 80)],
  },
  {
    id: 24,
    name: 'Chevron',
    paper: SQ,
    creases: [
      { id: 'c1', a: pt(0, 0), b: pt(100, 100) },
      { id: 'c2', a: pt(50, 0), b: pt(100, 50) },
    ],
    solution: [
      { creaseId: 'c1', side: 1 },
      { creaseId: 'c2', side: -1 },
    ],
    target: [pt(0, 0), pt(50, 0), pt(100, 50), pt(100, 100)],
  },
  {
    id: 25,
    name: 'Cabinet',
    paper: [pt(0, 0), pt(160, 0), pt(160, 100), pt(0, 100)],
    creases: [
      { id: 'c1', a: pt(40, 0), b: pt(40, 100) },
      { id: 'c2', a: pt(120, 0), b: pt(120, 100) },
      { id: 'c3', a: pt(40, 50), b: pt(120, 50) },
    ],
    solution: [
      { creaseId: 'c1', side: 1 },
      { creaseId: 'c2', side: -1 },
      { creaseId: 'c3', side: -1 },
    ],
    target: [pt(40, 50), pt(120, 50), pt(120, 100), pt(40, 100)],
  },
  {
    id: 26,
    name: 'Frog Base',
    paper: SQ,
    creases: [
      { id: 'c1', a: pt(0, 0), b: pt(100, 100) },
      { id: 'c2', a: pt(0, 100), b: pt(100, 0) },
      { id: 'c3', a: pt(50, 0), b: pt(50, 50) },
      { id: 'd1', a: pt(0, 50), b: pt(50, 0) },
    ],
    solution: [
      { creaseId: 'c1', side: 1 },
      { creaseId: 'c2', side: 1 },
      { creaseId: 'c3', side: 1 },
    ],
    target: [pt(50, 0), pt(100, 0), pt(50, 50)],
  },
  {
    id: 27,
    name: 'Band',
    paper: [pt(50, 0), pt(100, 25), pt(100, 75), pt(50, 100), pt(0, 75), pt(0, 25)],
    creases: [
      { id: 'c1', a: pt(0, 25), b: pt(100, 25) },
      { id: 'c2', a: pt(0, 75), b: pt(100, 75) },
    ],
    solution: [
      { creaseId: 'c1', side: -1 },
      { creaseId: 'c2', side: 1 },
    ],
    target: [pt(0, 25), pt(100, 25), pt(100, 75), pt(0, 75)],
  },
  {
    id: 28,
    name: 'Paper Plane',
    paper: [pt(0, 0), pt(120, 0), pt(120, 60), pt(0, 60)],
    creases: [
      { id: 'c1', a: pt(60, 0), b: pt(60, 60) },
      { id: 'c2', a: pt(60, 0), b: pt(120, 60) },
      { id: 'c3', a: pt(60, 30), b: pt(90, 60) },
      { id: 'd1', a: pt(60, 60), b: pt(120, 0) },
    ],
    solution: [
      { creaseId: 'c1', side: 1 },
      { creaseId: 'c2', side: -1 },
      { creaseId: 'c3', side: 1 },
    ],
    target: [pt(60, 0), pt(60, 30), pt(90, 60), pt(120, 60)],
  },
  {
    id: 29,
    name: 'Cottage',
    paper: [pt(0, 0), pt(80, 0), pt(80, 120), pt(0, 120)],
    creases: [
      { id: 'c1', a: pt(0, 40), b: pt(40, 0) },
      { id: 'c2', a: pt(40, 0), b: pt(80, 40) },
      { id: 'c3', a: pt(0, 90), b: pt(80, 90) },
    ],
    solution: [
      { creaseId: 'c1', side: -1 },
      { creaseId: 'c2', side: -1 },
      { creaseId: 'c3', side: 1 },
    ],
    target: [pt(40, 0), pt(80, 40), pt(80, 90), pt(0, 90), pt(0, 40)],
  },
  {
    id: 30,
    name: 'Grand Finale',
    paper: [pt(0, 0), pt(120, 0), pt(120, 120), pt(0, 120)],
    creases: [
      { id: 'c1', a: pt(60, 0), b: pt(60, 120) },
      { id: 'c2', a: pt(60, 60), b: pt(120, 60) },
      { id: 'c3', a: pt(60, 60), b: pt(120, 120) },
      { id: 'c4', a: pt(90, 60), b: pt(120, 90) },
      { id: 'd1', a: pt(60, 120), b: pt(120, 60) },
    ],
    solution: [
      { creaseId: 'c1', side: 1 },
      { creaseId: 'c2', side: -1 },
      { creaseId: 'c3', side: 1 },
      { creaseId: 'c4', side: -1 },
    ],
    target: [pt(60, 60), pt(90, 60), pt(120, 90), pt(120, 120)],
  },
];

export function levelByIndex(i: number): Level {
  return LEVELS[i];
}
