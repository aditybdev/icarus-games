# Skim

A stone-skipping tap-timing game. Flick to throw your stone across a morning
lake, then tap each time it kisses the water to keep it skipping. Every tap is
answered against a live, shrinking timing window — the closer to the ideal
moment you tap, the more speed the stone keeps. Miss a window and the stone
sinks; distance is the score.

## How a run works

- **Menu** — best distance, medal, throw stats, stone collection, daily line.
- **Aim** — drag and release anywhere: the flick's speed and angle become the
  throw (clamped into a skippable envelope). First two runs teach with a
  "Flick to throw!" hint.
- **Skip** — when the stone touches down a contact ring closes around it:
  green → gold → red as the window decays. Tap while the ring is up:
  - **perfect tap** (top quartile of the window) keeps the most speed and
    builds a perfect chain — 5 in a row lights fever mode (audio bed + glow);
  - a late/early tap still bounces, but bleeds more speed;
  - no tap before the ring empties → the stone plunges and the throw ends.
- Even perfect play bleeds speed (max 97% retained per bounce), so every
  throw ends — the skill is stretching the decay. Medals at 30/75/150 m.
- **Results** — distance, skips, medal progress with a near-miss line
  ("4.2 m from gold"), best badge, replay instantly.
- **Daily Skip** — 3 throws on a lake seeded from the UTC date (same wind and
  wave phase for everyone; sim time resets each throw so the seed is honest).
  Total distance across the 3 throws is the daily score; streaks persist.

## Architecture notes

- **Pure core** (`src/core/`, node-testable, no DOM): `sim.ts` is a fixed-step
  (120 Hz) deterministic projectile sim — real gravity, analytic wave surface,
  contact windows that freeze the stone at the contact point until the tap or
  timeout, quality-scaled bounce restitution, dead-stone plunge. `scoring.ts`
  medals/formatting/daily-lake seeding; `save.ts` persisted shape
  `{ v: 1, bestM, medal, stats, dailyStreak, stone, ... }`; `stones.ts` the
  3-stone collection (Granite free, River Slate by throws, Meteorite at gold).
- **DOM side** (`src/game/`, `src/ui/`): Canvas 2D renderer (procedural sky,
  parallax hills, analytic water polygon, buoys every 10 m, pooled ripples
  and splash particles, contact-ring telegraph, camera that eases after the
  stone), pointer input with tissue-style velocity sampling, WebAudio-synth
  sfx (whoosh/plip pitch ladder/perfect chain/medal sting/fever bed), and a
  small DOM overlay UI. `src/main.ts` glues to the shared `@icarus/platform`
  adapter (ready, lifecycle pause/resume, load/save, score, errors).
- The fair game clock only advances while unpaused; pausing freezes the sim,
  mutes audio, and shows the pause overlay only mid-run (host pauses in menus
  just freeze the clock). `body.paused` has exactly one owner.
- Audio starts after the first user gesture and follows the host's
  `isAudioEnabled()` state; nothing is ever scheduled on a suspended context.

## Dev / build

From the repo root:

```sh
npm run dev -w @icarus/skim      # vite dev server
npm run build -w @icarus/skim    # production build -> dist/
npm run test -w @icarus/skim     # vitest (pure core)
npm run typecheck -w @icarus/skim
```

Or from this directory: `npm run dev`, `npm run build`, `npm run test`,
`npm run typecheck` (binaries resolve via the root `node_modules`).
