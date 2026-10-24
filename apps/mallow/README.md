# Golden Mallow

A cozy campfire roast-timing game. Drag to rotate your marshmallow over the
flames, toast every side into the golden-brown window, and tap to pull it at
the perfect moment — raw, Golden!, or on fire.

## How a run works

- **Menu** — Campfire Night (5-mallow rush) or Daily Campfire (5 seeded
  mallows with gusty wind, same for everyone). Your best night, daily streak
  and lifetime roast stats are shown, plus the s'more recipe collection.
- **Order card** — each mallow arrives with an order: Lightly toasted,
  Golden, or Well-done, each with its own doneness window and fire
  intensity. Tap to skip the card.
- **Roast** — drag anywhere to rotate the skewer; the mallow's per-face
  color IS the doneness meter, and a gauge up top marks the order window,
  the ignition line and your current average. Only the downward hemisphere
  heats, so parking one face over the flame ignites it:
  - **On fire!** — shake (drag back and forth) to extinguish into a
    singed-but-saved face, or the flame chars it to locked charcoal in 2 s
    and spreads heat while it burns.
- **Pull** — tap to serve. Scoring is triangular closeness to the order's
  perfect doneness × evenness across faces, with hard caps for raw, burnt
  and still-flaming pulls. Grades run S/A/B/C/D per mallow.
- **Results** — night total (max 500), medal (bronze 180 / silver 300 /
  gold 420), the exact gap to the next medal, per-mallow badges, and your
  golden/burnt tally. Daily runs add the streak line.

Unlockables: Peanut Butter Cup at 10 lifetime mallows, Mint Chocolate for a
gold-medal night. Treats reskin the menu dots and the serve-plate garnish.

## Architecture notes

- **Pure core** (`src/core/`, node-testable, no DOM): `mallow.ts` is the
  roast sim — per-face heat accumulation with a cos^k orientation falloff,
  flickering `Fire` (seeded gusts for the daily), ignition/char/extinguish
  events; `orders.ts` the order book + triangular scoring; `scoring.ts`
  medals; `save.ts` the persisted shape `{ v: 1, bestRush, medal, stats,
  daily…, treat, flags }`; `treats.ts` the recipe collection.
- **DOM side** (`src/game/`, `src/ui/`): Canvas 2D renderer (all art
  procedural — twinkling stars, pooled flame particles + ember glow, per-face
  mallow strips, doneness gauge, order cards), pointer input (drag rotate /
  tap pull with a 14 px split), WebAudio-synthesized sfx (campfire crackle
  bed, rotation creaks, ignition whoomp + sizzle loop, golden ding, sad
  trombone) and a small DOM overlay UI. `src/main.ts` glues everything to
  the shared `@icarus/platform` adapter (ready, lifecycle pause/resume,
  load/save, score, error reporting).
- Fixed-step (120 Hz) sim on a fair clock: sim time only advances while
  unpaused and resets per mallow, so a daily seed produces identical wind
  for everyone. Pausing freezes the scene and mutes instantly.
- Audio starts after the first user gesture and follows the host's
  `isAudioEnabled()` state.

## Dev / build

From the repo root:

```sh
npm run dev -w @icarus/mallow      # vite dev server
npm run build -w @icarus/mallow    # production build -> dist/
npm run test -w @icarus/mallow     # vitest (pure core)
npm run typecheck -w @icarus/mallow
```

Or from this directory: `npm run dev`, `npm run build`, `npm run test`,
`npm run typecheck` (binaries resolve via the root `node_modules`).
