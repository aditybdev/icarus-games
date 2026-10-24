# Tap the 57

The glass ketchup bottle that won't pour — gaming's most famous food
frustration, finally playable. Rhythm-tap the bottle's "57" sweet spot to
build pressure, watch the landing dot walk across the counter, then drag to
aim and let go to squirt. Greed is the engine: every tap is more range, but
one tap past the line and the bottle erupts on the table.

## How a run works

- **Menu** — best rush, medal, condiment collection, daily line.
- **Order card** — five orders per rush (fries, burger, hot dog, then moving
  plates). 1.5s beat, tap to skip.
- **Build** — the 57 pulses on a ring that closes in rhythm. Tap on the beat
  for full pressure (perfect streaks climb a pitch ladder; 5 in a row lights
  fever). The rhythm *speeds up* as pressure rises — greed literally raises
  the tempo. Pressure also settles slowly, so overshooting the mark can be
  bled off by waiting a beat: the patience lever.
- **Aim** — drag to steer (arc preview shows the squirt path), release to
  fire. The build-phase landing dot already told you where 45° lands; angle
  is the fine control.
- **Two-phase near-miss** — under-pressure is the sad dribble that drops
  short; one tap too many is the SPLAT (order lost, counter stained).
- **Scoring** — coverage of the plate zone, 0–100 per order; dead-center is
  "Plated!" for the full count. Rush total /500 with bronze/silver/gold
  medals at 180/300/420 and a near-miss gap line on the results card.
- **Daily Diner** — five seeded orders, same lineup for everyone today
  (order-local sim time resets each order, movers are deterministic).
  Streaks persist.

## Architecture notes

- **Pure core** (`src/core/`, node-testable, no DOM): `bottle.ts` is the
  rhythm/pressure model (triangle-quality taps, pressure-scaled period,
  settle decay, splat threshold); `flight.ts` the single viscous blob on a
  parametric arc — blobby by design, never a fluid sim — with closed-form
  range and pressure inverse; `orders.ts` targets/coverage/Plated! + the
  fixed rush book and seeded daily book; `save.ts` persisted shape
  `{ v: 1, bestRush, medal, stats, dailyStreak, bottle, ... }`;
  `bottles.ts` the 3-condiment collection (Ketchup free, Mustard at 10
  orders served, Sriracha at a gold rush).
- **DOM side** (`src/game/`, `src/ui/`): Canvas 2D diner renderer (bottle
  with tap squash + pressure tremble, pulse ring, gauge with the order
  band, landing dot / arc preview, moving plates with food, pooled splat
  particles + stains, float texts), pointer input splitting taps from
  aim-drags, WebAudio-synth sfx (thock pitch ladder, squirt, splat, Plated!
  ding, medal sting, fever pad), and a small DOM overlay UI. `src/main.ts`
  glues to the shared `@icarus/platform` adapter (ready, lifecycle
  pause/resume, load/save, score, errors).
- The fair order clock only advances while unpaused; pausing freezes the
  rhythm, the movers and the flight, mutes audio, and shows the pause
  overlay only mid-run. `body.paused` has exactly one owner.
- Medal thresholds were bot-calibrated (perfect ≈498, strong ≈490, decent
  ≈317, sloppy ≈106) so bronze lands run 1–2, silver ≈3 attempts, gold is
  top-decile.

## Dev / build

From the repo root:

```sh
npm run dev -w @icarus/tap57      # vite dev server
npm run build -w @icarus/tap57    # production build -> dist/
npm run test -w @icarus/tap57     # vitest (pure core)
npm run typecheck -w @icarus/tap57
```

Or from this directory: `npm run dev`, `npm run build`, `npm run test`,
`npm run typecheck` (binaries resolve via the root `node_modules`).
